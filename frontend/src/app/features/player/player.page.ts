import {
  Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { forkJoin, map, switchMap } from 'rxjs';
import { ApiService, errorMessage } from '../../core/api.service';
import { MediaFile, TranscriptSegment } from '../../core/models';
import { formatTimestamp, parseSeconds } from '../../core/time';
import { StatusBadge } from '../../shared/status-badge';

@Component({
  selector: 'app-player-page',
  imports: [RouterLink, MatButtonModule, MatIconModule, StatusBadge],
  template: `
    <a mat-button routerLink="/search"><mat-icon>arrow_back</mat-icon>Back to search</a>
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    @if (media(); as m) {
      <div class="title">
        <h1>{{ m.filename }}</h1>
        <app-status-badge [status]="m.status" [progress]="m.progressPct" />
      </div>

      <!-- One <video> element plays audio files too; it just collapses to the controls bar. -->
      <video
        #player
        [class.audio]="!isVideo()"
        [src]="streamUrl()"
        controls
        preload="metadata"
        (loadedmetadata)="onLoaded()"
        (timeupdate)="currentTime.set(player.currentTime)"
        (seeked)="currentTime.set(player.currentTime)"
      ></video>
      @if (needsClick()) {
        <p class="muted">Your browser blocked autoplay. Press play to start at {{ fmt(currentTime()) }}.</p>
      }

      <h2>Transcript</h2>
      @if (segments().length === 0) {
        <p class="muted">No transcript yet.</p>
      }
      <ol class="transcript">
        @for (s of segments(); track $index) {
          <li [id]="'seg-' + $index" [class.active]="$index === activeIndex()">
            <button class="seg" type="button" (click)="seek(s.startSec, true)">
              <span class="ts">{{ fmt(s.startSec) }}</span>
              <span>{{ s.text }}</span>
            </button>
          </li>
        }
      </ol>
    }
  `,
  styles: `
    .title { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .title h1 { overflow-wrap: anywhere; margin: 8px 0; }
    video { width: 100%; max-height: 60vh; background: #000; border-radius: 12px; }
    video.audio { height: 54px; background: transparent; }
    .transcript { list-style: none; padding: 0; display: grid; gap: 2px; }
    .seg {
      all: unset; box-sizing: border-box; width: 100%; display: flex; gap: 12px; cursor: pointer;
      padding: 8px 12px; border-radius: 8px; line-height: 1.5;
    }
    .seg:hover, .seg:focus-visible { background: var(--mat-sys-surface-container); }
    .active .seg { background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
    .ts { font-family: ui-monospace, monospace; color: var(--mat-sys-primary); flex: none; }
    .active .ts { color: inherit; }
    .muted { color: var(--mat-sys-on-surface-variant); }
    .error { color: var(--mat-sys-error); }
  `,
})
export class PlayerPage {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly player = viewChild<ElementRef<HTMLVideoElement>>('player');

  readonly media = signal<MediaFile | null>(null);
  readonly segments = signal<TranscriptSegment[]>([]);
  readonly error = signal<string | null>(null);
  readonly currentTime = signal(0);
  readonly needsClick = signal(false);
  readonly fmt = formatTimestamp;

  readonly isVideo = computed(() => this.media()?.contentType?.startsWith('video/') ?? false);
  readonly streamUrl = computed(() => {
    const m = this.media();
    return m ? this.api.streamUrl(m.id) : '';
  });

  /** Index of the last segment that has started; -1 before the first one. */
  readonly activeIndex = computed(() => {
    const t = this.currentTime();
    const segs = this.segments();
    let active = -1;
    for (let i = 0; i < segs.length && segs[i].startSec <= t + 0.05; i++) {
      active = i;
    }
    return active;
  });

  /** Seek target from ?t= that arrived before the media's metadata was loaded. */
  private pendingSeek: number | null = null;

  constructor() {
    const destroyRef = inject(DestroyRef);

    this.route.paramMap
      .pipe(
        map((p) => Number(p.get('id'))),
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

    // Re-clicking a different search result for the same file only changes ?t=.
    this.route.queryParamMap.pipe(takeUntilDestroyed(destroyRef)).subscribe((p) => {
      const t = parseSeconds(p.get('t'));
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

    // Keep the active transcript line visible while playing.
    effect(() => {
      const i = this.activeIndex();
      if (i < 0) {
        return;
      }
      const li = (this.host.nativeElement as HTMLElement).querySelector(`#seg-${i}`);
      li?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' });
    });
  }

  onLoaded(): void {
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
    if (play) {
      el.play().then(
        () => this.needsClick.set(false),
        () => this.needsClick.set(true), // autoplay policy; the user has to press play
      );
    }
  }
}
