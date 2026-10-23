"""
video_convert.py
================
Microserviço Worker de Conversão de Vídeo do PictuRAS.

Responsabilidades:
1. Escutar pedidos na fila RabbitMQ: 'video_convert_queue'
2. Escutar pedidos de cancelamento na fila: 'video_convert_cancel_queue'
3. Descarregar vídeos do SeaweedFS (S3) para /tmp usando boto3
4. Chamar a função core FFmpeg (core/converter.py)
5. Enviar progresso em tempo real para a fila 'ws_queue'
6. Enviar resultados de sucesso ou erro para 'video_convert_result_queue'
7. Garantir limpeza de ficheiros temporários em /tmp em qualquer cenário
"""

import os
import sys
import json
import time
import shutil
import logging
import tempfile
import threading
from datetime import datetime, timezone

import pika

try:
    from s3_client import S3Client
    from core.converter import convert_video
except ImportError:
    from Tools.video_convert.s3_client import S3Client
    from Tools.video_convert.core.converter import convert_video

# Configuração de logs com formato limpo e legível
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [video_convert_tool] %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S"
)
logger = logging.getLogger("video_convert_tool")

# Variáveis de ambiente com valores por omissão da arquitetura PictuRAS
RABBITMQ_HOST = os.environ.get("RABBITMQ_HOST", "rabbitmq")
RABBITMQ_PORT = int(os.environ.get("RABBITMQ_PORT", "5672"))
RABBITMQ_USER = os.environ.get("RABBITMQ_USER", os.environ.get("RABBITMQ_USERNAME", "user"))
RABBITMQ_PASS = os.environ.get("RABBITMQ_PASS", os.environ.get("RABBITMQ_PASSWORD", "password"))

EXCHANGE_NAME = "picturas"
QUEUE_CONVERT = "video_convert_queue"
QUEUE_CANCEL = "video_convert_cancel_queue"
QUEUE_RESULT = "video_convert_result_queue"
QUEUE_WS = "ws_queue"

# Conjunto de correlationIds de tarefas canceladas (protegido por Lock)
cancelled_lock = threading.Lock()
cancelled_jobs = set()


def create_connection():
    """
    Cria uma ligação ao RabbitMQ com retentativas exponenciais.
    Essencial porque os contentores arrancam ao mesmo tempo.
    """
    credentials = pika.PlainCredentials(RABBITMQ_USER, RABBITMQ_PASS)
    parameters = pika.ConnectionParameters(
        host=RABBITMQ_HOST,
        port=RABBITMQ_PORT,
        virtual_host="/",
        credentials=credentials,
        heartbeat=60,
        blocked_connection_timeout=300
    )

    max_attempts = 15
    for attempt in range(1, max_attempts + 1):
        try:
            logger.info(f"Tentativa {attempt}/{max_attempts} de ligação ao RabbitMQ ({RABBITMQ_HOST}:{RABBITMQ_PORT})...")
            connection = pika.BlockingConnection(parameters)
            logger.info("✅ Ligação ao RabbitMQ estabelecida com sucesso!")
            return connection
        except pika.exceptions.AMQPConnectionError as err:
            wait = min(2 ** attempt, 20)
            logger.warning(f"RabbitMQ ainda não está pronto ({err}). A aguardar {wait}s...")
            time.sleep(wait)

    raise ConnectionError("❌ Não foi possível ligar ao RabbitMQ após várias tentativas.")


def publish_ws_progress(channel, correlation_id: str, progress: float, status: str = "processing", project_id: str = None, user_id: str = None):
    """
    Publica evento de progresso na fila ws_queue para que o wsGateway envie ao frontend.
    """
    message = {
        "type": "video-convert-progress",
        "correlationId": correlation_id,
        "progress": round(progress, 1),
        "status": status,
        "projectId": project_id,
        "user": user_id,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    try:
        channel.basic_publish(
            exchange=EXCHANGE_NAME,
            routing_key=QUEUE_WS,
            body=json.dumps(message),
            properties=pika.BasicProperties(content_type="application/json")
        )
    except Exception as e:
        logger.warning(f"Não foi possível publicar progresso na ws_queue: {e}")


def publish_result(channel, correlation_id: str, output_bucket: str, output_key: str, metadata: dict = None):
    """
    Publica o resultado da conversão concluída na fila video_convert_result_queue.
    """
    message = {
        "correlationId": correlation_id,
        "status": "success",
        "output": {
            "bucket": output_bucket,
            "key": output_key
        },
        "result": {
            "bucket": output_bucket,
            "key": output_key
        },
        "metadata": metadata or {},
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    channel.basic_publish(
        exchange=EXCHANGE_NAME,
        routing_key=QUEUE_RESULT,
        body=json.dumps(message),
        properties=pika.BasicProperties(
            content_type="application/json",
            delivery_mode=2  # Mensagem persistente
        )
    )
    logger.info(f"📬 Resultado publicado com sucesso na fila '{QUEUE_RESULT}': s3://{output_bucket}/{output_key}")


def publish_error(channel, correlation_id: str, error_message: str):
    """
    Publica mensagem de erro na fila video_convert_result_queue e na ws_queue.
    """
    message = {
        "correlationId": correlation_id,
        "status": "error",
        "error": error_message,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }

    try:
        channel.basic_publish(
            exchange=EXCHANGE_NAME,
            routing_key=QUEUE_RESULT,
            body=json.dumps(message),
            properties=pika.BasicProperties(
                content_type="application/json",
                delivery_mode=2
            )
        )
        logger.info(f"💥 Notificação de erro publicada na fila '{QUEUE_RESULT}': {error_message}")
    except Exception as e:
        logger.error(f"Erro ao publicar falha em {QUEUE_RESULT}: {e}")

    publish_ws_progress(channel, correlation_id, progress=0.0, status="error")


def start_cancel_listener():
    """
    Thread dedicada para escutar a fila video_convert_cancel_queue em tempo real.
    Quando recebe ordem de cancelamento, regista o correlationId no conjunto active.
    """
    def cancel_worker():
        try:
            conn = create_connection()
            ch = conn.channel()
            ch.exchange_declare(exchange=EXCHANGE_NAME, exchange_type="direct", durable=True)
            ch.queue_declare(queue=QUEUE_CANCEL, durable=True)
            ch.queue_bind(exchange=EXCHANGE_NAME, queue=QUEUE_CANCEL, routing_key=QUEUE_CANCEL)

            def on_cancel(ch_c, method, properties, body):
                try:
                    payload = json.loads(body.decode("utf-8"))
                    corr_id = payload.get("correlationId")
                    if corr_id:
                        with cancelled_lock:
                            cancelled_jobs.add(corr_id)
                        logger.warning(f"🛑 Recebido pedido de cancelamento para o job: {corr_id}")
                    ch_c.basic_ack(delivery_tag=method.delivery_tag)
                except Exception as ex:
                    logger.error(f"Erro ao processar mensagem de cancelamento: {ex}")
                    ch_c.basic_ack(delivery_tag=method.delivery_tag)

            ch.basic_consume(queue=QUEUE_CANCEL, on_message_callback=on_cancel, auto_ack=False)
            logger.info(f"🎧 Listener de cancelamentos ativo na fila '{QUEUE_CANCEL}'.")
            ch.start_consuming()
        except Exception as e:
            logger.error(f"Listener de cancelamentos terminou com erro: {e}")

    thread = threading.Thread(target=cancel_worker, daemon=True)
    thread.start()


def main():
    logger.info("🚀 A iniciar video_convert_tool worker...")

    s3 = S3Client()
    start_cancel_listener()

    connection = create_connection()
    channel = connection.channel()

    # Declarar Exchange e Filas para garantir que tudo existe
    channel.exchange_declare(exchange=EXCHANGE_NAME, exchange_type="direct", durable=True)

    channel.queue_declare(queue=QUEUE_CONVERT, durable=True)
    channel.queue_bind(exchange=EXCHANGE_NAME, queue=QUEUE_CONVERT, routing_key=QUEUE_CONVERT)

    channel.queue_declare(queue=QUEUE_RESULT, durable=True)
    channel.queue_bind(exchange=EXCHANGE_NAME, queue=QUEUE_RESULT, routing_key=QUEUE_RESULT)

    channel.queue_declare(queue=QUEUE_WS, durable=True)
    channel.queue_bind(exchange=EXCHANGE_NAME, queue=QUEUE_WS, routing_key=QUEUE_WS)

    # Processar um vídeo de cada vez (evita esgotar CPU e memória com FFmpeg concorrente)
    channel.basic_qos(prefetch_count=1)

    def on_convert_request(ch, method, properties, body):
        work_dir = None
        correlation_id = "unknown"

        try:
            req = json.loads(body.decode("utf-8"))
            message_id = req.get("messageId", "msg-unknown")
            correlation_id = req.get("correlationId", "job-unknown")
            procedure = req.get("procedure", "video_convert")

            resource = req.get("resource", {})
            input_res = resource.get("input", {})
            output_res = resource.get("output", {})
            params = req.get("parameters", {})

            input_bucket = input_res.get("bucket")
            input_key = input_res.get("key")
            output_bucket = output_res.get("bucket", input_bucket)
            project_id = output_res.get("projectId", "default")
            output_stage = output_res.get("stage", "out")

            target_format = params.get("targetFormat", "mp4").lower()
            target_resolution = params.get("targetResolution", "original")

            # Normalizar targetResolution: se for 'original', 'none' ou vazio, passar None para manter a resolução original no core
            res_clean = None
            if target_resolution and str(target_resolution).strip().lower() not in ("original", "none", ""):
                res_clean = str(target_resolution).strip().lower()

            # Normalizar targetFormat: se for 'original', manter formato original de entrada
            if target_format == "original":
                ext = os.path.splitext(input_key)[1].replace(".", "").lower()
                target_format = ext if ext in ("mp4", "webm", "mkv", "mov") else "mp4"

            logger.info("=" * 60)
            logger.info(f"📥 Recebido pedido de conversão:")
            logger.info(f"   MessageId: {message_id}")
            logger.info(f"   CorrelationId: {correlation_id}")
            logger.info(f"   Entrada: s3://{input_bucket}/{input_key}")
            logger.info(f"   Destino: formato={target_format}, resolução={res_clean or 'original (manter)'}")
            logger.info("=" * 60)

            # Verificar se já foi cancelado antes de iniciar
            with cancelled_lock:
                if correlation_id in cancelled_jobs:
                    logger.warning(f"⚠️ O job {correlation_id} já foi cancelado antes do início.")
                    publish_error(ch, correlation_id, "Conversão cancelada pelo utilizador.")
                    ch.basic_ack(delivery_tag=method.delivery_tag)
                    return

            # Criar pasta temporária isolada para esta conversão em /tmp
            work_dir = tempfile.mkdtemp(prefix=f"picturas_video_{correlation_id}_")

            # 1. Download do vídeo do SeaweedFS (S3)
            publish_ws_progress(ch, correlation_id, progress=5.0, status="downloading", project_id=project_id)
            input_ext = os.path.splitext(input_key)[1] or f".{target_format}"
            local_input = os.path.join(work_dir, f"input_original{input_ext}")

            s3.download_file(input_bucket, input_key, local_input)
            publish_ws_progress(ch, correlation_id, progress=15.0, status="downloaded", project_id=project_id)

            # 2. Preparar caminhos para conversão FFmpeg
            temp_filename = f"temp_output.{target_format}"
            local_temp_output = os.path.join(work_dir, temp_filename)

            # Callback de progresso do FFmpeg mapeado para 15% -> 85% do processo total
            def handle_ffmpeg_progress(data):
                percent = float(data.get("percent", 0.0))
                total_mapped = 15.0 + (percent * 0.70)
                publish_ws_progress(ch, correlation_id, progress=total_mapped, status="processing", project_id=project_id)

            def check_is_cancelled():
                with cancelled_lock:
                    return correlation_id in cancelled_jobs

            input_data = {
                "inputPath": local_input,
                "outputPath": local_temp_output,
                "targetFormat": target_format,
                "targetResolution": res_clean,
                "timeoutMs": 15 * 60 * 1000  # Timeout de 15 minutos conforme requisito RNF
            }

            logger.info(f"🎬 A executar conversão FFmpeg...")
            conversion_result = convert_video(
                input_data,
                on_progress=handle_ffmpeg_progress,
                is_cancelled=check_is_cancelled
            )

            # Determinar a resolução final real a partir dos metadados extraídos pelo core
            out_height = conversion_result.get("height")
            res_tag = f"_{out_height}p" if out_height else ""
            output_filename = f"converted_{int(time.time())}{res_tag}.{target_format}"
            local_output = os.path.join(work_dir, output_filename)
            os.rename(local_temp_output, local_output)
            conversion_result["outputPath"] = local_output

            # 3. Upload do resultado para o SeaweedFS (S3)
            publish_ws_progress(ch, correlation_id, progress=88.0, status="uploading", project_id=project_id)
            output_key = f"{project_id}/{output_stage}/{output_filename}"

            s3.upload_file(local_output, output_bucket, output_key)

            # Também guardar em src/ para ficar disponível na biblioteca do projeto (RN4 / REQ-VID-LIB-001)
            src_key = f"{project_id}/src/{output_filename}"
            try:
                s3.upload_file(local_output, output_bucket, src_key)
            except Exception as e_src:
                logger.warning(f"Não foi possível guardar cópia em src: {e_src}")

            # 4. Publicar resultado e progresso final 100%
            publish_ws_progress(ch, correlation_id, progress=100.0, status="completed", project_id=project_id)
            publish_result(ch, correlation_id, output_bucket, output_key, metadata=conversion_result)

            logger.info(f"🎉 Conversão concluída com sucesso para o job {correlation_id}!")
            ch.basic_ack(delivery_tag=method.delivery_tag)

        except Exception as e:
            logger.error(f"❌ Falha no processamento do vídeo (job {correlation_id}): {e}", exc_info=True)
            publish_error(ch, correlation_id, str(e))
            # ACK para descartar a mensagem e evitar ciclo infinito de erros na fila
            ch.basic_ack(delivery_tag=method.delivery_tag)

        finally:
            # 5. Limpeza de ficheiros temporários em /tmp em qualquer circunstância
            if work_dir and os.path.exists(work_dir):
                try:
                    shutil.rmtree(work_dir)
                    logger.debug(f"🧹 Diretório temporário removido: {work_dir}")
                except Exception as clean_err:
                    logger.warning(f"Erro ao remover pasta temporária {work_dir}: {clean_err}")

            with cancelled_lock:
                cancelled_jobs.discard(correlation_id)

    channel.basic_consume(queue=QUEUE_CONVERT, on_message_callback=on_convert_request, auto_ack=False)
    logger.info(f"🎧 Worker pronto e à escuta na fila '{QUEUE_CONVERT}'...")

    try:
        channel.start_consuming()
    except KeyboardInterrupt:
        logger.info("Worker interrompido pelo utilizador.")
        channel.stop_consuming()
    finally:
        connection.close()


if __name__ == "__main__":
    main()
