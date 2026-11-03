"""Speech-to-text. Two interchangeable backends selected by WHISPER_BACKEND.

Both transcribe one audio file (one window of a recording, see pipeline.py) and return
(segments, detected_language). Segments may be a lazy iterator so they can be streamed out as
soon as Whisper produces them.
"""
import threading
from collections.abc import Iterable

import httpx

from .config import settings


class TranscriptionError(Exception):
    pass


def _segment(start: float, end: float, text: str) -> dict:
    return {"start_sec": round(float(start), 3), "end_sec": round(float(end), 3), "text": text.strip()}


class LocalWhisper:
    audio_format = "wav"

    def __init__(self) -> None:
        self._model = None
        self._lock = threading.Lock()
        self.window_sec = settings.transcribe_window_sec

    def load(self):
        with self._lock:
            if self._model is None:
                from faster_whisper import WhisperModel  # heavy import, keep it lazy

                self._model = WhisperModel(
                    settings.whisper_model_size,
                    device=settings.whisper_device,
                    compute_type=settings.whisper_compute_type,
                    cpu_threads=settings.whisper_cpu_threads,
                )
        return self._model

    def transcribe(self, audio_path: str, language: str | None = None) -> tuple[Iterable[dict], str | None]:
        model = self.load()
        segments, info = model.transcribe(
            audio_path,
            language=language or settings.whisper_language,
            vad_filter=True,  # skips long silences, which also keeps timestamps tight
        )
        # Lazy: faster-whisper decodes as the generator is consumed.
        out = (_segment(s.start, s.end, s.text) for s in segments if s.text.strip())
        return out, info.language


class OpenAIWhisper:
    # Compressed so each window stays far below the API's 25 MB upload limit.
    audio_format = "mp3"

    def __init__(self) -> None:
        self.window_sec = min(settings.openai_window_sec, settings.transcribe_window_sec)

    def load(self):
        if not settings.openai_api_key:
            raise TranscriptionError("WHISPER_BACKEND=openai but OPENAI_API_KEY is not set")

    def transcribe(self, audio_path: str, language: str | None = None) -> tuple[Iterable[dict], str | None]:
        self.load()
        data = {
            "model": settings.openai_whisper_model,
            "response_format": "verbose_json",
            "timestamp_granularities[]": "segment",
        }
        language = language or settings.whisper_language
        if language:
            data["language"] = language
        with open(audio_path, "rb") as fh:
            try:
                resp = httpx.post(
                    f"{settings.openai_base_url}/audio/transcriptions",
                    headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                    data=data,
                    files={"file": ("audio.mp3", fh, "audio/mpeg")},
                    timeout=600,
                )
            except httpx.HTTPError as e:
                raise TranscriptionError(f"OpenAI API unreachable: {e}") from e
        if resp.status_code != 200:
            raise TranscriptionError(f"OpenAI API error {resp.status_code}: {resp.text[:300]}")
        body = resp.json()
        out = [_segment(s["start"], s["end"], s["text"]) for s in body.get("segments", []) if s["text"].strip()]
        return out, body.get("language")


def build_transcriber():
    if settings.whisper_backend == "openai":
        return OpenAIWhisper()
    if settings.whisper_backend == "local":
        return LocalWhisper()
    raise ValueError(f"Unknown WHISPER_BACKEND '{settings.whisper_backend}' (expected local|openai)")
