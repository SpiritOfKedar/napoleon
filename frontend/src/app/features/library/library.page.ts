import { DatePipe } from '@angular/common';
import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import { Subject, catchError, of, startWith, switchMap, takeWhile, timer } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ApiService, errorMessage } from '../../core/api.service';
import { MediaFile, isProcessing } from '../../core/models';
import { formatTimestamp } from '../../core/time';
import { StatusBadge } from '../../shared/status-badge';

@Component({
  selector: 'app-library-page',
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, StatusBadge],
  template: `
    <div class="head">
      <h1>Library</h1>
      <button mat-stroked-button (click)="refresh$.next()"><mat-icon>refresh</mat-icon>Refresh</button>
    </div>
    @if (polling()) {
      <mat-progress-bar mode="indeterminate" aria-label="Refreshing while files are processing" />
    }
    @if (error()) {
      <p class="error">{{ error() }}</p>
    }
    @if (loaded() && items().length === 0) {
      <p class="empty">Nothing here yet. <a routerLink="/upload">Upload a recording</a> to get started.</p>
    }
    <ul class="list">
      @for (m of items(); track m.id) {
        <li>
          <div class="main">
            <span class="name">{{ m.filename }}</span>
            <span class="meta">
              {{ m.durationSec != null ? fmt(m.durationSec) : '—' }} · {{ m.createdAt | date: 'medium' }}
            </span>
            @if (m.errorMessage) {
              <span class="error small">{{ m.errorMessage }}</span>
            }
          </div>
          <app-status-badge [status]="m.status" [progress]="m.progressPct" />
          <div class="actions">
            <a mat-button [routerLink]="['/player', m.id]" [disabled]="m.status !== 'INDEXED'">
              <mat-icon>play_arrow</mat-icon>Play
            </a>
            <a mat-button [routerLink]="['/search']" [queryParams]="{ mediaId: m.id }" [disabled]="m.status !== 'INDEXED'">
              <mat-icon>search</mat-icon>Search in
            </a>
          </div>
        </li>
      }
    </ul>
  `,
  styles: `
    .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .list { list-style: none; padding: 0; display: grid; gap: 8px; }
    .list li {
      display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
      padding: 12px 16px; border-radius: 12px; background: var(--mat-sys-surface-container-low);
    }
    .main { flex: 1; min-width: 200px; display: flex; flex-direction: column; gap: 2px; }
    .name { font-weight: 500; overflow-wrap: anywhere; }
    .meta, .empty { color: var(--mat-sys-on-surface-variant); font-size: 13px; }
    .actions { display: flex; gap: 4px; }
    .error { color: var(--mat-sys-error); }
    .small { font-size: 13px; }
  `,
})
export class LibraryPage {
  private readonly api = inject(ApiService);

  readonly items = signal<MediaFile[]>([]);
  readonly loaded = signal(false);
  readonly polling = signal(false);
  readonly error = signal<string | null>(null);
  readonly refresh$ = new Subject<void>();
  readonly fmt = formatTimestamp;

  constructor() {
    // Each refresh starts a poll that keeps going only while something is still processing.
    this.refresh$
      .pipe(
        startWith(undefined),
        switchMap(() =>
          timer(0, environment.pollIntervalMs).pipe(
            switchMap(() =>
              this.api.listMedia().pipe(
                catchError((err) => {
                  this.error.set(errorMessage(err));
                  return of(null);
                }),
              ),
            ),
            takeWhile((list) => list === null || list.some((m) => isProcessing(m.status)), true),
          ),
        ),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe((list) => {
        if (list) {
          this.error.set(null);
          this.items.set(list);
          this.polling.set(list.some((m) => isProcessing(m.status)));
        }
        this.loaded.set(true);
      });
  }
}
