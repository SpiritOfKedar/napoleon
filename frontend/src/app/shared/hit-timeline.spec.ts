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

describe('HitTimeline scrubbing', () => {
  function setup() {
    const fixture = TestBed.createComponent(HitTimeline);
    fixture.componentRef.setInput('duration', 100);
    fixture.componentRef.setInput('playhead', 10);
    fixture.componentRef.setInput('scrubbable', true);
    fixture.detectChanges();
    const track = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.track')!;
    const scrubs: number[] = [];
    fixture.componentInstance.scrub.subscribe((t) => scrubs.push(t));
    return { fixture, track, scrubs };
  }

  it('is a slider that seeks on press, before release', () => {
    const { track, scrubs } = setup();
    expect(track.getAttribute('role')).toBe('slider');
    track.getBoundingClientRect = () => ({ left: 0, width: 200, top: 0, height: 20, right: 200, bottom: 20, x: 0, y: 0, toJSON: () => ({}) });
    track.dispatchEvent(new PointerEvent('pointerdown', { button: 0, clientX: 50, pointerId: 1, bubbles: true }));
    expect(scrubs).toEqual([25]);
  });

  it('steps 5 s with the arrow keys', () => {
    const { track, scrubs } = setup();
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
    expect(scrubs).toEqual([15, 0]);
  });
});
