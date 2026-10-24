/**
 * Reel presentation. Each reel scrolls a virtual tape of symbols: the target
 * result sits at the top of the tape, the symbols currently showing sit far
 * below it, and the reel strip fills the gap. Spinning just moves a float
 * position down the tape, so stopping exactly on the result is trivial and a
 * slam-stop can jump ahead while the motion blur hides it.
 */
import { BlurFilter, Container, Graphics, Sprite, type Texture } from 'pixi.js';
import { C, mix } from './palette';
import { CELL, type SymbolTextures } from './symbols';
import type { Tweener } from './tween';

const VISIBLE_POOL = 4;
const MAX_SPEED = 26;
const ACCEL = 110;
const BACK_SLOPE = 4.7;

type Phase = 'idle' | 'windup' | 'spin' | 'land';

class Reel {
  readonly view = new Container();
  readonly sprites: Sprite[] = [];
  phase: Phase = 'idle';
  b = 0;
  v = 0;
  stopAt = Infinity;
  current: string[];
  target: string[];
  private fill: string[] = [];
  private fillOffset = 0;
  private start = 0;
  private landFrom = 0;
  private landT = 0;
  private landDur = 1;
  private lastB = 0;
  onLanded: () => void = () => {};

  constructor(private tex: SymbolTextures, initial: string[], readonly rows: number) {
    this.current = [...initial];
    this.target = [...initial];
    for (let k = 0; k < VISIBLE_POOL; k++) {
      const s = new Sprite();
      s.anchor.set(0.5);
      s.x = CELL / 2;
      this.sprites.push(s);
      this.view.addChild(s);
    }
    this.render(0);
  }

  private symbolAt(i: number): string {
    if (i >= 0 && i < this.rows) return this.target[i];
    if (this.phase !== 'idle' && i >= this.start && i < this.start + this.rows) {
      return this.current[i - this.start];
    }
    if (this.fill.length === 0) return this.target[((i % this.rows) + this.rows) % this.rows];
    const n = this.fill.length;
    return this.fill[(((this.fillOffset + i) % n) + n) % n];
  }

  spin(target: string[], fill: string[]): void {
    this.current = this.phase === 'idle' ? this.target : this.current;
    this.target = [...target];
    this.fill = fill;
    this.fillOffset = Math.floor(Math.random() * fill.length);
    this.start = 400;
    this.b = this.start;
    this.v = 0;
    this.phase = 'windup';
    this.stopAt = Infinity;
  }

  update(dt: number, now: number, tween: Tweener): void {
    if (this.phase === 'windup') {
      // Short upward kick before the reel drops away.
      this.landT += dt;
      const t = Math.min(1, this.landT / 0.14);
      this.b = this.start + 0.32 * Math.sin(t * Math.PI * 0.5);
      if (t >= 1) {
        this.landT = 0;
        this.phase = 'spin';
      }
    } else if (this.phase === 'spin') {
      this.v = Math.min(MAX_SPEED, this.v + ACCEL * dt);
      this.b -= this.v * dt;
      if (now >= this.stopAt && this.v >= MAX_SPEED * 0.6) this.beginLanding();
      if (this.b < 4) this.b += 200; // never run off the tape while waiting
    } else if (this.phase === 'land') {
      this.landT += dt;
      const t = Math.min(1, this.landT / this.landDur);
      const c1 = 1.2;
      const c3 = c1 + 1;
      const e = 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
      this.b = this.landFrom * (1 - e);
      if (t >= 1) {
        this.b = 0;
        this.phase = 'idle';
        this.current = [...this.target];
        this.render(dt);
        this.onLanded();
        return;
      }
    }
    void tween;
    this.render(dt);
  }

  beginLanding(): void {
    const frac = this.b - Math.floor(this.b);
    this.landFrom = 2 + frac;
    this.landT = 0;
    this.landDur = Math.max(0.28, ((BACK_SLOPE * 0.82) * this.landFrom) / Math.max(this.v, 10));
    this.phase = 'land';
  }

  render(dt: number): void {
    const speed = dt > 0 ? Math.abs(this.b - this.lastB) / dt : 0;
    this.lastB = this.b;
    const blurred = this.phase !== 'idle' && speed > 7;
    const base = Math.floor(this.b);
    for (let k = 0; k < VISIBLE_POOL; k++) {
      const idx = base + k;
      const s = this.sprites[k];
      const id = this.symbolAt(idx);
      const tex: Texture = blurred ? this.tex.blur[id] : this.tex.normal[id];
      if (s.texture !== tex) s.texture = tex;
      s.y = (idx - this.b) * CELL + CELL / 2;
      s.label = id;
      if (this.phase !== 'idle' || id !== 'SCAT') s.rotation = 0;
    }
  }

  /** The sprite showing `row` while idle. */
  spriteAt(row: number): Sprite {
    return this.sprites[row];
  }
}

export interface ReelEvents {
  onReelStop?: (reel: number) => void;
  onAnticipation?: (reel: number) => void;
}

export class ReelSet {
  readonly view = new Container();
  readonly reels: Reel[] = [];
  readonly width: number;
  readonly height: number;
  private glass = new Graphics();
  private frame = new Graphics();
  private frameGlow = new Graphics();
  private anticipation = new Graphics();
  private symbols = new Container();
  private time = 0;
  private resolveSpin: (() => void) | null = null;
  private landed = 0;
  private anticipating = -1;
  hot = 0;

  constructor(
    tex: SymbolTextures,
    initial: string[][],
    readonly rows: number,
    private events: ReelEvents = {},
  ) {
    const n = initial.length;
    this.width = n * CELL;
    this.height = rows * CELL;
    const mask = new Graphics().rect(0, 0, this.width, this.height).fill(0xffffff);
    this.symbols.mask = mask;
    this.frameGlow.filters = [new BlurFilter({ strength: 14, quality: 3 })];
    this.view.addChild(this.frameGlow, this.glass, this.anticipation, this.symbols, mask, this.frame);

    initial.forEach((col, r) => {
      const reel = new Reel(tex, col, rows);
      reel.view.x = r * CELL;
      reel.onLanded = () => this.reelLanded(r);
      this.reels.push(reel);
      this.symbols.addChild(reel.view);
    });
    this.drawFrame();
  }

  drawFrame(): void {
    const w = this.width;
    const h = this.height;
    const edge = mix(C.cyan, 0xb44dff, this.hot);
    const accent = mix(C.magenta, C.crimson, this.hot);
    this.glass.clear();
    this.glass.roundRect(-10, -10, w + 20, h + 20, 18).fill({ color: mix(C.nightDeep, 0x120008, this.hot), alpha: 0.72 });
    for (let r = 1; r < this.reels.length; r++) {
      this.glass.moveTo(r * CELL, 8).lineTo(r * CELL, h - 8).stroke({ width: 1.5, color: edge, alpha: 0.18 });
    }
    this.frame.clear();
    this.frame.roundRect(-14, -14, w + 28, h + 28, 22).stroke({ width: 3.5, color: edge });
    this.frame.roundRect(-14, -14, w + 28, h + 28, 22).stroke({ width: 1.2, color: C.white, alpha: 0.7 });
    this.frame.roundRect(-22, -22, w + 44, h + 44, 28).stroke({ width: 2, color: accent, alpha: 0.85 });
    this.frameGlow.clear();
    this.frameGlow.roundRect(-16, -16, w + 32, h + 32, 24).stroke({ width: 10, color: edge, alpha: 0.9 });
    this.frameGlow.roundRect(-22, -22, w + 44, h + 44, 28).stroke({ width: 8, color: accent, alpha: 0.7 });
  }

  get spinning(): boolean {
    return this.reels.some((r) => r.phase !== 'idle');
  }

  /**
   * Spin to the given grid. Resolves when every reel has landed.
   * `anticipateFrom`: reels at or after this index stop slowly (scatter tension).
   */
  spin(grid: string[][], fill: string[][], opts: { quick?: boolean } = {}): Promise<void> {
    this.landed = 0;
    this.anticipating = -1;
    const base = opts.quick ? 0.45 : 0.62;
    const stagger = opts.quick ? 0.1 : 0.16;

    let at = this.time + base;
    let scatters = 0;
    this.reels.forEach((reel, r) => {
      reel.spin(grid[r], fill[r]);
      if (r > 0) at += scatters >= 2 ? 1.25 : stagger;
      reel.stopAt = at;
      scatters += grid[r].filter((s) => s === 'SCAT').length;
    });
    return new Promise((resolve) => (this.resolveSpin = resolve));
  }

  /** Slam stop: land every spinning reel now, a beat apart. */
  slam(): void {
    let k = 0;
    for (const reel of this.reels) {
      if (reel.phase === 'spin' || reel.phase === 'windup') {
        reel.stopAt = this.time + 0.04 * k++;
        if (reel.phase === 'spin') reel.v = Math.max(reel.v, MAX_SPEED * 0.8);
      }
    }
    this.anticipating = -1;
    this.anticipation.clear();
  }

  private reelLanded(r: number): void {
    this.landed++;
    this.events.onReelStop?.(r);
    // Scatter tension: if two or more scatters are already showing and the next reel
    // is being held back, light it up.
    const next = r + 1;
    if (next < this.reels.length && this.reels[next].phase !== 'idle') {
      const shown = this.reels.slice(0, next).reduce((n, reel) => n + reel.target.filter((s) => s === 'SCAT').length, 0);
      if (shown >= 2 && this.reels[next].stopAt - this.time > 0.5) {
        this.anticipating = next;
        this.events.onAnticipation?.(next);
      } else {
        this.anticipating = -1;
      }
    } else {
      this.anticipating = -1;
    }
    if (this.landed === this.reels.length) {
      this.anticipation.clear();
      const done = this.resolveSpin;
      this.resolveSpin = null;
      done?.();
    }
  }

  update(dt: number, tween: Tweener): void {
    this.time += dt;
    for (const reel of this.reels) {
      reel.update(dt, this.time, tween);
      if (reel.phase === 'idle') {
        for (const s of reel.sprites) {
          if (s.label === 'SCAT') s.rotation += dt * 0.9;
        }
      }
    }
    this.anticipation.clear();
    if (this.anticipating >= 0) {
      const x = this.anticipating * CELL;
      const pulse = 0.55 + 0.45 * Math.sin(this.time * 14);
      this.anticipation.roundRect(x + 4, 4, CELL - 8, this.height - 8, 12).fill({ color: C.magenta, alpha: 0.12 * pulse });
      this.anticipation.roundRect(x + 4, 4, CELL - 8, this.height - 8, 12).stroke({ width: 4, color: C.amber, alpha: pulse });
    }
  }

  /** Show a grid immediately, no animation. */
  setGrid(grid: string[][]): void {
    this.reels.forEach((reel, r) => {
      reel.current = [...grid[r]];
      reel.target = [...grid[r]];
      reel.phase = 'idle';
      reel.b = 0;
      reel.render(0);
    });
  }

  sprite(reel: number, row: number): Sprite {
    return this.reels[reel].spriteAt(row);
  }

  /** Position of a cell centre in ReelSet space. */
  cellCenter(reel: number, row: number): { x: number; y: number } {
    return { x: reel * CELL + CELL / 2, y: row * CELL + CELL / 2 };
  }

  setDim(alpha: number, except: Set<string> = new Set()): void {
    this.reels.forEach((reel, r) => {
      for (let row = 0; row < this.rows; row++) {
        reel.spriteAt(row).alpha = except.has(`${r},${row}`) ? 1 : alpha;
      }
      reel.sprites[VISIBLE_POOL - 1].alpha = 1;
    });
  }
}
