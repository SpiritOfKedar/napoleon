package com.napoleon.controller;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.napoleon.client.TranscriptionClientException;
import com.napoleon.dto.SearchResultDto;
import com.napoleon.service.SearchService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;

@WebMvcTest(SearchController.class)
class SearchControllerTest {

    @Autowired
    MockMvc mvc;

    @MockitoBean
    SearchService searchService;

    @Test
    void returnsResults() throws Exception {
        when(searchService.search(any())).thenReturn(List.of(
                new SearchResultDto(7L, 1L, "meeting.mp4", 872.0, 878.0, 860.0, 890.0, "the Q3 budget", 0.83)));
        mvc.perform(get("/api/search").param("q", "budget").param("limit", "5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].mediaFilename").value("meeting.mp4"))
                .andExpect(jsonPath("$[0].startSec").value(872.0))
                .andExpect(jsonPath("$[0].score").value(0.83));
    }

    @Test
    void blankQueryIsRejected() throws Exception {
        mvc.perform(get("/api/search").param("q", "  "))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.message").value("Validation failed"))
                .andExpect(jsonPath("$.fieldErrors.q").exists());
    }

    @Test
    void limitOutOfRangeIsRejected() throws Exception {
        mvc.perform(get("/api/search").param("q", "budget").param("limit", "0"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.limit").exists());
    }

    @Test
    void nonNumericMediaIdIsRejected() throws Exception {
        mvc.perform(get("/api/search").param("q", "budget").param("mediaId", "abc"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors.mediaId").value("invalid value"));
    }

    @Test
    void embeddingServiceDownIsBadGateway() throws Exception {
        when(searchService.search(any())).thenThrow(new TranscriptionClientException("Embedding service unreachable"));
        mvc.perform(get("/api/search").param("q", "budget"))
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.status").value(502));
    }
}
