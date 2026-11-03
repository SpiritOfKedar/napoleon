package com.napoleon.service;

import com.napoleon.config.NapoleonProperties;
import com.napoleon.domain.MediaFile;
import com.napoleon.domain.MediaStatus;
import com.napoleon.repository.MediaFileRepository;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.List;
import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Persists a transcript incrementally while it is being produced.
 *
 * <p>Segments are appended in batches, one transaction each, as they stream in. That keeps memory
 * flat for long recordings and is what makes resuming possible: whatever was committed before a
 * crash is kept, and {@link #resumePoint} tells where to continue. Chunks are built once all
 * segments are in ({@link #finalizeIndex}) because the overlap needs neighbouring segments.
 *
 * <p>Inserts go through JDBC batches: the entities use IDENTITY ids, which turn off Hibernate's
 * batching, and long recordings have thousands of rows.
 */
@Component
public class TranscriptIndexer {

    static final int INSERT_BATCH_SIZE = 500;

    private static final String INSERT_SEGMENT = """
            INSERT INTO transcript_segment (media_file_id, seq, start_sec, end_sec, text, embedding)
            VALUES (?, ?, ?, ?, ?, CAST(? AS vector))
            """;

    private static final String INSERT_CHUNK = """
            INSERT INTO transcript_chunk (media_file_id, start_sec, end_sec, text, embedding)
            VALUES (?, ?, ?, ?, CAST(? AS vector))
            """;

    private final MediaFileRepository mediaRepo;
    private final JdbcTemplate jdbc;
    private final String embeddingModel;

    public TranscriptIndexer(MediaFileRepository mediaRepo, JdbcTemplate jdbc, NapoleonProperties props) {
        this.mediaRepo = mediaRepo;
        this.jdbc = jdbc;
        this.embeddingModel = props.embedding().model();
    }

    public record EmbeddedSegment(Chunker.Segment segment, float[] embedding) {}

    public record EmbeddedChunk(Chunker.Chunk chunk, float[] embedding) {}

    /** Where an interrupted transcription left off: the next seq and the end of the last stored segment. */
    public record ResumePoint(int nextSeq, double endSec) {}

    /** Throws away any previous transcript of this file and resets its progress. */
    @Transactional
    public void reset(long mediaId) {
        jdbc.update("DELETE FROM transcript_chunk WHERE media_file_id = ?", mediaId);
        jdbc.update("DELETE FROM transcript_segment WHERE media_file_id = ?", mediaId);
        jdbc.update("UPDATE media_file SET progress_pct = 0, updated_at = now() WHERE id = ?", mediaId);
    }

    /** Keeps the stored segments (chunks are rebuilt at the end anyway) and reports where they stop. */
    @Transactional
    public ResumePoint resumePoint(long mediaId) {
        jdbc.update("DELETE FROM transcript_chunk WHERE media_file_id = ?", mediaId);
        return jdbc.queryForObject("""
                        SELECT COALESCE(MAX(seq) + 1, 0) AS next_seq, COALESCE(MAX(end_sec), 0) AS end_sec
                        FROM transcript_segment WHERE media_file_id = ?
                        """,
                (rs, i) -> new ResumePoint(rs.getInt("next_seq"), rs.getDouble("end_sec")), mediaId);
    }

    @Transactional
    public void recordDuration(long mediaId, Double durationSec) {
        jdbc.update("UPDATE media_file SET duration_sec = ?, updated_at = now() WHERE id = ?", durationSec, mediaId);
    }

    /** Stores one batch of segments, numbered from firstSeq, and the progress reached with it. */
    @Transactional
    public void appendSegments(long mediaId, int firstSeq, List<EmbeddedSegment> segments, Double progressPct) {
        jdbc.batchUpdate(INSERT_SEGMENT, new BatchPreparedStatementSetter() {
            @Override
            public void setValues(PreparedStatement ps, int i) throws SQLException {
                EmbeddedSegment s = segments.get(i);
                ps.setLong(1, mediaId);
                ps.setInt(2, firstSeq + i);
                ps.setDouble(3, s.segment().startSec());
                ps.setDouble(4, s.segment().endSec());
                ps.setString(5, s.segment().text());
                ps.setString(6, VectorFormat.toLiteral(s.embedding()));
            }

            @Override
            public int getBatchSize() {
                return segments.size();
            }
        });
        if (progressPct != null) {
            jdbc.update("UPDATE media_file SET progress_pct = ?, updated_at = now() WHERE id = ?", progressPct, mediaId);
        }
    }

    /** All stored segments in order, without their embeddings (only what chunking needs). */
    @Transactional(readOnly = true)
    public List<Chunker.Segment> loadSegments(long mediaId) {
        return jdbc.query("SELECT start_sec, end_sec, text FROM transcript_segment WHERE media_file_id = ? ORDER BY seq",
                (rs, i) -> new Chunker.Segment(rs.getDouble("start_sec"), rs.getDouble("end_sec"), rs.getString("text")),
                mediaId);
    }

    /** Writes the chunks and marks the file INDEXED, in one transaction. */
    @Transactional
    public void finalizeIndex(long mediaId, Double durationSec, List<EmbeddedChunk> chunks) {
        MediaFile media = mediaRepo.findById(mediaId)
                .orElseThrow(() -> new NotFoundException("Media " + mediaId + " was deleted during processing"));

        // Re-running must not leave duplicates behind.
        jdbc.update("DELETE FROM transcript_chunk WHERE media_file_id = ?", mediaId);
        jdbc.batchUpdate(INSERT_CHUNK, chunks, INSERT_BATCH_SIZE, (ps, c) -> {
            ps.setLong(1, mediaId);
            ps.setDouble(2, c.chunk().startSec());
            ps.setDouble(3, c.chunk().endSec());
            ps.setString(4, c.chunk().text());
            ps.setString(5, VectorFormat.toLiteral(c.embedding()));
        });

        if (durationSec != null) {
            media.setDurationSec(durationSec);
        }
        media.setProgressPct(100.0);
        media.setEmbeddingModel(embeddingModel);
        media.setStatus(MediaStatus.INDEXED);
    }
}
