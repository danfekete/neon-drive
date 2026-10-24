/**
 * Neon Drive math engine.
 *
 * Pure: no rendering, no DOM, no timers. Give it a config, a bet and a random
 * source; it returns the complete round (base spin plus every free spin).
 * The renderer only animates what this returns, and the simulator runs it
 * millions of times, so the game and the RTP figures can never drift apart.
 */
import { randInt, type Rng } from './rng';
import type {
  FreeSpinStep,
  GameConfig,
  RoundResult,
  SpinStep,
  WayWin,
} from './types';

/** Safety valve: retriggers are finite in expectation, but never loop forever. */
const MAX_FREE_SPINS = 1000;

export interface CompiledConfig {
  cfg: GameConfig;
  reels: number;
  rows: number;
  ids: string[];
  wild: number;
  scatter: number;
  /** Indices of symbols that pay on ways. */
  paying: number[];
  /** pay[symbol][count] in coins per way (count 0..reels). */
  pay: number[][];
  scatterPay: number[];
  scatterAward: number[];
  base: Int16Array[];
  free: Int16Array[];
}

export function compileConfig(cfg: GameConfig): CompiledConfig {
  const ids = cfg.symbols.map((s) => s.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const wild = cfg.symbols.findIndex((s) => s.kind === 'wild');
  const scatter = cfg.symbols.findIndex((s) => s.kind === 'scatter');
  if (wild < 0 || scatter < 0) throw new Error('Config needs one wild and one scatter');

  for (const b of cfg.betLevels) {
    if (b % cfg.coinsPerBet !== 0) {
      throw new Error(`Bet ${b} must be a multiple of coinsPerBet (${cfg.coinsPerBet})`);
    }
  }

  const paying: number[] = [];
  const pay: number[][] = ids.map(() => new Array(cfg.reels + 1).fill(0));
  cfg.symbols.forEach((s, i) => {
    if (s.kind !== 'low' && s.kind !== 'high') return;
    const row = cfg.paytable[s.id];
    if (!row) throw new Error(`Missing paytable row for ${s.id}`);
    paying.push(i);
    for (const n of [3, 4, 5] as const) pay[i][n] = row[String(n) as '3' | '4' | '5'];
  });

  const scatterPay = new Array(cfg.reels + 1).fill(0);
  const scatterAward = new Array(cfg.reels + 1).fill(0);
  for (let n = 0; n <= cfg.reels; n++) {
    scatterPay[n] = cfg.scatter.pays[String(n)] ?? 0;
    scatterAward[n] = cfg.scatter.awards[String(n)] ?? 0;
  }

  const compileStrips = (strips: string[][], label: string): Int16Array[] => {
    if (strips.length !== cfg.reels) throw new Error(`${label}: expected ${cfg.reels} strips`);
    return strips.map((strip, r) => {
      if (strip.length < cfg.rows) throw new Error(`${label} reel ${r + 1}: strip too short`);
      const out = new Int16Array(strip.length);
      strip.forEach((id, i) => {
        const v = index.get(id);
        if (v === undefined) throw new Error(`${label} reel ${r + 1}: unknown symbol ${id}`);
        out[i] = v;
      });
      if (r === 0 && out.includes(wild)) {
        throw new Error(`${label}: wild must not appear on reel 1`);
      }
      // At most one scatter visible per reel: scatters at least `rows` apart, cyclically.
      const pos: number[] = [];
      out.forEach((v, i) => v === scatter && pos.push(i));
      for (let k = 0; k < pos.length; k++) {
        const next = k + 1 < pos.length ? pos[k + 1] : pos[0] + out.length;
        if (pos.length > 1 && next - pos[k] < cfg.rows) {
          throw new Error(`${label} reel ${r + 1}: scatters closer than ${cfg.rows} stops`);
        }
      }
      return out;
    });
  };

  return {
    cfg,
    reels: cfg.reels,
    rows: cfg.rows,
    ids,
    wild,
    scatter,
    paying,
    pay,
    scatterPay,
    scatterAward,
    base: compileStrips(cfg.strips.base, 'base'),
    free: compileStrips(cfg.strips.free, 'free'),
  };
}

/** Symbol indices visible for the given stops. grid[reel][row]. */
export function gridAt(strips: Int16Array[], stops: number[], rows: number): number[][] {
  return strips.map((strip, r) => {
    const col: number[] = [];
    for (let row = 0; row < rows; row++) col.push(strip[(stops[r] + row) % strip.length]);
    return col;
  });
}

export interface GridEvaluation {
  wins: { symbol: number; count: number; ways: number; coins: number; cells: [number, number][] }[];
  /** Total way-win in coins (before bet scaling and multiplier). */
  coins: number;
  scatterCount: number;
  scatterCells: [number, number][];
}

/** 243-ways evaluation: adjacent reels from the left, wilds substitute. */
export function evaluateGrid(cc: CompiledConfig, grid: number[][]): GridEvaluation {
  const wins: GridEvaluation['wins'] = [];
  let coins = 0;

  for (const s of cc.paying) {
    let ways = 1;
    let count = 0;
    for (let r = 0; r < cc.reels; r++) {
      let c = 0;
      const col = grid[r];
      for (let row = 0; row < cc.rows; row++) {
        const v = col[row];
        if (v === s || v === cc.wild) c++;
      }
      if (c === 0) break;
      ways *= c;
      count++;
    }
    if (count < 3) continue;
    const p = cc.pay[s][count];
    if (p <= 0) continue;
    const cells: [number, number][] = [];
    for (let r = 0; r < count; r++) {
      for (let row = 0; row < cc.rows; row++) {
        const v = grid[r][row];
        if (v === s || v === cc.wild) cells.push([r, row]);
      }
    }
    wins.push({ symbol: s, count, ways, coins: p * ways, cells });
    coins += p * ways;
  }

  let scatterCount = 0;
  const scatterCells: [number, number][] = [];
  for (let r = 0; r < cc.reels; r++) {
    for (let row = 0; row < cc.rows; row++) {
      if (grid[r][row] === cc.scatter) {
        scatterCount++;
        scatterCells.push([r, row]);
      }
    }
  }

  return { wins, coins, scatterCount, scatterCells };
}

export function randomStops(strips: Int16Array[], rng: Rng): number[] {
  return strips.map((s) => randInt(rng, s.length));
}

export interface RoundOptions {
  /** Force the base-game stops (tests, demo mode). */
  baseStops?: number[];
  /** Force free-spin stops in order; random once exhausted. */
  freeStops?: number[][];
}

function buildStep(
  cc: CompiledConfig,
  strips: Int16Array[],
  stops: number[],
  bet: number,
  multiplier: number,
): { step: SpinStep; rawWayCredits: number } {
  const grid = gridAt(strips, stops, cc.rows);
  const ev = evaluateGrid(cc, grid);
  const unit = bet / cc.cfg.coinsPerBet;
  const wins: WayWin[] = ev.wins.map((w) => ({
    symbol: cc.ids[w.symbol],
    count: w.count,
    ways: w.ways,
    win: w.coins * unit * multiplier,
    cells: w.cells,
  }));
  const rawWayCredits = ev.coins * unit;
  const wayWin = rawWayCredits * multiplier;
  const scatterWin = cc.scatterPay[ev.scatterCount] * bet;
  return {
    rawWayCredits,
    step: {
      stops,
      grid: grid.map((col) => col.map((v) => cc.ids[v])),
      wins,
      wayWin,
      scatterCount: ev.scatterCount,
      scatterCells: ev.scatterCells,
      scatterWin,
      multiplier,
      totalWin: wayWin + scatterWin,
      spinsAwarded: 0,
    },
  };
}

function runFreeSpins(
  cc: CompiledConfig,
  bet: number,
  rng: Rng,
  awarded: number,
  applyCap: (win: number) => number,
  isCapped: () => boolean,
  forced: number[][] = [],
): FreeSpinStep[] {
  const out: FreeSpinStep[] = [];
  const m = cc.cfg.multiplier;
  let spinsLeft = awarded;
  let multiplier = m.start;
  let index = 0;

  while (spinsLeft > 0 && !isCapped() && index < MAX_FREE_SPINS) {
    spinsLeft--;
    const stops = forced[index] ?? randomStops(cc.free, rng);
    index++;
    const { step, rawWayCredits } = buildStep(cc, cc.free, stops, bet, multiplier);
    step.totalWin = applyCap(step.totalWin);

    let multiplierAfter = multiplier;
    if (rawWayCredits > 0) {
      multiplierAfter = multiplier + m.step;
      if (m.max !== null) multiplierAfter = Math.min(multiplierAfter, m.max);
    }
    if (step.scatterCount >= cc.cfg.scatter.retrigger.minCount) {
      step.spinsAwarded = cc.cfg.scatter.retrigger.spins;
      spinsLeft += step.spinsAwarded;
    }
    out.push({ ...step, index, multiplierAfter, spinsLeft: isCapped() ? 0 : spinsLeft });
    multiplier = multiplierAfter;
  }
  return out;
}

/**
 * Play only a free-spins bonus with the given number of spins (no base spin).
 * Used by the analyzer to value the bonus; the cap applies as in a real round.
 */
export function playBonusOnly(cc: CompiledConfig, bet: number, rng: Rng, spins: number): number {
  const cap = cc.cfg.maxWinX * bet;
  let total = 0;
  let capped = false;
  const applyCap = (win: number): number => {
    if (capped) return 0;
    if (total + win >= cap) {
      capped = true;
      const paid = cap - total;
      total = cap;
      return paid;
    }
    total += win;
    return win;
  };
  runFreeSpins(cc, bet, rng, spins, applyCap, () => capped);
  return total;
}

/** Play one complete round: base spin, then the whole free-spins bonus if triggered. */
export function playRound(
  cc: CompiledConfig,
  bet: number,
  rng: Rng,
  opts: RoundOptions = {},
): RoundResult {
  if (!cc.cfg.betLevels.includes(bet)) throw new Error(`Invalid bet ${bet}`);
  const cap = cc.cfg.maxWinX * bet;
  let total = 0;
  let capped = false;

  const applyCap = (win: number): number => {
    if (capped) return 0;
    if (total + win >= cap) {
      capped = true;
      const paid = cap - total;
      total = cap;
      return paid;
    }
    total += win;
    return win;
  };

  const baseStops = opts.baseStops ?? randomStops(cc.base, rng);
  const { step: base } = buildStep(cc, cc.base, baseStops, bet, 1);
  base.totalWin = applyCap(base.totalWin);
  const baseWin = base.totalWin;

  base.spinsAwarded = cc.scatterAward[base.scatterCount];
  const freeSpins = runFreeSpins(cc, bet, rng, base.spinsAwarded, applyCap, () => capped, opts.freeStops);

  return {
    bet,
    base,
    freeSpins,
    totalWin: total,
    baseWin,
    bonusWin: total - baseWin,
    capped,
  };
}
