import { Component, ElementRef, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { ConfirmRequest, ConfirmService } from '../core/confirm.service';
import { reducedMotion } from '../core/spring';

/** How long the exit takes; matches the CSS transition below. */
const EXIT_MS = 200;

/**
 * The app's alert. Built on <dialog showModal()>, which gives focus trapping, an inert background
 * and Esc for free; the look and motion are ours. It dims the page because a destructive
 * question is a modal task. Cancel has initial focus so a reflexive Enter can't destroy anything.
 */
@Component({
  selector: 'app-confirm-dialog',
  template: `
    <dialog
      #dlg
      class="alert"
      [class.shown]="shown()"
      aria-labelledby="alert-title"
      [attr.aria-describedby]="view()?.message ? 'alert-msg' : null"
      (cancel)="$event.preventDefault(); answer(false)"
    >
      @if (view(); as v) {
        <h2 id="alert-title" class="title">{{ v.title }}</h2>
        @if (v.message) {
          <p id="alert-msg" class="msg">{{ v.message }}</p>
        }
        <div class="buttons">
          <button #cancelBtn type="button" class="btn" (click)="answer(false)">{{ v.cancelLabel ?? 'Cancel' }}</button>
          <button #okBtn type="button" class="btn" [class.destructive]="v.destructive" [class.primary]="!v.destructive" (click)="answer(true)">
            {{ v.confirmLabel }}
          </button>
        </div>
      }
    </dialog>
  `,
  styles: `
    .alert {
      width: min(19rem, calc(100vw - 2rem)); padding: 1.25rem 1.25rem 1rem; border: 0; border-radius: 14px;
      color: var(--label); background: var(--material-heavy);
      backdrop-filter: blur(30px) saturate(180%); -webkit-backdrop-filter: blur(30px) saturate(180%);
      box-shadow: 0 0 0 0.5px var(--separator), 0 24px 60px rgba(0, 0, 0, 0.28);
      text-align: center;
      /* Materialize: scale, blur and opacity arrive together, and leave along the same path. */
      opacity: 0; transform: scale(1.04); filter: blur(6px);
      transition: opacity 200ms var(--ease), transform 280ms var(--ease), filter 200ms var(--ease);
    }
    .alert.shown { opacity: 1; transform: none; filter: none; }
    .alert::backdrop { background: rgba(0, 0, 0, 0); transition: background-color 200ms ease-out; }
    .alert.shown::backdrop { background: rgba(0, 0, 0, 0.32); }
    .title { margin: 0; font-family: var(--font-display); font-size: 1.0625rem; line-height: 1.3; font-weight: 600; letter-spacing: -0.012em; }
    .msg { margin: 0.375rem 0 0; font-size: 0.8125rem; line-height: 1.4; color: var(--label-2); }
    .buttons { display: grid; grid-template-columns: 1fr 1fr; gap: 0.5rem; margin-top: 1.125rem; }
    .buttons .btn { height: 2.25rem; border-radius: 9px; font-weight: 500; }
    .buttons .btn.destructive { background: var(--red); color: #fff; }
    .buttons .btn.destructive:hover { background: color-mix(in srgb, var(--red) 88%, #000); }
    @media (prefers-reduced-transparency: reduce) { .alert { background: var(--surface); backdrop-filter: none; -webkit-backdrop-filter: none; } }
  `,
})
export class ConfirmDialog {
  private readonly service = inject(ConfirmService);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');
  private readonly cancelBtn = viewChild<ElementRef<HTMLButtonElement>>('cancelBtn');
  private readonly okBtn = viewChild<ElementRef<HTMLButtonElement>>('okBtn');
  private closeTimer: ReturnType<typeof setTimeout> | null = null;

  /** What is on screen; kept through the exit animation after the request is answered. */
  readonly view = signal<ConfirmRequest | null>(null);
  readonly shown = signal(false);

  constructor() {
    effect(() => {
      const req = this.service.request();
      if (req) {
        untracked(() => this.open(req));
      }
    });
  }

  answer(confirmed: boolean): void {
    if (!this.shown()) {
      return;
    }
    this.shown.set(false);
    this.service.settle(confirmed);
    const el = this.dlg().nativeElement;
    this.closeTimer = setTimeout(() => {
      el.open && el.close?.();
      el.removeAttribute('open');
      this.view.set(null);
    }, reducedMotion() ? 0 : EXIT_MS);
  }

  private open(req: ConfirmRequest): void {
    if (this.closeTimer) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
    this.view.set(req);
    const el = this.dlg().nativeElement;
    if (!el.open) {
      if (typeof el.showModal === 'function') {
        el.showModal();
      } else {
        el.setAttribute('open', '');
      }
    }
    // Next frame: the dialog is laid out in its start state, so the transition runs.
    requestAnimationFrame(() => {
      this.shown.set(true);
      const focus = req.destructive ? this.cancelBtn() : this.okBtn();
      focus?.nativeElement.focus();
    });
  }
}
