import os
from Tools.video_convert.core.converter import convert_video

# ==========================================
# 1. TEST SETTINGS (Change these to test!)
# ==========================================
# Allowed Formats: "mp4", "webm", "mkv", "mov"
TEST_FORMAT = "webm"

# Allowed Resolutions: "144p", "480p", "720p", "1080p", or None
TEST_RESOLUTION = "480p"
# ==========================================

# 2. Define dynamic paths
input_file = "tests/fixtures/fixture.mp4"

# Generate output name like: "output_manual_480p.webm"
res_label = TEST_RESOLUTION if TEST_RESOLUTION else "original"
output_file = f"tests/fixtures/output_manual_{res_label}.{TEST_FORMAT}"

print(f"[*] Starting conversion of '{input_file}'...")
print(f"[*] Target Format: {TEST_FORMAT.upper()}")
print(f"[*] Target Resolution: {res_label}\n")

# 3. Progress callback
def print_progress(progress_data):
    percent = progress_data['percent']
    # Using \r overwrites the same line in the terminal, making it look like a loading bar!
    print(f"[>] Conversion progress: {percent:.1f}%", end="\r")

# 4. Setup the input dictionary mapping the user requirements (Task J-03)
# 4. Setup the input dictionary mapping the user requirements
input_data = {
    'inputPath': input_file,
    'outputPath': output_file,
    'targetFormat': TEST_FORMAT,
    'targetResolution': TEST_RESOLUTION,
    'timeoutMs': 50  # <-- NOVO: O FFmpeg tem 50ms para acabar, ou morre!
}

# 5. Run the conversion
try:
    result = convert_video(input_data, on_progress=print_progress)
    
    print("\n\n[+] Success! Video converted successfully.")
    print(f"    - Saved at: {result['outputPath']}")
    print(f"    - Format: {result['format']}")
    print(f"    - Resolution: {result['width']}x{result['height']}")
    print(f"    - Duration: {result['durationMs']} ms")
    print(f"    - File Size: {result['sizeBytes']} bytes")
    print(f"    - Video Codec: {result['videoCodec']}")
    print(f"    - Audio Codec: {result['audioCodec']}")
    
except Exception as e:
    print(f"\n\n[-] Error during conversion: {e}")