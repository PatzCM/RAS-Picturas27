import os
import shutil
import pytest
from Tools.video_convert.core.converter import convert_video

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