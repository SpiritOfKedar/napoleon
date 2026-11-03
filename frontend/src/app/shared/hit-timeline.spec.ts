import { TestBed } from '@angular/core/testing';
import { HitTimeline } from './hit-timeline';

describe('HitTimeline', () => {
  it('places markers proportionally and emits seek on click', () => {
    const fixture = TestBed.createComponent(HitTimeline);
    fixture.componentRef.setInput('duration', 200);
    fixture.componentRef.setInput('hits', [{ startSec: 50 }, { startSec: 150, active: true }]);
    fixture.detectChanges();
    const markers = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>('.marker');
    expect(markers.length).toBe(2);
    expect(markers[0].style.left).toBe('25%');
    expect(markers[1].classList).toContain('active');

    let sought: number | undefined;
    fixture.componentInstance.seek.subscribe((t) => (sought = t));
    markers[1].click();
    expect(sought).toBe(150);
  });
});
