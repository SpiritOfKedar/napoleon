import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { MediaStore } from './core/media-store';
import { formatDuration } from './core/time';
import { ConfirmDialog } from './shared/confirm-dialog';
import { Icon } from './shared/icon';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, ConfirmDialog],
  template: `
    <div class="shell">
      <aside class="sidebar">
        <a routerLink="/search" class="brand">Napoleon</a>
        <nav aria-label="Main">
          <a routerLink="/search" routerLinkActive="active"><app-icon name="search" /><span>Search</span></a>
          <a routerLink="/library" routerLinkActive="active"><app-icon name="library" /><span>Library</span></a>
          <a routerLink="/upload" routerLinkActive="active"><app-icon name="upload" /><span>Upload</span></a>
        </nav>

        @if (store.indexed().length) {
          <section class="recordings" aria-labelledby="rec-h">
            <h2 id="rec-h" class="section">Recordings</h2>
            <ul>
              @for (m of store.indexed(); track m.id) {
                <li>
                  <a [routerLink]="['/player', m.id]" routerLinkActive="active" [title]="m.filename">
                    <app-icon [name]="m.contentType?.startsWith('video/') ? 'film' : 'waveform'" [size]="16" />
                    <span class="name">{{ m.filename }}</span>
                    <span class="dur">{{ dur(m.durationSec) }}</span>
                  </a>
                </li>
              }
            </ul>
          </section>
        }
      </aside>
      <main class="main">
        <router-outlet />
      </main>
    </div>
    <app-confirm-dialog />
  `,
  styles: `
    .shell { display: grid; grid-template-columns: 15rem minmax(0, 1fr); min-height: 100vh; }
    .sidebar {
      position: sticky; top: 0; height: 100vh; overflow-y: auto;
      padding: 1.25rem 0.75rem; display: flex; flex-direction: column; gap: 1.25rem;
      background: var(--material-heavy);
      backdrop-filter: blur(30px) saturate(180%); -webkit-backdrop-filter: blur(30px) saturate(180%);
      box-shadow: inset -1px 0 0 var(--separator);
    }
    .brand {
      padding: 0 0.625rem; color: var(--label); font-family: var(--font-display);
      font-size: 1.0625rem; font-weight: 700; letter-spacing: -0.02em;
    }
    nav, ul { display: flex; flex-direction: column; gap: 1px; }
    ul { list-style: none; margin: 0; padding: 0; }
    nav a, li a {
      display: flex; align-items: center; gap: 0.625rem; height: 2rem; padding: 0 0.625rem; border-radius: 8px;
      color: var(--label); font-size: 0.875rem; letter-spacing: -0.006em;
      transition: background-color 120ms ease-out;
    }
    nav a app-icon, li a app-icon { color: var(--accent); }
    nav a:hover, li a:hover { background: var(--fill); }
    nav a:active, li a:active { background: var(--fill-2); }
    nav a.active, li a.active { background: var(--fill-2); font-weight: 600; }
    .section { margin: 0 0 0.25rem; padding: 0 0.625rem; font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.02em; color: var(--label-2); }
    .name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .dur { font-size: 0.75rem; color: var(--label-2); font-variant-numeric: tabular-nums; }
    .main { min-width: 0; }

    @media (max-width: 760px) {
      .shell { grid-template-columns: 1fr; }
      .sidebar {
        position: sticky; z-index: 10; height: auto; flex-direction: row; align-items: center; justify-content: space-between;
        padding: 0.5rem 1rem; gap: 0.5rem; box-shadow: inset 0 -1px 0 var(--separator);
      }
      nav { flex-direction: row; }
      nav a span { display: none; }
      .recordings { display: none; }
    }
  `,
})
export class App {
  readonly store = inject(MediaStore);
  readonly dur = formatDuration;

  constructor() {
    this.store.refresh();
  }
}
