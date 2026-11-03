import { TestBed } from '@angular/core/testing';
import { MenuSelect, MenuValue } from './menu-select';

describe('MenuSelect', () => {
  function setup() {
    const fixture = TestBed.createComponent(MenuSelect);
    fixture.componentRef.setInput('options', [
      { value: null, label: 'All Recordings' },
      { value: 6, label: 'Sam-Altman.mp4', detail: '1h 08m' },
      { value: 8, label: 'sample-meeting.wav', detail: '1m 24s' },
    ]);
    fixture.componentRef.setInput('ariaLabel', 'Search in');
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const chosen: MenuValue[] = [];
    fixture.componentInstance.value.subscribe((v) => chosen.push(v));
    const trigger = el.querySelector<HTMLButtonElement>('.trigger')!;
    const list = el.querySelector<HTMLUListElement>('[role=listbox]')!;
    const key = (target: HTMLElement, k: string) => {
      target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      fixture.detectChanges();
    };
    return { fixture, el, trigger, list, chosen, key };
  }

  it('shows the current choice and opens on click', () => {
    const { fixture, trigger } = setup();
    expect(trigger.textContent).toContain('All Recordings');
    trigger.click();
    fixture.detectChanges();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
  });

  it('chooses with arrow keys and Enter, then closes', () => {
    const { fixture, trigger, list, chosen, key } = setup();
    key(trigger, 'ArrowDown');
    key(list, 'ArrowDown');
    key(list, 'Enter');
    expect(chosen.at(-1)).toBe(6);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.textContent).toContain('Sam-Altman.mp4');
    fixture.detectChanges();
  });

  it('closes on Escape without choosing', () => {
    const { trigger, list, chosen, key } = setup();
    key(trigger, 'ArrowDown');
    key(list, 'End');
    key(list, 'Escape');
    expect(chosen).toEqual([]);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('jumps to an item by typing its first letters', () => {
    const { trigger, list, chosen, key } = setup();
    key(trigger, 'ArrowDown');
    key(list, 's');
    key(list, 'a');
    key(list, 'm');
    key(list, 'p');
    key(list, 'Enter');
    expect(chosen.at(-1)).toBe(8);
  });
});
