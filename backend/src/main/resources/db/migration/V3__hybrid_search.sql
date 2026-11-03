-- Keyword side of hybrid search. 'english' stems English words and drops English stop words;
-- text in other scripts (Tamil, Hindi, ...) passes through as plain tokens, so exact words and
-- names still match in any language. Generated, so existing rows are filled in by this migration.
ALTER TABLE transcript_chunk
    ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED;
CREATE INDEX transcript_chunk_tsv_idx ON transcript_chunk USING gin (tsv);

ALTER TABLE transcript_segment
    ADD COLUMN tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED;
CREATE INDEX transcript_segment_tsv_idx ON transcript_segment USING gin (tsv);

-- Which embedding model produced this file's vectors. NULL = indexed before this column existed.
-- Files whose model differs from EMBEDDING_MODEL are re-embedded on startup.
ALTER TABLE media_file ADD COLUMN embedding_model VARCHAR(255);

-- When the current transcription started, so the UI can estimate time remaining.
ALTER TABLE media_file ADD COLUMN processing_started_at TIMESTAMPTZ;
