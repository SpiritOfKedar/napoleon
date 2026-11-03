package com.napoleon.service;

import com.napoleon.client.TranscriptionClient;
import com.napoleon.config.NapoleonProperties;
import com.napoleon.dto.SearchRequest;
import com.napoleon.dto.SearchResultDto;
import com.napoleon.repository.SearchHitView;
import com.napoleon.repository.TranscriptChunkRepository;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import org.springframework.stereotype.Service;

@Service
public class SearchService {

    private final TranscriptionClient client;
    private final TranscriptChunkRepository chunkRepo;
    private final int defaultLimit;

    public SearchService(TranscriptionClient client, TranscriptChunkRepository chunkRepo, NapoleonProperties props) {
        this.client = client;
        this.chunkRepo = chunkRepo;
        this.defaultLimit = props.search().defaultLimit();
    }

    public List<SearchResultDto> search(SearchRequest request) {
        int limit = request.limit() != null ? request.limit() : defaultLimit;
        String query = VectorFormat.toLiteral(client.embedOne(request.q().strip()));

        // Overlapping chunks often pinpoint the same sentence; fetch extra and drop the repeats
        // so the user doesn't see the same moment twice.
        int fetch = limit * 2;
        List<SearchHitView> hits = request.mediaId() != null
                ? chunkRepo.searchInMedia(query, request.mediaId(), fetch)
                : chunkRepo.searchAll(query, fetch);

        Set<String> seen = new HashSet<>();
        List<SearchResultDto> results = new ArrayList<>(limit);
        for (SearchHitView h : hits) {
            if (seen.add(h.getMediaId() + "@" + h.getStartSec())) {
                results.add(SearchResultDto.from(h));
                if (results.size() == limit) {
                    break;
                }
            }
        }
        return results;
    }
}
