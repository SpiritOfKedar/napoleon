package com.napoleon.repository;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.napoleon.client.TranscriptionClient;
import com.napoleon.client.TranscriptionClientException;
import com.napoleon.domain.MediaFile;
import com.napoleon.domain.MediaStatus;
import com.napoleon.domain.TranscriptChunk;
import com.napoleon.domain.TranscriptSegment;
import com.napoleon.dto.SearchRequest;
import com.napoleon.dto.SearchResultDto;
import com.napoleon.service.MediaProcessingService;
import com.napoleon.service.SearchService;
import com.napoleon.service.VectorFormat;
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

/**
 * Runs the real Flyway schema (pgvector + HNSW index) in a pgvector container.
 * The transcription service is mocked so embeddings are deterministic.
 * Skipped automatically when Docker isn't available.
 */
@SpringBootTest
@Testcontainers(disabledWithoutDocker = true)
class SearchIntegrationTest {

    static final int DIM = 384;

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
    SearchService searchService;
    @Autowired
    MediaProcessingService processingService;
    @Autowired
    MediaFileRepository mediaRepo;
    @Autowired
    TranscriptChunkRepository chunkRepo;
    @Autowired
    TranscriptSegmentRepository segmentRepo;

    /** Unit vector pointing mostly along axis {@code main}, slightly along {@code side}. */
    static float[] vec(int main, int side, float sideWeight) {
        float[] v = new float[DIM];
        v[main] = 1f;
        v[side] += sideWeight;
        float norm = (float) Math.sqrt(1 + sideWeight * sideWeight);
        for (int i = 0; i < DIM; i++) {
            v[i] /= norm;
        }
        return v;
    }

    @BeforeEach
    void clean() {
        chunkRepo.deleteAll();
        segmentRepo.deleteAll();
        mediaRepo.deleteAll();
    }

    private MediaFile media(String name) {
        MediaFile m = new MediaFile(name, mediaDir.resolve(name).toString(), "audio/mpeg", 1L);
        m.setStatus(MediaStatus.INDEXED);
        return mediaRepo.save(m);
    }

    private void chunk(MediaFile m, double start, String text, float[] v) {
        chunkRepo.save(new TranscriptChunk(m.getId(), start, start + 30, text, VectorFormat.toLiteral(v)));
    }

    @Test
    void resultsAreOrderedByCosineSimilarity() {
        MediaFile meeting = media("meeting.mp4");
        MediaFile podcast = media("podcast.mp3");
        chunk(meeting, 0, "weather chat", vec(5, 6, 0f));
        chunk(meeting, 860, "the Q3 budget", vec(1, 2, 0.1f));    // closest to the query
        chunk(podcast, 100, "budget-ish", vec(1, 2, 1.0f));       // 45 degrees off
        chunk(podcast, 200, "hiring plans", vec(2, 3, 0f));       // orthogonal

        when(client.embedOne(anyString())).thenReturn(vec(1, 2, 0f));

        List<SearchResultDto> results = searchService.search(new SearchRequest("Q3 budget", 3, null));

        assertThat(results).extracting(SearchResultDto::text)
                .containsExactly("the Q3 budget", "budget-ish", "hiring plans");
        assertThat(results.get(0).mediaFilename()).isEqualTo("meeting.mp4");
        // No segments were stored for these chunks, so startSec falls back to the chunk start.
        assertThat(results.get(0).startSec()).isEqualTo(860.0);
        assertThat(results.get(0).score()).isCloseTo(0.995, org.assertj.core.data.Offset.offset(0.01));
        assertThat(results).isSortedAccordingTo((a, b) -> Double.compare(b.score(), a.score()));
    }

    @Test
    void resultPointsAtBestMatchingSegmentInsideChunk() {
        MediaFile meeting = media("meeting.mp4");
        // One 30 s chunk at 20..50 s made of three segments; the budget sentence is the middle one.
        segmentRepo.save(new TranscriptSegment(meeting.getId(), 0, 20, 31, "hiring update", VectorFormat.toLiteral(vec(4, 5, 0f))));
        segmentRepo.save(new TranscriptSegment(meeting.getId(), 1, 31.6, 40, "the Q3 budget", VectorFormat.toLiteral(vec(1, 2, 0f))));
        segmentRepo.save(new TranscriptSegment(meeting.getId(), 2, 40, 50, "infrastructure", VectorFormat.toLiteral(vec(6, 7, 0f))));
        chunkRepo.save(new TranscriptChunk(meeting.getId(), 20, 50, "hiring update the Q3 budget infrastructure",
                VectorFormat.toLiteral(vec(1, 4, 0.8f))));
        when(client.embedOne(anyString())).thenReturn(vec(1, 2, 0f));

        SearchResultDto top = searchService.search(new SearchRequest("Q3 budget", 5, null)).getFirst();

        assertThat(top.chunkStartSec()).isEqualTo(20.0);
        assertThat(top.startSec()).isEqualTo(31.6);
        assertThat(top.endSec()).isEqualTo(40.0);
    }

    @Test
    void overlappingChunksPointingAtSameSentenceAreDeduplicated() {
        MediaFile meeting = media("meeting.mp4");
        segmentRepo.save(new TranscriptSegment(meeting.getId(), 0, 25, 30, "the Q3 budget", VectorFormat.toLiteral(vec(1, 2, 0f))));
        chunkRepo.save(new TranscriptChunk(meeting.getId(), 0, 30, "a the Q3 budget", VectorFormat.toLiteral(vec(1, 2, 0.2f))));
        chunkRepo.save(new TranscriptChunk(meeting.getId(), 25, 55, "the Q3 budget b", VectorFormat.toLiteral(vec(1, 2, 0.3f))));
        when(client.embedOne(anyString())).thenReturn(vec(1, 2, 0f));

        List<SearchResultDto> results = searchService.search(new SearchRequest("Q3 budget", 5, null));

        assertThat(results).hasSize(1);
        assertThat(results.getFirst().startSec()).isEqualTo(25.0);
    }

    @Test
    void mediaIdRestrictsResults() {
        MediaFile meeting = media("meeting.mp4");
        MediaFile podcast = media("podcast.mp3");
        chunk(meeting, 0, "meeting budget", vec(1, 2, 0.5f));
        chunk(podcast, 0, "podcast budget", vec(1, 2, 0f));
        when(client.embedOne(anyString())).thenReturn(vec(1, 2, 0f));

        List<SearchResultDto> results = searchService.search(new SearchRequest("budget", 10, meeting.getId()));

        assertThat(results).extracting(SearchResultDto::mediaFilename).containsExactly("meeting.mp4");
    }

    @Test
    void pipelineIndexesTranscriptIntoChunks() throws Exception {
        Path file = Files.writeString(mediaDir.resolve("talk.mp3"), "fake audio");
        MediaFile m = mediaRepo.save(new MediaFile("talk.mp3", file.toString(), "audio/mpeg", 10L));

        List<TranscriptionClient.Segment> segments = new ArrayList<>();
        for (int i = 0; i < 20; i++) {
            segments.add(new TranscriptionClient.Segment(i * 4, i * 4 + 4, "sentence " + i));
        }
        when(client.transcribe(any(), eq("talk.mp3")))
                .thenReturn(new TranscriptionClient.TranscriptionResult(segments, 80.0, "en"));
        when(client.embed(anyList())).thenAnswer(inv -> {
            List<String> texts = inv.getArgument(0);
            return texts.stream().map(t -> vec(Math.abs(t.hashCode()) % DIM, 0, 0f)).toList();
        });

        processingService.process(m.getId());

        MediaFile after = mediaRepo.findById(m.getId()).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(MediaStatus.INDEXED);
        assertThat(after.getDurationSec()).isEqualTo(80.0);
        assertThat(segmentRepo.findByMediaFileIdOrderBySeq(m.getId())).hasSize(20);
        assertThat(chunkRepo.countByMediaFileId(m.getId())).isGreaterThan(2);

        // Re-processing replaces rather than duplicates.
        long chunkCount = chunkRepo.countByMediaFileId(m.getId());
        processingService.process(m.getId());
        assertThat(chunkRepo.countByMediaFileId(m.getId())).isEqualTo(chunkCount);
    }

    @Test
    void badFileMarksMediaFailedWithMessage() {
        MediaFile m = mediaRepo.save(new MediaFile("broken.mp3", mediaDir.resolve("broken.mp3").toString(), "audio/mpeg", 1L));
        when(client.transcribe(any(), anyString()))
                .thenThrow(new TranscriptionClientException("Transcription failed: 422 Could not decode media"));

        processingService.process(m.getId());

        MediaFile after = mediaRepo.findById(m.getId()).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(MediaStatus.FAILED);
        assertThat(after.getErrorMessage()).contains("Could not decode media");
    }

    @org.springframework.beans.factory.annotation.Autowired
    com.napoleon.service.MediaService mediaService;

    @Test
    void deleteRemovesTranscriptAndStoredFile() throws Exception {
        Path file = Files.writeString(mediaDir.resolve("gone.mp4"), "x");
        MediaFile m = mediaRepo.save(new MediaFile("gone.mp4", file.toString(), "video/mp4", 1L));
        m.setStatus(MediaStatus.INDEXED);
        mediaRepo.save(m);
        chunk(m, 0, "soon deleted", vec(1, 2, 0f));
        segmentRepo.save(new TranscriptSegment(m.getId(), 0, 0, 4, "soon deleted", VectorFormat.toLiteral(vec(1, 2, 0f))));

        mediaService.delete(m.getId());

        assertThat(mediaRepo.findById(m.getId())).isEmpty();
        assertThat(chunkRepo.countByMediaFileId(m.getId())).isZero();
        assertThat(segmentRepo.findByMediaFileIdOrderBySeq(m.getId())).isEmpty();
        assertThat(Files.exists(file)).isFalse();
    }

    @Test
    void deleteWhileTranscribingIsRefused() {
        MediaFile m = mediaRepo.save(new MediaFile("busy.mp4", mediaDir.resolve("busy.mp4").toString(), "video/mp4", 1L));
        m.setStatus(MediaStatus.TRANSCRIBING);
        mediaRepo.save(m);

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> mediaService.delete(m.getId()))
                .isInstanceOf(com.napoleon.service.ConflictException.class);
        assertThat(mediaRepo.findById(m.getId())).isPresent();
    }

    @Autowired
    com.napoleon.service.EmbeddingRefresher refresher;

    @Autowired
    org.springframework.jdbc.core.JdbcTemplate jdbc;

    @Test
    void keywordMatchLiftsRareNameIntoResults() {
        MediaFile m = media("interview.mp4");
        // Four chunks are semantically close to the query and all say "think"; the one that
        // actually mentions Elon is semantically far, so vectors alone would rank it last.
        for (int i = 0; i < 4; i++) {
            chunk(m, i * 30, "I think we think about many things " + i, vec(1, 10 + i, 0.2f * (i + 1)));
        }
        chunk(m, 200, "then I wrote to Elon about starting it", vec(9, 8, 0f));
        when(client.embedOne(anyString())).thenReturn(vec(1, 2, 0f));

        List<SearchResultDto> results = searchService.search(new SearchRequest("what does he think about Elon", 3, null));

        assertThat(results).extracting(SearchResultDto::text).anyMatch(t -> t.contains("Elon"));
    }

    @Test
    void crossEncoderScoresDecideFinalOrder() {
        MediaFile m = media("talk.mp4");
        chunk(m, 0, "alpha chunk", vec(1, 2, 0f));
        chunk(m, 30, "beta chunk", vec(1, 2, 0.5f));
        chunk(m, 60, "gamma chunk", vec(1, 2, 1.0f));
        when(client.embedOne(anyString())).thenReturn(vec(1, 2, 0f));
        when(client.rerank(anyString(), anyList())).thenAnswer(inv -> {
            List<String> texts = inv.getArgument(1);
            return java.util.Optional.of(texts.stream().map(t -> t.startsWith("gamma") ? 0.9 : t.startsWith("beta") ? 0.5 : 0.1).toList());
        });

        List<SearchResultDto> results = searchService.search(new SearchRequest("anything", 3, null));

        assertThat(results).extracting(SearchResultDto::text).containsExactly("gamma chunk", "beta chunk", "alpha chunk");
        assertThat(results.getFirst().score()).isEqualTo(0.9);
    }

    @Test
    void pinpointPrefersSentenceContainingQueryWords() {
        MediaFile m = media("meeting.mp4");
        // Both sentences have the same vector; only the second one says "Lisbon".
        segmentRepo.save(new TranscriptSegment(m.getId(), 0, 0, 10, "we will meet somewhere nice", VectorFormat.toLiteral(vec(1, 2, 0f))));
        segmentRepo.save(new TranscriptSegment(m.getId(), 1, 10, 20, "the offsite is in Lisbon", VectorFormat.toLiteral(vec(1, 2, 0f))));
        chunkRepo.save(new TranscriptChunk(m.getId(), 0, 20, "we will meet somewhere nice the offsite is in Lisbon", VectorFormat.toLiteral(vec(1, 2, 0f))));
        when(client.embedOne(anyString())).thenReturn(vec(1, 2, 0f));

        SearchResultDto top = searchService.search(new SearchRequest("Lisbon offsite", 1, null)).getFirst();

        assertThat(top.startSec()).isEqualTo(10.0);
    }

    @Test
    void refresherReembedsFilesFromAnOlderModel() {
        MediaFile m = media("old.mp4");
        segmentRepo.save(new TranscriptSegment(m.getId(), 0, 0, 4, "hello", VectorFormat.toLiteral(vec(3, 4, 0f))));
        chunk(m, 0, "hello", vec(3, 4, 0f));
        when(client.embed(anyList())).thenAnswer(inv -> ((List<?>) inv.getArgument(0)).stream().map(t -> vec(7, 8, 0f)).toList());

        assertThat(refresher.refresh(m.getId())).isEqualTo(2);

        assertThat(jdbc.queryForObject("SELECT embedding_model FROM media_file WHERE id = ?", String.class, m.getId()))
                .isEqualTo("intfloat/multilingual-e5-small");
        Double sim = jdbc.queryForObject("SELECT 1 - (embedding <=> CAST(? AS vector)) FROM transcript_chunk WHERE media_file_id = ?",
                Double.class, VectorFormat.toLiteral(vec(7, 8, 0f)), m.getId());
        assertThat(sim).isCloseTo(1.0, org.assertj.core.data.Offset.offset(1e-4));
    }
}
