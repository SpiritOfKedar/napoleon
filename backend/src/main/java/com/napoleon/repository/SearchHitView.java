package com.napoleon.repository;

/** Projection for the native similarity query; getter names match the SQL column aliases. */
public interface SearchHitView {
    Long getChunkId();
    Long getMediaId();
    String getMediaFilename();
    /** Start of the best-matching segment inside the chunk (falls back to the chunk start). */
    Double getStartSec();
    Double getEndSec();
    Double getChunkStartSec();
    Double getChunkEndSec();
    String getText();
    Double getScore();
}
