package com.napoleon.service;

import com.napoleon.config.NapoleonProperties;
import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.web.multipart.MultipartFile;

/** Stores uploaded files on local disk under a random name so user filenames never touch the path. */
@Component
public class MediaStorage {

    /**
     * Sub-directory for in-flight multipart uploads. Pointing spring.servlet.multipart.location here
     * keeps the temp file on the same filesystem, so storing a multi-GB upload is a rename, not a copy.
     */
    public static final String INCOMING_DIR = ".incoming";

    private final Path root;

    public MediaStorage(NapoleonProperties props) {
        this.root = Path.of(props.storageDir()).toAbsolutePath().normalize();
        try {
            Files.createDirectories(root.resolve(INCOMING_DIR));
        } catch (IOException e) {
            throw new UncheckedIOException("Cannot create media storage dir " + root, e);
        }
    }

    public Path store(InputStream in, String originalFilename) throws IOException {
        Path target = newTarget(originalFilename);
        Files.copy(in, target, StandardCopyOption.REPLACE_EXISTING);
        return target;
    }

    /** Moves the upload into place; Tomcat renames its temp file when it can instead of copying. */
    public Path store(MultipartFile file, String originalFilename) throws IOException {
        Path target = newTarget(originalFilename);
        file.transferTo(target);
        return target;
    }

    private Path newTarget(String originalFilename) {
        return root.resolve(UUID.randomUUID() + extensionOf(originalFilename));
    }

    public Path resolve(String storagePath) {
        Path p = Path.of(storagePath).toAbsolutePath().normalize();
        if (!p.startsWith(root)) {
            throw new IllegalStateException("Stored path escapes the media directory: " + storagePath);
        }
        return p;
    }

    /** Path relative to the storage root, with forward slashes: how the transcription service sees it. */
    public String relativePath(String storagePath) {
        return root.relativize(resolve(storagePath)).toString().replace('\\', '/');
    }

    public void deleteQuietly(String storagePath) {
        try {
            Files.deleteIfExists(resolve(storagePath));
        } catch (IOException | RuntimeException ignored) {
            // best effort
        }
    }

    static String extensionOf(String filename) {
        if (filename == null) {
            return "";
        }
        int dot = filename.lastIndexOf('.');
        if (dot < 0 || dot == filename.length() - 1) {
            return "";
        }
        String ext = filename.substring(dot).toLowerCase();
        return ext.matches("\\.[a-z0-9]{1,8}") ? ext : "";
    }
}
