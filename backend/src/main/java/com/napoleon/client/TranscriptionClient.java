package com.napoleon.client;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.napoleon.config.NapoleonProperties;
import java.nio.file.Path;
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

    record EmbedRequest(List<String> texts) {}

    record EmbedResponse(String model, int dim, List<float[]> vectors) {}

    private final RestClient restClient;
    private final int expectedDim;

    public TranscriptionClient(RestClient.Builder builder, NapoleonProperties props) {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(props.transcription().connectTimeout());
        factory.setReadTimeout(props.transcription().readTimeout());
        this.restClient = builder
                .baseUrl(props.transcription().baseUrl())
                .requestFactory(factory)
                .build();
        this.expectedDim = props.embedding().dim();
    }

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
        return e.getStatusCode().value() + " " + (detail.length() > 500 ? detail.substring(0, 500) : detail);
    }
}
