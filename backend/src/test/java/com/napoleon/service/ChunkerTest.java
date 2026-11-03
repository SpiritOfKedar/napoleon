package com.napoleon.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.napoleon.service.Chunker.Chunk;
import com.napoleon.service.Chunker.Segment;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class ChunkerTest {

    private final Chunker chunker = new Chunker(30, 5);

    /** n consecutive segments of the given length, text "s0", "s1", ... */
    private static List<Segment> uniform(int n, double len) {
        List<Segment> out = new ArrayList<>();
        for (int i = 0; i < n; i++) {
            out.add(new Segment(i * len, (i + 1) * len, "s" + i));
        }
        return out;
    }

    @Test
    void emptyInputGivesNoChunks() {
        assertThat(chunker.chunk(List.of())).isEmpty();
    }

    @Test
    void shortRecordingIsOneChunk() {
        List<Chunk> chunks = chunker.chunk(uniform(5, 4)); // 0..20s
        assertThat(chunks).containsExactly(new Chunk(0, 20, "s0 s1 s2 s3 s4"));
    }

    @Test
    void chunksRespectWindowAndOverlap() {
        List<Chunk> chunks = chunker.chunk(uniform(30, 4)); // 0..120s, 4s segments

        assertThat(chunks).hasSizeGreaterThan(1);
        for (Chunk c : chunks) {
            assertThat(c.endSec() - c.startSec()).isLessThanOrEqualTo(30);
        }
        for (int i = 1; i < chunks.size(); i++) {
            double overlap = chunks.get(i - 1).endSec() - chunks.get(i).startSec();
            assertThat(overlap).as("overlap between chunk %d and %d", i - 1, i).isGreaterThanOrEqualTo(5);
        }
        // Chunks advance and together cover the whole recording.
        assertThat(chunks.getFirst().startSec()).isEqualTo(0);
        assertThat(chunks.getLast().endSec()).isEqualTo(120);
        for (int i = 1; i < chunks.size(); i++) {
            assertThat(chunks.get(i).startSec()).isGreaterThan(chunks.get(i - 1).startSec());
        }
    }

    @Test
    void firstChunkWithFourSecondSegmentsIsExpected() {
        List<Chunk> chunks = chunker.chunk(uniform(30, 4));
        // 7 segments fit in 28s; the 8th would end at 32s.
        assertThat(chunks.get(0)).isEqualTo(new Chunk(0, 28, "s0 s1 s2 s3 s4 s5 s6"));
        // 28 - 5 = 23 falls inside segment s5 (20..24), so the next chunk starts there.
        assertThat(chunks.get(1).startSec()).isEqualTo(20);
    }

    @Test
    void phraseAtBoundaryAppearsWholeInSomeChunk() {
        List<Segment> segs = new ArrayList<>(uniform(7, 4)); // 0..28
        segs.add(new Segment(28, 31, "the Q3 budget"));       // crosses the 30s boundary
        segs.add(new Segment(31, 40, "after"));
        List<Chunk> chunks = chunker.chunk(segs);
        assertThat(chunks).anySatisfy(c -> assertThat(c.text()).contains("the Q3 budget"));
    }

    @Test
    void segmentLongerThanWindowBecomesItsOwnChunk() {
        List<Segment> segs = List.of(
                new Segment(0, 10, "a"),
                new Segment(10, 55, "very long"),
                new Segment(55, 60, "b"));
        List<Chunk> chunks = chunker.chunk(segs);
        // Segments are never split, and a chunk made of one segment has nothing to step back into.
        assertThat(chunks).extracting(Chunk::text).containsExactly("a", "very long", "b");
    }

    @Test
    void blankSegmentsAreIgnoredAndInputIsSorted() {
        List<Segment> segs = List.of(
                new Segment(5, 8, "second"),
                new Segment(2, 3, "   "),
                new Segment(0, 4, "first"));
        assertThat(chunker.chunk(segs)).containsExactly(new Chunk(0, 8, "first second"));
    }

    @Test
    void terminatesWhenSegmentsAreTiny() {
        List<Chunk> chunks = chunker.chunk(uniform(2000, 0.5)); // 1000s of 0.5s segments
        assertThat(chunks).isNotEmpty();
        assertThat(chunks.getLast().endSec()).isEqualTo(1000);
    }

    @Test
    void rejectsInvalidConfig() {
        assertThatThrownBy(() -> new Chunker(0, 0)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Chunker(30, 30)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new Chunker(30, -1)).isInstanceOf(IllegalArgumentException.class);
    }
}
