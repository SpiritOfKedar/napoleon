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
        /* 0..100 while TRANSCRIBING, null before transcription starts. */
        Double progressPct,
        String errorMessage,
        Instant createdAt,
        Instant updatedAt) {

    public static MediaFileDto from(MediaFile m) {
        return new MediaFileDto(m.getId(), m.getFilename(), m.getContentType(), m.getSizeBytes(),
                m.getDurationSec(), m.getStatus(), m.getProgressPct(), m.getErrorMessage(),
                m.getCreatedAt(), m.getUpdatedAt());
    }
}
