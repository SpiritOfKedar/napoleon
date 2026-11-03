package com.napoleon.client;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.napoleon.config.NapoleonProperties;
import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.MediaType;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.stereotype.Component;
import org.springframework.util.LinkedMultiValueMap;
import org.springframework.util.MultiValueMap;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;
import org.springframework.web.client.RestClientResponseException;

/** HTTP client for the Python transcription/embedding service. */
@Component
public class TranscriptionClient {

    public record Segment(@JsonProperty("start_sec") double startSec,
                          @JsonProperty("end_sec") double endSec,
                          String text) {}

    public record TranscriptionResult(List<Segment> segments,
                                      @JsonProperty("duration_sec") Double durationSec,
                                      String language) {}

    /** Receives a streamed transcription as it happens. An exception thrown here aborts the stream. */
    public interface StreamListener {
        /** First event: the length of the whole file, or null if ffprobe could not tell. */
        void onMeta(Double durationSec);

        /** Timestamps are relative to the start of the file, also when resuming from an offset. */
        void onSegment(Segment segment);
    }

    record EmbedRequest(List<String> texts) {}

    record EmbedResponse(String model, int dim, List<float[]> vectors) {}

    record StreamRequest(String path, @JsonProperty("start_offset_sec") double startOffsetSec) {}

    @JsonIgnoreProperties(ignoreUnknown = true)
    record StreamLine(String type,
                      @JsonProperty("duration_sec") Double durationSec,
                      @JsonProperty("start_sec") Double startSec,
                      @JsonProperty("end_sec") Double endSec,
                      String text,
                      String language,
                      String detail) {}

    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final RestClient restClient;
    private final RestClient streamClient;
    private final int expectedDim;

    public TranscriptionClient(RestClient.Builder builder, NapoleonProperties props) {
        NapoleonProperties.Transcription cfg = props.transcription();
        this.restClient = builder.clone()
                .baseUrl(cfg.baseUrl())
                .requestFactory(requestFactory(cfg.connectTimeout(), cfg.readTimeout()))
                .build();
        // For the stream the read timeout is the longest allowed gap between two lines.
        this.streamClient = builder.clone()
                .baseUrl(cfg.baseUrl())
                .requestFactory(requestFactory(cfg.connectTimeout(), cfg.streamIdleTimeout()))
                .build();
        this.expectedDim = props.embedding().dim();
    }

    private static SimpleClientHttpRequestFactory requestFactory(Duration connectTimeout, Duration readTimeout) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(connectTimeout);
        factory.setReadTimeout(readTimeout);
        return factory;
    }

    /** Upload-based transcription: sends the whole file and waits for the whole transcript. */
    public TranscriptionResult transcribe(Path file, String originalFilename) {
        MultiValueMap<String, Object> body = new LinkedMultiValueMap<>();
        body.add("file", new FileSystemResource(file) {
            @Override
            public String getFilename() {
                return originalFilename; // the service uses the extension as a hint for ffmpeg
            }
        });
        try {
            TranscriptionResult result = restClient.post()
                    .uri("/transcribe")
                    .contentType(MediaType.MULTIPART_FORM_DATA)
                    .body(body)
                    .retrieve()
                    .body(TranscriptionResult.class);
            if (result == null || result.segments() == null) {
                throw new TranscriptionClientException("Transcription service returned an empty response");
            }
            return result;
        } catch (RestClientResponseException e) {
            throw new TranscriptionClientException("Transcription failed: " + extractDetail(e), e);
        } catch (RestClientException e) {
            throw new TranscriptionClientException("Transcription service unreachable: " + e.getMessage(), e);
        }
    }

    /**
     * Streaming transcription of a file on the shared media volume. Blocks until the service reports
     * done, calling the listener for each event, and returns the detected language.
     *
     * @param relativePath   path relative to the shared media root
     * @param startOffsetSec where to start (for resuming); 0 for the whole file
     */
    public String transcribeStream(String relativePath, double startOffsetSec, StreamListener listener) {
        try {
            return streamClient.post()
                    .uri("/transcribe/stream")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(new StreamRequest(relativePath, startOffsetSec))
                    .exchange((request, response) -> {
                        if (response.getStatusCode().isError()) {
                            String detail = new String(response.getBody().readAllBytes(), StandardCharsets.UTF_8);
                            throw new TranscriptionClientException("Transcription failed: "
                                    + response.getStatusCode().value() + " " + truncate(detail));
                        }
                        return readStream(response.getBody(), listener);
                    });
        } catch (RestClientException e) {
            throw new TranscriptionClientException("Transcription stream broke off: " + e.getMessage(), e);
        }
    }

    /** Parses the NDJSON stream of /transcribe/stream. Package-private for tests. */
    static String readStream(InputStream body, StreamListener listener) throws IOException {
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(body, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) {
                if (line.isBlank()) {
                    continue;
                }
                StreamLine event = MAPPER.readValue(line, StreamLine.class);
                switch (event.type() == null ? "" : event.type()) {
                    case "meta" -> listener.onMeta(event.durationSec());
                    case "segment" -> {
                        if (event.startSec() == null || event.endSec() == null) {
                            throw new TranscriptionClientException(
                                    "Malformed segment in transcription stream: " + truncate(line));
                        }
                        listener.onSegment(new Segment(event.startSec(), event.endSec(), event.text()));
                    }
                    case "done" -> {
                        return event.language();
                    }
                    case "error" -> throw new TranscriptionClientException("Transcription failed: " + event.detail());
                    default -> {
                        // heartbeat, or an event type this version does not know: ignore
                    }
                }
            }
        }
        throw new TranscriptionClientException("Transcription stream ended before it was complete");
    }

    public List<float[]> embed(List<String> texts) {
        try {
            EmbedResponse response = restClient.post()
                    .uri("/embed")
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(new EmbedRequest(texts))
                    .retrieve()
                    .body(EmbedResponse.class);
            if (response == null || response.vectors() == null || response.vectors().size() != texts.size()) {
                throw new TranscriptionClientException("Embedding service returned the wrong number of vectors");
            }
            for (float[] v : response.vectors()) {
                if (v.length != expectedDim) {
                    throw new TranscriptionClientException(
                            "Embedding dimension " + v.length + " does not match EMBEDDING_DIM=" + expectedDim);
                }
            }
            return response.vectors();
        } catch (RestClientResponseException e) {
            throw new TranscriptionClientException("Embedding failed: " + extractDetail(e), e);
        } catch (RestClientException e) {
            throw new TranscriptionClientException("Embedding service unreachable: " + e.getMessage(), e);
        }
    }

    public float[] embedOne(String text) {
        return embed(List.of(text)).getFirst();
    }

    private static String extractDetail(RestClientResponseException e) {
        String body = e.getResponseBodyAsString();
        String detail = body.isBlank() ? e.getStatusText() : body;
        return e.getStatusCode().value() + " " + truncate(detail);
    }

    private static String truncate(String s) {
        return s.length() > 500 ? s.substring(0, 500) : s;
    }
}
