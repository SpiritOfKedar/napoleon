package com.napoleon.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.ColumnTransformer;

/**
 * One raw Whisper segment. Shown as the transcript in the player; its embedding is used to find
 * the exact moment inside a matching chunk.
 */
@Entity
@Table(name = "transcript_segment")
public class TranscriptSegment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "media_file_id", nullable = false)
    private Long mediaFileId;

    @Column(nullable = false)
    private int seq;

    @Column(name = "start_sec", nullable = false)
    private double startSec;

    @Column(name = "end_sec", nullable = false)
    private double endSec;

    @Column(nullable = false, columnDefinition = "text")
    private String text;

    /** pgvector literal; same handling as {@link TranscriptChunk#getEmbedding()}. */
    @ColumnTransformer(write = "CAST(? AS vector)")
    @Column(nullable = false, columnDefinition = "vector")
    private String embedding;

    protected TranscriptSegment() {}

    public TranscriptSegment(Long mediaFileId, int seq, double startSec, double endSec, String text, String embedding) {
        this.mediaFileId = mediaFileId;
        this.seq = seq;
        this.startSec = startSec;
        this.endSec = endSec;
        this.text = text;
        this.embedding = embedding;
    }

    public Long getId() { return id; }
    public Long getMediaFileId() { return mediaFileId; }
    public int getSeq() { return seq; }
    public double getStartSec() { return startSec; }
    public double getEndSec() { return endSec; }
    public String getText() { return text; }
    public String getEmbedding() { return embedding; }
}
