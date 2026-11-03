import { Injectable, computed, inject, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { ApiService, errorMessage } from './api.service';
import { MediaFile, isProcessing } from './models';

/**
 * The media list shared by the sidebar, library, search and upload pages. Polls only while
 * something is still processing, so status, progress and time remaining stay live everywhere.
 */
@Injectable({ providedIn: 'root' })
export class MediaStore {
  private readonly api = inject(ApiService);
  private timer: ReturnType<typeof setTimeout> | null = null;

  readonly items = signal<MediaFile[]>([]);
  readonly loaded = signal(false);
  readonly error = signal<string | null>(null);

  readonly indexed = computed(() => this.items().filter((m) => m.status === 'INDEXED'));
  readonly processing = computed(() => this.items().some((m) => isProcessing(m.status)));
  readonly indexedSeconds = computed(() => this.indexed().reduce((s, m) => s + (m.durationSec ?? 0), 0));

  refresh(): void {
    this.api.listMedia().subscribe({
      next: (list) => {
        this.items.set(list);
        this.error.set(null);
        this.loaded.set(true);
        this.schedule(false);
      },
      error: (err) => {
        this.error.set(errorMessage(err));
        this.loaded.set(true);
        this.schedule(true);
      },
    });
  }

  remove(id: number): void {
    this.items.update((list) => list.filter((m) => m.id !== id));
  }

  private schedule(failed: boolean): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (failed || this.processing()) {
      this.timer = setTimeout(() => this.refresh(), environment.pollIntervalMs);
    }
  }
}
