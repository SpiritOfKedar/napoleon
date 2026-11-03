"""ffmpeg helpers: normalise any audio/video input to 16 kHz mono audio (what Whisper expects)."""
import json
import subprocess


class MediaDecodeError(Exception):
    """Raised when ffmpeg cannot read the uploaded file (corrupt or not media)."""


def extract_audio(input_path: str, output_path: str, start_sec: float | None = None,
                  length_sec: float | None = None, fmt: str = "wav", bitrate: str = "32k") -> None:
    """Writes [start_sec, start_sec + length_sec) of the input's audio to output_path.

    fmt is "wav" (16-bit PCM) or "mp3" (compressed, for upload size limits).
    """
    cmd = ["ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-y"]
    if start_sec:
        cmd += ["-ss", f"{start_sec:.3f}"]  # before -i: fast seek, no decoding of what is skipped
    cmd += ["-i", input_path]
    if length_sec is not None:
        cmd += ["-t", f"{length_sec:.3f}"]
    cmd += [
        "-vn",                # drop any video stream
        "-ac", "1",           # mono
        "-ar", "16000",       # 16 kHz
    ]
    if fmt == "mp3":
        cmd += ["-c:a", "libmp3lame", "-b:a", bitrate, "-f", "mp3"]
    elif fmt == "wav":
        cmd += ["-f", "wav"]
    else:
        raise ValueError(f"Unsupported audio format '{fmt}'")
    cmd.append(output_path)
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        detail = (result.stderr or "").strip().splitlines()
        raise MediaDecodeError(detail[-1] if detail else "ffmpeg failed to decode the file")


def probe_duration(path: str) -> float | None:
    cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True)
    except FileNotFoundError:
        return None
    if result.returncode != 0:
        return None
    try:
        return float(json.loads(result.stdout)["format"]["duration"])
    except (KeyError, ValueError, TypeError):
        return None
