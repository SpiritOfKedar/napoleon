package com.napoleon.service;

import com.napoleon.client.TranscriptionClient;
import com.napoleon.config.AsyncConfig;
import com.napoleon.config.NapoleonProperties;
import com.napoleon.domain.MediaFile;
import com.napoleon.domain.MediaStatus;
import com.napoleon.repository.MediaFileRepository;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/**
 * The upload pipeline: transcribe, embed and store segments as they arrive, then chunk, embed and
 * store chunks. Runs on the media executor.
 *
 * <p>With shared storage the transcription service reads the file from the shared volume and
 * streams segments back, so a long recording is indexed incrementally, shows progress, and resumes
 * from the last stored segment if the backend restarts mid-way. Without it, the file is uploaded
 * and the whole transcript comes back in one response.
 */
@Service
public class MediaProcessingService {

    private static final Logger log = LoggerFactory.getLogger(MediaProcessingService.class);
    private static final int MAX_ERROR_LENGTH = 2000;
    /** First boot downloads models; give the service plenty of time before failing a file. */
    private static final java.time.Duration READY_TIMEOUT = java.time.Duration.ofMinutes(30);
    /** Progress stays below this until chunks are written and the file is really INDEXED. */
    private static final double MAX_STREAMING_PROGRESS = 99.0;

    private final MediaFileRepository mediaRepo;
    private final MediaStorage storage;
    private final TranscriptionClient client;
    private final TranscriptIndexer indexer;
    private final Chunker chunker;
    private final int embedBatchSize;
    private final boolean sharedStorage;

    public MediaProcessingService(MediaFileRepository mediaRepo, MediaStorage storage,
                                  TranscriptionClient client, TranscriptIndexer indexer,
                                  NapoleonProperties props) {
        this.mediaRepo = mediaRepo;
        this.storage = storage;
        this.client = client;
        this.indexer = indexer;
        this.chunker = new Chunker(props.chunking().windowSec(), props.chunking().overlapSec());
        this.embedBatchSize = props.embedding().batchSize();
        this.sharedStorage = props.transcription().sharedStorage();
    }

    @Async(AsyncConfig.MEDIA_EXECUTOR)
    public void processAsync(long mediaId) {
        process(mediaId);
    }

    /** Never throws: any failure is recorded on the MediaFile as FAILED with a message. */
    public void process(long mediaId) {
        MediaFile media = mediaRepo.findById(mediaId).orElse(null);
        if (media == null) {
            log.warn("Media {} disappeared before processing started", mediaId);
            return;
        }
        try {
            // TRANSCRIBING at this point means a previous run was cut off (ProcessingRecovery).
            boolean interrupted = media.getStatus() == MediaStatus.TRANSCRIBING;
            // If the service is still starting (e.g. after a restart), wait instead of failing the file.
            client.awaitReady(READY_TIMEOUT);
            media.setStatus(MediaStatus.TRANSCRIBING);
            media.setProcessingStartedAt(Instant.now());
            media = mediaRepo.save(media);

            long t0 = System.currentTimeMillis();
            SegmentSink sink;
            if (sharedStorage) {
                double offset = 0;
                int nextSeq = 0;
                if (interrupted) {
                    TranscriptIndexer.ResumePoint from = indexer.resumePoint(mediaId);
                    offset = from.endSec();
                    nextSeq = from.nextSeq();
                    if (nextSeq > 0) {
                        log.info("Resuming media {} ({}) at {}s; keeping {} stored segments",
                                mediaId, media.getFilename(), offset, nextSeq);
                    }
                } else {
                    indexer.reset(mediaId);
                }
                sink = new SegmentSink(mediaId, nextSeq, media.getDurationSec());
                client.transcribeStream(storage.relativePath(media.getStoragePath()), offset, sink);
                sink.flush();
            } else {
                indexer.reset(mediaId);
                TranscriptionClient.TranscriptionResult result =
                        client.transcribe(storage.resolve(media.getStoragePath()), media.getFilename());
                sink = new SegmentSink(mediaId, 0, null);
                sink.onMeta(result.durationSec());
                result.segments().forEach(sink::onSegment);
                sink.flush();
            }

            List<Chunker.Segment> segments = indexer.loadSegments(mediaId);
            if (segments.isEmpty()) {
                throw new IllegalStateException("No speech was detected in this file");
            }

            // Chunks are what search ranks; segments were embedded too (while streaming) so search
            // can point at the exact sentence inside a 30 s chunk instead of the chunk's start.
            List<Chunker.Chunk> chunks = chunker.chunk(segments);
            List<float[]> chunkVectors = embedInBatches(chunks.stream().map(Chunker.Chunk::text).toList());
            List<TranscriptIndexer.EmbeddedChunk> embeddedChunks = new ArrayList<>(chunks.size());
            for (int i = 0; i < chunks.size(); i++) {
                embeddedChunks.add(new TranscriptIndexer.EmbeddedChunk(chunks.get(i), chunkVectors.get(i)));
            }
            indexer.finalizeIndex(mediaId, sink.durationSec, embeddedChunks);

            log.info("Indexed media {} ({}): {} segments, {} chunks in {} ms", mediaId, media.getFilename(),
                    segments.size(), chunks.size(), System.currentTimeMillis() - t0);
        } catch (Exception e) {
            log.error("Processing media {} failed", mediaId, e);
            markFailed(mediaId, e);
        }
    }

    /**
     * Collects streamed segments and stores them every {@code embedBatchSize} segments, so memory
     * stays flat and an interruption loses at most one batch.
     */
    private final class SegmentSink implements TranscriptionClient.StreamListener {

        private final long mediaId;
        private final List<Chunker.Segment> buffer = new ArrayList<>();
        private int nextSeq;
        private Double durationSec;

        SegmentSink(long mediaId, int nextSeq, Double knownDurationSec) {
            this.mediaId = mediaId;
            this.nextSeq = nextSeq;
            this.durationSec = knownDurationSec;
        }

        @Override
        public void onMeta(Double duration) {
            if (duration != null) {
                durationSec = duration;
                indexer.recordDuration(mediaId, duration);
            }
        }

        @Override
        public void onSegment(TranscriptionClient.Segment s) {
            if (s.text() == null || s.text().isBlank()) {
                return;
            }
            buffer.add(new Chunker.Segment(s.startSec(), s.endSec(), s.text().strip()));
            if (buffer.size() >= embedBatchSize) {
                flush();
            }
        }

        void flush() {
            if (buffer.isEmpty()) {
                return;
            }
            List<float[]> vectors = embedInBatches(buffer.stream().map(Chunker.Segment::text).toList());
            List<TranscriptIndexer.EmbeddedSegment> batch = new ArrayList<>(buffer.size());
            for (int i = 0; i < buffer.size(); i++) {
                batch.add(new TranscriptIndexer.EmbeddedSegment(buffer.get(i), vectors.get(i)));
            }
            indexer.appendSegments(mediaId, nextSeq, batch, progressAt(buffer.getLast().endSec()));
            nextSeq += buffer.size();
            buffer.clear();
        }

        private Double progressAt(double endSec) {
            if (durationSec == null || durationSec <= 0) {
                return null;
            }
            double pct = Math.min(MAX_STREAMING_PROGRESS, 100.0 * endSec / durationSec);
            return Math.round(pct * 10) / 10.0;
        }
    }

    private List<float[]> embedInBatches(List<String> texts) {
        List<float[]> out = new ArrayList<>(texts.size());
        for (int from = 0; from < texts.size(); from += embedBatchSize) {
            out.addAll(client.embed(texts.subList(from, Math.min(from + embedBatchSize, texts.size()))));
        }
        return out;
    }

    private void markFailed(long mediaId, Exception e) {
        try {
            mediaRepo.findById(mediaId).ifPresent(m -> {
                String msg = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
                m.markFailed(msg.length() > MAX_ERROR_LENGTH ? msg.substring(0, MAX_ERROR_LENGTH) : msg);
                mediaRepo.save(m);
            });
        } catch (Exception inner) {
            log.error("Could not record failure for media {}", mediaId, inner);
        }
    }
}
