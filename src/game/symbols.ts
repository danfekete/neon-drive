/**
 * Neon symbol art, drawn in code and baked into textures once at load.
 * Every symbol is two layers: a blurred "tube glow" silhouette and a sharp
 * core. Each also gets a vertically motion-blurred variant for spinning.
 */
import {
  BlurFilter,
  Container,
  FillGradient,
  Graphics,
  Rectangle,
  Sprite,
  Text,
  Texture,
  type Renderer,
} from 'pixi.js';
import { C, FONT_UI, mix } from './palette';

export const CELL = 180;
const HALF = CELL / 2;

type Layer = 'glow' | 'core';
type Draw = (g: Graphics, layer: Layer) => void;

interface SymbolArt {
  color: number;
  draw: Draw;
  /** Optional extra display objects for the core layer (text etc). */
  extras?: () => Container[];
  glow?: number;
}

const ROUND = { cap: 'round', join: 'round' } as const;

/** Stroke the path built by `path` as a neon tube: bright core with a white-hot centre line. */
function tube(g: Graphics, layer: Layer, color: number, width: number, path: (g: Graphics) => void): void {
  if (layer === 'glow') {
    path(g);
    g.stroke({ width: width * 3, color, alpha: 0.9, ...ROUND });
    return;
  }
  path(g);
  g.stroke({ width, color, ...ROUND });
  path(g);
  g.stroke({ width: Math.max(1.2, width * 0.38), color: mix(color, C.white, 0.8), alpha: 0.95, ...ROUND });
}

function letter(color: number, path: (g: Graphics) => void): SymbolArt {
  return { color, draw: (g, layer) => tube(g, layer, color, 9, path) };
}

const ART: Record<string, SymbolArt> = {
  A: letter(C.cyan, (g) => {
    g.moveTo(-38, 56).lineTo(0, -56).lineTo(38, 56);
    g.moveTo(-23, 14).lineTo(23, 14);
  }),
  K: letter(C.magenta, (g) => {
    g.moveTo(-30, -56).lineTo(-30, 56);
    g.moveTo(34, -56).lineTo(-30, 8);
    g.moveTo(-10, -12).lineTo(36, 56);
  }),
  Q: letter(C.violet, (g) => {
    g.ellipse(0, -4, 40, 52);
    g.moveTo(12, 26).lineTo(44, 62);
  }),
  J: letter(C.orange, (g) => {
    g.moveTo(-6, -56).lineTo(40, -56);
    g.moveTo(24, -56).lineTo(24, 22);
    g.arc(0, 22, 24, 0, Math.PI);
    g.lineTo(-24, 10);
  }),
  TEN: letter(C.lime, (g) => {
    g.moveTo(-50, -36).lineTo(-32, -56).lineTo(-32, 56);
    g.moveTo(-48, 56).lineTo(-16, 56);
    g.ellipse(26, 0, 28, 56);
  }),

  BOLT: {
    color: C.amber,
    draw: (g, layer) => {
      const pts = [16, -76, -34, 6, -4, 6, -18, 76, 38, -14, 8, -14, 26, -76];
      if (layer === 'core') {
        const grad = new FillGradient({
          type: 'linear',
          start: { x: 0, y: 0 },
          end: { x: 0, y: 1 },
          colorStops: [
            { offset: 0, color: 'rgba(255,214,102,0.75)' },
            { offset: 1, color: 'rgba(255,74,40,0.45)' },
          ],
        });
        g.poly(pts, true).fill(grad);
      }
      tube(g, layer, C.amber, 6, (p) => p.poly(pts, true));
    },
  },

  TAPE: {
    color: C.cyan,
    draw: (g, layer) => {
      if (layer === 'core') {
        g.roundRect(-74, -48, 148, 96, 10).fill({ color: C.nightDeep, alpha: 0.85 });
        g.roundRect(-56, -36, 112, 48, 6).fill({ color: C.magenta, alpha: 0.18 });
        g.rect(-56, -36, 112, 8).fill({ color: C.magenta, alpha: 0.85 });
        g.rect(-56, -26, 112, 4).fill({ color: C.amber, alpha: 0.85 });
      }
      tube(g, layer, C.cyan, 5, (p) => p.roundRect(-74, -48, 148, 96, 10));
      tube(g, layer, C.cyan, 3.5, (p) => {
        p.roundRect(-56, -36, 112, 48, 6);
        p.moveTo(-42, 48).lineTo(-34, 28).lineTo(34, 28).lineTo(42, 48);
      });
      tube(g, layer, C.white, 3, (p) => {
        p.circle(-28, -4, 11);
        p.circle(28, -4, 11);
      });
      if (layer === 'core') {
        for (const x of [-28, 28]) {
          for (let k = 0; k < 6; k++) {
            const a = (k / 6) * Math.PI * 2;
            g.moveTo(x + Math.cos(a) * 4, -4 + Math.sin(a) * 4)
              .lineTo(x + Math.cos(a) * 8, -4 + Math.sin(a) * 8)
              .stroke({ width: 2, color: C.white, alpha: 0.8 });
          }
        }
        g.roundRect(-12, -10, 24, 12, 3).fill({ color: C.amber, alpha: 0.35 });
      }
    },
  },

  SHADES: {
    color: C.magenta,
    draw: (g, layer) => {
      const lens = (p: Graphics, s: number): void => {
        p.moveTo(-74 * s, -22)
          .lineTo(-6 * s, -22)
          .lineTo(-10 * s, 4)
          .quadraticCurveTo(-14 * s, 24, -38 * s, 24)
          .quadraticCurveTo(-64 * s, 24, -68 * s, 4)
          .closePath();
      };
      if (layer === 'core') {
        for (const s of [1, -1]) {
          const grad = new FillGradient({
            type: 'linear',
            start: { x: 0, y: 0 },
            end: { x: 0, y: 1 },
            colorStops: [
              { offset: 0, color: 'rgba(255,46,136,0.85)' },
              { offset: 0.55, color: 'rgba(157,78,221,0.7)' },
              { offset: 1, color: 'rgba(45,226,230,0.75)' },
            ],
          });
          lens(g, s);
          g.fill(grad);
          g.moveTo(-60 * s, -12).lineTo(-44 * s, -12).stroke({ width: 3, color: C.white, alpha: 0.75, ...ROUND });
          g.moveTo(-58 * s, 14).lineTo(-28 * s, -14).stroke({ width: 2, color: C.white, alpha: 0.4, ...ROUND });
        }
      }
      tube(g, layer, C.magenta, 5, (p) => {
        lens(p, 1);
        lens(p, -1);
        p.moveTo(-6, -14).quadraticCurveTo(0, -24, 6, -14);
        p.moveTo(-80, -26).lineTo(80, -26);
      });
    },
  },

  PALM: {
    color: C.mint,
    draw: (g, layer) => {
      const top = { x: 8, y: -30 };
      tube(g, layer, C.magenta, 6, (p) => {
        p.moveTo(-4, 76).quadraticCurveTo(-14, 20, top.x, top.y);
      });
      if (layer === 'core') {
        for (const t of [0.2, 0.4, 0.6, 0.8]) {
          const x = (1 - t) ** 2 * -4 + 2 * (1 - t) * t * -14 + t * t * top.x;
          const y = (1 - t) ** 2 * 76 + 2 * (1 - t) * t * 20 + t * t * top.y;
          g.moveTo(x - 7, y + 3).lineTo(x + 7, y - 3).stroke({ width: 2.5, color: C.white, alpha: 0.7, ...ROUND });
        }
      }
      tube(g, layer, C.mint, 5, (p) => {
        const fronds: [number, number, number, number][] = [
          [-34, -66, -74, -30],
          [-40, -38, -56, 8],
          [-2, -80, -20, -78],
          [36, -72, 76, -36],
          [46, -36, 58, 12],
          [22, -78, 44, -76],
        ];
        for (const [cx, cy, x, y] of fronds) p.moveTo(top.x, top.y).quadraticCurveTo(cx, cy, x, y);
      });
      if (layer === 'core') {
        g.circle(top.x - 6, top.y + 6, 5).fill({ color: C.amber });
        g.circle(top.x + 6, top.y + 8, 5).fill({ color: C.amber });
      }
    },
  },

  SUN: {
    color: C.orange,
    glow: 16,
    draw: (g, layer) => {
      const r = 60;
      const cy = -10;
      const bands: [number, number][] = [
        [-r, 6],
        [11, 22],
        [27, 35],
        [40, 46],
        [51, 55],
      ];
      if (layer === 'glow') {
        g.circle(0, cy, r + 2).fill({ color: C.magenta, alpha: 0.8 });
        g.moveTo(-80, cy + r + 8).lineTo(80, cy + r + 8).stroke({ width: 8, color: C.cyan });
        return;
      }
      bands.forEach(([y0, y1], i) => {
        const pts: number[] = [];
        const steps = 24;
        for (let k = 0; k <= steps; k++) {
          const y = y0 + ((y1 - y0) * k) / steps;
          pts.push(-Math.sqrt(Math.max(0, r * r - y * y)), cy + y);
        }
        for (let k = steps; k >= 0; k--) {
          const y = y0 + ((y1 - y0) * k) / steps;
          pts.push(Math.sqrt(Math.max(0, r * r - y * y)), cy + y);
        }
        g.poly(pts, true).fill({ color: mix(C.amber, C.magenta, (i + 0.5) / bands.length) });
      });
      // Top highlight on the cap.
      g.arc(0, cy, r - 7, Math.PI * 1.15, Math.PI * 1.55).stroke({ width: 3, color: C.white, alpha: 0.55, ...ROUND });
      const hy = cy + r + 8;
      tube(g, layer, C.cyan, 4, (p) => {
        p.moveTo(-80, hy).lineTo(80, hy);
        p.moveTo(-58, hy + 12).lineTo(58, hy + 12);
        p.moveTo(0, hy).lineTo(0, hy + 14);
        p.moveTo(-22, hy).lineTo(-36, hy + 14);
        p.moveTo(22, hy).lineTo(36, hy + 14);
      });
    },
  },

  WILD: {
    color: C.cyan,
    draw: (g, layer) => {
      if (layer === 'core') {
        g.roundRect(-80, -50, 160, 100, 20).fill({ color: C.nightDeep, alpha: 0.9 });
      }
      tube(g, layer, C.cyan, 5, (p) => p.roundRect(-80, -50, 160, 100, 20));
      if (layer === 'core') {
        g.roundRect(-70, -40, 140, 80, 14).stroke({ width: 2, color: C.magenta, alpha: 0.9 });
      }
    },
    extras: () => {
      const chrome = new FillGradient({
        type: 'linear',
        start: { x: 0, y: 0 },
        end: { x: 0, y: 1 },
        colorStops: [
          { offset: 0, color: '#ffffff' },
          { offset: 0.42, color: '#a8b8ff' },
          { offset: 0.5, color: '#2a1550' },
          { offset: 0.58, color: '#ff8fd0' },
          { offset: 1, color: '#fff3c4' },
        ],
      });
      const t = new Text({
        text: 'WILD',
        style: {
          fontFamily: FONT_UI,
          fontWeight: '900',
          fontStyle: 'italic',
          fontSize: 54,
          fill: chrome,
          stroke: { color: C.magenta, width: 3, join: 'round' },
          letterSpacing: 1,
        },
      });
      t.anchor.set(0.5);
      t.position.set(-2, 1);
      return [t];
    },
  },

  SCAT: {
    color: C.magenta,
    glow: 14,
    draw: (g, layer) => {
      if (layer === 'glow') {
        g.circle(0, 0, 68).stroke({ width: 14, color: C.magenta });
        return;
      }
      g.circle(0, 0, 68).fill({ color: C.nightDeep });
      for (const r of [61, 55, 49, 43, 37]) {
        g.circle(0, 0, r).stroke({ width: 1.5, color: C.lilac, alpha: 0.28 });
      }
      g.arc(0, 0, 54, -2.5, -1.7).stroke({ width: 4, color: C.white, alpha: 0.55, ...ROUND });
      g.arc(0, 0, 54, 0.64, 1.44).stroke({ width: 4, color: C.cyan, alpha: 0.45, ...ROUND });
      const label = new FillGradient({
        type: 'linear',
        start: { x: 0, y: 0 },
        end: { x: 1, y: 1 },
        colorStops: [
          { offset: 0, color: '#ffb627' },
          { offset: 1, color: '#ff2e88' },
        ],
      });
      g.circle(0, 0, 25).fill(label);
      g.circle(0, 0, 4.5).fill({ color: C.nightDeep });
      tube(g, layer, C.magenta, 5, (p) => p.circle(0, 0, 68));
    },
    extras: () => {
      const t = new Text({
        text: 'FREE',
        style: { fontFamily: FONT_UI, fontWeight: '800', fontSize: 11, fill: C.nightDeep, letterSpacing: 2 },
      });
      t.anchor.set(0.5);
      t.position.set(0, -13);
      return [t];
    },
  },
};

export interface SymbolTextures {
  normal: Record<string, Texture>;
  blur: Record<string, Texture>;
  /** Soft round particle sprite. */
  spark: Texture;
  /** Small diamond shard particle. */
  shard: Texture;
}

function buildSymbol(art: SymbolArt): Container {
  const root = new Container();
  const glow = new Graphics();
  art.draw(glow, 'glow');
  glow.alpha = 0.55;
  glow.filters = [new BlurFilter({ strength: art.glow ?? 10, quality: 4 })];
  const core = new Graphics();
  art.draw(core, 'core');
  root.addChild(glow, core, ...(art.extras?.() ?? []));
  return root;
}

export function createSymbolTextures(renderer: Renderer, ids: string[]): SymbolTextures {
  const frame = new Rectangle(-HALF, -HALF, CELL, CELL);
  const blurFrame = new Rectangle(-HALF, -HALF - 40, CELL, CELL + 80);
  const resolution = Math.min(2, Math.max(1, renderer.resolution));
  const normal: Record<string, Texture> = {};
  const blur: Record<string, Texture> = {};

  for (const id of ids) {
    const art = ART[id];
    if (!art) throw new Error(`No art for symbol ${id}`);
    const view = buildSymbol(art);
    normal[id] = renderer.generateTexture({ target: view, frame, resolution, antialias: true });
    view.destroy({ children: true });

    const holder = new Container();
    const s = new Sprite(normal[id]);
    s.anchor.set(0.5);
    s.alpha = 0.85;
    holder.addChild(s);
    holder.filters = [new BlurFilter({ strengthX: 0, strengthY: 22, quality: 3 })];
    // Taller frame so the streaks fade out instead of being cut off at the cell edge.
    blur[id] = renderer.generateTexture({ target: holder, frame: blurFrame, resolution: 1, antialias: false });
    holder.destroy({ children: true });
  }

  return { normal, blur, spark: makeSpark(), shard: makeShard(renderer) };
}

function makeSpark(): Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.22)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return Texture.from(canvas);
}

function makeShard(renderer: Renderer): Texture {
  const g = new Graphics();
  g.poly([0, -14, 5, 0, 0, 14, -5, 0], true).fill({ color: C.white });
  const t = renderer.generateTexture({ target: g, resolution: 2 });
  g.destroy();
  return t;
}

/** The symbol's signature colour, for highlights and particles. */
export function symbolColor(id: string): number {
  return ART[id]?.color ?? C.white;
}
