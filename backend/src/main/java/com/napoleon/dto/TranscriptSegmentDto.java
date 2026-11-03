package com.napoleon.dto;

import com.napoleon.domain.TranscriptSegment;

public record TranscriptSegmentDto(double startSec, double endSec, String text) {

    public static TranscriptSegmentDto from(TranscriptSegment s) {
        return new TranscriptSegmentDto(s.getStartSec(), s.getEndSec(), s.getText());
    }
}
