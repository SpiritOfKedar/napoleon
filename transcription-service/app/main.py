import logging
import os
import shutil
import tempfile
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from pydantic import BaseModel, Field

from .audio import MediaDecodeError, extract_audio, probe_duration
from .config import VALID_MODEL_SIZES, settings
from .embedder import Embedder
from .transcriber import TranscriptionError, build_transcriber

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("transcription-service")

transcriber = build_transcriber()
embedder = Embedder()


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


@app.post("/transcribe", response_model=TranscribeResponse)
async def transcribe(file: UploadFile = File(...)):
    workdir = tempfile.mkdtemp(dir=settings.work_dir)
    try:
        src = os.path.join(workdir, "input" + os.path.splitext(file.filename or "")[1])
        with open(src, "wb") as out:
            await run_in_threadpool(shutil.copyfileobj, file.file, out)
        wav = os.path.join(workdir, "audio.wav")
        try:
            await run_in_threadpool(extract_audio, src, wav)
        except MediaDecodeError as e:
            raise HTTPException(status_code=422, detail=f"Could not decode media: {e}")

        duration = await run_in_threadpool(probe_duration, wav)
        t = time.time()
        try:
            segments, language = await run_in_threadpool(transcriber.transcribe, wav)
        except TranscriptionError as e:
            raise HTTPException(status_code=502, detail=str(e))
        log.info("Transcribed %s (%.0fs audio) into %d segments in %.1fs",
                 file.filename, duration or 0, len(segments), time.time() - t)
        return TranscribeResponse(segments=segments, duration_sec=duration, language=language)
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


@app.post("/embed", response_model=EmbedResponse)
async def embed(req: EmbedRequest):
    if len(req.texts) > settings.embed_max_batch:
        raise HTTPException(status_code=413, detail=f"At most {settings.embed_max_batch} texts per request")
    vectors = await run_in_threadpool(embedder.embed, req.texts)
    return EmbedResponse(model=settings.embedding_model, dim=settings.embedding_dim, vectors=vectors)
