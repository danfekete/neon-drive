/**
 * In-game controls and readouts: balance, bet, spin, win, info, and the
 * Overdrive panel (multiplier and spins left). Everything is drawn in Pixi so
 * it scales with the game; the long-form info screen is DOM (see info.ts).
 */
import { BlurFilter, Container, FillGradient, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import { C, FONT_LOGO, FONT_UI, mix } from './palette';

export const fmt = (n: number): string => Math.round(n).toLocaleString('en-US');

export function labelStyle(size = 22): TextStyleOptions {
  return { fontFamily: FONT_UI, fontWeight: '400', fontSize: size, fill: C.lilac, letterSpacing: 1 };
}

export function valueStyle(size = 44, color: number = C.white): TextStyleOptions {
  return {
    fontFamily: FONT_UI,
    fontWeight: '600',
    fontSize: size,
    fill: color,
    dropShadow: { color: C.cyan, blur: 10, distance: 0, alpha: 0.7, angle: 0 },
  };
}

export function chromeFill(): FillGradient {
  return new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: '#ffffff' },
      { offset: 0.44, color: '#b7c4ff' },
      { offset: 0.5, color: '#3a1d6e' },
      { offset: 0.56, color: '#ff8fd0' },
      { offset: 1, color: '#fff1c1' },
    ],
  });
}

/** A round neon button. */
export class RoundButton extends Container {
  private ring = new Graphics();
  private glow = new Graphics();
  readonly icon = new Graphics();
  private _enabled = true;
  private hover = false;
  private down = false;

  constructor(
    readonly radius: number,
    private color: number,
    private drawIcon: (g: Graphics, r: number, color: number) => void,
    onTap: () => void,
    ariaLabel: string,
  ) {
    super();
    this.glow.filters = [new BlurFilter({ strength: 10, quality: 3 })];
    this.addChild(this.glow, this.ring, this.icon);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.accessibleTitle = ariaLabel;
    this.accessible = true;
    this.hitArea = { contains: (x: number, y: number) => x * x + y * y <= (radius + 8) ** 2 };
    this.on('pointertap', (e) => {
      e.stopPropagation();
      if (this._enabled) onTap();
    });
    this.on('pointerover', () => ((this.hover = true), this.redraw()));
    this.on('pointerout', () => ((this.hover = false), (this.down = false), this.redraw()));
    this.on('pointerdown', (e) => {
      e.stopPropagation();
      this.down = true;
      this.redraw();
    });
    this.on('pointerup', () => ((this.down = false), this.redraw()));
    this.redraw();
  }

  setColor(color: number): void {
    this.color = color;
    this.redraw();
  }

  setIcon(draw: (g: Graphics, r: number, color: number) => void): void {
    this.drawIcon = draw;
    this.redraw();
  }

  set enabled(v: boolean) {
    this._enabled = v;
    this.cursor = v ? 'pointer' : 'default';
    this.redraw();
  }

  get enabled(): boolean {
    return this._enabled;
  }

  redraw(): void {
    const r = this.radius;
    const col = this._enabled ? this.color : mix(this.color, C.night, 0.65);
    this.ring.clear();
    this.ring.circle(0, 0, r).fill({ color: C.nightDeep, alpha: 0.82 });
    this.ring.circle(0, 0, r).stroke({ width: Math.max(3, r * 0.07), color: col });
    this.ring.circle(0, 0, r).stroke({ width: 1.2, color: C.white, alpha: this._enabled ? 0.7 : 0.2 });
    this.glow.clear();
    this.glow.circle(0, 0, r).stroke({ width: r * 0.22, color: col, alpha: this._enabled ? (this.hover ? 1 : 0.75) : 0.2 });
    this.icon.clear();
    this.drawIcon(this.icon, r, col);
    this.scale.set(this.down && this._enabled ? 0.94 : 1);
  }
}

export const icons = {
  spin: (g: Graphics, r: number, color: number) => {
    // Two chasing arcs, like a tape deck's play/loop symbol.
    const a = r * 0.46;
    g.arc(0, 0, a, -2.6, 0.2).stroke({ width: r * 0.11, color, cap: 'round' });
    g.arc(0, 0, a, 0.55, 3.35).stroke({ width: r * 0.11, color: C.white, alpha: 0.9, cap: 'round' });
    const tip = (ang: number, c: number, alpha = 1): void => {
      const x = Math.cos(ang) * a;
      const y = Math.sin(ang) * a;
      const t = ang + Math.PI / 2;
      const s = r * 0.17;
      g.poly([
        x + Math.cos(t) * s, y + Math.sin(t) * s,
        x + Math.cos(ang) * s * 0.9, y + Math.sin(ang) * s * 0.9,
        x - Math.cos(ang) * s * 0.9, y - Math.sin(ang) * s * 0.9,
      ]).fill({ color: c, alpha });
    };
    tip(0.2, color);
    tip(3.35, C.white, 0.9);
  },
  stop: (g: Graphics, r: number, color: number) => {
    const s = r * 0.3;
    g.roundRect(-s, -s, s * 2, s * 2, r * 0.06).fill({ color, alpha: 0.9 });
  },
  plus: (g: Graphics, r: number, color: number) => {
    const s = r * 0.42;
    g.moveTo(-s, 0).lineTo(s, 0).moveTo(0, -s).lineTo(0, s).stroke({ width: r * 0.16, color, cap: 'round' });
  },
  minus: (g: Graphics, r: number, color: number) => {
    const s = r * 0.42;
    g.moveTo(-s, 0).lineTo(s, 0).stroke({ width: r * 0.16, color, cap: 'round' });
  },
  info: (g: Graphics, r: number, color: number) => {
    g.circle(0, -r * 0.36, r * 0.1).fill({ color });
    g.moveTo(0, -r * 0.08).lineTo(0, r * 0.42).stroke({ width: r * 0.15, color, cap: 'round' });
  },
  refill: (g: Graphics, r: number, color: number) => {
    const s = r * 0.42;
    g.moveTo(-s, 0).lineTo(s, 0).moveTo(0, -s).lineTo(0, s).stroke({ width: r * 0.14, color, cap: 'round' });
    g.circle(0, 0, r * 0.62).stroke({ width: r * 0.06, color, alpha: 0.6 });
  },
};

/** Label above a value. */
export class Readout extends Container {
  readonly caption: Text;
  readonly value: Text;

  constructor(label: string, valueSize = 44, align: 'left' | 'center' | 'right' = 'center') {
    super();
    this.caption = new Text({ text: label, style: labelStyle(valueSize * 0.5) });
    this.value = new Text({ text: '0', style: valueStyle(valueSize) });
    const ax = align === 'left' ? 0 : align === 'right' ? 1 : 0.5;
    this.caption.anchor.set(ax, 1);
    this.value.anchor.set(ax, 0);
    this.caption.y = -2;
    this.addChild(this.caption, this.value);
  }

  set(v: number | string): void {
    this.value.text = typeof v === 'number' ? fmt(v) : v;
  }
}

/** The game's name: neon tube "Neon" over chrome "Drive". */
export class Logo extends Container {
  private neon: Text;
  private neonGlow: Text;
  private drive: Text;
  private flicker = 0;

  constructor() {
    super();
    const neonStyle: TextStyleOptions = { fontFamily: FONT_LOGO, fontSize: 92, fill: C.magenta, letterSpacing: 6 };
    this.neonGlow = new Text({ text: 'Neon', style: neonStyle });
    this.neonGlow.filters = [new BlurFilter({ strength: 16, quality: 3 })];
    this.neon = new Text({
      text: 'Neon',
      style: { ...neonStyle, fill: 0xffd6ec, stroke: { color: C.magenta, width: 3 } },
    });
    this.drive = new Text({
      text: 'Drive',
      style: {
        fontFamily: FONT_UI,
        fontWeight: '900',
        fontStyle: 'italic',
        fontSize: 88,
        fill: chromeFill(),
        stroke: { color: C.cyan, width: 3, join: 'round' },
        letterSpacing: 2,
        dropShadow: { color: C.cyan, blur: 18, distance: 0, alpha: 0.65, angle: 0 },
      },
    });
    for (const t of [this.neonGlow, this.neon]) t.anchor.set(1, 0.5);
    this.drive.anchor.set(0, 0.5);
    this.neonGlow.x = this.neon.x = -6;
    this.drive.x = 10;
    this.drive.y = 4;
    this.addChild(this.neonGlow, this.neon, this.drive);
  }

  /** Occasional tube flicker, like an old sign. */
  update(dt: number): void {
    this.flicker -= dt;
    if (this.flicker < 0) {
      const off = Math.random() < 0.5;
      this.neon.alpha = off ? 0.55 : 1;
      this.neonGlow.alpha = off ? 0.3 : 1;
      this.flicker = off ? 0.05 + Math.random() * 0.08 : 2 + Math.random() * 5;
    }
  }

  setHot(t: number): void {
    const c = mix(C.magenta, C.crimson, t);
    this.neonGlow.style.fill = c;
    this.neon.style.stroke = { color: c, width: 3 };
  }
}

/** Overdrive panel: big multiplier and spins left. */
export class BonusPanel extends Container {
  readonly multiplier: Text;
  readonly multLabel: Text;
  readonly spins: Text;
  readonly spinsLabel: Text;
  private glow: Text;

  constructor() {
    super();
    this.multLabel = new Text({ text: 'Multiplier', style: labelStyle(24) });
    this.multiplier = new Text({
      text: '×1',
      style: {
        fontFamily: FONT_UI,
        fontWeight: '900',
        fontStyle: 'italic',
        fontSize: 120,
        fill: chromeFill(),
        stroke: { color: C.crimson, width: 4, join: 'round' },
      },
    });
    this.glow = new Text({ text: '×1', style: { fontFamily: FONT_UI, fontWeight: '900', fontStyle: 'italic', fontSize: 120, fill: C.crimson } });
    this.glow.filters = [new BlurFilter({ strength: 20, quality: 3 })];
    this.spinsLabel = new Text({ text: 'Free spins left', style: labelStyle(24) });
    this.spins = new Text({ text: '8', style: valueStyle(72) });
    for (const t of [this.multLabel, this.multiplier, this.glow, this.spinsLabel, this.spins]) t.anchor.set(0.5);
    this.addChild(this.multLabel, this.glow, this.multiplier, this.spinsLabel, this.spins);
    this.visible = false;
  }

  setMultiplier(m: number): void {
    this.multiplier.text = `×${m}`;
    this.glow.text = `×${m}`;
  }

  setSpins(n: number): void {
    this.spins.text = String(n);
  }

  /** Side-by-side (portrait strip) or stacked on both sides of the reels (landscape). */
  arrange(mode: 'sides' | 'row', reelsLeft: number, reelsRight: number, centerY: number): void {
    if (mode === 'sides') {
      for (const t of [this.multLabel, this.spinsLabel, this.spins, this.multiplier, this.glow]) t.scale.set(1);
      const lx = reelsLeft / 2;
      const rx = reelsRight + (1920 - reelsRight) / 2;
      this.multLabel.position.set(lx, centerY - 90);
      this.multiplier.position.set(lx, centerY);
      this.glow.position.copyFrom(this.multiplier.position);
      this.spinsLabel.position.set(rx, centerY - 90);
      this.spins.position.set(rx, centerY);
    } else {
      this.multLabel.position.set(280, centerY - 64);
      this.multiplier.position.set(280, centerY + 14);
      this.glow.position.copyFrom(this.multiplier.position);
      this.multiplier.scale.set(0.9);
      this.glow.scale.set(0.9);
      this.spinsLabel.position.set(800, centerY - 64);
      this.spins.position.set(800, centerY + 14);
      this.multLabel.scale.set(1.4);
      this.spinsLabel.scale.set(1.4);
      this.spins.scale.set(1.3);
    }
  }
}
