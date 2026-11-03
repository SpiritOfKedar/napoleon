import { HttpErrorResponse, HttpEventType, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { environment } from '../../environments/environment';
import { ApiService, errorMessage } from './api.service';
import { MediaFile, SearchResult } from './models';

describe('ApiService', () => {
  let api: ApiService;
  let http: HttpTestingController;
  const base = environment.apiBaseUrl;

  const media: MediaFile = {
    id: 1,
    filename: 'meeting.mp4',
    contentType: 'video/mp4',
    sizeBytes: 100,
    durationSec: 900,
    status: 'INDEXED',
    errorMessage: null,
    createdAt: '2026-11-03T10:00:00Z',
    updatedAt: '2026-11-03T10:05:00Z',
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting()],
    });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('lists media', () => {
    let result: MediaFile[] | undefined;
    api.listMedia().subscribe((r) => (result = r));
    const req = http.expectOne(`${base}/media`);
    expect(req.request.method).toBe('GET');
    req.flush([media]);
    expect(result).toEqual([media]);
  });

  it('gets one media file and its transcript', () => {
    api.getMedia(1).subscribe();
    http.expectOne(`${base}/media/1`).flush(media);
    api.getTranscript(1).subscribe();
    http.expectOne(`${base}/media/1/transcript`).flush([]);
  });

  it('searches with query, limit and media filter', () => {
    const hit: SearchResult = {
      chunkId: 3, mediaId: 1, mediaFilename: 'meeting.mp4',
      startSec: 872, endSec: 878, chunkStartSec: 860, chunkEndSec: 890, text: 'the Q3 budget', score: 0.8,
    };
    let result: SearchResult[] | undefined;
    api.search('Q3 budget', 5, 1).subscribe((r) => (result = r));

    const req = http.expectOne((r) => r.url === `${base}/search`);
    expect(req.request.params.get('q')).toBe('Q3 budget');
    expect(req.request.params.get('limit')).toBe('5');
    expect(req.request.params.get('mediaId')).toBe('1');
    req.flush([hit]);
    expect(result).toEqual([hit]);
  });

  it('omits optional search params when not given', () => {
    api.search('hello').subscribe();
    const req = http.expectOne((r) => r.url === `${base}/search`);
    expect(req.request.params.keys()).toEqual(['q']);
    req.flush([]);
  });

  it('uploads as multipart form data and reports progress', () => {
    const file = new File(['abc'], 'clip.mp3', { type: 'audio/mpeg' });
    const types: HttpEventType[] = [];
    api.upload(file).subscribe((e) => types.push(e.type));

    const req = http.expectOne(`${base}/media`);
    expect(req.request.method).toBe('POST');
    expect(req.request.reportProgress).toBe(true);
    const body = req.request.body as FormData;
    expect((body.get('file') as File).name).toBe('clip.mp3');

    req.event({ type: HttpEventType.UploadProgress, loaded: 1, total: 3 });
    req.flush(media);
    expect(types).toContain(HttpEventType.UploadProgress);
    expect(types).toContain(HttpEventType.Response);
  });

  it('builds the stream URL', () => {
    expect(api.streamUrl(7)).toBe(`${base}/media/7/stream`);
  });
});

describe('errorMessage', () => {
  it('uses the backend error JSON message and field errors', () => {
    const err = new HttpErrorResponse({
      status: 400,
      error: { status: 400, message: 'Validation failed', fieldErrors: { q: 'q must not be blank' } },
    });
    expect(errorMessage(err)).toBe('Validation failed (q: q must not be blank)');
  });

  it('explains network failures', () => {
    expect(errorMessage(new HttpErrorResponse({ status: 0 }))).toBe('Cannot reach the server');
  });
});
