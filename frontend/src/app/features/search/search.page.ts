import { DecimalPipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, catchError, distinctUntilChanged, finalize, map, switchMap, tap } from 'rxjs';
import { ApiService, errorMessage } from '../../core/api.service';
import { TextPart, splitHighlight } from '../../core/highlight';
import { MediaFile, SearchResult } from '../../core/models';
import { formatTimestamp } from '../../core/time';

interface ResultView extends SearchResult {
  parts: TextPart[];
}

@Component({
  selector: 'app-search-page',
  imports: [
    FormsModule, DecimalPipe, RouterLink, MatFormFieldModule, MatInputModule, MatSelectModule,
    MatButtonModule, MatIconModule, MatProgressBarModule,
  ],
  template: `
    <h1>Search your recordings</h1>
    <form class="bar" (ngSubmit)="submit()">
      <mat-form-field appearance="outline" class="q" subscriptSizing="dynamic">
        <mat-label>What was said?</mat-label>
        <mat-icon matPrefix>search</mat-icon>
        <input matInput name="q" [(ngModel)]="query" placeholder="e.g. the Q3 budget" autocomplete="off" />
      </mat-form-field>
      <mat-form-field appearance="outline" class="scope" subscriptSizing="dynamic">
        <mat-label>In</mat-label>
        <mat-select name="mediaId" [(ngModel)]="mediaId">
          <mat-option [value]="null">All recordings</mat-option>
          @for (m of indexedMedia(); track m.id) {
            <mat-option [value]="m.id">{{ m.filename }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <button mat-flat-button type="submit" [disabled]="!query.trim()">Search</button>
    </form>

    @if (loading()) {
      <mat-progress-bar mode="indeterminate" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    @if (searched() && !loading() && !error() && results().length === 0) {
      <p class="muted">No matches. Is anything <a routerLink="/library">indexed</a> yet?</p>
    }

    <ol class="results">
      @for (r of results(); track r.chunkId) {
        <li>
          <a class="hit" [routerLink]="['/player', r.mediaId]" [queryParams]="{ t: r.startSec }">
            <div class="top">
              <span class="file">{{ r.mediaFilename }}</span>
              <span class="time"><span class="play" aria-hidden="true">▶</span>{{ fmt(r.startSec) }}</span>
              <span class="score" title="Cosine similarity">{{ r.score * 100 | number: '1.0-0' }}% match</span>
            </div>
            <p class="text">
              @for (p of r.parts; track $index) {
                @if (p.match) { <mark>{{ p.text }}</mark> } @else { {{ p.text }} }
              }
            </p>
          </a>
        </li>
      }
    </ol>
  `,
  styles: `
    .bar { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
    .q { flex: 1 1 320px; }
    .scope { flex: 0 1 220px; }
    .results { list-style: none; padding: 0; display: grid; gap: 10px; }
    .hit {
      display: block; padding: 14px 16px; border-radius: 12px; color: inherit; text-decoration: none;
      background: var(--mat-sys-surface-container-low); border: 1px solid transparent;
    }
    .hit:hover, .hit:focus-visible { border-color: var(--mat-sys-primary); outline: none; }
    .top { display: flex; gap: 12px; align-items: baseline; flex-wrap: wrap; }
    .file { font-weight: 600; overflow-wrap: anywhere; }
    .time { font-family: ui-monospace, monospace; color: var(--mat-sys-primary); }
    .play { font-size: 11px; margin-right: 4px; }
    .score { margin-left: auto; font-size: 12px; color: var(--mat-sys-on-surface-variant); }
    .text { margin: 8px 0 0; line-height: 1.5; }
    mark { background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container); border-radius: 3px; padding: 0 2px; }
    .error { color: var(--mat-sys-error); }
    .muted { color: var(--mat-sys-on-surface-variant); }
  `,
})
export class SearchPage {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  query = '';
  mediaId: number | null = null;

  readonly indexedMedia = signal<MediaFile[]>([]);
  readonly results = signal<ResultView[]>([]);
  readonly loading = signal(false);
  readonly searched = signal(false);
  readonly error = signal<string | null>(null);
  readonly fmt = formatTimestamp;

  constructor() {
    const destroyRef = inject(DestroyRef);

    this.api
      .listMedia()
      .pipe(takeUntilDestroyed(destroyRef))
      .subscribe({
        next: (list) => this.indexedMedia.set(list.filter((m) => m.status === 'INDEXED')),
        error: () => this.indexedMedia.set([]),
      });

    // The URL (?q=&mediaId=) is the source of truth, so results survive reload and back/forward.
    this.route.queryParamMap
      .pipe(
        map((p) => ({ q: (p.get('q') ?? '').trim(), mediaId: p.get('mediaId') ? Number(p.get('mediaId')) : null })),
        distinctUntilChanged((a, b) => a.q === b.q && a.mediaId === b.mediaId),
        tap(({ q, mediaId }) => {
          this.query = q;
          this.mediaId = mediaId;
        }),
        switchMap(({ q, mediaId }) => {
          if (!q) {
            this.results.set([]);
            this.searched.set(false);
            return EMPTY;
          }
          this.loading.set(true);
          this.error.set(null);
          return this.api.search(q, undefined, mediaId).pipe(
            map((hits) => hits.map((h) => ({ ...h, parts: splitHighlight(h.text, q) }))),
            catchError((err) => {
              this.error.set(errorMessage(err));
              return [[] as ResultView[]];
            }),
            finalize(() => this.loading.set(false)),
          );
        }),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe((views) => {
        this.results.set(views);
        this.searched.set(true);
      });
  }

  submit(): void {
    const q = this.query.trim();
    if (!q) {
      return;
    }
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { q, mediaId: this.mediaId ?? null },
    });
  }
}
