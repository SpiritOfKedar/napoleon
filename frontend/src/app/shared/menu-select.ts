import { Component, ElementRef, HostListener, computed, inject, input, model, signal, viewChild } from '@angular/core';
import { Icon } from './icon';

export type MenuValue = string | number | null;

export interface MenuOption {
  value: MenuValue;
  label: string;
  /** Secondary text on the right, e.g. a duration. */
  detail?: string;
}

let nextId = 0;

/**
 * A pop-up button: our replacement for the native <select>, whose menu is drawn by the OS and
 * ignores the app's design. The menu grows out of its trigger (origin anchored at the button),
 * marks the current choice with a checkmark, and works fully from the keyboard:
 * ↑/↓ move, Home/End jump, Enter/Space choose, Esc/Tab close, typing jumps to a matching item.
 */
@Component({
  selector: 'app-menu-select',
  imports: [Icon],
  template: `
    <button
      #trigger
      type="button"
      class="trigger"
      aria-haspopup="listbox"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="id + '-list'"
      [attr.aria-label]="ariaLabel() + ': ' + currentLabel()"
      (click)="toggle()"
      (keydown)="onTriggerKey($event)"
    >
      <span class="current">{{ currentLabel() }}</span>
      <app-icon name="updown" [size]="14" />
    </button>
    <ul
      #list
      class="menu"
      [class.shown]="open()"
      [class.above]="placement() === 'above'"
      role="listbox"
      tabindex="-1"
      [id]="id + '-list'"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-activedescendant]="open() && active() >= 0 ? id + '-' + active() : null"
      [attr.inert]="open() ? null : ''"
      (keydown)="onListKey($event)"
    >
      @for (o of options(); track $index) {
        <li
          role="option"
          [id]="id + '-' + $index"
          [attr.aria-selected]="o.value === value()"
          [class.active]="$index === active()"
          (pointermove)="active.set($index)"
          (click)="choose($index)"
        >
          <app-icon class="check" name="check" [size]="14" [style.visibility]="o.value === value() ? 'visible' : 'hidden'" />
          <span class="label">{{ o.label }}</span>
          @if (o.detail) {
            <span class="detail">{{ o.detail }}</span>
          }
        </li>
      }
    </ul>
  `,
  styles: `
    :host { position: relative; display: inline-flex; }
    .trigger {
      all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: 0.5rem;
      height: 2.25rem; max-width: 14rem; padding: 0 0.625rem 0 0.75rem; border-radius: 10px; cursor: pointer;
      background: var(--fill); color: var(--label); font: 400 0.875rem var(--font);
      transition: background-color 120ms ease-out, transform 100ms ease-out;
    }
    .trigger:hover { background: var(--fill-2); }
    .trigger:active { transform: scale(0.98); }
    .trigger[aria-expanded='true'] { background: var(--fill-2); }
    .trigger:focus-visible { box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 45%, transparent); }
    .trigger app-icon { color: var(--label-2); }
    .current { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    .menu {
      position: absolute; top: calc(100% + 0.375rem); right: 0; z-index: 30;
      /* Size to the longest option (not the button), within limits; longer names ellipsize. */
      width: max-content; min-width: 100%; max-width: min(24rem, 90vw); max-height: 18rem; overflow-y: auto;
      margin: 0; padding: 0.3125rem; list-style: none; outline: none; border-radius: 12px;
      background: var(--material-heavy);
      backdrop-filter: blur(30px) saturate(180%); -webkit-backdrop-filter: blur(30px) saturate(180%);
      box-shadow: 0 0 0 0.5px var(--separator), 0 12px 32px rgba(0, 0, 0, 0.22);
      /* Grows from the trigger's corner, and returns the same way. */
      transform-origin: top right;
      opacity: 0; transform: scale(0.96) translateY(-4px); filter: blur(4px); visibility: hidden;
      transition: opacity 160ms var(--ease), transform 220ms var(--ease), filter 160ms var(--ease), visibility 0s linear 220ms;
    }
    .menu.above { top: auto; bottom: calc(100% + 0.375rem); transform-origin: bottom right; transform: scale(0.96) translateY(4px); }
    .menu.shown { opacity: 1; transform: none; filter: none; visibility: visible; transition-delay: 0s; }
    li {
      display: grid; grid-template-columns: 1rem minmax(0, 1fr) auto; gap: 0.5rem; align-items: center;
      height: 2rem; padding: 0 0.625rem 0 0.5rem; border-radius: 7px; cursor: default;
      font-size: 0.875rem; color: var(--label); white-space: nowrap;
    }
    li.active { background: var(--accent); color: #fff; }
    li.active .detail, li.active .check { color: #fff; }
    .check { color: var(--accent); }
    .label { overflow: hidden; text-overflow: ellipsis; }
    .detail { font-size: 0.8125rem; color: var(--label-2); font-variant-numeric: tabular-nums; padding-left: 1rem; }
    @media (prefers-reduced-transparency: reduce) { .menu { background: var(--surface); backdrop-filter: none; -webkit-backdrop-filter: none; } }
  `,
})
export class MenuSelect {
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly list = viewChild.required<ElementRef<HTMLUListElement>>('list');
  private typed = '';
  private typedAt = 0;

  readonly options = input.required<MenuOption[]>();
  readonly value = model<MenuValue>(null);
  readonly ariaLabel = input('Choose');
  /** Open below the button (default) or above it, e.g. at the bottom of a fullscreen player. */
  readonly placement = input<'below' | 'above'>('below');

  readonly id = `menu-${nextId++}`;
  readonly open = signal(false);
  readonly active = signal(-1);
  readonly selectedIndex = computed(() => this.options().findIndex((o) => o.value === this.value()));
  readonly currentLabel = computed(() => this.options()[this.selectedIndex()]?.label ?? this.options()[0]?.label ?? '');

  toggle(): void {
    if (this.open()) {
      this.close(true);
    } else {
      this.show();
    }
  }

  show(index = this.selectedIndex()): void {
    this.active.set(Math.max(0, index));
    this.open.set(true);
    // Focus moves into the list right away; inert is lifted first (the template does the same on render).
    const list = this.list().nativeElement;
    list.removeAttribute('inert');
    list.focus();
    queueMicrotask(() => this.scrollActiveIntoView());
  }

  close(refocus: boolean): void {
    if (!this.open()) {
      return;
    }
    this.open.set(false);
    if (refocus) {
      this.trigger().nativeElement.focus();
    }
  }

  choose(index: number): void {
    const option = this.options()[index];
    if (option) {
      this.value.set(option.value);
    }
    this.close(true);
  }

  onTriggerKey(e: KeyboardEvent): void {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      this.show();
    }
  }

  onListKey(e: KeyboardEvent): void {
    const n = this.options().length;
    switch (e.key) {
      case 'ArrowDown':
        this.move(Math.min(n - 1, this.active() + 1), e);
        break;
      case 'ArrowUp':
        this.move(Math.max(0, this.active() - 1), e);
        break;
      case 'Home':
        this.move(0, e);
        break;
      case 'End':
        this.move(n - 1, e);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        this.choose(this.active());
        break;
      case 'Escape':
        e.preventDefault();
        this.close(true);
        break;
      case 'Tab':
        this.close(false);
        break;
      default:
        if (e.key.length === 1) {
          this.typeahead(e.key);
        }
    }
  }

  /** Clicking anywhere else closes the menu without choosing. */
  @HostListener('document:pointerdown', ['$event'])
  onDocumentPointer(e: PointerEvent): void {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) {
      this.close(false);
    }
  }

  private move(index: number, e: KeyboardEvent): void {
    e.preventDefault();
    this.active.set(index);
    this.scrollActiveIntoView();
  }

  private typeahead(ch: string): void {
    const now = Date.now();
    this.typed = now - this.typedAt > 700 ? ch.toLowerCase() : this.typed + ch.toLowerCase();
    this.typedAt = now;
    const i = this.options().findIndex((o) => o.label.toLowerCase().startsWith(this.typed));
    if (i >= 0) {
      this.active.set(i);
      this.scrollActiveIntoView();
    }
  }

  private scrollActiveIntoView(): void {
    const li = this.list().nativeElement.querySelector<HTMLElement>(`#${this.id}-${this.active()}`);
    li?.scrollIntoView?.({ block: 'nearest' });
  }
}
