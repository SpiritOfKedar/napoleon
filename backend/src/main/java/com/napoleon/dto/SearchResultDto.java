package com.napoleon.dto;

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
        /* Relevance 0..1: the cross-encoder score, or cosine similarity when reranking is off. */
        double score) {}
