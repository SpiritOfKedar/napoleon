package com.napoleon.service;

import com.napoleon.domain.MediaFile;
import com.napoleon.domain.MediaStatus;
import com.napoleon.dto.MediaFileDto;
import com.napoleon.dto.TranscriptSegmentDto;
import com.napoleon.repository.MediaFileRepository;
import com.napoleon.repository.TranscriptSegmentRepository;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.MediaType;
import org.springframework.http.MediaTypeFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;
import org.springframework.web.multipart.MultipartFile;

@Service
public class MediaService {

    // Cheap first-line check; ffmpeg in the transcription service is the real judge of whether
    // a file is decodable (a bad file ends up FAILED, not rejected here).
    private static final Set<String> ALLOWED_EXTENSIONS = Set.of(
            ".mp3", ".wav", ".m4a", ".aac", ".ogg", ".oga", ".opus", ".flac", ".webm",
            ".mp4", ".m4v", ".mov", ".mkv", ".avi");

    private final MediaFileRepository mediaRepo;
    private final TranscriptSegmentRepository segmentRepo;
    private final MediaStorage storage;
    private final MediaProcessingService processing;

    public MediaService(MediaFileRepository mediaRepo, TranscriptSegmentRepository segmentRepo,
                        MediaStorage storage, MediaProcessingService processing) {
        this.mediaRepo = mediaRepo;
        this.segmentRepo = segmentRepo;
        this.storage = storage;
        this.processing = processing;
    }

    public MediaFileDto upload(MultipartFile file) throws IOException {
        if (file == null || file.isEmpty()) {
            throw new BadRequestException("File is empty");
        }
        String filename = StringUtils.cleanPath(
                file.getOriginalFilename() == null ? "upload" : Path.of(file.getOriginalFilename()).getFileName().toString());
        String ext = MediaStorage.extensionOf(filename).toLowerCase(Locale.ROOT);
        if (!ALLOWED_EXTENSIONS.contains(ext)) {
            throw new BadRequestException("Unsupported file type '" + ext + "'. Allowed: " + ALLOWED_EXTENSIONS);
        }

        Path stored = storage.store(file, filename);
        String contentType = MediaTypeFactory.getMediaType(filename)
                .map(MediaType::toString)
                .orElse(file.getContentType());

        MediaFile media;
        try {
            media = mediaRepo.save(new MediaFile(filename, stored.toString(), contentType, file.getSize()));
        } catch (RuntimeException e) {
            storage.deleteQuietly(stored.toString());
            throw e;
        }
        // save() has committed by now (no surrounding transaction), so the worker will see the row.
        processing.processAsync(media.getId());
        return MediaFileDto.from(media);
    }

    /**
     * Removes the file, its transcript and its stored media. Refused while the file is still being
     * processed, because the worker would otherwise keep writing to a deleted row.
     */
    public void delete(long id) {
        MediaFile media = find(id);
        if (media.getStatus() == MediaStatus.UPLOADED || media.getStatus() == MediaStatus.TRANSCRIBING) {
            throw new ConflictException("Media " + id + " is still being processed; delete it once it has finished");
        }
        // Segments and chunks go with the row (ON DELETE CASCADE). The file goes after the row, so a
        // failed database delete never leaves a row pointing at a missing file.
        mediaRepo.deleteById(id);
        storage.deleteQuietly(media.getStoragePath());
    }

    public List<MediaFileDto> list() {
        return mediaRepo.findAllByOrderByCreatedAtDesc().stream().map(MediaFileDto::from).toList();
    }

    public MediaFileDto get(long id) {
        return MediaFileDto.from(find(id));
    }

    public List<TranscriptSegmentDto> transcript(long id) {
        find(id);
        return segmentRepo.findByMediaFileIdOrderBySeq(id).stream().map(TranscriptSegmentDto::from).toList();
    }

    public record StreamableMedia(Resource resource, MediaType mediaType) {}

    public StreamableMedia stream(long id) {
        MediaFile media = find(id);
        Path path = storage.resolve(media.getStoragePath());
        if (!Files.isReadable(path)) {
            throw new NotFoundException("Media file for " + id + " is missing on disk");
        }
        MediaType type = media.getContentType() != null
                ? MediaType.parseMediaType(media.getContentType())
                : MediaType.APPLICATION_OCTET_STREAM;
        return new StreamableMedia(new FileSystemResource(path), type);
    }

    private MediaFile find(long id) {
        return mediaRepo.findById(id).orElseThrow(() -> new NotFoundException("Media " + id + " not found"));
    }
}
