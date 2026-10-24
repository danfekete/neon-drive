import { describe, expect, it } from 'vitest';
import { compileConfig, evaluateGrid, playRound } from '../src/math/engine';
import { exactStats } from '../src/math/analysis';
import { SeededRng } from '../src/math/rng';
import type { GameConfig } from '../src/math/types';
import shipped from '../src/math/neon-drive.json';

const SYMBOLS: GameConfig['symbols'] = [
  { id: 'X', name: 'Blank', kind: 'low' },
  { id: 'A', name: 'A', kind: 'low' },
  { id: 'K', name: 'K', kind: 'low' },
  { id: 'SUN', name: 'Sun', kind: 'high' },
  { id: 'WILD', name: 'Wild', kind: 'wild' },
  { id: 'SCAT', name: 'Scatter', kind: 'scatter' },
];

/** Strips that are exactly the given columns, so stop 0 shows them as-is. */
function testConfig(base: string[][], free: string[][] = base, extra: Partial<GameConfig> = {}): GameConfig {
  return {
    name: 'test',
    version: '0',
    reels: 5,
    rows: 3,
    coinsPerBet: 10,
    betLevels: [10, 20],
    defaultBet: 10,
    startingBalance: 1000,
    maxWinX: 5000,
    symbols: SYMBOLS,
    paytable: {
      X: { '3': 0, '4': 0, '5': 0 },
      A: { '3': 5, '4': 10, '5': 20 },
      K: { '3': 4, '4': 8, '5': 16 },
      SUN: { '3': 50, '4': 100, '5': 1000 },
    },
    scatter: {
      pays: { '3': 2, '4': 10, '5': 50 },
      awards: { '3': 8, '4': 12, '5': 20 },
      retrigger: { minCount: 3, spins: 5 },
    },
    multiplier: { start: 1, step: 1, max: null },
    strips: { base, free },
    ...extra,
  };
}

const ZERO = [0, 0, 0, 0, 0];

describe('config', () => {
  it('the shipped config compiles and passes validation', () => {
    expect(() => compileConfig(shipped as GameConfig)).not.toThrow();
  });

  it('rejects a wild on reel 1', () => {
    const cols = [['WILD', 'K', 'A'], ['K', 'A', 'K'], ['K', 'A', 'K'], ['K', 'A', 'K'], ['K', 'A', 'K']];
    expect(() => compileConfig(testConfig(cols))).toThrow(/reel 1/);
  });

  it('rejects scatters close enough to show twice on one reel', () => {
    const cols = [['SCAT', 'K', 'SCAT', 'A'], ['K', 'A', 'K'], ['K', 'A', 'K'], ['K', 'A', 'K'], ['K', 'A', 'K']];
    expect(() => compileConfig(testConfig(cols))).toThrow(/scatters closer/);
  });

  it('rejects bets that would produce fractional wins', () => {
    const cols = Array.from({ length: 5 }, () => ['K', 'A', 'K']);
    expect(() => compileConfig(testConfig(cols, cols, { betLevels: [15] }))).toThrow(/multiple/);
  });
});

describe('243-ways evaluation', () => {
  it('multiplies matching symbols per reel, with wilds substituting', () => {
    const cols = [
      ['A', 'A', 'K'], // 2
      ['A', 'WILD', 'K'], // 2 (wild counts)
      ['K', 'A', 'K'], // 1
      ['K', 'K', 'K'], // stops A at 3 reels
      ['A', 'A', 'A'],
    ];
    const cc = compileConfig(testConfig(cols));
    const ev = evaluateGrid(cc, cols.map((c) => c.map((id) => cc.ids.indexOf(id))));
    const a = ev.wins.find((w) => cc.ids[w.symbol] === 'A')!;
    expect(a.count).toBe(3);
    expect(a.ways).toBe(4);
    expect(a.coins).toBe(5 * 4);
    expect(a.cells).toHaveLength(5); // 2 + 2 + 1
  });

  it('pays every symbol that connects, independently', () => {
    const cols = [
      ['A', 'K', 'SUN'],
      ['A', 'K', 'SUN'],
      ['A', 'K', 'SUN'],
      ['A', 'K', 'SUN'],
      ['A', 'K', 'SUN'],
    ];
    const cc = compileConfig(testConfig(cols));
    const ev = evaluateGrid(cc, cols.map((c) => c.map((id) => cc.ids.indexOf(id))));
    expect(ev.coins).toBe(20 + 16 + 1000);
  });

  it('ignores two-reel matches and counts scatters anywhere', () => {
    const cols = [
      ['A', 'SCAT', 'K'],
      ['A', 'K', 'SCAT'],
      ['K', 'K', 'SUN'],
      ['SCAT', 'SUN', 'SUN'],
      ['SUN', 'SUN', 'SUN'],
    ];
    const cc = compileConfig(testConfig(cols));
    const ev = evaluateGrid(cc, cols.map((c) => c.map((id) => cc.ids.indexOf(id))));
    expect(ev.wins.map((w) => cc.ids[w.symbol])).toEqual(['K']);
    expect(ev.scatterCount).toBe(3);
  });
});

describe('rounds', () => {
  const blank = Array.from({ length: 5 }, () => ['X', 'X', 'X', 'X']);
  const trigger = [['SCAT', 'X', 'X', 'X'], ['SCAT', 'X', 'X', 'X'], ['SCAT', 'X', 'X', 'X'], ['X', 'X', 'X', 'X'], ['X', 'X', 'X', 'X']];

  it('scales wins by the bet and pays the scatter', () => {
    const cc = compileConfig(testConfig(trigger, blank));
    const r = playRound(cc, 20, new SeededRng(1), { baseStops: ZERO });
    expect(r.base.scatterCount).toBe(3);
    expect(r.base.scatterWin).toBe(2 * 20);
    expect(r.base.spinsAwarded).toBe(8);
    expect(r.freeSpins).toHaveLength(8);
    expect(r.bonusWin).toBe(0);
    expect(r.totalWin).toBe(40);
  });

  it('climbs the multiplier only after winning free spins, applying it to that spin first', () => {
    // Free strips: stop 0 shows K on reels 1-3 (4 coins = 0.4x bet), stop 3 shows only blanks.
    const free = [
      ['K', 'X', 'X', 'X', 'X', 'X'],
      ['K', 'X', 'X', 'X', 'X', 'X'],
      ['K', 'X', 'X', 'X', 'X', 'X'],
      ['X', 'X', 'X', 'X', 'X', 'X'],
      ['X', 'X', 'X', 'X', 'X', 'X'],
    ];
    const cc = compileConfig(testConfig(trigger, free));
    const win = ZERO;
    const lose = [3, 3, 3, 3, 3];
    const r = playRound(cc, 10, new SeededRng(1), {
      baseStops: ZERO,
      freeStops: [win, lose, win, win, lose, lose, lose, lose],
    });
    expect(r.freeSpins.map((s) => s.multiplier)).toEqual([1, 2, 2, 3, 4, 4, 4, 4]);
    expect(r.freeSpins.map((s) => s.wayWin)).toEqual([4, 0, 8, 12, 0, 0, 0, 0]);
    expect(r.bonusWin).toBe(24);
    expect(r.totalWin).toBe(r.baseWin + 24);
  });

  it('retriggers add five spins', () => {
    const cc = compileConfig(testConfig(trigger, trigger));
    const forced = Array.from({ length: 100 }, (_, i) => (i === 0 ? ZERO : [1, 1, 1, 1, 1]));
    const r = playRound(cc, 10, new SeededRng(1), { baseStops: ZERO, freeStops: forced });
    expect(r.freeSpins[0].spinsAwarded).toBe(5);
    expect(r.freeSpins).toHaveLength(8 + 5);
  });

  it('caps the round at maxWinX and stops the bonus', () => {
    const sun = Array.from({ length: 5 }, () => ['SUN', 'SUN', 'SUN']);
    const cc = compileConfig(testConfig(sun, sun, { maxWinX: 100 }));
    const r = playRound(cc, 10, new SeededRng(1), { baseStops: ZERO });
    expect(r.capped).toBe(true);
    expect(r.totalWin).toBe(100 * 10);
  });

  it('wins are always whole credits', () => {
    const cc = compileConfig(shipped as GameConfig);
    const rng = new SeededRng('integers');
    for (let i = 0; i < 20000; i++) {
      const r = playRound(cc, cc.cfg.betLevels[i % cc.cfg.betLevels.length], rng);
      expect(Number.isInteger(r.totalWin)).toBe(true);
    }
  });

  it('is deterministic for a seed', () => {
    const cc = compileConfig(shipped as GameConfig);
    const a = new SeededRng('same');
    const b = new SeededRng('same');
    for (let i = 0; i < 1000; i++) {
      expect(playRound(cc, 10, a).totalWin).toBe(playRound(cc, 10, b).totalWin);
    }
  });
});

describe('shipped math', () => {
  it('exact base-game numbers agree with sampling', () => {
    const cc = compileConfig(shipped as GameConfig);
    const exact = exactStats(cc, cc.base);
    const rng = new SeededRng('agree');
    let ways = 0;
    let hits = 0;
    const n = 400000;
    for (let i = 0; i < n; i++) {
      const r = playRound(cc, 10, rng);
      ways += r.base.wayWin;
      if (r.base.totalWin > 0) hits++;
    }
    expect(Math.abs(ways / n / 10 - exact.wayRtp)).toBeLessThan(0.015);
    expect(Math.abs(hits / n - exact.hitRate)).toBeLessThan(0.004);
  });

  it('meets the design targets', () => {
    const cc = compileConfig(shipped as GameConfig);
    const exact = exactStats(cc, cc.base);
    const trigger = exact.scatterDist.slice(3).reduce((a, b) => a + b, 0);
    expect(exact.hitRate).toBeGreaterThan(0.22);
    expect(exact.hitRate).toBeLessThan(0.28);
    expect(1 / trigger).toBeGreaterThan(130);
    expect(1 / trigger).toBeLessThan(180);
  });
});
