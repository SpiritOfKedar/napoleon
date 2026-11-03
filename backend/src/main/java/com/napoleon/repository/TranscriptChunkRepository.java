package com.napoleon.repository;

import com.napoleon.domain.TranscriptChunk;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface TranscriptChunkRepository extends JpaRepository<TranscriptChunk, Long> {

    /*
     * Two steps in one query:
     *  1. "top": nearest chunks by cosine distance (<=>). ORDER BY uses the bare distance
     *     expression against a constant so the HNSW index can serve it.
     *  2. LATERAL: inside each top chunk, the single segment closest to the query. Its start time
     *     is what the result points at, so the player lands on the sentence, not the chunk start.
     * score = 1 - cosine distance = cosine similarity of the chunk.
     * CAST(...) rather than :: because "::" would clash with named-parameter parsing.
     */
    String TOP_CHUNKS = """
            SELECT c.id, c.media_file_id, c.start_sec, c.end_sec, c.text,
                   c.embedding <=> CAST(:query AS vector) AS dist
            FROM transcript_chunk c
            """;

    String RANK_AND_PINPOINT = """
            ORDER BY c.embedding <=> CAST(:query AS vector)
            LIMIT :limit
            ) top
            JOIN media_file m ON m.id = top.media_file_id
            LEFT JOIN LATERAL (
                SELECT s.start_sec, s.end_sec
                FROM transcript_segment s
                WHERE s.media_file_id = top.media_file_id
                  AND s.start_sec >= top.start_sec
                  AND s.end_sec <= top.end_sec
                ORDER BY s.embedding <=> CAST(:query AS vector)
                LIMIT 1
            ) best ON true
            ORDER BY top.dist
            """;

    String SELECT_HITS = """
            SELECT top.id            AS chunkId,
                   top.media_file_id AS mediaId,
                   m.filename        AS mediaFilename,
                   COALESCE(best.start_sec, top.start_sec) AS startSec,
                   COALESCE(best.end_sec, top.end_sec)     AS endSec,
                   top.start_sec     AS chunkStartSec,
                   top.end_sec       AS chunkEndSec,
                   top.text          AS text,
                   1 - top.dist      AS score
            FROM (
            """;

    @Query(value = SELECT_HITS + TOP_CHUNKS + RANK_AND_PINPOINT, nativeQuery = true)
    List<SearchHitView> searchAll(String query, int limit);

    @Query(value = SELECT_HITS + TOP_CHUNKS + "WHERE c.media_file_id = :mediaId\n" + RANK_AND_PINPOINT,
            nativeQuery = true)
    List<SearchHitView> searchInMedia(String query, long mediaId, int limit);

    long countByMediaFileId(Long mediaFileId);

    @Modifying
    @Query("delete from TranscriptChunk c where c.mediaFileId = :mediaFileId")
    void deleteByMediaFileId(Long mediaFileId);
}
