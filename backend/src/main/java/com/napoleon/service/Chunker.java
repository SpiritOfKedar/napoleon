package com.napoleon.service;

import java.util.ArrayList;
import java.util.List;

/**
 * Groups Whisper segments into overlapping time windows.
 *
 * <p>Each chunk starts at a segment boundary and takes whole segments until adding the next one
 * would push it past {@code windowSec}. The next chunk starts at the segment covering
 * {@code previousChunkEnd - overlapSec}, so at least the last {@code overlapSec} seconds of every
 * chunk are repeated at the start of the next one. A phrase that straddles a boundary therefore
 * appears whole in at least one chunk.
 *
 * <p>Segments are never split, so a single segment longer than the window becomes its own chunk.
 */
public final class Chunker {

    public record Segment(double startSec, double endSec, String text) {}

    public record Chunk(double startSec, double endSec, String text) {}

    private final double windowSec;
    private final double overlapSec;

    public Chunker(double windowSec, double overlapSec) {
        if (windowSec <= 0) {
            throw new IllegalArgumentException("windowSec must be > 0");
        }
        if (overlapSec < 0 || overlapSec >= windowSec) {
            throw new IllegalArgumentException("overlapSec must be >= 0 and < windowSec");
        }
        this.windowSec = windowSec;
        this.overlapSec = overlapSec;
    }

    public List<Chunk> chunk(List<Segment> input) {
        List<Segment> segments = input.stream()
                .filter(s -> s.text() != null && !s.text().isBlank())
                .sorted((a, b) -> Double.compare(a.startSec(), b.startSec()))
                .toList();
        List<Chunk> chunks = new ArrayList<>();
        int n = segments.size();
        int first = 0;
        while (first < n) {
            double windowStart = segments.get(first).startSec();
            int last = first;
            while (last + 1 < n && segments.get(last + 1).endSec() - windowStart <= windowSec) {
                last++;
            }
            chunks.add(toChunk(segments.subList(first, last + 1)));
            if (last == n - 1) {
                break;
            }
            // Start the next chunk at the segment that contains (chunkEnd - overlap), so the next
            // chunk repeats at least overlapSec of this one. It must still start after `first`,
            // otherwise the loop would never advance.
            double overlapFrom = segments.get(last).endSec() - overlapSec;
            int next = first < last ? first + 1 : last + 1;
            for (int k = last; k > first; k--) {
                if (segments.get(k).startSec() <= overlapFrom) {
                    next = k;
                    break;
                }
            }
            first = next;
        }
        return chunks;
    }

    private static Chunk toChunk(List<Segment> window) {
        StringBuilder text = new StringBuilder();
        for (Segment s : window) {
            if (!text.isEmpty()) {
                text.append(' ');
            }
            text.append(s.text().strip());
        }
        return new Chunk(window.getFirst().startSec(), window.getLast().endSec(), text.toString());
    }
}
