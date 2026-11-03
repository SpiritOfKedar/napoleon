package com.napoleon.service;

import com.napoleon.client.TranscriptionClient;
import com.napoleon.config.NapoleonProperties;
import com.napoleon.dto.SearchRequest;
import com.napoleon.dto.SearchResultDto;
import com.napoleon.repository.SearchRepository;
import com.napoleon.repository.SearchRepository.Candidate;
import com.napoleon.repository.SearchRepository.Pinpoint;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Service;

/**
 * Search in three stages:
 * <ol>
 *   <li>Retrieve: chunks that are semantically close (embeddings) or that contain the query's
 *       words (full-text, rare words weighted up), fused into one candidate list.</li>
 *   <li>Rerank: a cross-encoder reads query and chunk together and scores how well the chunk
 *       answers the query. This is what makes exact wording count.</li>
 *   <li>Pinpoint: inside each hit, the sentence to start playback at.</li>
 * </ol>
 */
@Service
public class SearchService {

    private final TranscriptionClient client;
    private final SearchRepository repo;
    private final int defaultLimit;
    private final int candidates;
    private final boolean rerank;
    private final double minScore;

    public SearchService(TranscriptionClient client, SearchRepository repo, NapoleonProperties props) {
        this.client = client;
        this.repo = repo;
        this.defaultLimit = props.search().defaultLimit();
        this.candidates = props.search().candidates();
        this.rerank = props.search().rerank();
        this.minScore = props.search().minScore();
    }

    record Scored(Candidate candidate, double score) {}

    public List<SearchResultDto> search(SearchRequest request) {
        int limit = request.limit() != null ? request.limit() : defaultLimit;
        String text = request.q().strip();
        String vector = VectorFormat.toLiteral(client.embedOne(text));

        int pool = Math.max(candidates, limit * 2);
        List<Candidate> found = repo.candidates(vector, text, request.mediaId(), pool, pool);
        List<Scored> ranked = rank(text, found);

        // Overlapping chunks often pinpoint the same sentence; take extra and drop the repeats so
        // the user doesn't see the same moment twice.
        List<Scored> top = ranked.subList(0, Math.min(ranked.size(), limit * 2));
        Map<Long, Pinpoint> points = repo.pinpoint(top.stream().map(s -> s.candidate().chunkId()).toList(), vector, text);

        Set<String> seen = new HashSet<>();
        List<SearchResultDto> results = new ArrayList<>(limit);
        for (Scored s : top) {
            Candidate c = s.candidate();
            Pinpoint p = points.get(c.chunkId());
            double start = p != null ? p.startSec() : c.startSec();
            double end = p != null ? p.endSec() : c.endSec();
            if (seen.add(c.mediaId() + "@" + start)) {
                results.add(new SearchResultDto(c.chunkId(), c.mediaId(), c.mediaFilename(), start, end,
                        c.startSec(), c.endSec(), c.text(), s.score()));
                if (results.size() == limit) {
                    break;
                }
            }
        }
        return results;
    }

    /** Cross-encoder order when available; otherwise the fused order, scored by cosine similarity. */
    private List<Scored> rank(String query, List<Candidate> found) {
        if (found.isEmpty()) {
            return List.of();
        }
        Optional<List<Double>> scores = rerank
                ? client.rerank(query, found.stream().map(Candidate::text).toList())
                : Optional.empty();
        List<Scored> out = new ArrayList<>(found.size());
        for (int i = 0; i < found.size(); i++) {
            Candidate c = found.get(i);
            out.add(new Scored(c, scores.isPresent() ? scores.get().get(i) : c.similarity()));
        }
        if (scores.isPresent()) {
            out.sort(Comparator.comparingDouble(Scored::score).reversed());
            // The cross-encoder separates cleanly: relevant passages score ~0.01-1, unrelated ones
            // ~0.000-0.006. Showing those as "results" is noise, so "no results" is the honest answer.
            out.removeIf(s -> s.score() < minScore);
        }
        return out;
    }
}
