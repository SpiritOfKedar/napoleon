import { Component, ElementRef, computed, input, output, signal, viewChild } from '@angular/core';
import { formatClock } from '../core/time';

export interface TimelineHit {
  startSec: number;
  /** The hit this timeline is "about" (e.g. a result's own moment); drawn in the accent colour. */
  active?: boolean;
  /** 0..1; reserved for weighting markers. */
  score?: number;
}

/** Arrow-key step when the scrubber has keyboard focus. */
const KEY_STEP_SEC = 5;

/**
 * A hairline spanning the recording's full length with a tick at each match, so you can see at a
 * glance where in a long recording things were said. Ticks are buttons that seek.
 *
 * With `scrubbable`, the track is also the playback scrubber: it captures the pointer and follows
 * it 1:1 from the moment of the press (the playhead moves before the media catches up), and it is
 * an accessible slider (←/→ 5 s, Home/End).
 */
@Component({
  selector: 'app-hit-timeline',
  template: `
    <div
      #track
      class="track"
      [class.tall]="tall()"
      [class.scrubbable]="scrubbable()"
      [class.dragging]="dragValue() != null"
      [attr.role]="scrubbable() ? 'slider' : 'group'"
      [attr.tabindex]="scrubbable() ? 0 : null"
      [attr.aria-label]="scrubbable() ? 'Playback position' : 'Matches across ' + fmt(duration())"
      [attr.aria-valuemin]="scrubbable() ? 0 : null"
      [attr.aria-valuemax]="scrubbable() ? round(duration()) : null"
      [attr.aria-valuenow]="scrubbable() ? round(position() ?? 0) : null"
      [attr.aria-valuetext]="scrubbable() ? fmt(position() ?? 0) + ' of ' + fmt(duration()) : null"
      (pointerdown)="onDown($event)"
      (pointermove)="onMove($event)"
      (pointerup)="onUp($event)"
      (pointercancel)="onUp($event)"
      (keydown)="onKey($event)"
    >
      <span class="rail" aria-hidden="true"></span>
      @if (position() != null) {
        <span class="played" aria-hidden="true" [style.transform]="'scaleX(' + pct(position()!) / 100 + ')'"></span>
        <span class="head" aria-hidden="true" [style.left.%]="pct(position()!)"></span>
      }
      @for (h of markers(); track $index) {
        <button
          type="button"
          class="marker"
          [class.active]="h.active"
          [style.left.%]="pct(h.startSec)"
          [attr.aria-label]="'Play from ' + fmt(h.startSec)"
          [title]="fmt(h.startSec)"
          (pointerdown)="$event.stopPropagation()"
          (click)="$event.preventDefault(); $event.stopPropagation(); seek.emit(h.startSec)"
        ></button>
      }
    </div>
    @if (showLabels()) {
      <div class="labels"><span>{{ fmt(position() ?? 0) }}</span><span>-{{ fmt(duration() - (position() ?? 0)) }}</span></div>
    }
  `,
  styles: `
    :host { display: block; }
    .track { position: relative; height: 0.75rem; touch-action: none; }
    .track.tall { height: 1.25rem; }
    .track.scrubbable { cursor: pointer; border-radius: 4px; }
    .rail, .played { position: absolute; left: 0; right: 0; top: 50%; height: 2px; margin-top: -1px; border-radius: 1px; }
    .rail { background: var(--fill-2); }
    .tall .rail, .tall .played { height: 4px; margin-top: -2px; border-radius: 2px; transition: height 150ms var(--ease), margin 150ms var(--ease); }
    .tall.scrubbable:hover .rail, .tall.scrubbable:hover .played, .dragging .rail, .dragging .played { height: 6px; margin-top: -3px; border-radius: 3px; }
    .played { background: var(--label-2); transform-origin: left; }
    .head {
      position: absolute; top: 50%; width: 0.75rem; height: 0.75rem; margin: -0.375rem 0 0 -0.375rem; border-radius: 50%;
      background: var(--label); box-shadow: 0 1px 3px rgba(0,0,0,.3); pointer-events: none; transition: transform 120ms ease-out;
    }
    .dragging .head { transform: scale(1.25); }
    .marker {
      all: unset; position: absolute; top: 50%; width: 2px; height: 0.625rem; margin: -0.3125rem 0 0 -1px; border-radius: 1px;
      background: var(--label-3); cursor: pointer; z-index: 1;
    }
    .marker::after { content: ''; position: absolute; inset: -0.5rem -0.375rem; } /* bigger hit area */
    .tall .marker { height: 1rem; margin-top: -0.5rem; background: var(--accent); opacity: .55; }
    .marker.active { background: var(--accent); opacity: 1; width: 3px; }
    .marker:hover, .marker:focus-visible { background: var(--accent); opacity: 1; box-shadow: none; }
    .labels { display: flex; justify-content: space-between; margin-top: 0.25rem; font-size: 0.75rem; color: var(--label-2); font-variant-numeric: tabular-nums; }
  `,
})
export class HitTimeline {
  private readonly track = viewChild.required<ElementRef<HTMLElement>>('track');

  readonly duration = input.required<number>();
  readonly hits = input<TimelineHit[]>([]);
  readonly playhead = input<number | null>(null);
  readonly tall = input(false);
  readonly showLabels = input(false);
  readonly scrubbable = input(false);
  /** A marker was chosen: jump there (and play). */
  readonly seek = output<number>();
  /** The user is scrubbing: continuous positions while dragging, then the final one. */
  readonly scrub = output<number>();

  /** Position under the pointer while dragging; shown instead of the media's own time. */
  readonly dragValue = signal<number | null>(null);
  readonly position = computed(() => this.dragValue() ?? this.playhead());

  readonly fmt = formatClock;
  readonly round = Math.round;
  readonly markers = computed(() => this.hits().filter((h) => h.startSec >= 0 && h.startSec <= this.duration() + 1));

  pct(sec: number): number {
    const d = this.duration();
    return d > 0 ? Math.min(100, Math.max(0, (100 * sec) / d)) : 0;
  }

  onDown(e: PointerEvent): void {
    if (!this.scrubbable() || e.button !== 0) {
      return;
    }
    const el = this.track().nativeElement;
    el.setPointerCapture?.(e.pointerId); // keep tracking even when the pointer leaves the bar
    this.dragTo(e); // respond on press, not on release
  }

  onMove(e: PointerEvent): void {
    if (this.dragValue() != null) {
      this.dragTo(e);
    }
  }

  onUp(e: PointerEvent): void {
    const v = this.dragValue();
    if (v == null) {
      return;
    }
    this.track().nativeElement.releasePointerCapture?.(e.pointerId);
    this.scrub.emit(v);
    this.dragValue.set(null);
  }

  onKey(e: KeyboardEvent): void {
    if (!this.scrubbable()) {
      return;
    }
    const now = this.position() ?? 0;
    const target =
      e.key === 'ArrowRight' || e.key === 'ArrowUp' ? now + KEY_STEP_SEC
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? now - KEY_STEP_SEC
      : e.key === 'Home' ? 0
      : e.key === 'End' ? this.duration()
      : null;
    if (target != null) {
      e.preventDefault();
      e.stopPropagation();
      this.scrub.emit(Math.min(this.duration(), Math.max(0, target)));
    }
  }

  private dragTo(e: PointerEvent): void {
    const rect = this.track().nativeElement.getBoundingClientRect();
    const ratio = rect.width > 0 ? Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)) : 0;
    const t = ratio * this.duration();
    this.dragValue.set(t);
    this.scrub.emit(t);
  }
}
