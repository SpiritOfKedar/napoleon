package com.napoleon.client;

public class TranscriptionClientException extends RuntimeException {
    public TranscriptionClientException(String message) {
        super(message);
    }

    public TranscriptionClientException(String message, Throwable cause) {
        super(message, cause);
    }
}
