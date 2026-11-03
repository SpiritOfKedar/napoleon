"""All settings come from environment variables so nothing is hardcoded."""
import os
from dataclasses import dataclass


def _env(name: str, default: str) -> str:
    value = os.getenv(name)
    return value if value not in (None, "") else default


@dataclass(frozen=True)
class Settings:
    # "local" uses faster-whisper in-process; "openai" calls the OpenAI transcription API.
    whisper_backend: str = _env("WHISPER_BACKEND", "local")
    whisper_model_size: str = _env("WHISPER_MODEL_SIZE", "base")
    whisper_device: str = _env("WHISPER_DEVICE", "cpu")
    whisper_compute_type: str = _env("WHISPER_COMPUTE_TYPE", "int8")
    whisper_language: str | None = os.getenv("WHISPER_LANGUAGE") or None
    # 0 lets CTranslate2 pick. Set it when several services share the CPU.
    whisper_cpu_threads: int = int(_env("WHISPER_CPU_THREADS", "0"))
    # How many files are transcribed at once. Extra requests wait (and send heartbeats) instead of
    # all competing for the same CPU cores.
    whisper_concurrency: int = int(_env("WHISPER_CONCURRENCY", "1"))

    openai_api_key: str | None = os.getenv("OPENAI_API_KEY") or None
    openai_base_url: str = _env("OPENAI_BASE_URL", "https://api.openai.com/v1")
    openai_whisper_model: str = _env("OPENAI_WHISPER_MODEL", "whisper-1")
    # The OpenAI API rejects uploads over 25 MB, so audio is sent as compressed mono MP3 in pieces
    # of at most this many seconds (20 min at 32 kbit/s is about 4.8 MB).
    openai_window_sec: float = float(_env("OPENAI_WINDOW_SEC", "1200"))
    openai_audio_bitrate: str = _env("OPENAI_AUDIO_BITRATE", "32k")

    # Long recordings are decoded and transcribed one window at a time, so memory use does not grow
    # with the length of the file (faster-whisper holds a window's audio in RAM as float32).
    transcribe_window_sec: float = float(_env("TRANSCRIBE_WINDOW_SEC", "1800"))

    embedding_model: str = _env("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    embedding_dim: int = int(_env("EMBEDDING_DIM", "384"))
    embed_max_batch: int = int(_env("EMBED_MAX_BATCH", "256"))

    # Load models at startup instead of on first request (slower boot, no first-request stall).
    preload_models: bool = _env("PRELOAD_MODELS", "true").lower() == "true"
    work_dir: str = _env("WORK_DIR", "/tmp/napoleon")
    # Where the backend's uploaded media is mounted (read-only). /transcribe/stream takes paths
    # relative to this directory, so large videos are never copied over HTTP.
    media_root: str = _env("MEDIA_ROOT", "/data/media")
    # A line is written to the stream at least this often, so the backend's idle timeout only
    # fires when this service is really gone.
    stream_heartbeat_sec: float = float(_env("STREAM_HEARTBEAT_SEC", "15"))


settings = Settings()

VALID_MODEL_SIZES = {"tiny", "base", "small", "medium", "large-v3"}
