package com.napoleon.service;

import com.napoleon.client.TranscriptionClient;
import com.napoleon.config.AsyncConfig;
import com.napoleon.config.NapoleonProperties;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.util.List;
import java.util.concurrent.Executor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.jdbc.core.BatchPreparedStatementSetter;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

/**
 * Vectors from different embedding models are not comparable, so after EMBEDDING_MODEL changes,
 * every indexed file is re-embedded from its stored transcript text on startup. No re-transcription
 * is needed. Files are done one at a time on the media executor; search keeps working meanwhile
 * (files not yet refreshed just rank poorly until they are).
 */
@Component
public class EmbeddingRefresher {

    private static final Logger log = LoggerFactory.getLogger(EmbeddingRefresher.class);

    /** First boot downloads models; give the service plenty of time before giving up. */
    private static final java.time.Duration READY_TIMEOUT = java.time.Duration.ofMinutes(30);

    private record Row(long id, String text) {}

    private final JdbcTemplate jdbc;
    private final TranscriptionClient client;
    private final Executor executor;
    private final String model;
    private final int batchSize;

    public EmbeddingRefresher(JdbcTemplate jdbc, TranscriptionClient client,
                              @Qualifier(AsyncConfig.MEDIA_EXECUTOR) Executor executor, NapoleonProperties props) {
        this.jdbc = jdbc;
        this.client = client;
        this.executor = executor;
        this.model = props.embedding().model();
        this.batchSize = props.embedding().batchSize();
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onReady() {
        List<Long> stale = jdbc.queryForList(
                "SELECT id FROM media_file WHERE status = 'INDEXED' AND embedding_model IS DISTINCT FROM ? ORDER BY id",
                Long.class, model);
        if (stale.isEmpty()) {
            return;
        }
        log.info("Re-embedding {} file(s) with {}", stale.size(), model);
        executor.execute(() -> {
            try {
                client.awaitReady(READY_TIMEOUT);
            } catch (RuntimeException e) {
                log.error("Not re-embedding: {}. It will be retried on next startup.", e.getMessage());
                return;
            }
            stale.forEach(this::refreshQuietly);
        });
    }

    private void refreshQuietly(long mediaId) {
        try {
            long t0 = System.currentTimeMillis();
            int n = refresh(mediaId);
            log.info("Re-embedded media {} ({} rows) in {} ms", mediaId, n, System.currentTimeMillis() - t0);
        } catch (Exception e) {
            log.error("Re-embedding media {} failed; it will be retried on next startup", mediaId, e);
        }
    }

    /** Re-embeds one file's segments and chunks; returns the number of rows updated. */
    public int refresh(long mediaId) {
        int n = reembed("transcript_segment", mediaId) + reembed("transcript_chunk", mediaId);
        jdbc.update("UPDATE media_file SET embedding_model = ? WHERE id = ?", model, mediaId);
        return n;
    }

    private int reembed(String table, long mediaId) {
        // table is one of two constants above, never user input.
        List<Row> rows = jdbc.query("SELECT id, text FROM " + table + " WHERE media_file_id = ? ORDER BY id",
                (rs, i) -> new Row(rs.getLong("id"), rs.getString("text")), mediaId);
        for (int from = 0; from < rows.size(); from += batchSize) {
            List<Row> batch = rows.subList(from, Math.min(from + batchSize, rows.size()));
            List<float[]> vectors = client.embed(batch.stream().map(Row::text).toList());
            jdbc.batchUpdate("UPDATE " + table + " SET embedding = CAST(? AS vector) WHERE id = ?",
                    new BatchPreparedStatementSetter() {
                        @Override
                        public void setValues(PreparedStatement ps, int i) throws SQLException {
                            ps.setString(1, VectorFormat.toLiteral(vectors.get(i)));
                            ps.setLong(2, batch.get(i).id());
                        }

                        @Override
                        public int getBatchSize() {
                            return batch.size();
                        }
                    });
        }
        return rows.size();
    }
}
