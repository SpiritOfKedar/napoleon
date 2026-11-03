-- How far transcription has got, 0..100. Long recordings take a while; this is what the UI shows.
ALTER TABLE media_file ADD COLUMN progress_pct REAL;

-- Resuming an interrupted file looks up the last stored segment.
CREATE INDEX transcript_segment_media_seq_idx ON transcript_segment (media_file_id, seq);
