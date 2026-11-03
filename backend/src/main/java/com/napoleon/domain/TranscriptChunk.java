package com.napoleon.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import org.hibernate.annotations.ColumnTransformer;

/** An overlapping ~30 s window of transcript text plus its embedding. This is the unit of search. */
@Entity
@Table(name = "transcript_chunk")
public class TranscriptChunk {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "media_file_id", nullable = false)
    private Long mediaFileId;

    @Column(name = "start_sec", nullable = false)
    private double startSec;

    @Column(name = "end_sec", nullable = false)
    private double endSec;

    @Column(nullable = false, columnDefinition = "text")
    private String text;

    /**
     * pgvector text form, e.g. "[0.1,0.2,...]". Stored as a String and cast on write, which avoids
     * a custom Hibernate type. See {@link com.napoleon.service.VectorFormat}.
     */
    @ColumnTransformer(write = "CAST(? AS vector)")
    @Column(nullable = false, columnDefinition = "vector")
    private String embedding;

    protected TranscriptChunk() {}

    public TranscriptChunk(Long mediaFileId, double startSec, double endSec, String text, String embedding) {
        this.mediaFileId = mediaFileId;
        this.startSec = startSec;
        this.endSec = endSec;
        this.text = text;
        this.embedding = embedding;
    }

    public Long getId() { return id; }
    public Long getMediaFileId() { return mediaFileId; }
    public double getStartSec() { return startSec; }
    public double getEndSec() { return endSec; }
    public String getText() { return text; }
    public String getEmbedding() { return embedding; }
}
