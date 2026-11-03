import json
import logging
import os
import queue
import shutil
import tempfile
import threading
import time
from contextlib import asynccontextmanager, closing

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from .audio import MediaDecodeError, probe_duration
from .config import VALID_MODEL_SIZES, settings
from .embedder import Embedder
from .pipeline import transcribe_windows
from .transcriber import TranscriptionError, build_transcriber

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("transcription-service")

transcriber = build_transcriber()
embedder = Embedder()
# Limits how many files are transcribed at once (see WHISPER_CONCURRENCY).
transcription_slots = threading.BoundedSemaphore(max(1, settings.whisper_concurrency))


@asynccontextmanager
async def lifespan(_: FastAPI):
    if settings.whisper_backend == "local" and settings.whisper_model_size not in VALID_MODEL_SIZES:
        log.warning("WHISPER_MODEL_SIZE=%s is not one of %s", settings.whisper_model_size, sorted(VALID_MODEL_SIZES))
    os.makedirs(settings.work_dir, exist_ok=True)
    if settings.preload_models:
        t = time.time()
        await run_in_threadpool(transcriber.load)
        await run_in_threadpool(embedder.load)
        log.info("Models loaded in %.1fs", time.time() - t)
    yield


app = FastAPI(title="Napoleon transcription service", lifespan=lifespan)


class Segment(BaseModel):
    start_sec: float
    end_sec: float
    text: str


class TranscribeResponse(BaseModel):
    segments: list[Segment]
    duration_sec: float | None
    language: str | None


class StreamRequest(BaseModel):
    # Relative to MEDIA_ROOT, the media volume shared with the backend.
    path: str = Field(min_length=1)
    # Resume point: transcription starts here and timestamps stay relative to the whole file.
    start_offset_sec: float = Field(default=0.0, ge=0.0)


class EmbedRequest(BaseModel):
    texts: list[str] = Field(min_length=1)


class EmbedResponse(BaseModel):
    model: str
    dim: int
    vectors: list[list[float]]


@app.get("/health")
def health():
    return {
        "status": "ok",
        "whisper_backend": settings.whisper_backend,
        "whisper_model_size": settings.whisper_model_size,
        "embedding_model": settings.embedding_model,
        "embedding_dim": settings.embedding_dim,
    }


def _transcribe_all(src: str, duration: float | None, start_offset: float, workdir: str,
                    state: dict, cancel: threading.Event | None = None):
    """Runs the windowed pipeline while holding a transcription slot. Yields segments."""
    while not transcription_slots.acquire(timeout=1):
        if cancel is not None and cancel.is_set():
            return
    try:
        yield from transcribe_windows(src, duration, start_offset, transcriber, workdir, state,
                                      bitrate=settings.openai_audio_bitrate)
    finally:
        transcription_slots.release()


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(file: UploadFile = File(...)):
    """Upload-based transcription for setups where the media volume is not shared.

    Returns everything at the end; /transcribe/stream is preferred for long recordings.
    """
    workdir = tempfile.mkdtemp(dir=settings.work_dir)
    try:
        src = os.path.join(workdir, "input" + os.path.splitext(file.filename or "")[1])
        with open(src, "wb") as out:
            await run_in_threadpool(shutil.copyfileobj, file.file, out)

        duration = await run_in_threadpool(probe_duration, src)
        state: dict = {}
        t = time.time()
        try:
            segments = await run_in_threadpool(lambda: list(_transcribe_all(src, duration, 0.0, workdir, state)))
        except MediaDecodeError as e:
            raise HTTPException(status_code=422, detail=f"Could not decode media: {e}")
        except TranscriptionError as e:
            raise HTTPException(status_code=502, detail=str(e))
        log.info("Transcribed %s (%.0fs audio) into %d segments in %.1fs",
                 file.filename, duration or 0, len(segments), time.time() - t)
        return TranscribeResponse(segments=segments, duration_sec=duration, language=state.get("language"))
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def resolve_media_path(relative: str) -> str:
    root = os.path.realpath(settings.media_root)
    candidate = os.path.realpath(os.path.join(root, relative))
    if os.path.commonpath([root, candidate]) != root or candidate == root:
        raise HTTPException(status_code=400, detail="path must point inside MEDIA_ROOT")
    if not os.path.isfile(candidate):
        raise HTTPException(status_code=404, detail=f"Media file '{relative}' not found under MEDIA_ROOT")
    return candidate


def _line(event: dict) -> bytes:
    return (json.dumps(event, separators=(",", ":")) + "\n").encode()


def _produce(src: str, duration: float | None, start_offset: float,
             events: queue.Queue, cancel: threading.Event) -> None:
    """Worker thread: pushes segment/done/error events, then always a final None."""
    workdir = tempfile.mkdtemp(dir=settings.work_dir)
    t = time.time()
    count = 0
    try:
        state: dict = {}
        # closing(): stopping early must release the transcription slot right away, not at GC.
        with closing(_transcribe_all(src, duration, start_offset, workdir, state, cancel)) as segments:
            for seg in segments:
                if cancel.is_set():
                    log.info("Client went away; stopped transcribing %s after %d segments", src, count)
                    return
                events.put({"type": "segment", **seg})
                count += 1
        if not cancel.is_set():
            events.put({"type": "done", "language": state.get("language")})
            log.info("Streamed %s from %.0fs (%.0fs audio) as %d segments in %.1fs",
                     os.path.basename(src), start_offset, duration or 0, count, time.time() - t)
    except MediaDecodeError as e:
        events.put({"type": "error", "detail": f"Could not decode media: {e}"})
    except TranscriptionError as e:
        events.put({"type": "error", "detail": str(e)})
    except Exception as e:  # noqa: BLE001 - report anything to the client instead of a cut stream
        log.exception("Transcription of %s failed", src)
        events.put({"type": "error", "detail": f"{type(e).__name__}: {e}"})
    finally:
        shutil.rmtree(workdir, ignore_errors=True)
        events.put(None)


@app.post("/transcribe/stream")
async def transcribe_stream(req: StreamRequest):
    """Transcribes a file from the shared media volume and streams NDJSON lines:

    {"type":"meta","duration_sec":...}   first, always
    {"type":"segment","start_sec":...,"end_sec":...,"text":...}   as Whisper produces them
    {"type":"heartbeat"}   while waiting for a free slot or a slow window
    {"type":"done","language":...} or {"type":"error","detail":...}   last
    """
    src = resolve_media_path(req.path)
    duration = await run_in_threadpool(probe_duration, src)
    events: queue.Queue = queue.Queue()
    cancel = threading.Event()
    threading.Thread(target=_produce, args=(src, duration, req.start_offset_sec, events, cancel),
                     name="transcribe", daemon=True).start()

    async def body():
        try:
            yield _line({"type": "meta", "duration_sec": duration})
            while True:
                try:
                    item = await run_in_threadpool(events.get, True, settings.stream_heartbeat_sec)
                except queue.Empty:
                    yield _line({"type": "heartbeat"})
                    continue
                if item is None:
                    return
                yield _line(item)
        finally:
            # Client disconnected or stream finished: let the worker stop at the next segment.
            cancel.set()

    return StreamingResponse(body(), media_type="application/x-ndjson")


@app.post("/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest):
    if len(req.texts) > settings.embed_max_batch:
        raise HTTPException(status_code=413, detail=f"At most {settings.embed_max_batch} texts per request")
    vectors = await run_in_threadpool(embedder.embed, req.texts)
    return EmbedResponse(model=settings.embedding_model, dim=settings.embedding_dim, vectors=vectors)
