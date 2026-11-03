# Napoleon

Search inside your audio and video recordings in plain language.

Upload a recording. Napoleon transcribes it with Whisper, indexes the transcript as vectors in
PostgreSQL/pgvector, and answers queries like *"when did we talk about the Q3 budget?"* with the
exact moments: **`00:00:31` in `meeting.mp4` — "Now let us talk about the Q3 budget…"**. Clicking a
result opens the player at that timestamp.

```
 ┌───────────┐   /api    ┌──────────────┐  HTTP   ┌───────────────────────┐
 │ Angular   │ ────────▶ │ Spring Boot  │ ──────▶ │ transcription-service │
 │ (nginx)   │           │ backend      │         │ FastAPI               │
 └───────────┘           └──────┬───────┘         │  • faster-whisper     │
   :4200                        │ JPA + native SQL│  • sentence-transformers
                                ▼                 │  • ffmpeg             │
                         ┌──────────────┐         └───────────────────────┘
                         │ PostgreSQL + │                :8000
                         │ pgvector     │
                         └──────────────┘
```

| Directory | What |
|---|---|
| `frontend/` | Angular 21 standalone app with Angular Material: upload, library, search and player pages |
| `backend/` | Java 21 / Spring Boot 3.5 API: upload, async processing pipeline, Range streaming, vector search |
| `transcription-service/` | Python FastAPI: `POST /transcribe`, `POST /embed`, `GET /health` |
| `infra/` | Seed and end-to-end scripts, and the sample recording |

## Quick start

Prerequisites: **Docker Desktop** (or Docker Engine with Compose v2).

```bash
cp .env.example .env   # optional; every value has a default
docker compose up -d --build
```

Or use `make up` (or `npm run up` on machines without `make`). It waits until every service is
healthy, then runs the seed.

The first start takes a few minutes because it downloads the Whisper `base` model (~150 MB) and the
embedding model (~90 MB) into the `model-cache` volume. Later starts are fast. Check progress with
`docker compose ps` or `make logs`.

Then open **http://localhost:4200**.

On first launch the `seed` container uploads `infra/sample/sample-meeting.wav`, an 84-second
synthetic planning meeting. It shows up as **Transcribing…** in the Library and turns **Indexed**
after roughly 10–30 s on a laptop CPU. Then try searching:

| Query | Expected top hit (start time) |
|---|---|
| `Q3 budget` | ~00:00:31, "Now let us talk about the Q3 budget…" |
| `when is the offsite` | ~00:01:05, "…the company offsite will be held in Lisbon…" |
| `how fast is search now` | ~00:00:43, "…Search latency dropped…" |
| `new engineers` | ~00:00:20, "…add two backend engineers…" |

`infra/sample/sample-meeting.json` lists when each sentence starts.

### Upload your own file

Drag files onto the **Upload** page, or use curl:

```bash
curl -F "file=@meeting.mp4" http://localhost:8080/api/media
curl http://localhost:8080/api/media            # watch status: UPLOADED → TRANSCRIBING → INDEXED
curl -G http://localhost:8080/api/search --data-urlencode "q=Q3 budget"
```

Supported: mp3, wav, m4a, aac, ogg, opus, flac, webm, mp4, m4v, mov, mkv, avi. Video files have
their audio extracted with ffmpeg. A file that cannot be decoded ends up **FAILED**, with ffmpeg's
error shown in the Library. The pipeline keeps running.

### End-to-end check

```bash
make e2e        # or: sh infra/scripts/e2e-check.sh
```

The script uploads the sample, waits for INDEXED, and searches for the Q3 budget sentence. It checks
that the top hit starts within 5 s of where the sentence is spoken (31.66 s), and that the stream
endpoint answers a Range request with `206`.

## Commands

| make | npm (root) | |
|---|---|---|
| `make up` | `npm run up` | build + start + wait healthy + seed |
| `make down` | `npm run down` | stop (keeps data) |
| `make logs` | `npm run logs` | follow logs |
| `make test` | `npm test` | backend + frontend (+ Python service, make only) tests |
| `make e2e` | `npm run e2e` | end-to-end check against the running stack |
| `make clean` | | stop **and delete** DB, media and model cache volumes |

## API

| Method | Path | |
|---|---|---|
| `POST` | `/api/media` | multipart `file`; returns `202` + the MediaFile; processing runs in the background |
| `GET` | `/api/media` | all media, newest first |
| `GET` | `/api/media/{id}` | one media file with `status` and `errorMessage` |
| `GET` | `/api/media/{id}/transcript` | Whisper segments `[{startSec, endSec, text}]` |
| `GET` | `/api/media/{id}/stream` | the file, with HTTP Range support (`206 Partial Content`) |
| `GET` | `/api/search?q=&limit=10&mediaId=` | `[{mediaId, mediaFilename, startSec, endSec, chunkStartSec, chunkEndSec, text, score}]` |
| `GET` | `/actuator/health` | health |

Every error uses the same JSON shape:

```json
{ "timestamp": "...", "status": 400, "error": "Bad Request", "message": "Validation failed",
  "path": "/api/search", "fieldErrors": { "q": "q must not be blank" } }
```

The transcription service can be exercised directly:

```bash
curl -F "file=@infra/sample/sample-meeting.wav" http://localhost:8000/transcribe
curl -H "Content-Type: application/json" -d '{"texts":["hello world"]}' http://localhost:8000/embed
```

## How search works

1. **Transcribe.** ffmpeg converts the upload to 16 kHz mono WAV, and faster-whisper (with VAD)
   returns timestamped segments.
2. **Chunk.** Segments are grouped into windows of about 30 s. Each new window starts at the
   segment that covers the previous window's last 5 s, so every boundary overlaps by at least 5 s
   and a phrase that crosses a boundary is still whole in one chunk. Segments are never split. See
   `backend/.../service/Chunker.java`.
3. **Embed.** Chunks *and* individual segments are embedded with `all-MiniLM-L6-v2` (384-dim,
   L2-normalized) in batches.
4. **Search.** The query is embedded. Postgres finds the nearest chunks by cosine distance using an
   HNSW index. Then, inside each of those chunks, it picks the segment closest to the query (a
   `LATERAL` subquery). The result's `startSec` is that segment's start, so playback lands on the
   sentence instead of the start of a 30 s window. Overlapping chunks that point at the same
   sentence are de-duplicated. `score` is the chunk's cosine similarity.

## Configuration

Everything is set through environment variables; see `.env.example` for the full list with comments.
The ones you are most likely to change:

| Variable | Default | |
|---|---|---|
| `WHISPER_BACKEND` | `local` | `local` (faster-whisper) or `openai` (OpenAI API; set `OPENAI_API_KEY`; 25 MB per-file API limit) |
| `WHISPER_MODEL_SIZE` | `base` | `tiny`, `base`, `small`, `medium`, `large-v3` |
| `WHISPER_LANGUAGE` | *(auto)* | e.g. `en` to skip language detection |
| `EMBEDDING_MODEL` / `EMBEDDING_DIM` | `all-MiniLM-L6-v2` / `384` | must match each other; see the warning below |
| `CHUNK_WINDOW_SEC` / `CHUNK_OVERLAP_SEC` | `30` / `5` | applies to newly processed files |
| `MAX_UPLOAD_SIZE` | `500MB` | Spring size syntax |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:4200` | only needed when the UI and API are on different origins |
| `PROCESSING_WORKER_THREADS` | `2` | files transcribed in parallel |

> **Embedding dimension is locked in at first start.** The Flyway migration creates
> `vector(${EMBEDDING_DIM})` columns the first time the database starts. To switch to a model with
> a different dimension, run `make clean` (this deletes all indexed data) or add a migration, then
> re-upload. The transcription service refuses to start if the model's real dimension doesn't
> match `EMBEDDING_DIM`.

## Local development (without Docker for the app code)

You still need Postgres with pgvector. The easiest way is `docker compose up -d postgres transcription-service`.

```bash
# backend (JDK 21)
cd backend && ./mvnw spring-boot:run              # http://localhost:8080

# frontend (Node 22.12+)
cd frontend && npm install && npx ng serve        # http://localhost:4200, calls :8080 directly (CORS)

# transcription service (Python 3.12 + ffmpeg on PATH)
cd transcription-service && pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
PRELOAD_MODELS=false pytest
```

## Tests

- **Backend** (`cd backend && ./mvnw test`):
  - `ChunkerTest`: window/overlap rules and edge cases.
  - `VectorFormatTest`
  - `MediaControllerTest`: Range streaming (`206`, `Content-Range`) and error JSON.
  - `SearchControllerTest`: validation and the upstream `502`.
  - `SearchIntegrationTest`: Testcontainers with `pgvector/pgvector:pg17`. Runs the real migration
    and checks search ordering, the `mediaId` filter, sentence pinpointing, de-duplication, that
    the pipeline indexes a transcript and that re-processing doesn't duplicate rows, and that a bad
    file ends up FAILED. **It is skipped automatically when Docker isn't available.**
- **Frontend** (`cd frontend && npx ng test --watch=false`, Vitest):
  - Timestamp formatter.
  - Highlighter.
  - `ApiService` (with `HttpTestingController`).
  - App shell.
- **Transcription service** (`make test-transcription`, or `pytest` locally): API tests with the
  models stubbed out, plus a real ffmpeg rejection of a non-media file.

## Troubleshooting

- **Transcription service stays "starting".** The first boot downloads models. Watch
  `docker compose logs -f transcription-service`.
- **A file is FAILED with "No speech was detected".** Whisper's VAD found no speech, for example in
  music or silence.
- **Slow transcription.** Use `WHISPER_MODEL_SIZE=tiny`, set `WHISPER_LANGUAGE`, or switch to
  `WHISPER_BACKEND=openai`.
- **Autoplay blocked.** If the browser refuses to autoplay, the player has already seeked to the
  right time; press play.
- **Restarted mid-transcription.** Files left UPLOADED or TRANSCRIBING are re-queued when the backend
  starts.
