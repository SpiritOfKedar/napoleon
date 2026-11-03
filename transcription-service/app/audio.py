"""ffmpeg helpers: normalise any audio/video input to 16 kHz mono WAV (what Whisper expects)."""
import json
import subprocess


class MediaDecodeError(Exception):
    """Raised when ffmpeg cannot read the uploaded file (corrupt or not media)."""


def extract_audio(input_path: str, output_path: str) -> None:
    cmd = [
        "ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y",
        "-i", input_path,
        "-vn",                # drop any video stream
        "-ac", "1",           # mono
        "-ar", "16000",       # 16 kHz
        "-f", "wav", output_path,
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        detail = (result.stderr or "").strip().splitlines()
        raise MediaDecodeError(detail[-1] if detail else "ffmpeg failed to decode the file")


def probe_duration(path: str) -> float | None:
    cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        return None
    try:
        return float(json.loads(result.stdout)["format"]["duration"])
    except (KeyError, ValueError, TypeError):
        return None
