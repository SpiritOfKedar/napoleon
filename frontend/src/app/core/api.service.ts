import { HttpClient, HttpErrorResponse, HttpEvent, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../environments/environment';
import { ApiError, MediaFile, SearchResult, TranscriptSegment } from './models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly base = environment.apiBaseUrl;

  listMedia(): Observable<MediaFile[]> {
    return this.http.get<MediaFile[]>(`${this.base}/media`);
  }

  /** Removes the file, its transcript and its stored media. Fails with 409 while it is still processing. */
  deleteMedia(id: number): Observable<void> {
    return this.http.delete<void>(`${this.base}/media/${id}`);
  }

  /** Transcribes the file again from scratch (e.g. after switching to a better Whisper model). */
  reprocessMedia(id: number): Observable<MediaFile> {
    return this.http.post<MediaFile>(`${this.base}/media/${id}/reprocess`, null);
  }

  getMedia(id: number): Observable<MediaFile> {
    return this.http.get<MediaFile>(`${this.base}/media/${id}`);
  }

  getTranscript(id: number): Observable<TranscriptSegment[]> {
    return this.http.get<TranscriptSegment[]>(`${this.base}/media/${id}/transcript`);
  }

  /** Emits progress events; the final HttpResponse carries the created MediaFile. */
  upload(file: File): Observable<HttpEvent<MediaFile>> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<MediaFile>(`${this.base}/media`, form, {
      reportProgress: true,
      observe: 'events',
    });
  }

  search(q: string, limit?: number, mediaId?: number | null): Observable<SearchResult[]> {
    let params = new HttpParams().set('q', q);
    if (limit != null) {
      params = params.set('limit', limit);
    }
    if (mediaId != null) {
      params = params.set('mediaId', mediaId);
    }
    return this.http.get<SearchResult[]>(`${this.base}/search`, { params });
  }

  /** URL for <audio>/<video> src; the backend supports Range requests so seeking works. */
  streamUrl(id: number): string {
    return `${this.base}/media/${id}/stream`;
  }
}

/** Turns any HTTP error into a short human-readable message. */
export function errorMessage(err: unknown): string {
  if (err instanceof HttpErrorResponse) {
    const body = err.error as Partial<ApiError> | null;
    if (body && typeof body === 'object' && body.message) {
      const fields = body.fieldErrors
        ? ' (' + Object.entries(body.fieldErrors).map(([k, v]) => `${k}: ${v}`).join(', ') + ')'
        : '';
      return body.message + fields;
    }
    if (err.status === 0) {
      return 'Cannot reach the server';
    }
    return `${err.status} ${err.statusText}`;
  }
  return err instanceof Error ? err.message : String(err);
}
