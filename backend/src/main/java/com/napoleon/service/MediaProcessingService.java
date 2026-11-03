package com.napoleon.service;

import com.napoleon.client.TranscriptionClient;
import com.napoleon.config.AsyncConfig;
import com.napoleon.config.NapoleonProperties;
import com.napoleon.domain.MediaFile;
import com.napoleon.domain.MediaStatus;
import com.napoleon.repository.MediaFileRepository;
import java.util.ArrayList;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

/** The upload pipeline: transcribe, chunk, embed, persist. Runs on the media executor. */
@Service
public class MediaProcessingService {

    private static final Logger log = LoggerFactory.getLogger(MediaProcessingService.class);
    private static final int MAX_ERROR_LENGTH = 2000;

    private final MediaFileRepository mediaRepo;
    private final MediaStorage storage;
    private final TranscriptionClient client;
    private final TranscriptIndexer indexer;
    private final Chunker chunker;
    private final int embedBatchSize;

    public MediaProcessingService(MediaFileRepository mediaRepo, MediaStorage storage,
                                  TranscriptionClient client, TranscriptIndexer indexer,
                                  NapoleonProperties props) {
        this.mediaRepo = mediaRepo;
        this.storage = storage;
        this.client = client;
        this.indexer = indexer;
        this.chunker = new Chunker(props.chunking().windowSec(), props.chunking().overlapSec());
        this.embedBatchSize = props.embedding().batchSize();
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
            media.setStatus(MediaStatus.TRANSCRIBING);
            media = mediaRepo.save(media);

            long t0 = System.currentTimeMillis();
            TranscriptionClient.TranscriptionResult result =
                    client.transcribe(storage.resolve(media.getStoragePath()), media.getFilename());

            List<Chunker.Segment> segments = result.segments().stream()
                    .filter(s -> s.text() != null && !s.text().isBlank())
                    .map(s -> new Chunker.Segment(s.startSec(), s.endSec(), s.text().strip()))
                    .toList();
            if (segments.isEmpty()) {
                throw new IllegalStateException("No speech was detected in this file");
            }

            List<Chunker.Chunk> chunks = chunker.chunk(segments);

            // Chunks are what search ranks; segments are embedded too so search can point at the
            // exact sentence inside a 30 s chunk instead of the chunk's start.
            List<float[]> chunkVectors = embedInBatches(chunks.stream().map(Chunker.Chunk::text).toList());
            List<float[]> segmentVectors = embedInBatches(segments.stream().map(Chunker.Segment::text).toList());

            List<TranscriptIndexer.EmbeddedChunk> embeddedChunks = new ArrayList<>(chunks.size());
            for (int i = 0; i < chunks.size(); i++) {
                embeddedChunks.add(new TranscriptIndexer.EmbeddedChunk(chunks.get(i), chunkVectors.get(i)));
            }
            List<TranscriptIndexer.EmbeddedSegment> embeddedSegments = new ArrayList<>(segments.size());
            for (int i = 0; i < segments.size(); i++) {
                embeddedSegments.add(new TranscriptIndexer.EmbeddedSegment(segments.get(i), segmentVectors.get(i)));
            }
            indexer.replaceIndex(mediaId, result.durationSec(), embeddedSegments, embeddedChunks);

            log.info("Indexed media {} ({}): {} segments, {} chunks in {} ms", mediaId, media.getFilename(),
                    segments.size(), chunks.size(), System.currentTimeMillis() - t0);
        } catch (Exception e) {
            log.error("Processing media {} failed", mediaId, e);
            markFailed(mediaId, e);
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
