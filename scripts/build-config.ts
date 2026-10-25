/**
 * Tuning entry point. Edit the spec below, run `npm run analyze`, read the
 * numbers, repeat. It writes src/math/neon-drive.json, which the game and the
 * simulator both load.
 *
 *   npx tsx scripts/build-config.ts [--bonuses 200000] [--no-write]
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { compileConfig, playBonusOnly } from '../src/math/engine';
import { exactStats } from '../src/math/analysis';
import { SeededRng } from '../src/math/rng';
import type { GameConfig } from '../src/math/types';
import { buildStrip, type ReelSpec } from './strip-builder';

const LOWS = ['TEN', 'J', 'Q', 'K', 'A'];

/**
 * Counts per reel for the base game. v2 (lively): low symbols come in stacks
 * of three and wilds are doubled, so a spin connects across reels 1-3 far more
 * often. Wins are more frequent and smaller; the RTP is the same.
 */
const lowsBase = (): ReelSpec => [['TEN', 7], ['J', 7], ['Q', 6], ['K', 6], ['A', 5]];
const highsBase = (): ReelSpec => [['BOLT', 4], ['TAPE', 4], ['SHADES', 3], ['PALM', 3], ['SUN', 2]];
const BASE: ReelSpec[] = [
  // reel 1: no wild
  [...lowsBase(), ...highsBase(), ['SCAT', 2]],
  [...lowsBase(), ...highsBase(), ['WILD', 2], ['SCAT', 2]],
  [...lowsBase(), ...highsBase(), ['WILD', 2], ['SCAT', 1]],
  [...lowsBase(), ...highsBase(), ['WILD', 2], ['SCAT', 2]],
  [...lowsBase(), ...highsBase(), ['SCAT', 2]],
];

/** Counts per reel for free spins: richer in premiums and wilds. */
const lowsFree = (): ReelSpec => [['TEN', 5], ['J', 5], ['Q', 4], ['K', 4], ['A', 4]];
const highsFree = (): ReelSpec => [['BOLT', 4], ['TAPE', 4], ['SHADES', 4], ['PALM', 3], ['SUN', 3]];
const FREE: ReelSpec[] = [
  [...lowsFree(), ...highsFree(), ['SCAT', 1]],
  [...lowsFree(), ...highsFree(), ['WILD', 3], ['SCAT', 1]],
  [...lowsFree(), ...highsFree(), ['WILD', 3], ['SCAT', 1]],
  [...lowsFree(), ...highsFree(), ['WILD', 3], ['SCAT', 1]],
  [...lowsFree(), ...highsFree(), ['SCAT', 1]],
];

const SEED = 'neon-drive-v2';

export function buildConfig(): GameConfig {
  return {
    name: 'Neon Drive',
    version: '2.0.0',
    reels: 5,
    rows: 3,
    coinsPerBet: 10,
    betLevels: [10, 20, 50, 100, 200, 500],
    defaultBet: 20,
    startingBalance: 10000,
    maxWinX: 5000,
    symbols: [
      ...LOWS.map((id) => ({ id, name: id === 'TEN' ? '10' : id, kind: 'low' as const })),
      { id: 'BOLT', name: 'Lightning', kind: 'high' },
      { id: 'TAPE', name: 'Cassette', kind: 'high' },
      { id: 'SHADES', name: 'Shades', kind: 'high' },
      { id: 'PALM', name: 'Palm', kind: 'high' },
      { id: 'SUN', name: 'Sunset', kind: 'high' },
      { id: 'WILD', name: 'Wild', kind: 'wild' },
      { id: 'SCAT', name: 'Vinyl', kind: 'scatter' },
    ],
    paytable: {
      TEN: { '3': 6, '4': 8, '5': 15 },
      J: { '3': 6, '4': 8, '5': 16 },
      Q: { '3': 5, '4': 10, '5': 20 },
      K: { '3': 6, '4': 10, '5': 22 },
      A: { '3': 6, '4': 12, '5': 25 },
      BOLT: { '3': 8, '4': 20, '5': 45 },
      TAPE: { '3': 10, '4': 25, '5': 60 },
      SHADES: { '3': 12, '4': 32, '5': 90 },
      PALM: { '3': 16, '4': 45, '5': 150 },
      SUN: { '3': 25, '4': 100, '5': 400 },
    },
    scatter: {
      pays: { '3': 2, '4': 10, '5': 100 },
      awards: { '3': 8, '4': 12, '5': 20 },
      retrigger: { minCount: 3, spins: 5 },
    },
    multiplier: { start: 1, step: 1, max: null },
    strips: {
      base: BASE.map((spec, r) => buildStrip(spec, `${SEED}-base-${r}`, 'SCAT')),
      free: FREE.map((spec, r) => buildStrip(spec, `${SEED}-free-${r}`, 'SCAT')),
    },
  };
}

function pct(x: number, d = 2): string {
  return `${(x * 100).toFixed(d)}%`;
}

function main(): void {
  const args = process.argv.slice(2);
  const bonuses = Number(args[args.indexOf('--bonuses') + 1]) || 100000;
  const write = !args.includes('--no-write');

  const cfg = buildConfig();
  const cc = compileConfig(cfg);
  const base = exactStats(cc, cc.base);
  const free = exactStats(cc, cc.free);

  const bet = 10;
  const rng = new SeededRng('tune');
  const bonusEV: Record<number, number> = {};
  for (const n of [3, 4, 5]) {
    const spins = cc.scatterAward[n];
    const runs = n === 3 ? bonuses : Math.max(10000, Math.floor(bonuses / 4));
    let sum = 0;
    for (let i = 0; i < runs; i++) sum += playBonusOnly(cc, bet, rng, spins);
    bonusEV[n] = sum / runs / bet;
  }
  const pTrig = base.scatterDist.slice(3).reduce((a, b) => a + b, 0);
  const fsRtp = [3, 4, 5].reduce((acc, n) => acc + (base.scatterDist[n] ?? 0) * bonusEV[n], 0);
  const total = base.wayRtp + base.scatterRtp + fsRtp;

  console.log(`Strip lengths base: ${cc.base.map((s) => s.length).join(' ')}  free: ${cc.free.map((s) => s.length).join(' ')}`);
  console.log(`Base ways RTP     ${pct(base.wayRtp)}`);
  console.log(`Base scatter RTP  ${pct(base.scatterRtp)}`);
  console.log(`Free spins RTP    ${pct(fsRtp)}  (trigger 1 in ${(1 / pTrig).toFixed(1)}, avg bonus ${(bonusEV[3]).toFixed(1)}x / ${bonusEV[4].toFixed(1)}x / ${bonusEV[5].toFixed(1)}x)`);
  console.log(`TOTAL RTP         ${pct(total)}  (base share ${pct((base.wayRtp + base.scatterRtp) / total, 1)})`);
  console.log(`Hit rate          ${pct(base.hitRate)}  (ways ${pct(base.wayHitRate)})`);
  console.log(`FS spin: ways RTP ${pct(free.wayRtp)}, hit ${pct(free.wayHitRate)}, retrigger P ${pct(free.scatterDist.slice(3).reduce((a, b) => a + b, 0), 3)}`);
  console.log('Base RTP by symbol:', Object.entries(base.bySymbol).map(([k, v]) => `${k} ${pct(v, 1)}`).join(', '));

  if (write) {
    const out = fileURLToPath(new URL('../src/math/neon-drive.json', import.meta.url));
    writeFileSync(out, JSON.stringify(cfg, null, 2) + '\n');
    console.log(`Wrote ${out}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
