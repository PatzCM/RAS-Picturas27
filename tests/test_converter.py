import os
import shutil
import pytest
from Tools.video_convert.core.converter import convert_video, validate_input_video, get_video_metadata

# Paths for the tests
FIXTURE_PATH = "tests/fixtures/fixture.mp4"
TMP_INPUT = "/tmp/test_input.mp4"
TMP_OUTPUT = "/tmp/test_output.mp4"

@pytest.fixture
def video_environment():
    """
    Setup: Copies the fixture video to the /tmp folder before each test.
    Teardown: Deletes the temporary files after the test finishes.
    """
    # 1. Setup
    shutil.copy(FIXTURE_PATH, TMP_INPUT)
    
    # Pauses the setup to let the test run
    yield 
    
    # 2. Teardown / Cleanup (Tarefa J-09)
    if os.path.exists(TMP_INPUT):
        os.remove(TMP_INPUT)
    if os.path.exists(TMP_OUTPUT):
        os.remove(TMP_OUTPUT)


def test_convert_video_progress(video_environment):
    """
    Test J-05: Verifies that the on_progress callback is called with valid percentages.
    """
    input_data = {
        'inputPath': TMP_INPUT,
        'outputPath': TMP_OUTPUT,
        'targetFormat': 'mp4',
    }

    progress_updates = []

    def mock_on_progress(progress_data):
        progress_updates.append(progress_data['percent'])

    convert_video(input_data, on_progress=mock_on_progress)

    # Asserts
    assert len(progress_updates) > 0, "on_progress was never called"
    
    for percent in progress_updates:
        assert 0.0 <= percent <= 100.0, f"Invalid progress percentage: {percent}"
        
    assert progress_updates[-1] > 0.0


def test_convert_video_cancellation(video_environment):
    """
    Test J-06: Verifies that the conversion aborts when is_cancelled returns True.
    """
    input_data = {
        'inputPath': TMP_INPUT,
        'outputPath': TMP_OUTPUT,
        'targetFormat': 'mp4',
    }

    check_count = {'count': 0}

    def mock_is_cancelled():
        check_count['count'] += 1
        if check_count['count'] >= 5:
            return True
        return False

    with pytest.raises(RuntimeError) as exception_info:
        convert_video(input_data, is_cancelled=mock_is_cancelled)

    assert "cancel" in str(exception_info.value).lower()

def test_convert_video_timeout(video_environment):
    """
    Test J-07: Verifies that the conversion aborts when exceeding timeoutMs.
    """
    input_data = {
        'inputPath': TMP_INPUT,
        'outputPath': TMP_OUTPUT,
        'targetFormat': 'mp4',
        # Give it only 1 millisecond (it will definitely fail)
        'timeoutMs': 1 
    }

    # We expect a TimeoutError to be raised
    with pytest.raises(TimeoutError) as exception_info:
        convert_video(input_data)

    # Verify the error message
    assert "timeout" in str(exception_info.value).lower()


def test_tst_unit_01_convert_video_mp4_to_webm(video_environment):
    """
    TST-UNIT-01: Dado um vídeo local válido (.mp4), quando convert_video é chamada para formato webm,
    então o ficheiro de output é gerado com sucesso e os metadados são validados via ffprobe.
    """
    webm_output = "/tmp/test_output_converted.webm"
    if os.path.exists(webm_output):
        os.remove(webm_output)

    try:
        input_data = {
            'inputPath': TMP_INPUT,
            'outputPath': webm_output,
            'targetFormat': 'webm',
            'targetResolution': '480p'
        }
        res = convert_video(input_data)
        assert os.path.exists(webm_output)
        assert res['format'] == 'webm'
        assert res['height'] == 480
        meta = get_video_metadata(webm_output)
        assert meta['videoCodec'] in ['vp9', 'vp8']
    finally:
        if os.path.exists(webm_output):
            os.remove(webm_output)


def test_tst_unit_02_validate_input_video_non_video():
    """
    TST-UNIT-02: Dado um ficheiro de texto não-vídeo, quando validate_input_video é chamada,
    então o ffprobe falha e o sistema levanta uma exceção estruturada (ValueError).
    """
    fake_text_path = "/tmp/fake_video_file.txt"
    with open(fake_text_path, "w") as f:
        f.write("Isto é um ficheiro de texto comum e não um stream de vídeo.")

    try:
        with pytest.raises(ValueError) as exc_info:
            validate_input_video(fake_text_path)
        assert "invalid video file" in str(exc_info.value).lower() or "ffprobe failed" in str(exc_info.value).lower()
    finally:
        if os.path.exists(fake_text_path):
            os.remove(fake_text_path)
