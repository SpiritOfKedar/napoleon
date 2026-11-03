import { HttpEventType } from '@angular/common/http';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { ApiService, errorMessage } from '../../core/api.service';
import { MediaStore } from '../../core/media-store';
import { MediaFile } from '../../core/models';
import { Icon } from '../../shared/icon';
import { StatusBadge } from '../../shared/status-badge';

interface UploadItem {
  key: number;
  file: File;
  progress: number; // 0-100, upload only
  phase: 'uploading' | 'uploaded' | 'error';
  mediaId?: number;
  error?: string;
}

const ACCEPT = 'audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac,.webm,.mp4,.m4v,.mov,.mkv,.avi';

@Component({
  selector: 'app-upload-page',
  imports: [RouterLink, Icon, StatusBadge],
  template: `
    <header class="toolbar">
      <h1 class="title-2">Upload</h1>
    </header>

    <div class="page">
      <div
        class="drop"
        [class.over]="dragOver()"
        (dragover)="onDragOver($event)"
        (dragleave)="dragOver.set(false)"
        (drop)="onDrop($event)"
      >
        <app-icon name="upload" [size]="32" />
        <p class="headline">Drop audio or video files here</p>
        <p class="footnote">MP4, MOV, MKV, WebM, MP3, WAV, M4A and more, up to 5 GB each.</p>
        <button class="btn primary" type="button" (click)="input.click()">Choose Files…</button>
        <input #input type="file" multiple [accept]="accept" hidden (change)="onPick(input)" />
      </div>

      @if (rows().length) {
        <h2 class="section">Uploads</h2>
        <ul class="list" style="--inset: 4rem">
          @for (r of rows(); track r.item.key) {
            <li class="row">
              <span class="kind" aria-hidden="true">
                <app-icon [name]="r.item.file.type.startsWith('video') ? 'film' : 'waveform'" [size]="18" />
              </span>
              <div class="main">
                <span class="name" [title]="r.item.file.name">{{ r.item.file.name }}</span>
                @switch (r.item.phase) {
                  @case ('uploading') {
                    <span class="bar" role="progressbar" [attr.aria-valuenow]="r.item.progress" aria-valuemin="0" aria-valuemax="100" aria-label="Upload progress">
                      <span [style.transform]="'scaleX(' + r.item.progress / 100 + ')'"></span>
                    </span>
                    <span class="footnote tnum">Uploading… {{ r.item.progress }}% of {{ size(r.item.file.size) }}</span>
                  }
                  @case ('error') { <span class="footnote danger-text">{{ r.item.error }}</span> }
                  @case ('uploaded') {
                    <span class="footnote tnum">{{ size(r.item.file.size) }}</span>
                    @if (r.media?.errorMessage) {
                      <span class="footnote danger-text">{{ r.media?.errorMessage }}</span>
                    }
                  }
                }
              </div>
              @if (r.media; as m) {
                <app-status-badge [status]="m.status" [progress]="m.progressPct" [startedAt]="m.processingStartedAt" />
                @if (m.status === 'INDEXED') {
                  <a class="btn" [routerLink]="['/player', m.id]">Open</a>
                }
              }
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .drop {
      display: grid; justify-items: center; gap: 0.5rem; text-align: center; padding: 3.5rem 1.5rem;
      border-radius: 14px; border: 1.5px dashed var(--separator); color: var(--label-2);
      transition: background-color 150ms ease-out, border-color 150ms ease-out;
    }
    .drop.over { border-color: var(--accent); border-style: solid; background: var(--accent-tint); }
    .drop p { margin: 0; }
    .drop .headline { color: var(--label); margin-top: 0.5rem; }
    .drop .btn { margin-top: 0.75rem; }
    .section { margin: 2rem 0 0.5rem; font-size: 0.8125rem; font-weight: 600; color: var(--label-2); }
    .row { display: flex; align-items: center; gap: 0.875rem; padding: 0.75rem 1rem; }
    .kind { flex: none; width: 2.25rem; height: 2.25rem; border-radius: 8px; display: grid; place-items: center; background: var(--fill); color: var(--label-2); }
    .main { flex: 1; min-width: 0; display: grid; gap: 0.25rem; }
    .name { font-size: 0.9375rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .bar { display: block; height: 3px; border-radius: 2px; background: var(--fill-2); overflow: hidden; }
    .bar span { display: block; height: 100%; background: var(--accent); transform-origin: left; transition: transform 200ms ease-out; }
  `,
})
export class UploadPage {
  private readonly api = inject(ApiService);
  private readonly store = inject(MediaStore);
  private readonly subs = new Subscription();
  private nextKey = 0;

  readonly accept = ACCEPT;
  readonly items = signal<UploadItem[]>([]);
  readonly dragOver = signal(false);

  /** Each upload joined with its live server state from the shared store. */
  readonly rows = computed(() => {
    const byId = new Map<number, MediaFile>(this.store.items().map((m) => [m.id, m]));
    return this.items().map((item) => ({ item, media: item.mediaId != null ? byId.get(item.mediaId) : undefined }));
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => this.subs.unsubscribe());
  }

  size(bytes: number): string {
    if (bytes >= 1e9) {
      return `${(bytes / 1e9).toFixed(2)} GB`;
    }
    return bytes >= 1e6 ? `${(bytes / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  }

  onDragOver(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(true);
  }

  onDrop(e: DragEvent): void {
    e.preventDefault();
    this.dragOver.set(false);
    this.start(Array.from(e.dataTransfer?.files ?? []));
  }

  onPick(input: HTMLInputElement): void {
    this.start(Array.from(input.files ?? []));
    input.value = ''; // allow picking the same file again
  }

  private start(files: File[]): void {
    for (const file of files) {
      const key = this.nextKey++;
      this.items.update((list) => [{ key, file, progress: 0, phase: 'uploading' }, ...list]);
      this.subs.add(
        this.api.upload(file).subscribe({
          next: (event) => {
            if (event.type === HttpEventType.UploadProgress && event.total) {
              this.patch(key, { progress: Math.round((100 * event.loaded) / event.total) });
            } else if (event.type === HttpEventType.Response && event.body) {
              this.patch(key, { phase: 'uploaded', progress: 100, mediaId: event.body.id });
              this.store.refresh(); // the store keeps polling while it is processing
            }
          },
          error: (err) => this.patch(key, { phase: 'error', error: errorMessage(err) }),
        }),
      );
    }
  }

  private patch(key: number, changes: Partial<UploadItem>): void {
    this.items.update((list) => list.map((i) => (i.key === key ? { ...i, ...changes } : i)));
  }
}
