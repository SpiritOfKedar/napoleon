package com.napoleon.service;

import com.napoleon.domain.MediaFile;
import com.napoleon.domain.MediaStatus;
import com.napoleon.repository.MediaFileRepository;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/**
 * The in-memory job queue is lost on restart, so files left UPLOADED or TRANSCRIBING by a previous
 * run are re-queued on startup. With shared storage a TRANSCRIBING file resumes after its last
 * stored segment instead of starting over; otherwise indexing replaces rows, so re-running is safe.
 */
@Component
public class ProcessingRecovery {

    private static final Logger log = LoggerFactory.getLogger(ProcessingRecovery.class);

    private final MediaFileRepository mediaRepo;
    private final MediaProcessingService processing;

    public ProcessingRecovery(MediaFileRepository mediaRepo, MediaProcessingService processing) {
        this.mediaRepo = mediaRepo;
        this.processing = processing;
    }

    @EventListener(ApplicationReadyEvent.class)
    public void requeueUnfinished() {
        List<MediaFile> pending = mediaRepo.findByStatusIn(List.of(MediaStatus.UPLOADED, MediaStatus.TRANSCRIBING));
        for (MediaFile m : pending) {
            log.info("Re-queueing unfinished media {} ({})", m.getId(), m.getFilename());
            processing.processAsync(m.getId());
        }
    }
}
