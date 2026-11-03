// Mirrors the backend DTOs in com.napoleon.dto.

export type MediaStatus = 'UPLOADED' | 'TRANSCRIBING' | 'INDEXED' | 'FAILED';

export interface MediaFile {
  id: number;
  filename: string;
  contentType: string | null;
  sizeBytes: number | null;
  durationSec: number | null;
  status: MediaStatus;
  /** 0..100 while TRANSCRIBING; null before transcription starts. */
  progressPct: number | null;
  /** When the current transcription started (ISO); used for the time-remaining estimate. */
  processingStartedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TranscriptSegment {
  startSec: number;
  endSec: number;
  text: string;
}

export interface SearchResult {
  chunkId: number;
  mediaId: number;
  mediaFilename: string;
  /** Start of the best-matching sentence: where playback should begin. */
  startSec: number;
  endSec: number;
  /** The ~30 s window that `text` covers. */
  chunkStartSec: number;
  chunkEndSec: number;
  text: string;
  /** Relevance 0..1 (cross-encoder score; cosine similarity if reranking is off). */
  score: number;
}

export interface ApiError {
  timestamp: string;
  status: number;
  error: string;
  message: string;
  path: string;
  fieldErrors?: Record<string, string>;
}

export function isProcessing(status: MediaStatus): boolean {
  return status === 'UPLOADED' || status === 'TRANSCRIBING';
}
