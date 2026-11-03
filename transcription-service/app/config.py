"""All settings come from environment variables so nothing is hardcoded."""
import os
from dataclasses import dataclass


def _env(name: str, default: str) -> str:
    value = os.getenv(name)
    return value if value not in (None, "") else default


def _env_raw(name: str, default: str) -> str:
    """Like _env, but an explicitly empty value is kept (used for prefixes that may be "")."""
    value = os.getenv(name)
    return default if value is None else value


@dataclass(frozen=True)
class Settings:
    # local  = faster-whisper in this container (free, private; speed depends on the CPU)
    # groq   = Groq's hosted whisper-large-v3-turbo (most accurate and fastest; needs GROQ_API_KEY)
    # openai = OpenAI's transcription API (needs OPENAI_API_KEY)
    whisper_backend: str = _env("WHISPER_BACKEND", "local")
    whisper_model_size: str = _env("WHISPER_MODEL_SIZE", "small")
    whisper_device: str = _env("WHISPER_DEVICE", "cpu")
    whisper_compute_type: str = _env("WHISPER_COMPUTE_TYPE", "int8")
    whisper_language: str | None = os.getenv("WHISPER_LANGUAGE") or None
    # 0 lets CTranslate2 pick. Set it when several services share the CPU.
    whisper_cpu_threads: int = int(_env("WHISPER_CPU_THREADS", "0"))
    # >0 uses faster-whisper's batched pipeline: several VAD chunks are decoded together, which is
    # much faster than sequential decoding. 0 = sequential (slightly better at long-range context).
    whisper_batch_size: int = int(_env("WHISPER_BATCH_SIZE", "8"))
    # Beam search width. Benchmarked on an 8-core CPU (small, batch 8, 5 min of interview audio):
    # beam 1 = 13.9x realtime, beam 5 = 9.1x, with near-identical wording. 5 helps on noisy audio.
    whisper_beam_size: int = int(_env("WHISPER_BEAM_SIZE", "1"))
    # How many files are transcribed at once. Extra requests wait (and send heartbeats) instead of
    # all competing for the same CPU cores.
    whisper_concurrency: int = int(_env("WHISPER_CONCURRENCY", "1"))

    openai_api_key: str | None = os.getenv("OPENAI_API_KEY") or None
    openai_base_url: str = _env("OPENAI_BASE_URL", "https://api.openai.com/v1")
    openai_whisper_model: str = _env("OPENAI_WHISPER_MODEL", "whisper-1")
    groq_api_key: str | None = os.getenv("GROQ_API_KEY") or None
    groq_base_url: str = _env("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
    groq_whisper_model: str = _env("GROQ_WHISPER_MODEL", "whisper-large-v3-turbo")
    # Hosted APIs reject uploads over 25 MB, so audio is sent as compressed mono MP3 in pieces of
    # at most this many seconds (20 min at 32 kbit/s is about 4.8 MB).
    openai_window_sec: float = float(_env("OPENAI_WINDOW_SEC", "1200"))
    openai_audio_bitrate: str = _env("OPENAI_AUDIO_BITRATE", "32k")

    # Long recordings are decoded and transcribed one window at a time, so memory use does not grow
    # with the length of the file (faster-whisper holds a window's audio in RAM as float32).
    transcribe_window_sec: float = float(_env("TRANSCRIBE_WINDOW_SEC", "1800"))

    # Whisper emits short fragments ("Um", "I was not"). They are merged into sentence-sized
    # segments: a segment ends at sentence punctuation once it is at least MERGE_MIN_SEC long, at a
    # pause longer than MERGE_MAX_GAP_SEC, or before it would exceed MERGE_MAX_SEC.
    merge_min_sec: float = float(_env("MERGE_MIN_SEC", "3"))
    merge_max_sec: float = float(_env("MERGE_MAX_SEC", "15"))
    merge_max_gap_sec: float = float(_env("MERGE_MAX_GAP_SEC", "1.5"))

    # multilingual-e5-small: 384-dim, ~100 languages incl. Hindi/Tamil/Telugu, queries in one
    # language find speech in another. e5 models expect these prefixes on input text.
    embedding_model: str = _env("EMBEDDING_MODEL", "intfloat/multilingual-e5-small")
    embedding_dim: int = int(_env("EMBEDDING_DIM", "384"))
    embed_query_prefix: str = _env_raw("EMBED_QUERY_PREFIX", "query: ")
    embed_passage_prefix: str = _env_raw("EMBED_PASSAGE_PREFIX", "passage: ")
    embed_max_batch: int = int(_env("EMBED_MAX_BATCH", "256"))

    # Cross-encoder that re-scores the top search candidates against the query (reads both
    # together, so it judges actual wording, not just topic). Empty RERANK_MODEL disables it.
    rerank_model: str = _env_raw("RERANK_MODEL", "cross-encoder/mmarco-mMiniLMv2-L12-H384-v1")
    rerank_max_length: int = int(_env("RERANK_MAX_LENGTH", "320"))
    rerank_max_batch: int = int(_env("RERANK_MAX_BATCH", "100"))

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

VALID_MODEL_SIZES = {
    "tiny", "base", "small", "medium", "large-v3", "large-v3-turbo", "turbo",
    "tiny.en", "base.en", "small.en", "medium.en", "distil-large-v3",
}
