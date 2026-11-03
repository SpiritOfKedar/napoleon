import { Component, computed, input } from '@angular/core';

/**
 * Thin-stroke line icons drawn on a 24-unit grid, matched to the system font's weight.
 * Decorative by default (aria-hidden); give the surrounding control an accessible name.
 */
const PATHS: Record<string, string> = {
  search: 'M10.5 17a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13ZM15.3 15.3 20 20',
  library: 'M4.5 9.5h15v9.5a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19V9.5ZM6.5 6.5h11M8.5 3.5h7',
  upload: 'M12 15.5V4.5M7.5 9 12 4.5 16.5 9M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15',
  play: 'M8 5.8v12.4a.8.8 0 0 0 1.2.7l10-6.2a.8.8 0 0 0 0-1.4l-10-6.2A.8.8 0 0 0 8 5.8Z',
  film: 'M5.5 4.5h13a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-11a2 2 0 0 1 2-2ZM7.5 4.5v15M16.5 4.5v15M3.5 9h4M3.5 15h4M16.5 9h4M16.5 15h4',
  waveform: 'M4 10.5v3M7.5 8v8M11 5v14M14.5 8.5v7M18 6.5v11M21 10.5v3',
  trash: 'M4.5 6.5h15M9.5 6.5V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1.5M6.5 6.5l.8 12.1a1.5 1.5 0 0 0 1.5 1.4h6.4a1.5 1.5 0 0 0 1.5-1.4l.8-12.1',
  redo: 'M19 12a7 7 0 1 1-2-4.9M19.5 4.5v3.5H16',
  back: 'M14.5 5.5 8 12l6.5 6.5',
  chevron: 'M9.5 5.5 16 12l-6.5 6.5',
  down: 'M6.5 9.5 12 15l5.5-5.5',
  prev: 'M6.5 5.5v13M18 6.2v11.6a.6.6 0 0 1-.95.5L9.5 12.5a.6.6 0 0 1 0-1l7.55-5.8a.6.6 0 0 1 .95.5Z',
  next: 'M17.5 5.5v13M6 6.2v11.6a.6.6 0 0 0 .95.5l7.55-5.8a.6.6 0 0 0 0-1L6.95 5.7A.6.6 0 0 0 6 6.2Z',
  plus: 'M12 5v14M5 12h14',
  check: 'M5.5 12.5 10 17l8.5-9.5',
  updown: 'M8.5 9.5 12 6l3.5 3.5M8.5 14.5 12 18l3.5-3.5',
  pause: 'M7.5 5.5h3v13h-3zM13.5 5.5h3v13h-3z',
  volume: 'M4.5 9.5h3l4.5-4v13l-4.5-4h-3zM15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11',
  mute: 'M4.5 9.5h3l4.5-4v13l-4.5-4h-3zM16 9.5l5 5M21 9.5l-5 5',
  fullscreen: 'M4.5 9V4.5H9M15 4.5h4.5V9M19.5 15v4.5H15M9 19.5H4.5V15',
  exitfullscreen: 'M9 4.5V9H4.5M19.5 9H15V4.5M15 19.5V15h4.5M4.5 15H9v4.5',
  current: 'M12 4.5v12M7 11.5l5 5 5-5M6 20h12',
};

const FILLED = new Set(['play', 'pause']);

@Component({
  selector: 'app-icon',
  template: `
    <svg viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" aria-hidden="true" focusable="false">
      <path [attr.d]="d()" [attr.fill]="filled() ? 'currentColor' : 'none'" [attr.stroke]="filled() ? 'none' : 'currentColor'"
        stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  `,
  styles: `:host { display: inline-flex; flex: none; line-height: 0; } svg { display: block; }`,
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input(18);
  readonly d = computed(() => PATHS[this.name()] ?? '');
  readonly filled = computed(() => FILLED.has(this.name()));
}
