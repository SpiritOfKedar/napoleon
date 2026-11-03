package com.napoleon.repository;

import com.napoleon.domain.TranscriptSegment;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface TranscriptSegmentRepository extends JpaRepository<TranscriptSegment, Long> {

    List<TranscriptSegment> findByMediaFileIdOrderBySeq(Long mediaFileId);

    @Modifying
    @Query("delete from TranscriptSegment s where s.mediaFileId = :mediaFileId")
    void deleteByMediaFileId(Long mediaFileId);
}
