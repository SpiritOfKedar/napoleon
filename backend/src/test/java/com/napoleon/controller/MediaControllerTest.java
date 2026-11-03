package com.napoleon.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.napoleon.service.BadRequestException;
import com.napoleon.service.MediaService;
import com.napoleon.service.NotFoundException;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(MediaController.class)
class MediaControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    MediaService mediaService;

    private void givenStream(String body) {
        when(mediaService.stream(1L)).thenReturn(new MediaService.StreamableMedia(
                new ByteArrayResource(body.getBytes(StandardCharsets.US_ASCII)) {
                    @Override
                    public String getFilename() {
                        return "a.mp3";
                    }
                },
                MediaType.parseMediaType("audio/mpeg")));
    }

    @Test
    void deleteReturnsNoContent() throws Exception {
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/media/1"))
                .andExpect(status().isNoContent());
        org.mockito.Mockito.verify(mediaService).delete(1L);
    }

    @Test
    void deleteWhileProcessingIsConflict() throws Exception {
        org.mockito.Mockito.doThrow(new com.napoleon.service.ConflictException("still being processed"))
                .when(mediaService).delete(1L);
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/media/1"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value("still being processed"));
    }

    @Test
    void deleteUnknownIdIsNotFound() throws Exception {
        org.mockito.Mockito.doThrow(new NotFoundException("Media 9 not found")).when(mediaService).delete(9L);
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete("/api/media/9"))
                .andExpect(status().isNotFound());
    }

    @Test
    void streamWithoutRangeReturnsWholeFile() throws Exception {
        givenStream("0123456789");
        mvc.perform(get("/api/media/1/stream"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCEPT_RANGES, "bytes"))
                .andExpect(content().string("0123456789"));
    }

    @Test
    void streamHonoursRangeHeader() throws Exception {
        givenStream("0123456789");
        mvc.perform(get("/api/media/1/stream").header(HttpHeaders.RANGE, "bytes=2-5"))
                .andExpect(status().isPartialContent())
                .andExpect(header().string(HttpHeaders.CONTENT_RANGE, "bytes 2-5/10"))
                .andExpect(content().string("2345"));
    }

    @Test
    void streamHonoursOpenEndedRange() throws Exception {
        givenStream("0123456789");
        mvc.perform(get("/api/media/1/stream").header(HttpHeaders.RANGE, "bytes=7-"))
                .andExpect(status().isPartialContent())
                .andExpect(content().string("789"));
    }

    @Test
    void unknownMediaGivesErrorJson() throws Exception {
        when(mediaService.get(42L)).thenThrow(new NotFoundException("Media 42 not found"));
        mvc.perform(get("/api/media/42"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.status").value(404))
                .andExpect(jsonPath("$.message").value("Media 42 not found"))
                .andExpect(jsonPath("$.path").value("/api/media/42"));
    }

    @Test
    void uploadWithoutFilePartIsBadRequest() throws Exception {
        mvc.perform(multipart("/api/media"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value(400));
    }

    @Test
    void unsupportedFileTypeIsBadRequest() throws Exception {
        when(mediaService.upload(any())).thenThrow(new BadRequestException("Unsupported file type '.txt'"));
        mvc.perform(multipart("/api/media").file(new MockMultipartFile("file", "a.txt", "text/plain", "x".getBytes())))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Unsupported file type '.txt'"));
    }
}
