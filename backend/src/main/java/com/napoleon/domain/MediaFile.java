package com.napoleon.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.PrePersist;
import jakarta.persistence.PreUpdate;
import jakarta.persistence.Table;
import java.time.Instant;

@Entity
@Table(name = "media_file")
public class MediaFile {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String filename;

    @Column(name = "storage_path", nullable = false)
    private String storagePath;

    @Column(name = "content_type")
    private String contentType;

    @Column(name = "size_bytes")
    private Long sizeBytes;

    @Column(name = "duration_sec")
    private Double durationSec;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false)
    private MediaStatus status;

    /** 0..100 while transcribing; written directly by TranscriptIndexer as segments arrive. */
    @Column(name = "progress_pct")
    private Double progressPct;

    /** Embedding model that produced this file's vectors; null for files indexed before V3. */
    @Column(name = "embedding_model")
    private String embeddingModel;

    @Column(name = "processing_started_at")
    private Instant processingStartedAt;

    @Column(name = "error_message")
    private String errorMessage;

    @Column(name = "created_at", nullable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false)
    private Instant updatedAt;

    protected MediaFile() {}

    public MediaFile(String filename, String storagePath, String contentType, Long sizeBytes) {
        this.filename = filename;
        this.storagePath = storagePath;
        this.contentType = contentType;
        this.sizeBytes = sizeBytes;
        this.status = MediaStatus.UPLOADED;
    }

    @PrePersist
    void onCreate() {
        createdAt = Instant.now();
        updatedAt = createdAt;
    }

    @PreUpdate
    void onUpdate() {
        updatedAt = Instant.now();
    }

    public Long getId() { return id; }
    public String getFilename() { return filename; }
    public String getStoragePath() { return storagePath; }
    public String getContentType() { return contentType; }
    public Long getSizeBytes() { return sizeBytes; }
    public Double getDurationSec() { return durationSec; }
    public MediaStatus getStatus() { return status; }
    public Double getProgressPct() { return progressPct; }
    public String getErrorMessage() { return errorMessage; }
    public String getEmbeddingModel() { return embeddingModel; }
    public Instant getProcessingStartedAt() { return processingStartedAt; }
    public void setEmbeddingModel(String embeddingModel) { this.embeddingModel = embeddingModel; }
    public void setProcessingStartedAt(Instant processingStartedAt) { this.processingStartedAt = processingStartedAt; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getUpdatedAt() { return updatedAt; }

    public void setStoragePath(String storagePath) { this.storagePath = storagePath; }
    public void setDurationSec(Double durationSec) { this.durationSec = durationSec; }
    public void setProgressPct(Double progressPct) { this.progressPct = progressPct; }

    public void setStatus(MediaStatus status) {
        this.status = status;
        if (status != MediaStatus.FAILED) {
            this.errorMessage = null;
        }
    }

    public void markFailed(String message) {
        this.status = MediaStatus.FAILED;
        this.errorMessage = message;
    }
}
