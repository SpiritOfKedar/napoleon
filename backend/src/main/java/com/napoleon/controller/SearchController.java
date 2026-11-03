package com.napoleon.controller;

import com.napoleon.dto.SearchRequest;
import com.napoleon.dto.SearchResultDto;
import com.napoleon.service.SearchService;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.ModelAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/search")
public class SearchController {

    private final SearchService searchService;

    public SearchController(SearchService searchService) {
        this.searchService = searchService;
    }

    @GetMapping
    public List<SearchResultDto> search(@Valid @ModelAttribute SearchRequest request) {
        return searchService.search(request);
    }
}
