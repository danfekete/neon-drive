/** Game configuration as stored in JSON. Retuning the game only touches this. */

export type SymbolKind = 'low' | 'high' | 'wild' | 'scatter';

export interface SymbolDef {
  id: string;
  name: string;
  kind: SymbolKind;
}

export interface GameConfig {
  name: string;
  version: string;
  reels: number;
  rows: number;
  /** A win of `coinsPerBet` coins equals 1x the total bet. Keeps all wins integer. */
  coinsPerBet: number;
  betLevels: number[];
  defaultBet: number;
  startingBalance: number;
  /** Round win cap, as a multiple of the bet. */
  maxWinX: number;
  symbols: SymbolDef[];
  /** Coins paid per way for 3, 4 and 5 of a kind. */
  paytable: Record<string, { '3': number; '4': number; '5': number }>;
  scatter: {
    /** Scatter pay as a multiple of the bet, by number of scatters anywhere. */
    pays: Record<string, number>;
    /** Free spins awarded in the base game, by number of scatters. */
    awards: Record<string, number>;
    retrigger: { minCount: number; spins: number };
  };
  multiplier: { start: number; step: number; max: number | null };
  strips: { base: string[][]; free: string[][] };
}

/** One way-win: a symbol on adjacent reels from the left. */
export interface WayWin {
  symbol: string;
  /** Number of adjacent reels matched (3, 4 or 5). */
  count: number;
  ways: number;
  /** Credits paid for this win, after any multiplier. */
  win: number;
  /** [reel, row] cells that make up the win, including wilds. */
  cells: [number, number][];
}

export interface SpinStep {
  stops: number[];
  /** grid[reel][row] symbol ids, row 0 at the top. */
  grid: string[][];
  wins: WayWin[];
  /** Sum of way wins, after multiplier. */
  wayWin: number;
  scatterCount: number;
  scatterCells: [number, number][];
  scatterWin: number;
  /** Multiplier applied to this spin's way wins (1 in the base game). */
  multiplier: number;
  /** Total credits for this spin, after capping. */
  totalWin: number;
  /** Free spins awarded by this spin (trigger or retrigger), 0 if none. */
  spinsAwarded: number;
}

export interface FreeSpinStep extends SpinStep {
  /** 1-based index of this free spin within the bonus. */
  index: number;
  /** Multiplier after this spin (it climbs on winning spins). */
  multiplierAfter: number;
  /** Free spins left after this one. */
  spinsLeft: number;
}

export interface RoundResult {
  bet: number;
  base: SpinStep;
  freeSpins: FreeSpinStep[];
  /** Total of base + free spins, after the max-win cap. */
  totalWin: number;
  baseWin: number;
  bonusWin: number;
  capped: boolean;
}
