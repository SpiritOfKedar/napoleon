import { Component } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, MatToolbarModule, MatButtonModule, MatIconModule],
  template: `
    <mat-toolbar class="toolbar">
      <a routerLink="/search" class="brand">Napoleon</a>
      <nav>
        <a mat-button routerLink="/search" routerLinkActive="active"><mat-icon>search</mat-icon>Search</a>
        <a mat-button routerLink="/library" routerLinkActive="active"><mat-icon>video_library</mat-icon>Library</a>
        <a mat-button routerLink="/upload" routerLinkActive="active"><mat-icon>upload</mat-icon>Upload</a>
      </nav>
    </mat-toolbar>
    <main class="content">
      <router-outlet />
    </main>
  `,
  styles: `
    .toolbar { position: sticky; top: 0; z-index: 10; gap: 16px; flex-wrap: wrap; height: auto; min-height: 64px; }
    .brand { color: inherit; text-decoration: none; font-weight: 600; letter-spacing: .02em; }
    nav { display: flex; gap: 4px; flex-wrap: wrap; }
    nav a.active { background: var(--mat-sys-secondary-container); color: var(--mat-sys-on-secondary-container); }
    .content { max-width: 1000px; margin: 0 auto; padding: 24px 16px 64px; }
  `,
})
export class App {}
