import json
import pytest
from unittest.mock import MagicMock
from Tools.video_convert.video_convert import (
    publish_ws_progress,
    publish_result,
    publish_error,
    cancelled_jobs,
    cancelled_lock,
    QUEUE_WS,
    QUEUE_RESULT,
    EXCHANGE_NAME
)


def test_publish_ws_progress():
    """
    Testa se o evento de progresso é enviado com o formato esperado para a ws_queue.
    """
    mock_channel = MagicMock()
    publish_ws_progress(
        mock_channel,
        correlation_id="job-1234",
        progress=45.67,
        status="processing",
        project_id="proj-999",
        user_id="user-42"
    )

    mock_channel.basic_publish.assert_called_once()
    args, kwargs = mock_channel.basic_publish.call_args
    assert kwargs["exchange"] == EXCHANGE_NAME
    assert kwargs["routing_key"] == QUEUE_WS

    payload = json.loads(kwargs["body"])
    assert payload["type"] == "video-convert-progress"
    assert payload["correlationId"] == "job-1234"
    assert payload["progress"] == 45.7  # Arredondado a 1 casa decimal
    assert payload["status"] == "processing"
    assert payload["projectId"] == "proj-999"
    assert payload["user"] == "user-42"
    assert "timestamp" in payload


def test_publish_result():
    """
    Testa se o resultado de sucesso é enviado com os campos esperados para a fila de resultados.
    """
    mock_channel = MagicMock()
    publish_result(
        mock_channel,
        correlation_id="job-5678",
        output_bucket="user-42",
        output_key="proj-999/out/converted.mp4",
        metadata={"format": "mp4", "width": 1280, "height": 720}
    )

    mock_channel.basic_publish.assert_called_once()
    args, kwargs = mock_channel.basic_publish.call_args
    assert kwargs["exchange"] == EXCHANGE_NAME
    assert kwargs["routing_key"] == QUEUE_RESULT

    payload = json.loads(kwargs["body"])
    assert payload["correlationId"] == "job-5678"
    assert payload["status"] == "success"
    assert payload["output"]["bucket"] == "user-42"
    assert payload["output"]["key"] == "proj-999/out/converted.mp4"
    assert payload["result"]["key"] == "proj-999/out/converted.mp4"
    assert payload["metadata"]["format"] == "mp4"


def test_publish_error():
    """
    Testa se o erro é enviado tanto para a fila de resultados como para a ws_queue.
    """
    mock_channel = MagicMock()
    publish_error(
        mock_channel,
        correlation_id="job-fail-1",
        error_message="Ficheiro corrompido"
    )

    # Deve publicar em QUEUE_RESULT e em QUEUE_WS
    assert mock_channel.basic_publish.call_count == 2

    # Primeira chamada: video_convert_result_queue
    call_1 = mock_channel.basic_publish.call_args_list[0]
    payload_1 = json.loads(call_1.kwargs["body"])
    assert payload_1["correlationId"] == "job-fail-1"
    assert payload_1["status"] == "error"
    assert "Ficheiro corrompido" in payload_1["error"]

    # Segunda chamada: ws_queue com status error
    call_2 = mock_channel.basic_publish.call_args_list[1]
    payload_2 = json.loads(call_2.kwargs["body"])
    assert payload_2["type"] == "video-convert-progress"
    assert payload_2["status"] == "error"


def test_cancellation_tracking():
    """
    Testa o controlo do conjunto de jobs cancelados com thread lock.
    """
    test_id = "test-job-to-cancel"
    with cancelled_lock:
        cancelled_jobs.add(test_id)
        assert test_id in cancelled_jobs

    with cancelled_lock:
        cancelled_jobs.discard(test_id)
        assert test_id not in cancelled_jobs
