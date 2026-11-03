import { Component, computed, input } from '@angular/core';
import { MediaStatus } from '../core/models';

@Component({
  selector: 'app-status-badge',
  template: `<span class="badge" [class]="'badge ' + cls()">{{ label() }}</span>`,
  styles: `
    .badge {
      display: inline-block; padding: 2px 10px; border-radius: 999px;
      font-size: 12px; font-weight: 600; letter-spacing: .03em; white-space: nowrap;
    }
    .uploaded { background: var(--mat-sys-surface-container-highest); color: var(--mat-sys-on-surface); }
    .transcribing { background: var(--mat-sys-tertiary-container); color: var(--mat-sys-on-tertiary-container); }
    .indexed { background: var(--mat-sys-primary-container); color: var(--mat-sys-on-primary-container); }
    .failed { background: var(--mat-sys-error-container); color: var(--mat-sys-on-error-container); }
  `,
})
export class StatusBadge {
  readonly status = input.required<MediaStatus>();
  /** Transcription progress, 0..100; shown while TRANSCRIBING when known. */
  readonly progress = input<number | null | undefined>(null);
  readonly cls = computed(() => this.status().toLowerCase());
  readonly label = computed(() => {
    switch (this.status()) {
      case 'UPLOADED': return 'Queued';
      case 'TRANSCRIBING': {
        const p = this.progress();
        return p != null && p > 0 ? `Transcribing… ${Math.floor(p)}%` : 'Transcribing…';
      }
      case 'INDEXED': return 'Indexed';
      case 'FAILED': return 'Failed';
    }
  });
}
