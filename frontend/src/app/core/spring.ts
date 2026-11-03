/**
 * Animates an element's scrollTop with a critically damped spring (no overshoot).
 *
 * - Interruptible: calling to() mid-flight re-targets from the current position and keeps the
 *   current velocity, so there is no visible jump or "brick wall".
 * - Starts from the on-screen value, not a remembered one, so a user scroll in between is respected.
 * - Respects prefers-reduced-motion by jumping instead of animating.
 *
 * `response` is the time constant in seconds (Apple's "response"): lower is snappier.
 */
export class SpringScroller {
  private raf = 0;
  private last = 0;
  private x = 0;
  private v = 0;
  private target = 0;

  constructor(
    private readonly el: HTMLElement,
    private readonly response = 0.45,
  ) {}

  get animating(): boolean {
    return this.raf !== 0;
  }

  to(target: number): void {
    const max = Math.max(0, this.el.scrollHeight - this.el.clientHeight);
    this.target = Math.min(max, Math.max(0, target));
    if (reducedMotion()) {
      this.stop();
      this.el.scrollTop = this.target;
      return;
    }
    if (!this.raf) {
      this.x = this.el.scrollTop; // presentation value
      this.last = performance.now();
      this.raf = requestAnimationFrame(this.step);
    }
  }

  stop(): void {
    if (this.raf) {
      cancelAnimationFrame(this.raf);
    }
    this.raf = 0;
    this.v = 0;
  }

  private readonly step = (now: number): void => {
    const dt = Math.min(0.032, (now - this.last) / 1000);
    this.last = now;
    const omega = (2 * Math.PI) / this.response;
    // Critically damped: x'' = -ω²(x - target) - 2ω x'
    const a = -omega * omega * (this.x - this.target) - 2 * omega * this.v;
    this.v += a * dt;
    this.x += this.v * dt;
    if (Math.abs(this.x - this.target) < 0.5 && Math.abs(this.v) < 4) {
      this.el.scrollTop = this.target;
      this.raf = 0;
      this.v = 0;
      return;
    }
    this.el.scrollTop = this.x;
    this.raf = requestAnimationFrame(this.step);
  };
}

export function reducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
