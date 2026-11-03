package com.napoleon.client;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;

class TranscriptionStreamParserTest {

    static final class Recorder implements TranscriptionClient.StreamListener {
        final List<Double> metas = new ArrayList<>();
        final List<TranscriptionClient.Segment> segments = new ArrayList<>();

        @Override
        public void onMeta(Double durationSec) {
            metas.add(durationSec);
        }

        @Override
        public void onSegment(TranscriptionClient.Segment segment) {
            segments.add(segment);
        }
    }

    private static String parse(String ndjson, Recorder r) throws IOException {
        return TranscriptionClient.readStream(new ByteArrayInputStream(ndjson.getBytes(StandardCharsets.UTF_8)), r);
    }

    @Test
    void readsMetaSegmentsAndDoneSkippingHeartbeats() throws IOException {
        Recorder r = new Recorder();
        String language = parse("""
                {"type":"meta","duration_sec":5400.5}
                {"type":"heartbeat"}
                {"type":"segment","start_sec":3600.0,"end_sec":3604.2,"text":"past the first hour"}

                {"type":"segment","start_sec":3604.2,"end_sec":3609.0,"text":"ünïcode ok"}
                {"type":"done","language":"en"}
                """, r);

        assertThat(language).isEqualTo("en");
        assertThat(r.metas).containsExactly(5400.5);
        assertThat(r.segments).containsExactly(
                new TranscriptionClient.Segment(3600.0, 3604.2, "past the first hour"),
                new TranscriptionClient.Segment(3604.2, 3609.0, "ünïcode ok"));
    }

    @Test
    void nullDurationIsPassedThrough() throws IOException {
        Recorder r = new Recorder();
        parse("{\"type\":\"meta\",\"duration_sec\":null}\n{\"type\":\"done\",\"language\":null}\n", r);
        assertThat(r.metas).containsExactly((Double) null);
    }

    @Test
    void errorEventBecomesExceptionWithDetail() {
        Recorder r = new Recorder();
        assertThatThrownBy(() -> parse("""
                {"type":"meta","duration_sec":10}
                {"type":"segment","start_sec":0,"end_sec":2,"text":"hi"}
                {"type":"error","detail":"Could not decode media: moov atom not found"}
                """, r))
                .isInstanceOf(TranscriptionClientException.class)
                .hasMessageContaining("moov atom not found");
        // Segments before the error were delivered (and are kept for resuming).
        assertThat(r.segments).hasSize(1);
    }

    @Test
    void streamCutOffBeforeDoneIsAnError() {
        assertThatThrownBy(() -> parse("{\"type\":\"meta\",\"duration_sec\":10}\n", new Recorder()))
                .isInstanceOf(TranscriptionClientException.class)
                .hasMessageContaining("ended before");
    }

    @Test
    void unknownEventTypesAndFieldsAreIgnored() throws IOException {
        Recorder r = new Recorder();
        parse("{\"type\":\"progress\",\"pct\":12}\n{\"type\":\"segment\",\"start_sec\":1,\"end_sec\":2,\"text\":\"a\",\"words\":[]}\n"
                + "{\"type\":\"done\"}\n", r);
        assertThat(r.segments).hasSize(1);
    }
}
