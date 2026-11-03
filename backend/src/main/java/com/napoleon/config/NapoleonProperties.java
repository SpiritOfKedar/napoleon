package com.napoleon.config;

import jakarta.validation.Valid;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import java.time.Duration;
import java.util.List;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.validation.annotation.Validated;

@Validated
@ConfigurationProperties(prefix = "napoleon")
public record NapoleonProperties(
        @NotBlank String storageDir,
        List<String> corsAllowedOrigins,
        @Valid @NotNull Transcription transcription,
        @Valid @NotNull Embedding embedding,
        @Valid @NotNull Chunking chunking,
        @Valid @NotNull Processing processing,
        @Valid @NotNull Search search) {

    /**
     * @param readTimeout       for the upload-based /transcribe call, which answers only when done
     * @param sharedStorage     the transcription service mounts the media dir, so files are passed
     *                          by path and transcribed through the streaming, resumable endpoint
     * @param streamIdleTimeout longest silence on the stream; the service sends heartbeats
     */
    public record Transcription(@NotBlank String baseUrl, @NotNull Duration connectTimeout, @NotNull Duration readTimeout,
                                boolean sharedStorage, @NotNull Duration streamIdleTimeout) {}

    public record Embedding(@NotBlank String model, @Positive int dim, @Positive int batchSize) {}

    public record Chunking(@Positive double windowSec, @Min(0) double overlapSec) {}

    public record Processing(@Positive int workerThreads) {}

    public record Search(@Positive int defaultLimit) {}
}
