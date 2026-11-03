import { Injectable, signal } from '@angular/core';

export interface ConfirmOptions {
  title: string;
  message?: string;
  /** Name the action ("Delete"), never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive actions get the red button and keep Cancel as the default focus. */
  destructive?: boolean;
}

export interface ConfirmRequest extends ConfirmOptions {
  resolve: (confirmed: boolean) => void;
}

/**
 * Our own confirmation alert, replacing window.confirm(). Use it sparingly: only before
 * destructive or hard-to-undo actions, so people don't learn to click through it.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly request = signal<ConfirmRequest | null>(null);

  confirm(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.request()?.resolve(false); // a newer question replaces an unanswered one
      this.request.set({ ...options, resolve });
    });
  }

  settle(confirmed: boolean): void {
    const r = this.request();
    this.request.set(null);
    r?.resolve(confirmed);
  }
}
