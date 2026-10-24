/**
 * Neon Drive palette. Night-drive colours: a violet night (never neutral
 * black), magenta horizon, laser cyan, sodium-amber sun. Free spins
 * ("Overdrive") push the whole scene hotter: crimson and ultraviolet.
 */
export const C = {
  night: 0x12052e,
  nightDeep: 0x07021a,
  dusk: 0x2a0b4f,
  magenta: 0xff2e88,
  cyan: 0x2de2e6,
  amber: 0xffb627,
  orange: 0xff6b35,
  violet: 0x9d4edd,
  lilac: 0xd8c8ff,
  lime: 0xb8ff3d,
  mint: 0x3dfcb0,
  crimson: 0xff1744,
  white: 0xffffff,
} as const;

export const FONT_LOGO = 'Monoton';
export const FONT_UI = 'Kanit';

export function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

export function mix(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return (r << 16) | (g << 8) | bl;
}
