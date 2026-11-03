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

    openai_api_key: str | None = os.getenv("OPENAI_API_KEY") or None
    openai_base_url: str = _env("OPENAI_BASE_URL", "https://api.openai.com/v1")
    openai_whisper_model: str = _env("OPENAI_WHISPER_MODEL", "whisper-1")

    embedding_model: str = _env("EMBEDDING_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
    embedding_dim: int = int(_env("EMBEDDING_DIM", "384"))
    embed_max_batch: int = int(_env("EMBED_MAX_BATCH", "256"))

    # Load models at startup instead of on first request (slower boot, no first-request stall).
    preload_models: bool = _env("PRELOAD_MODELS", "true").lower() == "true"
    work_dir: str = _env("WORK_DIR", "/tmp/napoleon")


settings = Settings()

VALID_MODEL_SIZES = {"tiny", "base", "small", "medium", "large-v3"}
