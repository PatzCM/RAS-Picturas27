"""
s3_client.py
=============
Módulo responsável por toda a comunicação com o SeaweedFS (S3).
Usa a biblioteca boto3 para descarregar e enviar ficheiros de vídeo.
"""

import os
import logging
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError

logger = logging.getLogger("video_convert_s3")


class S3Client:
    """
    Cliente para interagir com o SeaweedFS através da API S3.
    """

    def __init__(self, endpoint_url=None, access_key=None, secret_key=None, region="us-east-1"):
        # Lê variáveis de ambiente caso não sejam fornecidas explicitamente
        self.endpoint_url = endpoint_url or os.environ.get("S3_ENDPOINT", "http://seaweedfs:9000")
        if not self.endpoint_url.startswith("http://") and not self.endpoint_url.startswith("https://"):
            self.endpoint_url = f"http://{self.endpoint_url}"

        self.access_key = access_key or os.environ.get("S3_ACCESS_KEY", "admin")
        self.secret_key = secret_key or os.environ.get("S3_SECRET_KEY", "admin123")
        self.region = region or os.environ.get("S3_REGION", "us-east-1")

        logger.info(f"A inicializar S3Client com endpoint: {self.endpoint_url}, region: {self.region}")

        # path-style addressing é obrigatório para SeaweedFS e MinIO
        self.client = boto3.client(
            "s3",
            endpoint_url=self.endpoint_url,
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            region_name=self.region,
            config=Config(s3={"addressing_style": "path"}),
        )

    def ensure_bucket_exists(self, bucket: str):
        """
        Garante que o bucket existe no SeaweedFS antes de tentar upload/download.
        """
        try:
            self.client.head_bucket(Bucket=bucket)
            logger.debug(f"Bucket '{bucket}' verificado com sucesso.")
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code")
            if error_code in ["404", "NoSuchBucket"]:
                logger.info(f"Bucket '{bucket}' não existe. A criar...")
                self.client.create_bucket(Bucket=bucket)
                logger.info(f"Bucket '{bucket}' criado.")
            else:
                logger.warning(f"Erro ao verificar bucket '{bucket}': {e}. A tentar criar...")
                try:
                    self.client.create_bucket(Bucket=bucket)
                except Exception as create_err:
                    logger.error(f"Falha ao criar bucket '{bucket}': {create_err}")

    def download_file(self, bucket: str, key: str, local_path: str):
        """
        Descarrega um ficheiro do SeaweedFS para o sistema de ficheiros local (/tmp).
        """
        logger.info(f"⬇️  A descarregar s3://{bucket}/{key} -> {local_path}")
        self.ensure_bucket_exists(bucket)

        os.makedirs(os.path.dirname(local_path), exist_ok=True)
        self.client.download_file(bucket, key, local_path)

        size_bytes = os.path.getsize(local_path)
        logger.info(f"✅ Download concluído: {size_bytes / (1024 * 1024):.2f} MB")
        return local_path

    def upload_file(self, local_path: str, bucket: str, key: str, content_type: str = None):
        """
        Envia o vídeo convertido para o SeaweedFS.
        """
        logger.info(f"⬆️  A enviar {local_path} -> s3://{bucket}/{key}")
        self.ensure_bucket_exists(bucket)

        extra_args = {}
        if content_type:
            extra_args["ContentType"] = content_type
        elif local_path.endswith(".mp4"):
            extra_args["ContentType"] = "video/mp4"
        elif local_path.endswith(".webm"):
            extra_args["ContentType"] = "video/webm"
        elif local_path.endswith(".mkv"):
            extra_args["ContentType"] = "video/x-matroska"
        elif local_path.endswith(".mov"):
            extra_args["ContentType"] = "video/quicktime"

        if extra_args:
            self.client.upload_file(local_path, bucket, key, ExtraArgs=extra_args)
        else:
            self.client.upload_file(local_path, bucket, key)

        logger.info(f"✅ Upload concluído com sucesso para s3://{bucket}/{key}")
