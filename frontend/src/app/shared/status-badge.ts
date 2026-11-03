import { Component, computed, input } from '@angular/core';
import { MediaStatus } from '../core/models';
import { formatEta } from '../core/time';

/** Status as a small coloured dot and plain text; a hairline bar and time remaining while working. */
@Component({
  selector: 'app-status-badge',
  template: `
    <span class="badge" [class]="'badge ' + cls()">
      <span class="dot" aria-hidden="true"></span>
      <span class="label">{{ label() }}</span>
      @if (showBar()) {
        <span class="track" aria-hidden="true"><span class="fill" [style.transform]="'scaleX(' + (progress() ?? 0) / 100 + ')'"></span></span>
      }
    </span>
    @if (eta(); as e) {
      <span class="eta">{{ e }}</span>
    }
  `,
  styles: `
    :host { display: inline-flex; flex-direction: column; gap: 0.25rem; min-width: 0; }
    .badge { position: relative; display: inline-flex; align-items: center; gap: 0.4375rem; font-size: 0.8125rem; color: var(--label-2); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .dot { width: 0.4375rem; height: 0.4375rem; border-radius: 50%; background: var(--label-3); flex: none; }
    .indexed .dot { background: var(--green); }
    .transcribing .dot { background: var(--accent); }
    .failed .dot { background: var(--red); }
    .failed { color: var(--red); }
    .transcribing { color: var(--label); }
    .track { position: absolute; left: 0; right: 0; bottom: -0.375rem; height: 2px; border-radius: 1px; background: var(--fill-2); overflow: hidden; }
    .fill { display: block; height: 100%; background: var(--accent); transform-origin: left; transition: transform 600ms var(--ease); }
    .eta { margin-top: 0.375rem; font-size: 0.75rem; color: var(--label-2); }
  `,
})
export class StatusBadge {
  readonly status = input.required<MediaStatus>();
  /** Transcription progress, 0..100; shown while TRANSCRIBING when known. */
  readonly progress = input<number | null | undefined>(null);
  /** ISO time the current transcription started; enables the time-remaining estimate. */
  readonly startedAt = input<string | null | undefined>(null);

  readonly cls = computed(() => this.status().toLowerCase());
  readonly showBar = computed(() => this.status() === 'TRANSCRIBING' && (this.progress() ?? 0) > 0);
  readonly label = computed(() => {
    switch (this.status()) {
      case 'UPLOADED': return 'Queued';
      case 'TRANSCRIBING': {
        const p = this.progress();
        return p != null && p > 0 ? `Transcribing… ${Math.floor(p)}%` : 'Transcribing…';
      }
      case 'INDEXED': return 'Ready';
      case 'FAILED': return 'Failed';
    }
  });

  /** Extrapolates from progress so far: elapsed × remaining / done. Needs a few % to be stable. */
  readonly eta = computed(() => {
    const p = this.progress();
    const started = this.startedAt();
    if (this.status() !== 'TRANSCRIBING' || p == null || p < 2 || p >= 100 || !started) {
      return null;
    }
    const elapsedSec = (Date.now() - Date.parse(started)) / 1000;
    if (!Number.isFinite(elapsedSec) || elapsedSec <= 0) {
      return null;
    }
    return formatEta((elapsedSec * (100 - p)) / p);
  });
}
