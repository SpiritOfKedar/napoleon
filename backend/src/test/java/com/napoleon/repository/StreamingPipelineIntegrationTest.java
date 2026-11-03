package com.napoleon.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;

import com.napoleon.client.TranscriptionClient;
import com.napoleon.client.TranscriptionClientException;
import com.napoleon.domain.MediaFile;
import com.napoleon.domain.MediaStatus;
import com.napoleon.domain.TranscriptSegment;
import com.napoleon.service.Chunker;
import com.napoleon.service.MediaProcessingService;
import com.napoleon.service.TranscriptIndexer;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.utility.DockerImageName;

/** The shared-storage pipeline: incremental indexing, progress, and resuming after a restart. */
@SpringBootTest(properties = "napoleon.transcription.shared-storage=true")
@Testcontainers(disabledWithoutDocker = true)
class StreamingPipelineIntegrationTest {

    static final int DIM = 384;
    static final double SEG = 4.0;

    @Container
    @ServiceConnection
    static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>(
            DockerImageName.parse("pgvector/pgvector:pg17").asCompatibleSubstituteFor("postgres"));

    @TempDir
    static Path mediaDir;

    @DynamicPropertySource
    static void props(DynamicPropertyRegistry registry) {
        registry.add("napoleon.storage-dir", () -> mediaDir.toString());
        registry.add("napoleon.embedding.dim", () -> DIM);
    }

    @MockitoBean
    TranscriptionClient client;

    @Autowired
    MediaProcessingService processingService;
    @Autowired
    TranscriptIndexer indexer;
    @Autowired
    MediaFileRepository mediaRepo;
    @Autowired
    TranscriptChunkRepository chunkRepo;
    @Autowired
    TranscriptSegmentRepository segmentRepo;

    static float[] unit(int axis) {
        float[] v = new float[DIM];
        v[axis % DIM] = 1f;
        return v;
    }

    @BeforeEach
    void setUp() {
        chunkRepo.deleteAll();
        segmentRepo.deleteAll();
        mediaRepo.deleteAll();
        when(client.embed(anyList())).thenAnswer(inv -> {
            List<String> texts = inv.getArgument(0);
            return texts.stream().map(t -> unit(Math.abs(t.hashCode()))).toList();
        });
    }

    private MediaFile media(String name, MediaStatus status) throws Exception {
        Path file = Files.writeString(mediaDir.resolve(name), "fake video");
        MediaFile m = new MediaFile(name, file.toString(), "video/mp4", 10L);
        m.setStatus(status);
        return mediaRepo.save(m);
    }

    /** Streams segments [fromIndex, toIndex) of a recording made of SEG-second sentences. */
    private void stream(String path, double expectedOffset, double duration, int fromIndex, int toIndex,
                        RuntimeException failAtEnd) {
        doAnswer(inv -> {
            TranscriptionClient.StreamListener l = inv.getArgument(2);
            l.onMeta(duration);
            for (int i = fromIndex; i < toIndex; i++) {
                l.onSegment(new TranscriptionClient.Segment(i * SEG, i * SEG + SEG, "sentence " + i));
            }
            if (failAtEnd != null) {
                throw failAtEnd;
            }
            return "en";
        }).when(client).transcribeStream(eq(path), eq(expectedOffset), any());
    }

    private List<TranscriptSegment> segments(MediaFile m) {
        return segmentRepo.findByMediaFileIdOrderBySeq(m.getId());
    }

    @Test
    void streamsLongRecordingIntoIndex() throws Exception {
        MediaFile m = media("long.mp4", MediaStatus.UPLOADED);
        stream("long.mp4", 0.0, 400 * SEG, 0, 400, null);

        processingService.process(m.getId());

        MediaFile after = mediaRepo.findById(m.getId()).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(MediaStatus.INDEXED);
        assertThat(after.getProgressPct()).isEqualTo(100.0);
        assertThat(after.getDurationSec()).isEqualTo(1600.0);
        List<TranscriptSegment> segs = segments(m);
        assertThat(segs).hasSize(400);
        assertThat(segs).extracting(TranscriptSegment::getSeq).containsExactlyElementsOf(range(0, 400));
        assertThat(chunkRepo.countByMediaFileId(m.getId())).isGreaterThan(40);
    }

    @Test
    void interruptedFileResumesAfterLastStoredSegment() throws Exception {
        // A previous run stored the first 64 sentences, then the backend died.
        MediaFile m = media("resume.mp4", MediaStatus.TRANSCRIBING);
        List<TranscriptIndexer.EmbeddedSegment> stored = new ArrayList<>();
        for (int i = 0; i < 64; i++) {
            stored.add(new TranscriptIndexer.EmbeddedSegment(new Chunker.Segment(i * SEG, i * SEG + SEG, "sentence " + i), unit(i)));
        }
        indexer.appendSegments(m.getId(), 0, stored, 40.0);

        stream("resume.mp4", 64 * SEG, 160 * SEG, 64, 160, null);

        processingService.process(m.getId());

        MediaFile after = mediaRepo.findById(m.getId()).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(MediaStatus.INDEXED);
        List<TranscriptSegment> segs = segments(m);
        assertThat(segs).hasSize(160);
        assertThat(segs).extracting(TranscriptSegment::getSeq).containsExactlyElementsOf(range(0, 160));
        assertThat(segs.get(64).getStartSec()).isEqualTo(64 * SEG);
    }

    @Test
    void brokenStreamKeepsCommittedBatchesAndFails() throws Exception {
        MediaFile m = media("cut.mp4", MediaStatus.UPLOADED);
        stream("cut.mp4", 0.0, 1000 * SEG, 0, 70, new TranscriptionClientException("Transcription stream broke off"));

        processingService.process(m.getId());

        MediaFile after = mediaRepo.findById(m.getId()).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(MediaStatus.FAILED);
        assertThat(after.getErrorMessage()).contains("broke off");
        // Two full batches of 32 were committed before the break; the partial third was not.
        assertThat(segments(m)).hasSize(64);
        assertThat(after.getProgressPct()).isEqualTo(6.4);
        assertThat(chunkRepo.countByMediaFileId(m.getId())).isZero();
    }

    @Test
    void freshUploadDiscardsLeftovers() throws Exception {
        MediaFile m = media("again.mp4", MediaStatus.UPLOADED);
        indexer.appendSegments(m.getId(), 0,
                List.of(new TranscriptIndexer.EmbeddedSegment(new Chunker.Segment(900, 904, "stale"), unit(1))), null);
        stream("again.mp4", 0.0, 10 * SEG, 0, 10, null);

        processingService.process(m.getId());

        assertThat(segments(m)).extracting(TranscriptSegment::getText).doesNotContain("stale").hasSize(10);
    }

    private static List<Integer> range(int from, int to) {
        List<Integer> out = new ArrayList<>();
        for (int i = from; i < to; i++) {
            out.add(i);
        }
        return out;
    }
}
