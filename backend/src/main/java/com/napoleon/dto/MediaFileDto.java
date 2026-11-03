package com.napoleon.dto;

import com.napoleon.domain.MediaFile;
import com.napoleon.domain.MediaStatus;
import java.time.Instant;

public record MediaFileDto(
        Long id,
        String filename,
        String contentType,
        Long sizeBytes,
        Double durationSec,
        MediaStatus status,
        String errorMessage,
        Instant createdAt,
        Instant updatedAt) {

    public static MediaFileDto from(MediaFile m) {
        return new MediaFileDto(m.getId(), m.getFilename(), m.getContentType(), m.getSizeBytes(),
                m.getDurationSec(), m.getStatus(), m.getErrorMessage(), m.getCreatedAt(), m.getUpdatedAt());
    }
}
