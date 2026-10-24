/**
 * A small tween and timing helper driven by the Pixi ticker. Promises make
 * presentation sequences read top to bottom; `skip()` fast-forwards
 * everything when the player taps to hurry the game along.
 */
import type { Ticker } from 'pixi.js';

export type Ease = (t: number) => number;

export const ease = {
  linear: (t: number) => t,
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2),
  outCubic: (t: number) => 1 - (1 - t) ** 3,
  inCubic: (t: number) => t * t * t,
  outExpo: (t: number) => (t === 1 ? 1 : 1 - 2 ** (-10 * t)),
  outBack: (t: number) => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
  },
  outElastic: (t: number) => {
    if (t === 0 || t === 1) return t;
    return 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
  },
} satisfies Record<string, Ease>;

interface Job {
  elapsed: number;
  delay: number;
  duration: number;
  step: (t: number) => void;
  done: () => void;
  target?: object;
  skippable: boolean;
}

export interface TweenOptions {
  duration: number;
  ease?: Ease;
  delay?: number;
  onUpdate?: () => void;
  /** If false, `skip()` will not fast-forward this tween (ambient loops). */
  skippable?: boolean;
}

export class Tweener {
  private jobs = new Set<Job>();
  /** Global time in seconds since start, for shaders and ambient motion. */
  time = 0;

  constructor(ticker: Ticker) {
    ticker.add((t) => this.update(t.deltaMS / 1000));
  }

  update(dt: number): void {
    this.time += dt;
    for (const job of [...this.jobs]) {
      job.elapsed += dt;
      if (job.elapsed < job.delay) continue;
      const t = job.duration <= 0 ? 1 : Math.min(1, (job.elapsed - job.delay) / job.duration);
      job.step(t);
      if (t >= 1) {
        this.jobs.delete(job);
        job.done();
      }
    }
  }

  /** Tween numeric properties of `target` to `to`. Resolves when finished. */
  to<T extends object>(target: T, to: Partial<Record<keyof T, number>>, opts: TweenOptions): Promise<void> {
    const keys = Object.keys(to) as (keyof T)[];
    const from: Record<string, number> = {};
    let started = false;
    const e = opts.ease ?? ease.outQuad;
    return new Promise((resolve) => {
      this.jobs.add({
        elapsed: 0,
        delay: opts.delay ?? 0,
        duration: opts.duration,
        target,
        skippable: opts.skippable ?? true,
        step: (t) => {
          if (!started) {
            started = true;
            for (const k of keys) from[k as string] = target[k] as unknown as number;
          }
          const v = e(t);
          for (const k of keys) {
            const a = from[k as string];
            const b = to[k] as number;
            (target as Record<string, number>)[k as string] = a + (b - a) * v;
          }
          opts.onUpdate?.();
        },
        done: resolve,
      });
    });
  }

  /** Call `fn(t)` with t from 0 to 1 over the duration. */
  run(duration: number, fn: (t: number) => void, opts: { ease?: Ease; delay?: number; skippable?: boolean } = {}): Promise<void> {
    const e = opts.ease ?? ease.linear;
    return new Promise((resolve) => {
      this.jobs.add({
        elapsed: 0,
        delay: opts.delay ?? 0,
        duration,
        skippable: opts.skippable ?? true,
        step: (t) => fn(e(t)),
        done: resolve,
      });
    });
  }

  wait(seconds: number, skippable = true): Promise<void> {
    return this.run(seconds, () => {}, { skippable });
  }

  /** Stop tweens on a target without completing them. */
  kill(target: object): void {
    for (const job of this.jobs) if (job.target === target) this.jobs.delete(job);
  }

  /** Jump every skippable tween and wait to its end state. */
  skip(): void {
    for (const job of [...this.jobs]) {
      if (!job.skippable) continue;
      job.step(1);
      this.jobs.delete(job);
      job.done();
    }
  }
}
