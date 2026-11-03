package com.napoleon.repository;

import com.napoleon.domain.MediaFile;
import com.napoleon.domain.MediaStatus;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;

public interface MediaFileRepository extends JpaRepository<MediaFile, Long> {

    List<MediaFile> findAllByOrderByCreatedAtDesc();

    List<MediaFile> findByStatusIn(Collection<MediaStatus> statuses);
}
