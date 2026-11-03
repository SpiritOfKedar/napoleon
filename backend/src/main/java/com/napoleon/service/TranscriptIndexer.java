package com.napoleon.service;

import com.napoleon.domain.MediaFile;
import com.napoleon.domain.MediaStatus;
import com.napoleon.domain.TranscriptChunk;
import com.napoleon.domain.TranscriptSegment;
import com.napoleon.repository.MediaFileRepository;
import com.napoleon.repository.TranscriptChunkRepository;
import com.napoleon.repository.TranscriptSegmentRepository;
import java.util.ArrayList;
import java.util.List;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/** Writes a media file's segments and chunks and marks it INDEXED, all in one transaction. */
@Component
public class TranscriptIndexer {

    private final MediaFileRepository mediaRepo;
    private final TranscriptSegmentRepository segmentRepo;
    private final TranscriptChunkRepository chunkRepo;

    public TranscriptIndexer(MediaFileRepository mediaRepo,
                             TranscriptSegmentRepository segmentRepo,
                             TranscriptChunkRepository chunkRepo) {
        this.mediaRepo = mediaRepo;
        this.segmentRepo = segmentRepo;
        this.chunkRepo = chunkRepo;
    }

    public record EmbeddedSegment(Chunker.Segment segment, float[] embedding) {}

    public record EmbeddedChunk(Chunker.Chunk chunk, float[] embedding) {}

    @Transactional
    public void replaceIndex(long mediaId, Double durationSec,
                             List<EmbeddedSegment> segments, List<EmbeddedChunk> chunks) {
        MediaFile media = mediaRepo.findById(mediaId)
                .orElseThrow(() -> new NotFoundException("Media " + mediaId + " was deleted during processing"));

        // Re-processing (e.g. after a restart) must not leave duplicates behind.
        segmentRepo.deleteByMediaFileId(mediaId);
        chunkRepo.deleteByMediaFileId(mediaId);

        List<TranscriptSegment> segmentRows = new ArrayList<>(segments.size());
        for (int i = 0; i < segments.size(); i++) {
            Chunker.Segment s = segments.get(i).segment();
            segmentRows.add(new TranscriptSegment(mediaId, i, s.startSec(), s.endSec(), s.text(),
                    VectorFormat.toLiteral(segments.get(i).embedding())));
        }
        segmentRepo.saveAll(segmentRows);

        List<TranscriptChunk> chunkRows = chunks.stream()
                .map(c -> new TranscriptChunk(mediaId, c.chunk().startSec(), c.chunk().endSec(),
                        c.chunk().text(), VectorFormat.toLiteral(c.embedding())))
                .toList();
        chunkRepo.saveAll(chunkRows);

        media.setDurationSec(durationSec);
        media.setStatus(MediaStatus.INDEXED);
    }
}
