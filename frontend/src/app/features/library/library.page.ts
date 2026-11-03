import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable } from 'rxjs';
import { ApiService, errorMessage } from '../../core/api.service';
import { ConfirmService } from '../../core/confirm.service';
import { MediaStore } from '../../core/media-store';
import { MediaFile, isProcessing } from '../../core/models';
import { formatDuration } from '../../core/time';
import { Icon } from '../../shared/icon';
import { StatusBadge } from '../../shared/status-badge';

type Filter = 'all' | 'ready' | 'processing' | 'failed';

@Component({
  selector: 'app-library-page',
  imports: [DatePipe, RouterLink, Icon, StatusBadge],
  template: `
    <header class="toolbar">
      <div class="heading">
        <h1 class="title-2">Library</h1>
        @if (store.items().length) {
          <span class="footnote">{{ summary() }}</span>
        }
      </div>
      <div class="segmented" role="radiogroup" aria-label="Show" [style.--count]="filters.length">
        <span class="thumb" aria-hidden="true" [style.transform]="'translateX(' + filterIndex() * 100 + '%)'"></span>
        @for (f of filters; track f.key) {
          <button type="button" role="radio" [attr.aria-checked]="filter() === f.key" [class.on]="filter() === f.key" (click)="filter.set(f.key)">
            {{ f.label }}
          </button>
        }
      </div>
      <a class="btn primary" routerLink="/upload"><app-icon name="plus" [size]="16" />Add</a>
    </header>

    <div class="page">
      @if (error() || store.error(); as e) {
        <p class="footnote danger-text">{{ e }}</p>
      }

      @if (store.loaded() && store.items().length === 0) {
        <div class="empty">
          <h2 class="title-2">No Recordings</h2>
          <p class="subhead">Add audio or video files to make everything said in them searchable.</p>
          <a class="btn primary" routerLink="/upload">Add Recordings…</a>
        </div>
      } @else if (store.loaded() && visible().length === 0) {
        <p class="footnote nothing">Nothing in this view.</p>
      }

      @if (visible().length) {
        <ul class="list" style="--inset: 4rem">
          @for (m of visible(); track m.id) {
            <li class="row">
              <span class="kind" aria-hidden="true"><app-icon [name]="isVideo(m) ? 'film' : 'waveform'" [size]="18" /></span>
              <div class="main">
                <span class="name" [title]="m.filename">{{ m.filename }}</span>
                <span class="meta footnote tnum">{{ formatDuration(m.durationSec) }} · {{ m.createdAt | date: 'MMM d, y' }}</span>
                @if (m.errorMessage) {
                  <span class="err" [title]="m.errorMessage">{{ m.errorMessage }}</span>
                }
              </div>
              <app-status-badge class="status" [status]="m.status" [progress]="m.progressPct" [startedAt]="m.processingStartedAt" />
              <div class="actions">
                <a class="btn icon" [routerLink]="['/player', m.id]" [attr.aria-disabled]="m.status !== 'INDEXED'"
                  [attr.tabindex]="m.status === 'INDEXED' ? null : -1" title="Play" aria-label="Play">
                  <app-icon name="play" [size]="16" />
                </a>
                <a class="btn icon" [routerLink]="['/search']" [queryParams]="{ mediaId: m.id }" [attr.aria-disabled]="m.status !== 'INDEXED'"
                  [attr.tabindex]="m.status === 'INDEXED' ? null : -1" title="Search in this recording" aria-label="Search in this recording">
                  <app-icon name="search" [size]="16" />
                </a>
                <button class="btn icon" type="button" title="Transcribe again" aria-label="Transcribe again"
                  [disabled]="isProcessing(m.status) || busy().has(m.id)" (click)="reprocess(m)">
                  <app-icon name="redo" [size]="16" />
                </button>
                <button class="btn icon destructive" type="button" title="Delete" aria-label="Delete"
                  [disabled]="isProcessing(m.status) || busy().has(m.id)" (click)="remove(m)">
                  <app-icon name="trash" [size]="16" />
                </button>
              </div>
            </li>
          }
        </ul>
      }
    </div>
  `,
  styles: `
    .heading { flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 0.75rem; }

    .segmented {
      position: relative; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
      padding: 2px; border-radius: 9px; background: var(--fill);
    }
    .segmented button {
      all: unset; position: relative; z-index: 1; padding: 0.3125rem 0.875rem; border-radius: 7px; text-align: center;
      font-size: 0.8125rem; color: var(--label); cursor: pointer; transition: transform 100ms ease-out;
    }
    .segmented button:active { transform: scale(0.96); }
    .segmented button.on { font-weight: 600; }
    .segmented button:focus-visible { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent); }
    .thumb {
      position: absolute; top: 2px; bottom: 2px; left: 2px; width: calc((100% - 4px) / var(--count)); border-radius: 7px;
      background: var(--surface); box-shadow: 0 1px 3px rgba(0,0,0,.12), 0 0 0 0.5px rgba(0,0,0,.04);
      transition: transform 320ms var(--ease);
    }
    @media (prefers-color-scheme: dark) { .thumb { background: #636366; } }

    .row { display: grid; grid-template-columns: 2.25rem minmax(0, 1fr) 11rem auto; gap: 0.875rem; align-items: center; padding: 0.75rem 1rem; }
    .kind { width: 2.25rem; height: 2.25rem; border-radius: 8px; display: grid; place-items: center; background: var(--fill); color: var(--label-2); }
    .main { min-width: 0; display: grid; gap: 0.125rem; }
    .name { font-size: 0.9375rem; font-weight: 500; letter-spacing: -0.008em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .err { font-size: 0.8125rem; color: var(--red); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .actions { display: flex; gap: 0.125rem; }
    .empty { display: grid; justify-items: center; gap: 0.5rem; text-align: center; padding: 6rem 1rem; }
    .empty p { margin: 0 0 0.75rem; max-width: 22rem; }
    .nothing { margin-top: 1rem; }

    @media (max-width: 900px) {
      .row { grid-template-columns: 2.25rem minmax(0, 1fr) auto; }
      .status { grid-column: 2; grid-row: 2; }
      .actions { grid-row: 1 / span 2; grid-column: 3; }
      .segmented { display: none; }
    }
  `,
})
export class LibraryPage {
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  readonly store = inject(MediaStore);

  readonly error = signal<string | null>(null);
  readonly busy = signal<ReadonlySet<number>>(new Set());
  readonly filter = signal<Filter>('all');
  readonly isProcessing = isProcessing;
  readonly formatDuration = formatDuration;
  readonly filters: { key: Filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'ready', label: 'Ready' },
    { key: 'processing', label: 'Processing' },
    { key: 'failed', label: 'Failed' },
  ];

  readonly filterIndex = computed(() => this.filters.findIndex((f) => f.key === this.filter()));
  readonly visible = computed(() => this.store.items().filter((m) => this.matches(m, this.filter())));
  readonly summary = computed(() => {
    const n = this.store.items().length;
    return `${n} ${n === 1 ? 'recording' : 'recordings'} · ${formatDuration(this.store.indexedSeconds())} searchable`;
  });

  constructor() {
    this.store.refresh();
  }

  isVideo(m: MediaFile): boolean {
    return m.contentType?.startsWith('video/') ?? false;
  }

  async remove(m: MediaFile): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Delete “${m.filename}”?`,
      message: 'The recording and its transcript will be removed. This can’t be undone.',
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (!ok) {
      return;
    }
    this.run(m, this.api.deleteMedia(m.id), () => this.store.remove(m.id));
  }

  async reprocess(m: MediaFile): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Transcribe “${m.filename}” again?`,
      message: 'The current transcript is replaced using the current model. Long recordings take a few minutes.',
      confirmLabel: 'Transcribe',
    });
    if (!ok) {
      return;
    }
    this.run(m, this.api.reprocessMedia(m.id), () => this.store.refresh());
  }

  private run(m: MediaFile, call: Observable<unknown>, done: () => void): void {
    const release = () =>
      this.busy.update((s) => {
        const n = new Set(s);
        n.delete(m.id);
        return n;
      });
    this.busy.update((s) => new Set(s).add(m.id));
    call.subscribe({
      next: () => {
        release();
        done();
      },
      error: (err: unknown) => {
        release();
        this.error.set(errorMessage(err));
      },
    });
  }

  private matches(m: MediaFile, f: Filter): boolean {
    switch (f) {
      case 'all': return true;
      case 'ready': return m.status === 'INDEXED';
      case 'processing': return isProcessing(m.status);
      case 'failed': return m.status === 'FAILED';
    }
  }
}
