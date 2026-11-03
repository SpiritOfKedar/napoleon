import { Component, computed, input, output } from '@angular/core';
import { formatClock } from '../core/time';

export interface TimelineHit {
  startSec: number;
  /** The hit this timeline is "about" (e.g. a result's own moment); drawn in the accent colour. */
  active?: boolean;
  /** 0..1; reserved for weighting markers. */
  score?: number;
}

/**
 * A hairline spanning the recording's full length with a tick at each match, so you can see at a
 * glance where in a long recording things were said. Ticks are buttons that seek.
 */
@Component({
  selector: 'app-hit-timeline',
  template: `
    <div class="track" [class.tall]="tall()" role="group" [attr.aria-label]="'Matches across ' + fmt(duration())">
      <span class="rail" aria-hidden="true"></span>
      @if (playhead() != null) {
        <span class="played" aria-hidden="true" [style.transform]="'scaleX(' + pct(playhead()!) / 100 + ')'"></span>
        <span class="head" aria-hidden="true" [style.left.%]="pct(playhead()!)"></span>
      }
      @for (h of markers(); track $index) {
        <button
          type="button"
          class="marker"
          [class.active]="h.active"
          [style.left.%]="pct(h.startSec)"
          [attr.aria-label]="'Play from ' + fmt(h.startSec)"
          [title]="fmt(h.startSec)"
          (click)="$event.preventDefault(); $event.stopPropagation(); seek.emit(h.startSec)"
        ></button>
      }
    </div>
    @if (showLabels()) {
      <div class="labels"><span>{{ fmt(playhead() ?? 0) }}</span><span>-{{ fmt(duration() - (playhead() ?? 0)) }}</span></div>
    }
  `,
  styles: `
    :host { display: block; }
    .track { position: relative; height: 0.75rem; }
    .track.tall { height: 1.25rem; }
    .rail, .played { position: absolute; left: 0; right: 0; top: 50%; height: 2px; margin-top: -1px; border-radius: 1px; }
    .rail { background: var(--fill-2); }
    .tall .rail, .tall .played { height: 4px; margin-top: -2px; border-radius: 2px; }
    .played { background: var(--label-2); transform-origin: left; }
    .head { position: absolute; top: 50%; width: 0.75rem; height: 0.75rem; margin: -0.375rem 0 0 -0.375rem; border-radius: 50%; background: var(--label); box-shadow: 0 1px 3px rgba(0,0,0,.3); pointer-events: none; }
    .marker {
      all: unset; position: absolute; top: 50%; width: 2px; height: 0.625rem; margin: -0.3125rem 0 0 -1px; border-radius: 1px;
      background: var(--label-3); cursor: pointer;
    }
    .marker::after { content: ''; position: absolute; inset: -0.5rem -0.375rem; } /* bigger hit area */
    .tall .marker { height: 1rem; margin-top: -0.5rem; background: var(--accent); opacity: .55; }
    .marker.active { background: var(--accent); opacity: 1; width: 3px; }
    .marker:hover, .marker:focus-visible { background: var(--accent); opacity: 1; box-shadow: none; }
    .labels { display: flex; justify-content: space-between; margin-top: 0.25rem; font-size: 0.75rem; color: var(--label-2); font-variant-numeric: tabular-nums; }
  `,
})
export class HitTimeline {
  readonly duration = input.required<number>();
  readonly hits = input<TimelineHit[]>([]);
  readonly playhead = input<number | null>(null);
  readonly tall = input(false);
  readonly showLabels = input(false);
  readonly seek = output<number>();

  readonly fmt = formatClock;
  readonly markers = computed(() => this.hits().filter((h) => h.startSec >= 0 && h.startSec <= this.duration() + 1));

  pct(sec: number): number {
    const d = this.duration();
    return d > 0 ? Math.min(100, Math.max(0, (100 * sec) / d)) : 0;
  }
}
