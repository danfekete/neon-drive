/**
 * Builds reel strips from symbol counts. Symbols are spread evenly around the
 * strip (with seeded jitter so reels don't look identical), optionally in
 * stacks, and scatters are kept far enough apart that a reel can never show
 * two at once.
 */
import { SeededRng, randInt } from '../src/math/rng';

/** [symbol id, total count on the strip, stack size (default 1)] */
export type ReelSpec = [string, number, number?][];

export function buildStrip(spec: ReelSpec, seed: string, scatterId: string, rows = 3): string[] {
  const rng = new SeededRng(seed);
  type Block = { id: string; size: number; key: number };
  const blocks: Block[] = [];

  for (const [id, count, stack = 1] of spec) {
    if (count <= 0) continue;
    const n = Math.ceil(count / stack);
    let left = count;
    const phase = randInt(rng, 1000) / 1000;
    for (let k = 0; k < n; k++) {
      const size = Math.min(stack, left);
      left -= size;
      const jitter = (randInt(rng, 1000) / 1000 - 0.5) * 0.5;
      blocks.push({ id, size, key: ((k + phase + jitter) / n + 1) % 1 });
    }
  }
  blocks.sort((a, b) => a.key - b.key);

  // Break up neighbouring blocks of the same symbol so stacks stay the size we asked for.
  for (let pass = 0; pass < 20; pass++) {
    let changed = false;
    for (let i = 0; i < blocks.length; i++) {
      const j = (i + 1) % blocks.length;
      if (blocks[i].id === blocks[j].id) {
        for (let t = 2; t < blocks.length; t++) {
          const k = (j + t) % blocks.length;
          const prev = blocks[(k - 1 + blocks.length) % blocks.length];
          const next = blocks[(k + 1) % blocks.length];
          if (blocks[k].id !== blocks[i].id && prev.id !== blocks[j].id && next.id !== blocks[j].id) {
            [blocks[j], blocks[k]] = [blocks[k], blocks[j]];
            changed = true;
            break;
          }
        }
      }
    }
    if (!changed) break;
  }

  const strip = blocks.flatMap((b) => new Array<string>(b.size).fill(b.id));

  // Enforce scatter spacing by swapping offending scatters forward.
  const L = strip.length;
  for (let pass = 0; pass < 50; pass++) {
    const pos = strip.map((s, i) => (s === scatterId ? i : -1)).filter((i) => i >= 0);
    let bad = -1;
    for (let k = 0; k < pos.length && pos.length > 1; k++) {
      const next = k + 1 < pos.length ? pos[k + 1] : pos[0] + L;
      if (next - pos[k] < rows) bad = pos[k + 1 < pos.length ? k + 1 : 0];
    }
    if (bad < 0) break;
    const target = (bad + rows + randInt(rng, L - rows)) % L;
    [strip[bad], strip[target]] = [strip[target], strip[bad]];
  }
  return strip;
}
