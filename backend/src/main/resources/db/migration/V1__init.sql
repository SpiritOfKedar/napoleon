-- ${embedding_dim} is a Flyway placeholder fed from EMBEDDING_DIM.
-- It is baked in when this migration first runs; changing the embedding dimension later
-- needs a new migration and a full re-index.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE media_file (
    id             BIGSERIAL PRIMARY KEY,
    filename       VARCHAR(512)  NOT NULL,
    storage_path   VARCHAR(1024) NOT NULL,
    content_type   VARCHAR(255),
    size_bytes     BIGINT,
    duration_sec   DOUBLE PRECISION,
    status         VARCHAR(20)   NOT NULL,
    error_message  VARCHAR(2000),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    CONSTRAINT media_file_status_chk CHECK (status IN ('UPLOADED', 'TRANSCRIBING', 'INDEXED', 'FAILED'))
);

-- Raw Whisper segments. Used to render the full transcript in the player, and (via their own
-- embeddings) to pinpoint the exact moment inside a matching chunk at search time.
CREATE TABLE transcript_segment (
    id             BIGSERIAL PRIMARY KEY,
    media_file_id  BIGINT NOT NULL REFERENCES media_file (id) ON DELETE CASCADE,
    seq            INT    NOT NULL,
    start_sec      DOUBLE PRECISION NOT NULL,
    end_sec        DOUBLE PRECISION NOT NULL,
    text           TEXT   NOT NULL,
    embedding      vector(${embedding_dim}) NOT NULL
);
CREATE INDEX transcript_segment_media_idx ON transcript_segment (media_file_id, start_sec);

-- Overlapping ~30 s windows of segments; these are what get embedded and searched.
CREATE TABLE transcript_chunk (
    id             BIGSERIAL PRIMARY KEY,
    media_file_id  BIGINT NOT NULL REFERENCES media_file (id) ON DELETE CASCADE,
    start_sec      DOUBLE PRECISION NOT NULL,
    end_sec        DOUBLE PRECISION NOT NULL,
    text           TEXT   NOT NULL,
    embedding      vector(${embedding_dim}) NOT NULL
);
CREATE INDEX transcript_chunk_media_idx ON transcript_chunk (media_file_id);
CREATE INDEX transcript_chunk_embedding_hnsw ON transcript_chunk USING hnsw (embedding vector_cosine_ops);
