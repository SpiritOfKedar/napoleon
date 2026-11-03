package com.napoleon.controller;

import com.napoleon.dto.MediaFileDto;
import com.napoleon.dto.TranscriptSegmentDto;
import com.napoleon.service.MediaService;
import java.io.IOException;
import java.net.URI;
import java.util.List;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/media")
public class MediaController {

    private final MediaService mediaService;

    public MediaController(MediaService mediaService) {
        this.mediaService = mediaService;
    }

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<MediaFileDto> upload(@RequestParam("file") MultipartFile file) throws IOException {
        MediaFileDto created = mediaService.upload(file);
        return ResponseEntity.accepted()
                .location(URI.create("/api/media/" + created.id()))
                .body(created);
    }

    @GetMapping
    public List<MediaFileDto> list() {
        return mediaService.list();
    }

    @GetMapping("/{id}")
    public MediaFileDto get(@PathVariable long id) {
        return mediaService.get(id);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable long id) {
        mediaService.delete(id);
        return ResponseEntity.noContent().build();
    }

    @PostMapping("/{id}/reprocess")
    public ResponseEntity<MediaFileDto> reprocess(@PathVariable long id) {
        return ResponseEntity.accepted().body(mediaService.reprocess(id));
    }

    @GetMapping("/{id}/transcript")
    public List<TranscriptSegmentDto> transcript(@PathVariable long id) {
        return mediaService.transcript(id);
    }

    /**
     * Returning a Resource lets Spring MVC handle the Range header itself: it answers
     * "Range: bytes=x-y" with 206 Partial Content, which browsers need for seeking.
     */
    @GetMapping("/{id}/stream")
    public ResponseEntity<Resource> stream(@PathVariable long id) {
        MediaService.StreamableMedia media = mediaService.stream(id);
        return ResponseEntity.ok()
                .contentType(media.mediaType())
                .header(HttpHeaders.ACCEPT_RANGES, "bytes")
                .body(media.resource());
    }
}
