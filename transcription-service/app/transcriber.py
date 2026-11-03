"""Speech-to-text. Interchangeable backends selected by WHISPER_BACKEND.

Each transcribes one audio file (one window of a recording, see pipeline.py) and returns
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
        self._batched = None
        self._lock = threading.Lock()
        self.window_sec = settings.transcribe_window_sec

    def load(self):
        with self._lock:
            if self._model is None:
                from faster_whisper import BatchedInferencePipeline, WhisperModel  # heavy import

                self._model = WhisperModel(
                    settings.whisper_model_size,
                    device=settings.whisper_device,
                    compute_type=settings.whisper_compute_type,
                    cpu_threads=settings.whisper_cpu_threads,
                )
                if settings.whisper_batch_size > 0:
                    self._batched = BatchedInferencePipeline(model=self._model)
        return self._model

    def transcribe(self, audio_path: str, language: str | None = None) -> tuple[Iterable[dict], str | None]:
        model = self.load()
        language = language or settings.whisper_language
        if self._batched is not None:
            # The batched pipeline always splits audio with VAD, which also skips silence.
            # without_timestamps=False: by default it returns one segment per ~30 s VAD chunk,
            # far too coarse for search to point at the right sentence.
            segments, info = self._batched.transcribe(
                audio_path, language=language, batch_size=settings.whisper_batch_size,
                beam_size=settings.whisper_beam_size, without_timestamps=False,
            )
        else:
            segments, info = model.transcribe(
                audio_path, language=language, beam_size=settings.whisper_beam_size,
                vad_filter=True,  # skips long silences, which also keeps timestamps tight
            )
        # Lazy: faster-whisper decodes as the generator is consumed.
        out = (_segment(s.start, s.end, s.text) for s in segments if s.text.strip())
        return out, info.language


class HostedWhisper:
    """Any OpenAI-compatible /audio/transcriptions API (OpenAI itself, Groq)."""

    # Compressed so each window stays far below the 25 MB upload limit of these APIs.
    audio_format = "mp3"

    def __init__(self, name: str, api_key: str | None, base_url: str, model: str, key_env: str) -> None:
        self.name = name
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.key_env = key_env
        self.window_sec = min(settings.openai_window_sec, settings.transcribe_window_sec)

    def load(self):
        if not self.api_key:
            raise TranscriptionError(f"WHISPER_BACKEND={self.name} but {self.key_env} is not set")

    def transcribe(self, audio_path: str, language: str | None = None) -> tuple[Iterable[dict], str | None]:
        self.load()
        data = {
            "model": self.model,
            "response_format": "verbose_json",
            "timestamp_granularities[]": "segment",
        }
        language = language or settings.whisper_language
        if language:
            data["language"] = language
        with open(audio_path, "rb") as fh:
            try:
                resp = httpx.post(
                    f"{self.base_url}/audio/transcriptions",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                    data=data,
                    files={"file": ("audio.mp3", fh, "audio/mpeg")},
                    timeout=600,
                )
            except httpx.HTTPError as e:
                raise TranscriptionError(f"{self.name} API unreachable: {e}") from e
        if resp.status_code != 200:
            raise TranscriptionError(f"{self.name} API error {resp.status_code}: {resp.text[:300]}")
        body = resp.json()
        out = [_segment(s["start"], s["end"], s["text"]) for s in body.get("segments", []) if s["text"].strip()]
        return out, _language_code(body.get("language"))


# Hosted APIs report the language as a name ("english"); local Whisper and its `language`
# parameter use ISO codes. Feeding the name back for the next window would be rejected.
_LANGUAGE_CODES = {
    "english": "en", "hindi": "hi", "tamil": "ta", "telugu": "te", "kannada": "kn",
    "malayalam": "ml", "marathi": "mr", "bengali": "bn", "gujarati": "gu", "punjabi": "pa",
    "urdu": "ur", "spanish": "es", "french": "fr", "german": "de",
}


def _language_code(language: str | None) -> str | None:
    if not language:
        return None
    lowered = language.strip().lower()
    if len(lowered) <= 3:
        return lowered
    return _LANGUAGE_CODES.get(lowered)


def build_transcriber():
    backend = settings.whisper_backend
    if backend == "local":
        return LocalWhisper()
    if backend == "groq":
        return HostedWhisper("groq", settings.groq_api_key, settings.groq_base_url,
                             settings.groq_whisper_model, "GROQ_API_KEY")
    if backend == "openai":
        return HostedWhisper("openai", settings.openai_api_key, settings.openai_base_url,
                             settings.openai_whisper_model, "OPENAI_API_KEY")
    raise ValueError(f"Unknown WHISPER_BACKEND '{backend}' (expected local|groq|openai)")
