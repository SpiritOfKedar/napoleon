import { HttpEventType } from '@angular/common/http';
import { Component, DestroyRef, OnDestroy, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { Subscription } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiService, errorMessage } from '../../core/api.service';
import { MediaFile, isProcessing } from '../../core/models';
import { StatusBadge } from '../../shared/status-badge';

interface UploadItem {
  key: number;
  file: File;
  progress: number; // 0-100, upload only
  phase: 'uploading' | 'uploaded' | 'error';
  media?: MediaFile;
  error?: string;
}

const ACCEPT = 'audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.opus,.flac,.webm,.mp4,.m4v,.mov,.mkv,.avi';

@Component({
  selector: 'app-upload-page',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule, RouterLink, StatusBadge],
  template: `
    <h1>Upload</h1>
    <div
      class="dropzone"
      [class.over]="dragOver()"
      (dragover)="onDragOver($event)"
      (dragleave)="dragOver.set(false)"
      (drop)="onDrop($event)"
      (click)="input.click()"
      (keydown.enter)="input.click()"
      tabindex="0"
      role="button"
      aria-label="Choose audio or video files to upload"
    >
      <mat-icon class="big">cloud_upload</mat-icon>
      <p><strong>Drop audio or video files here</strong> or click to choose</p>
      <p class="hint">MP3, WAV, M4A, MP4, MOV, MKV, WebM…</p>
      <input #input type="file" multiple [accept]="accept" hidden (change)="onPick(input)" />
    </div>

    @if (items().length) {
      <ul class="items">
        @for (item of items(); track item.key) {
          <li>
            <div class="row">
              <mat-icon>{{ item.file.type.startsWith('video') ? 'movie' : 'audiotrack' }}</mat-icon>
              <span class="name">{{ item.file.name }}</span>
              @switch (item.phase) {
                @case ('uploading') { <span class="muted">Uploading {{ item.progress }}%</span> }
                @case ('error') { <span class="error">{{ item.error }}</span> }
                @case ('uploaded') {
                  @if (item.media; as m) {
                    <app-status-badge [status]="m.status" [progress]="m.progressPct" />
                    @if (m.status === 'INDEXED') {
                      <a mat-button [routerLink]="['/player', m.id]">Open</a>
                    }
                  }
                }
              }
            </div>
            @if (item.phase === 'uploading') {
              <mat-progress-bar mode="determinate" [value]="item.progress" />
            } @else if (item.media && isProcessing(item.media.status)) {
              <mat-progress-bar mode="indeterminate" />
            }
            @if (item.media?.errorMessage) {
              <p class="error small">{{ item.media?.errorMessage }}</p>
            }
          </li>
        }
      </ul>
    }
  `,
  styles: `
    .dropzone {
      border: 2px dashed var(--mat-sys-outline); border-radius: 16px; padding: 40px 16px;
      text-align: center; cursor: pointer; transition: background .15s, border-color .15s;
    }
    .dropzone.over, .dropzone:hover, .dropzone:focus-visible {
      background: var(--mat-sys-surface-container); border-color: var(--mat-sys-primary); outline: none;
    }
    .big { font-size: 48px; width: 48px; height: 48px; color: var(--mat-sys-primary); }
    .hint, .muted { color: var(--mat-sys-on-surface-variant); }
    .items { list-style: none; padding: 0; margin-top: 24px; display: grid; gap: 12px; }
    .items li { padding: 12px; border-radius: 12px; background: var(--mat-sys-surface-container-low); }
    .row { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin-bottom: 6px; }
    .name { flex: 1; min-width: 0; overflow-wrap: anywhere; font-weight: 500; }
    .error { color: var(--mat-sys-error); }
    .small { font-size: 13px; margin: 6px 0 0; }
  `,
})
export class UploadPage implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly subs = new Subscription();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private nextKey = 0;

  readonly accept = ACCEPT;
  readonly items = signal<UploadItem[]>([]);
  readonly dragOver = signal(false);
  readonly isProcessing = isProcessing;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.subs.unsubscribe());
  }

  ngOnDestroy(): void {
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
    }
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
              this.patch(key, { phase: 'uploaded', progress: 100, media: event.body });
              this.schedulePoll();
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

  /** Refreshes server status of uploaded files until none is still processing. */
  private schedulePoll(): void {
    if (this.pollTimer) {
      return;
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.subs.add(
        this.api.listMedia().subscribe({
          next: (all) => {
            const byId = new Map(all.map((m) => [m.id, m]));
            this.items.update((list) =>
              list.map((i) => (i.media && byId.has(i.media.id) ? { ...i, media: byId.get(i.media.id) } : i)),
            );
            if (this.items().some((i) => i.media && isProcessing(i.media.status))) {
              this.schedulePoll();
            }
          },
          error: () => this.schedulePoll(),
        }),
      );
    }, environment.pollIntervalMs);
  }
}
