import { TestBed } from '@angular/core/testing';
import { StatusBadge } from './status-badge';
import { MediaStatus } from '../core/models';

describe('StatusBadge', () => {
  function render(status: MediaStatus, progress: number | null): string {
    const fixture = TestBed.createComponent(StatusBadge);
    fixture.componentRef.setInput('status', status);
    fixture.componentRef.setInput('progress', progress);
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent!.trim();
  }

  it('shows transcription progress when known', () => {
    expect(render('TRANSCRIBING', 42.7)).toBe('Transcribing… 42%');
  });

  it('hides progress before any is reported', () => {
    expect(render('TRANSCRIBING', null)).toBe('Transcribing…');
    expect(render('TRANSCRIBING', 0)).toBe('Transcribing…');
  });

  it('ignores progress for other statuses', () => {
    expect(render('INDEXED', 100)).toBe('Ready');
  });
});
