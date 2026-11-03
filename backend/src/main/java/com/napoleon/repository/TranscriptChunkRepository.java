package com.napoleon.repository;

import com.napoleon.domain.TranscriptChunk;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

/** Searching lives in {@link SearchRepository}; this is plain CRUD. */
public interface TranscriptChunkRepository extends JpaRepository<TranscriptChunk, Long> {

    long countByMediaFileId(Long mediaFileId);

    @Modifying
    @Query("delete from TranscriptChunk c where c.mediaFileId = :mediaFileId")
    void deleteByMediaFileId(Long mediaFileId);
}
