package com.napoleon.dto;

import com.napoleon.repository.SearchHitView;

/**
 * One search hit. {@code startSec}/{@code endSec} are the best-matching sentence (where playback
 * should start); {@code text} is the surrounding chunk, spanning {@code chunkStartSec}..{@code chunkEndSec}.
 */
public record SearchResultDto(
        Long chunkId,
        Long mediaId,
        String mediaFilename,
        double startSec,
        double endSec,
        double chunkStartSec,
        double chunkEndSec,
        String text,
        double score) {

    public static SearchResultDto from(SearchHitView h) {
        return new SearchResultDto(h.getChunkId(), h.getMediaId(), h.getMediaFilename(),
                h.getStartSec(), h.getEndSec(), h.getChunkStartSec(), h.getChunkEndSec(),
                h.getText(), h.getScore());
    }
}
