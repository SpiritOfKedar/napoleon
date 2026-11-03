package com.napoleon.repository;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Hybrid retrieval over transcript chunks: semantic (pgvector) and keyword (full-text) candidates,
 * fused with reciprocal rank fusion. Plain JDBC because the query is built per request (optional
 * media filter) and returns more than a JPA projection comfortably handles.
 */
@Repository
public class SearchRepository {

    /** Standard RRF constant: dampens the advantage of rank 1 over rank 2. */
    static final int RRF_K = 60;

    public record Candidate(long chunkId, long mediaId, String mediaFilename, double startSec, double endSec,
                            String text, double similarity, double keywordScore, double fusedScore) {}

    public record Pinpoint(long chunkId, double startSec, double endSec) {}

    /*
     * vec:   nearest chunks by cosine distance (ORDER BY the bare distance so HNSW serves it).
     * terms: the query's lexemes (stemmed, English stop words removed).
     * idf:   rarity of each term among the searched chunks, BM25-style. Without this, a chunk that
     *        says "think" five times would outrank the one chunk that mentions "Elon".
     * kw:    chunks containing any query term, scored by the summed idf of the terms they contain.
     * fused: reciprocal rank fusion of both lists, so a chunk found by both ranks highest.
     */
    private static final String CANDIDATES = """
            WITH vec AS (
                SELECT id, row_number() OVER (ORDER BY dist) AS r
                FROM (
                    SELECT c.id, c.embedding <=> CAST(:query AS vector) AS dist
                    FROM transcript_chunk c
                    %1$s
                    ORDER BY c.embedding <=> CAST(:query AS vector)
                    LIMIT :k
                ) v
            ),
            terms AS (
                SELECT DISTINCT plainto_tsquery('simple', t.lexeme) AS tq
                FROM unnest(to_tsvector('english', :text)) t
            ),
            total AS (
                SELECT count(*)::float8 AS n FROM transcript_chunk c %1$s
            ),
            idf AS (
                SELECT t.tq, ln(1 + (total.n - d.df + 0.5) / (d.df + 0.5)) AS w
                FROM terms t
                CROSS JOIN total
                CROSS JOIN LATERAL (
                    SELECT count(*)::float8 AS df FROM transcript_chunk c WHERE c.tsv @@ t.tq %2$s
                ) d
                WHERE d.df > 0
            ),
            kw AS (
                SELECT id, score, row_number() OVER (ORDER BY score DESC) AS r
                FROM (
                    SELECT c.id, sum(i.w) AS score
                    FROM transcript_chunk c
                    JOIN idf i ON c.tsv @@ i.tq
                    %1$s
                    GROUP BY c.id
                    ORDER BY score DESC
                    LIMIT :k
                ) s
            ),
            fused AS (
                SELECT COALESCE(vec.id, kw.id) AS id,
                       COALESCE(1.0 / (%3$d + vec.r), 0) + COALESCE(1.0 / (%3$d + kw.r), 0) AS fused,
                       COALESCE(kw.score, 0) AS kw_score
                FROM vec FULL OUTER JOIN kw ON vec.id = kw.id
            )
            SELECT c.id AS chunk_id, c.media_file_id, m.filename, c.start_sec, c.end_sec, c.text,
                   1 - (c.embedding <=> CAST(:query AS vector)) AS similarity,
                   f.kw_score, f.fused
            FROM fused f
            JOIN transcript_chunk c ON c.id = f.id
            JOIN media_file m ON m.id = c.media_file_id
            ORDER BY f.fused DESC, similarity DESC
            LIMIT :n
            """;

    /*
     * For each chunk, the segment (sentence) inside it that best matches: closest by embedding,
     * with a bonus for containing the query's words, so the player starts on the sentence that
     * actually says them.
     */
    private static final String PINPOINT = """
            SELECT DISTINCT ON (c.id) c.id AS chunk_id, s.start_sec, s.end_sec
            FROM transcript_chunk c
            JOIN transcript_segment s
              ON s.media_file_id = c.media_file_id
             AND s.start_sec >= c.start_sec
             AND s.end_sec <= c.end_sec
            WHERE c.id IN (:ids)
            ORDER BY c.id,
                     (s.embedding <=> CAST(:query AS vector))
                     - 2.0 * ts_rank(s.tsv, replace(plainto_tsquery('english', :text)::text, '&', '|')::tsquery)
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public SearchRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * @param vectorLiteral pgvector literal of the query embedding
     * @param text          the raw query text, for keyword matching
     * @param mediaId       restricts the search to one file, or null for all files
     * @param perList       candidates taken from each of the vector and keyword lists
     * @param limit         fused candidates returned
     */
    public List<Candidate> candidates(String vectorLiteral, String text, Long mediaId, int perList, int limit) {
        String where = mediaId != null ? "WHERE c.media_file_id = :mediaId" : "";
        String and = mediaId != null ? "AND c.media_file_id = :mediaId" : "";
        String sql = CANDIDATES.formatted(where, and, RRF_K);
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("query", vectorLiteral)
                .addValue("text", text)
                .addValue("k", perList)
                .addValue("n", limit);
        if (mediaId != null) {
            params.addValue("mediaId", mediaId);
        }
        return jdbc.query(sql, params, (rs, i) -> new Candidate(
                rs.getLong("chunk_id"), rs.getLong("media_file_id"), rs.getString("filename"),
                rs.getDouble("start_sec"), rs.getDouble("end_sec"), rs.getString("text"),
                rs.getDouble("similarity"), rs.getDouble("kw_score"), rs.getDouble("fused")));
    }

    /** Best sentence inside each of the given chunks, keyed by chunk id. Chunks without segments are absent. */
    public Map<Long, Pinpoint> pinpoint(List<Long> chunkIds, String vectorLiteral, String text) {
        Map<Long, Pinpoint> out = new HashMap<>();
        if (chunkIds.isEmpty()) {
            return out;
        }
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("ids", chunkIds)
                .addValue("query", vectorLiteral)
                .addValue("text", text);
        jdbc.query(PINPOINT, params, rs -> {
            long id = rs.getLong("chunk_id");
            out.put(id, new Pinpoint(id, rs.getDouble("start_sec"), rs.getDouble("end_sec")));
        });
        return out;
    }
}
