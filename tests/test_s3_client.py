import os
import tempfile
import pytest
from unittest.mock import MagicMock, patch
from Tools.video_convert.s3_client import S3Client


def test_s3_client_initialization():
    """
    Testa se o cliente S3 inicializa com os parâmetros corretos.
    """
    with patch("boto3.client") as mock_boto:
        client = S3Client(
            endpoint_url="http://localhost:9000",
            access_key="test_user",
            secret_key="test_pass",
            region="us-east-1"
        )
        assert client.endpoint_url == "http://localhost:9000"
        assert client.access_key == "test_user"
        assert client.secret_key == "test_pass"
        mock_boto.assert_called_once()


def test_s3_client_download_file():
    """
    Testa se a função download_file invoca o boto3 corretamente.
    """
    with patch("boto3.client") as mock_boto:
        mock_s3_instance = MagicMock()
        mock_boto.return_value = mock_s3_instance

        client = S3Client(endpoint_url="http://localhost:9000")

        with tempfile.TemporaryDirectory() as tmpdir:
            local_file = os.path.join(tmpdir, "video.mp4")

            # Simular download criando o ficheiro
            def fake_download(bucket, key, target):
                with open(target, "wb") as f:
                    f.write(b"fake_video_content")

            mock_s3_instance.download_file.side_effect = fake_download

            result_path = client.download_file("test-bucket", "proj/src/video.mp4", local_file)
            assert os.path.exists(result_path)
            assert os.path.getsize(result_path) > 0
            mock_s3_instance.download_file.assert_called_once_with(
                "test-bucket", "proj/src/video.mp4", local_file
            )


def test_s3_client_upload_file():
    """
    Testa se a função upload_file passa o ContentType correto para vídeos.
    """
    with patch("boto3.client") as mock_boto:
        mock_s3_instance = MagicMock()
        mock_boto.return_value = mock_s3_instance

        client = S3Client(endpoint_url="http://localhost:9000")

        with tempfile.NamedTemporaryFile(suffix=".mp4") as tmp_file:
            client.upload_file(tmp_file.name, "test-bucket", "proj/out/video.mp4")

            mock_s3_instance.upload_file.assert_called_once()
            args, kwargs = mock_s3_instance.upload_file.call_args
            assert args[0] == tmp_file.name
            assert args[1] == "test-bucket"
            assert args[2] == "proj/out/video.mp4"
            assert kwargs.get("ExtraArgs", {}).get("ContentType") == "video/mp4"
