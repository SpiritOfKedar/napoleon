import { Component, DestroyRef, ElementRef, HostListener, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { EMPTY, catchError, distinctUntilChanged, finalize, map, switchMap, tap } from 'rxjs';
import { ApiService, errorMessage } from '../../core/api.service';
import { TextPart, splitHighlight } from '../../core/highlight';
import { MediaStore } from '../../core/media-store';
import { SearchResult } from '../../core/models';
import { formatClock, formatDuration } from '../../core/time';
import { Icon } from '../../shared/icon';
import { MenuOption, MenuSelect, MenuValue } from '../../shared/menu-select';

interface ResultView extends SearchResult {
  parts: TextPart[];
  durationSec: number | null;
  /** Positions (0..100) of every result in the same file, for the position hairline. */
  ticks: number[];
  here: number | null;
}

@Component({
  selector: 'app-search-page',
  imports: [FormsModule, RouterLink, Icon, MenuSelect],
  template: `
    <form class="toolbar" (ngSubmit)="submit()" role="search">
      <label class="search-field grow">
        <app-icon name="search" [size]="16" />
        <span class="sr-only">Search recordings</span>
        <input #box name="q" [(ngModel)]="query" placeholder="Search what was said" autocomplete="off" enterkeyhint="search" />
      </label>
      <app-menu-select ariaLabel="Search in" [options]="scopeOptions()" [value]="mediaId" (valueChange)="setScope($event)" />
    </form>

    <div class="page">
      @if (error()) {
        <p class="footnote danger-text">{{ error() }}</p>
      } @else if (!searched() && !loading()) {
        <p class="footnote idle">
          @if (store.indexed().length) {
            {{ store.indexed().length }} {{ store.indexed().length === 1 ? 'recording' : 'recordings' }},
            {{ formatDuration(store.indexedSeconds()) }} of audio. Press <kbd>/</kbd> to search.
          } @else if (store.loaded()) {
            Nothing to search yet. <a routerLink="/upload">Upload a recording</a>.
          }
        </p>
      } @else {
        <p class="footnote count" aria-live="polite">
          @if (loading() && !results().length) {
            Searching…
          } @else if (results().length) {
            {{ results().length }} {{ results().length === 1 ? 'result' : 'results' }}
            @if (fileCount() > 1) { in {{ fileCount() }} recordings }
          } @else {
            No results for “{{ lastQuery() }}”.
          }
        </p>
      }

      @if (results().length) {
        <ol class="list results" [class.stale]="loading()" style="--inset: 5.25rem">
          @for (r of results(); track r.chunkId) {
            <li>
              <a class="row" [routerLink]="['/player', r.mediaId]" [queryParams]="{ t: r.startSec, q: lastQuery() }">
                <span class="time tnum">{{ clock(r.startSec) }}</span>
                <span class="content">
                  <span class="file">{{ r.mediaFilename }}</span>
                  <span class="text">
                    @for (p of r.parts; track $index) {
                      @if (p.match) { <mark>{{ p.text }}</mark> } @else { {{ p.text }} }
                    }
                  </span>
                  @if (r.here != null) {
                    <span class="pos" aria-hidden="true">
                      @for (t of r.ticks; track $index) { <span class="tick" [style.left.%]="t"></span> }
                      <span class="tick here" [style.left.%]="r.here"></span>
                    </span>
                  }
                </span>
                <app-icon class="chev" name="chevron" [size]="14" />
              </a>
            </li>
          }
        </ol>
      }
    </div>
  `,
  styles: `
    .grow { flex: 1; }
    kbd { font: 500 0.75rem var(--font); padding: 0.0625rem 0.375rem; border-radius: 4px; background: var(--fill); color: var(--label); }
    .idle, .count { margin: 1rem 0 0.75rem; }

    .results { transition: opacity 200ms ease-out; }
    .results.stale { opacity: 0.5; }
    .row {
      display: grid; grid-template-columns: 4.25rem minmax(0, 1fr) auto; gap: 1rem; align-items: start;
      padding: 0.875rem 1rem; color: inherit; transition: background-color 100ms ease-out;
    }
    .row:hover { background: color-mix(in srgb, var(--fill) 60%, transparent); }
    .row:active { background: var(--fill); }
    .row:focus-visible { border-radius: 0; box-shadow: inset 0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent); }
    .time { font-size: 0.9375rem; font-weight: 600; color: var(--accent); line-height: 1.45; text-align: right; }
    .content { display: grid; gap: 0.25rem; min-width: 0; }
    .file { font-size: 0.75rem; color: var(--label-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .text {
      font-size: 0.9375rem; line-height: 1.5; letter-spacing: -0.006em; color: var(--label);
      display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
    }
    .pos { position: relative; height: 2px; margin-top: 0.5rem; border-radius: 1px; background: var(--fill-2); }
    .tick { position: absolute; top: -2px; width: 2px; height: 6px; margin-left: -1px; border-radius: 1px; background: var(--label-3); }
    .tick.here { background: var(--accent); width: 3px; }
    .chev { color: var(--label-3); margin-top: 0.25rem; }

    @media (max-width: 760px) {
      .row { grid-template-columns: 3.5rem minmax(0, 1fr); }
      .chev { display: none; }
    }
  `,
})
export class SearchPage {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');
  readonly store = inject(MediaStore);

  query = '';
  mediaId: number | null = null;

  readonly results = signal<ResultView[]>([]);
  readonly loading = signal(false);
  readonly searched = signal(false);
  readonly error = signal<string | null>(null);
  readonly lastQuery = signal('');
  readonly clock = formatClock;
  readonly formatDuration = formatDuration;
  /** "All Recordings" first, then each searchable recording with its length. */
  readonly scopeOptions = computed<MenuOption[]>(() => [
    { value: null, label: 'All Recordings' },
    ...this.store.indexed().map((m) => ({ value: m.id, label: m.filename, detail: formatDuration(m.durationSec) })),
  ]);
  readonly fileCount = computed(() => new Set(this.results().map((r) => r.mediaId)).size);

  constructor() {
    const destroyRef = inject(DestroyRef);

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
            map((hits) => this.toViews(hits, q)),
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

  /** "/" focuses the search field from anywhere on the page (unless already typing). */
  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
    if (e.key === '/' && !typing) {
      e.preventDefault();
      this.box()?.nativeElement.focus();
    }
  }

  submit(): void {
    const q = this.query.trim();
    if (!q) {
      return;
    }
    this.router.navigate([], { relativeTo: this.route, queryParams: { q, mediaId: this.mediaId ?? null } });
  }

  setScope(value: MenuValue): void {
    this.mediaId = typeof value === 'number' ? value : null;
    this.submit();
  }

  private toViews(hits: SearchResult[], q: string): ResultView[] {
    this.lastQuery.set(q);
    const media = new Map(this.store.items().map((m) => [m.id, m]));
    return hits.map((h) => {
      const d = media.get(h.mediaId)?.durationSec ?? null;
      const pct = (t: number) => (d ? Math.min(100, (100 * t) / d) : 0);
      return {
        ...h,
        parts: splitHighlight(h.text, q),
        durationSec: d,
        here: d ? pct(h.startSec) : null,
        ticks: d ? hits.filter((o) => o.mediaId === h.mediaId && o.chunkId !== h.chunkId).map((o) => pct(o.startSec)) : [],
      };
    });
  }
}
