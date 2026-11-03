"""Speech-to-text. Two interchangeable backends selected by WHISPER_BACKEND."""
import threading

import httpx

from .config import settings


class TranscriptionError(Exception):
    pass


def _segment(start: float, end: float, text: str) -> dict:
    return {"start_sec": round(float(start), 3), "end_sec": round(float(end), 3), "text": text.strip()}


class LocalWhisper:
    def __init__(self) -> None:
        self._model = None
        self._lock = threading.Lock()

    def load(self):
        with self._lock:
            if self._model is None:
                from faster_whisper import WhisperModel  # heavy import, keep it lazy

                self._model = WhisperModel(
                    settings.whisper_model_size,
                    device=settings.whisper_device,
                    compute_type=settings.whisper_compute_type,
                )
        return self._model

    def transcribe(self, wav_path: str) -> tuple[list[dict], str | None]:
        model = self.load()
        segments, info = model.transcribe(
            wav_path,
            language=settings.whisper_language,
            vad_filter=True,  # skips long silences, which also keeps timestamps tight
        )
        out = [_segment(s.start, s.end, s.text) for s in segments if s.text.strip()]
        return out, info.language


class OpenAIWhisper:
    def load(self):
        if not settings.openai_api_key:
            raise TranscriptionError("WHISPER_BACKEND=openai but OPENAI_API_KEY is not set")

    def transcribe(self, wav_path: str) -> tuple[list[dict], str | None]:
        self.load()
        data = {
            "model": settings.openai_whisper_model,
            "response_format": "verbose_json",
            "timestamp_granularities[]": "segment",
        }
        if settings.whisper_language:
            data["language"] = settings.whisper_language
        with open(wav_path, "rb") as fh:
            resp = httpx.post(
                f"{settings.openai_base_url}/audio/transcriptions",
                headers={"Authorization": f"Bearer {settings.openai_api_key}"},
                data=data,
                files={"file": ("audio.wav", fh, "audio/wav")},
                timeout=600,
            )
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
