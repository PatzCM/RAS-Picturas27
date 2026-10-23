import subprocess
import json
import os
import time

def get_video_metadata(file_path: str) -> dict:
    """
    Task J-02 & J-08: Extracts video metadata using ffprobe.
    Returns width, height, duration, size, and codecs.
    """
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    # Secure invocation (J-04)
    # We removed '-select_streams v:0' to allow reading BOTH audio and video streams
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "stream=codec_type,codec_name,width,height",
        "-show_entries", "format=duration,size",
        "-of", "json",
        file_path
    ]

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, check=True)
        info = json.loads(result.stdout)
        
        duration_s = float(info.get('format', {}).get('duration', 0))
        size_bytes = int(info.get('format', {}).get('size', 0))
        
        video_codec = None
        audio_codec = None
        width = None
        height = None

        # Loop through streams to find video and audio independently
        for stream in info.get('streams', []):
            if stream.get('codec_type') == 'video':
                video_codec = stream.get('codec_name')
                width = stream.get('width')
                height = stream.get('height')
            elif stream.get('codec_type') == 'audio':
                audio_codec = stream.get('codec_name')

        return {
            "durationMs": int(duration_s * 1000),
            "width": width,
            "height": height,
            "sizeBytes": size_bytes,
            "videoCodec": video_codec,
            "audioCodec": audio_codec
        }
    except subprocess.CalledProcessError as e:
        raise ValueError(f"ffprobe failed. Invalid video file: {e.stderr}")


def validate_input_video(file_path: str) -> dict:
    """
    TST-UNIT-02: Valida a integridade do ficheiro de vídeo de entrada via ffprobe.
    Levanta ValueError caso o ficheiro não seja um vídeo válido ou esteja corrompido.
    """
    return get_video_metadata(file_path)


def get_ffmpeg_args(target_format: str, target_resolution: str) -> list:
    """
    Task J-03 & RNG-04: MVP Matrix for resolution and formats (MP4, WebM, MKV, MOV).
    """
    args = []

    fmt = (target_format or "mp4").lower()
    if fmt == "mp4":
        args.extend(["-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p"])
    elif fmt == "webm":
        args.extend(["-c:v", "libvpx-vp9", "-c:a", "libvorbis"])
    elif fmt == "mkv":
        args.extend(["-c:v", "libx264", "-c:a", "aac"])
    elif fmt == "mov":
        args.extend(["-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p"])
    else:
        args.extend(["-c:v", "libx264", "-c:a", "aac"])

    if target_resolution and str(target_resolution).strip().lower() not in ("original", "none", ""):
        height = str(target_resolution).replace("p", "").strip()
        args.extend(["-vf", f"scale=-2:{height}"])

    return args


def convert_video(input_data: dict, *, on_progress=None, is_cancelled=None) -> dict:
    input_path = input_data['inputPath']
    output_path = input_data['outputPath']
    target_format = input_data.get('targetFormat', 'mp4')
    target_resolution = input_data.get('targetResolution')
    
    # Task J-07: Get timeoutMs from input (defaults to None if not provided)
    timeout_ms = input_data.get('timeoutMs')

    # 1. Input Validation
    video_info = get_video_metadata(input_path)
    
    # 2. Setup FFmpeg arguments
    ffmpeg_options = get_ffmpeg_args(target_format, target_resolution)
    
# 3. FFmpeg Command
    cmd = ["ffmpeg", "-y", "-i", input_path] + ffmpeg_options + ["-progress", "pipe:1", output_path]
    ffmpeg_process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)

    start_time = time.time()

    # Task J-09: Wrap in try/except to clean up broken files on error
    try:
        # 4. Monitor progress, cancellation, and timeouts
        for line in ffmpeg_process.stdout:
            
            # Task J-06: Cancellation
            if is_cancelled and is_cancelled():
                ffmpeg_process.terminate() 
                raise RuntimeError("Conversion cancelled by user.")

            # Task J-07: Timeout check
            if timeout_ms:
                elapsed_ms = (time.time() - start_time) * 1000
                if elapsed_ms > timeout_ms:
                    ffmpeg_process.terminate()
                    raise TimeoutError(f"Conversion exceeded the timeout of {timeout_ms}ms.")

            # Task J-05: Progress
            if "out_time_ms=" in line:
                try:
                    time_ms = int(line.strip().split("=")[1]) / 1000 
                    if on_progress and video_info["durationMs"] > 0:
                        percent = (time_ms / video_info["durationMs"]) * 100
                        on_progress({"percent": min(percent, 100.0)})
                except ValueError:
                    pass

        ffmpeg_process.wait()

        if ffmpeg_process.returncode != 0 and ffmpeg_process.returncode != -15:
            raise RuntimeError("FFmpeg conversion failed.")
            
    except Exception as e:
        # TAREFA J-09: Limpar o ficheiro parcialmente gerado em caso de erro/cancelamento
        if os.path.exists(output_path):
            os.remove(output_path)
        # Voltar a "atirar" o erro para que a função da tua colega saiba que falhou
        raise e

    
    # 5. Output Validation
    output_info = get_video_metadata(output_path)

    return {
        "outputPath": output_path,
        "format": target_format,
        "width": output_info["width"],
        "height": output_info["height"],
        "durationMs": output_info["durationMs"],
        "sizeBytes": output_info["sizeBytes"],
        "videoCodec": output_info["videoCodec"],
        "audioCodec": output_info["audioCodec"]
    }