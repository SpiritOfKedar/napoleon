import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { catchError, distinctUntilChanged, forkJoin, map, of, switchMap } from 'rxjs';
import { ApiService, errorMessage } from '../../core/api.service';
import { TextPart, splitHighlight } from '../../core/highlight';
import { MediaFile, SearchResult, TranscriptSegment } from '../../core/models';
import { SpringScroller } from '../../core/spring';
import { formatClock, parseSeconds } from '../../core/time';
import { HitTimeline, TimelineHit } from '../../shared/hit-timeline';
import { Icon } from '../../shared/icon';
import { StatusBadge } from '../../shared/status-badge';

interface LineView extends TranscriptSegment {
  parts: TextPart[];
  hit: boolean;
}

/** Keys that scroll a focused container; pressing one means the user is navigating by hand. */
const SCROLL_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);

@Component({
  selector: 'app-player-page',
  imports: [FormsModule, RouterLink, StatusBadge, HitTimeline, Icon],
  template: `
    <header class="toolbar">
      <a class="btn plain back" routerLink="/search" [queryParams]="q() ? { q: q() } : {}">
        <app-icon name="back" [size]="16" />Search
      </a>
      @if (media(); as m) {
        <h1 class="headline title" [title]="m.filename">{{ m.filename }}</h1>
        @if (m.status !== 'INDEXED') {
          <app-status-badge [status]="m.status" [progress]="m.progressPct" [startedAt]="m.processingStartedAt" />
        }
      }
    </header>

    @if (error()) {
      <p class="page footnote danger-text">{{ error() }}</p>
    }

    @if (media(); as m) {
      <div class="layout">
        <section class="stage" aria-label="Player">
          @if (!isVideo()) {
            <div class="artwork" aria-hidden="true"><app-icon name="waveform" [size]="56" /></div>
          }
          <video
            #player
            [class.audio]="!isVideo()"
            [src]="streamUrl()"
            controls
            preload="metadata"
            (loadedmetadata)="onLoaded(player.duration)"
            (timeupdate)="currentTime.set(player.currentTime)"
            (seeked)="currentTime.set(player.currentTime)"
          ></video>
          @if (needsClick()) {
            <p class="footnote">Press play to start at {{ clock(currentTime()) }}.</p>
          }

          <div class="scrub">
            <app-hit-timeline [duration]="duration()" [hits]="timeline()" [playhead]="currentTime()" [tall]="true" [showLabels]="true" (seek)="seek($event, true)" />
          </div>

          <div class="matches">
            @if (hits().length) {
              <span class="footnote">{{ hits().length }} {{ hits().length === 1 ? 'match' : 'matches' }} for “{{ q() }}”</span>
              <span class="nav">
                <button class="btn icon" type="button" (click)="jump(-1)" aria-label="Previous match" title="Previous match"><app-icon name="prev" [size]="16" /></button>
                <button class="btn icon" type="button" (click)="jump(1)" aria-label="Next match" title="Next match"><app-icon name="next" [size]="16" /></button>
              </span>
            } @else if (q()) {
              <span class="footnote">No matches for “{{ q() }}” in this recording.</span>
            }
          </div>
        </section>

        <section class="transcript" aria-label="Transcript">
          <form class="search-field find" (ngSubmit)="find()" role="search">
            <app-icon name="search" [size]="15" />
            <input name="fq" [(ngModel)]="findText" placeholder="Find in transcript" autocomplete="off" aria-label="Find in transcript" />
          </form>

          <ol
            #panel
            class="lines"
            tabindex="-1"
            (wheel)="handOver()"
            (touchmove)="handOver()"
            (pointerdown)="onPanelPointer($event)"
            (keydown)="onPanelKey($event)"
          >
            @for (s of lines(); track $index) {
              <li [id]="'seg-' + $index" [class.active]="$index === activeIndex()" [class.hit]="s.hit">
                <button class="line" type="button" (click)="seek(s.startSec, true)">
                  <span class="ts tnum">{{ clock(s.startSec) }}</span>
                  <span class="txt">
                    @for (p of s.parts; track $index) {
                      @if (p.match) { <mark>{{ p.text }}</mark> } @else { {{ p.text }} }
                    }
                  </span>
                </button>
              </li>
            } @empty {
              <li class="footnote none">No transcript yet.</li>
            }
          </ol>

          <button class="resume" type="button" [class.shown]="!following() && activeIndex() >= 0" (click)="resume()" [attr.tabindex]="following() ? -1 : 0">
            <app-icon name="current" [size]="14" />Back to Current Line
          </button>
        </section>
      </div>
    }
  `,
  styles: `
    .back { margin-left: -0.5rem; }
    .title { flex: 1; min-width: 0; margin: 0; text-align: center; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

    .layout {
      display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(20rem, 1fr); gap: 2.5rem;
      padding: 1rem 2rem 2rem; align-items: start;
    }
    .stage { position: sticky; top: 4.5rem; display: grid; gap: 0.75rem; }
    video { display: block; width: 100%; max-height: 64vh; border-radius: var(--radius); background: #000; }
    video.audio { height: 3.5rem; background: transparent; border-radius: 0; }
    .artwork {
      aspect-ratio: 16 / 9; border-radius: var(--radius); display: grid; place-items: center;
      background: var(--fill); color: var(--label-3);
    }
    .stage > .footnote { margin: 0; }
    .scrub { padding: 0.25rem 0.125rem 0; }
    .matches { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; min-height: 2rem; }
    .nav { display: flex; gap: 0.125rem; }

    .transcript { position: relative; display: flex; flex-direction: column; gap: 0.75rem; min-width: 0; }
    .find { flex: none; }
    .lines {
      list-style: none; margin: 0; padding: 30vh 0 45vh; height: calc(100vh - 9.5rem); overflow-y: auto; outline: none;
      /* Lines fade out at the edges rather than ending at a hard line. */
      -webkit-mask-image: linear-gradient(transparent, #000 12%, #000 80%, transparent);
      mask-image: linear-gradient(transparent, #000 12%, #000 80%, transparent);
      scrollbar-width: thin;
    }
    .line {
      all: unset; box-sizing: border-box; width: 100%; cursor: pointer;
      display: grid; grid-template-columns: 3.5rem minmax(0, 1fr); gap: 0.5rem; align-items: baseline;
      padding: 0.4375rem 0.5rem; border-radius: 10px;
      transition: background-color 120ms ease-out;
    }
    .line:active { background: var(--fill); }
    .line:focus-visible { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent); }
    .ts { font-size: 0.75rem; color: var(--label-2); text-align: right; opacity: 0; transition: opacity 200ms ease-out; }
    .txt {
      font-family: var(--font-display); font-size: 1.375rem; line-height: 1.32; font-weight: 600; letter-spacing: -0.018em;
      color: var(--label); opacity: 0.28; transition: opacity 300ms var(--ease);
    }
    .line:hover .txt { opacity: 0.6; }
    .line:hover .ts, .active .ts, .hit .ts { opacity: 1; }
    .hit .txt { opacity: 0.55; }
    .hit .ts { color: var(--accent); }
    .active .txt { opacity: 1; }
    .active .ts { color: var(--label); }
    .none { padding: 0 0.5rem; }

    /* Floating control that materializes: blur, scale and opacity arrive together. */
    .resume {
      all: unset; position: absolute; left: 50%; bottom: 1.5rem; display: inline-flex; align-items: center; gap: 0.375rem;
      padding: 0.5rem 0.875rem; border-radius: 980px; cursor: pointer; font-size: 0.8125rem; font-weight: 600; color: var(--label);
      background: var(--material); backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%);
      box-shadow: var(--shadow), inset 0 0 0 0.5px var(--separator);
      opacity: 0; transform: translate(-50%, 0.5rem) scale(0.94); filter: blur(4px); pointer-events: none;
      transition: opacity 240ms var(--ease), transform 320ms var(--ease), filter 240ms var(--ease);
    }
    .resume.shown { opacity: 1; transform: translate(-50%, 0) scale(1); filter: none; pointer-events: auto; }
    .resume:active { transform: translate(-50%, 0) scale(0.97); }
    .resume:focus-visible { box-shadow: var(--shadow), 0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent); }

    @media (max-width: 960px) {
      .layout { grid-template-columns: 1fr; gap: 1.5rem; padding: 1rem; }
      .stage { position: static; }
      .lines { height: 70vh; padding: 20vh 0 35vh; }
      .txt { font-size: 1.1875rem; }
      .line { grid-template-columns: 3rem minmax(0, 1fr); }
    }
  `,
})
export class PlayerPage {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly player = viewChild<ElementRef<HTMLVideoElement>>('player');
  private readonly panel = viewChild<ElementRef<HTMLOListElement>>('panel');
  private scroller: SpringScroller | null = null;

  readonly media = signal<MediaFile | null>(null);
  readonly segments = signal<TranscriptSegment[]>([]);
  readonly hits = signal<SearchResult[]>([]);
  readonly q = signal('');
  readonly error = signal<string | null>(null);
  readonly currentTime = signal(0);
  readonly mediaDuration = signal<number | null>(null);
  readonly needsClick = signal(false);
  /** The transcript follows playback until the user scrolls it themselves. */
  readonly following = signal(true);
  readonly clock = formatClock;

  findText = '';

  readonly isVideo = computed(() => this.media()?.contentType?.startsWith('video/') ?? false);
  readonly streamUrl = computed(() => {
    const m = this.media();
    return m ? this.api.streamUrl(m.id) : '';
  });
  readonly duration = computed(() => this.media()?.durationSec ?? this.mediaDuration() ?? 0);
  readonly timeline = computed<TimelineHit[]>(() => this.hits().map((h) => ({ startSec: h.startSec, score: h.score })));

  readonly lines = computed<LineView[]>(() => {
    const q = this.q();
    const hitStarts = new Set(this.hits().map((h) => h.startSec.toFixed(2)));
    return this.segments().map((s) => ({
      ...s,
      parts: q ? splitHighlight(s.text, q) : [{ text: s.text, match: false }],
      hit: hitStarts.has(s.startSec.toFixed(2)),
    }));
  });

  /** Index of the last segment that has started (binary search); -1 before the first one. */
  readonly activeIndex = computed(() => {
    const t = this.currentTime();
    const segs = this.segments();
    let lo = 0;
    let hi = segs.length - 1;
    let active = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segs[mid].startSec <= t + 0.05) {
        active = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return active;
  });

  /** Seek target from ?t= that arrived before the media's metadata was loaded. */
  private pendingSeek: number | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => this.scroller?.stop());

    this.route.paramMap
      .pipe(
        map((p) => Number(p.get('id'))),
        distinctUntilChanged(),
        switchMap((id) => forkJoin([this.api.getMedia(id), this.api.getTranscript(id)])),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe({
        next: ([media, segments]) => {
          this.media.set(media);
          this.segments.set(segments);
        },
        error: (err) => this.error.set(errorMessage(err)),
      });

    // ?q= marks where the query matches inside this recording.
    this.route.queryParamMap
      .pipe(
        map((p) => ({ id: Number(this.route.snapshot.paramMap.get('id')), q: (p.get('q') ?? '').trim() })),
        distinctUntilChanged((a, b) => a.id === b.id && a.q === b.q),
        switchMap(({ id, q }) => {
          this.q.set(q);
          this.findText = q;
          return q ? this.api.search(q, 50, id).pipe(catchError(() => of([] as SearchResult[]))) : of([] as SearchResult[]);
        }),
        takeUntilDestroyed(destroyRef),
      )
      .subscribe((hits) => this.hits.set([...hits].sort((a, b) => a.startSec - b.startSec)));

    // Only a changed ?t= seeks; "Find" rewrites ?q= and must not snap playback back.
    this.route.queryParamMap
      .pipe(map((p) => parseSeconds(p.get('t'))), distinctUntilChanged(), takeUntilDestroyed(destroyRef))
      .subscribe((t) => {
        if (t == null) {
          return;
        }
        const el = this.player()?.nativeElement;
        if (el && el.readyState >= HTMLMediaElement.HAVE_METADATA) {
          this.seek(t, true);
        } else {
          this.pendingSeek = t;
          this.currentTime.set(t);
        }
      });

    // Keep the current line in view with a spring, while following.
    effect(() => {
      const i = this.activeIndex();
      const panel = this.panel()?.nativeElement;
      if (i < 0 || !panel || !this.following()) {
        return;
      }
      untracked(() => this.scrollToLine(panel, i));
    });
  }

  onLoaded(duration: number): void {
    if (Number.isFinite(duration)) {
      this.mediaDuration.set(duration);
    }
    if (this.pendingSeek != null) {
      const t = this.pendingSeek;
      this.pendingSeek = null;
      this.seek(t, true);
    }
  }

  seek(seconds: number, play: boolean): void {
    const el = this.player()?.nativeElement;
    if (!el) {
      return;
    }
    el.currentTime = seconds;
    this.currentTime.set(seconds);
    this.following.set(true);
    if (play) {
      el.play().then(
        () => this.needsClick.set(false),
        () => this.needsClick.set(true), // autoplay policy; the user has to press play
      );
    }
  }

  /** Previous/next match relative to the playhead. */
  jump(direction: 1 | -1): void {
    const t = this.currentTime();
    const hits = this.hits();
    const target = direction > 0 ? hits.find((h) => h.startSec > t + 0.5) : [...hits].reverse().find((h) => h.startSec < t - 0.5);
    if (target) {
      this.seek(target.startSec, true);
    }
  }

  find(): void {
    const q = this.findText.trim();
    this.router.navigate([], { relativeTo: this.route, queryParams: { q: q || null }, queryParamsHandling: 'merge', replaceUrl: true });
  }

  /** The user took over scrolling: stop following (and stop any spring mid-flight). */
  handOver(): void {
    this.scroller?.stop();
    this.following.set(false);
  }

  /** Pressing on the panel's own scrollbar (not a line) is also taking over. */
  onPanelPointer(e: PointerEvent): void {
    if (e.target === this.panel()?.nativeElement) {
      this.handOver();
    }
  }

  onPanelKey(e: KeyboardEvent): void {
    if (SCROLL_KEYS.has(e.key) && e.target === this.panel()?.nativeElement) {
      this.handOver();
    }
  }

  resume(): void {
    this.following.set(true);
  }

  private scrollToLine(panel: HTMLElement, index: number): void {
    const li = panel.querySelector<HTMLElement>(`#seg-${index}`);
    if (!li) {
      return;
    }
    this.scroller ??= new SpringScroller(panel, 0.45);
    // Rest the current line about a third of the way down, where the eye already is.
    this.scroller.to(li.offsetTop - panel.clientHeight * 0.32);
  }
}
