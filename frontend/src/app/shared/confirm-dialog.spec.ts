import { TestBed } from '@angular/core/testing';
import { ConfirmService } from '../core/confirm.service';
import { ConfirmDialog } from './confirm-dialog';

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

describe('ConfirmDialog', () => {
  async function open(destructive: boolean) {
    const fixture = TestBed.createComponent(ConfirmDialog);
    fixture.detectChanges();
    const service = TestBed.inject(ConfirmService);
    const answer = service.confirm({ title: 'Delete “talk.mp4”?', message: 'This can’t be undone.', confirmLabel: 'Delete', destructive });
    fixture.detectChanges();
    await nextFrame();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const buttons = Array.from(el.querySelectorAll<HTMLButtonElement>('.buttons button'));
    return { fixture, el, answer, cancel: buttons[0], ok: buttons[1] };
  }

  it('shows the question and resolves true when the action is chosen', async () => {
    const { el, answer, ok } = await open(true);
    expect(el.querySelector('.title')?.textContent).toContain('Delete “talk.mp4”?');
    expect(ok.textContent?.trim()).toBe('Delete');
    expect(ok.classList).toContain('destructive');
    ok.click();
    await expect(answer).resolves.toBe(true);
  });

  it('resolves false on Cancel, and Esc counts as Cancel', async () => {
    const first = await open(true);
    first.cancel.click();
    await expect(first.answer).resolves.toBe(false);

    const second = await open(true);
    second.el.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
    await expect(second.answer).resolves.toBe(false);
  });

  it('puts focus on Cancel for destructive questions', async () => {
    const { cancel } = await open(true);
    expect(document.activeElement).toBe(cancel);
  });
});
