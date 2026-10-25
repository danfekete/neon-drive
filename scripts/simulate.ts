/**
 * Full-game simulator: plays complete rounds through the same engine the game
 * uses and reports the numbers against the design targets.
 *
 *   npm run sim -- [--spins 10000000] [--seed abc] [--workers 4]
 */
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { compileConfig, playRound } from '../src/math/engine';
import { SeededRng } from '../src/math/rng';
import type { GameConfig } from '../src/math/types';
import config from '../src/math/neon-drive.json' with { type: 'json' };

const BUCKETS = [0, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000];

interface Tally {
  spins: number;
  wagered: number;
  won: number;
  baseWon: number;
  bonusWon: number;
  scatterWon: number;
  hits: number;
  bonuses: number;
  freeSpins: number;
  sumSq: number;
  maxWinX: number;
  capped: number;
  buckets: number[];
  bonusBuckets: number[];
}

function emptyTally(): Tally {
  return {
    spins: 0, wagered: 0, won: 0, baseWon: 0, bonusWon: 0, scatterWon: 0, hits: 0,
    bonuses: 0, freeSpins: 0, sumSq: 0, maxWinX: 0, capped: 0,
    buckets: new Array(BUCKETS.length).fill(0),
    bonusBuckets: new Array(BUCKETS.length).fill(0),
  };
}

function bucketOf(x: number): number {
  let b = 0;
  for (let i = 0; i < BUCKETS.length; i++) if (x >= BUCKETS[i]) b = i;
  return b;
}

function run(spins: number, seed: string): Tally {
  const cc = compileConfig(config as GameConfig);
  const rng = new SeededRng(seed);
  const bet = cc.cfg.betLevels[0];
  const t = emptyTally();
  for (let i = 0; i < spins; i++) {
    const r = playRound(cc, bet, rng);
    const x = r.totalWin / bet;
    t.spins++;
    t.wagered += bet;
    t.won += r.totalWin;
    t.baseWon += r.baseWin;
    t.bonusWon += r.bonusWin;
    t.scatterWon += r.base.scatterWin;
    if (r.totalWin > 0) t.hits++;
    if (r.freeSpins.length > 0) {
      t.bonuses++;
      t.freeSpins += r.freeSpins.length;
      t.bonusBuckets[bucketOf(r.bonusWin / bet)]++;
    }
    t.sumSq += x * x;
    if (x > t.maxWinX) t.maxWinX = x;
    if (r.capped) t.capped++;
    t.buckets[bucketOf(x)]++;
  }
  return t;
}

function merge(a: Tally, b: Tally): Tally {
  const out = emptyTally();
  for (const k of Object.keys(out) as (keyof Tally)[]) {
    if (k === 'buckets' || k === 'bonusBuckets') {
      out[k] = a[k].map((v, i) => v + b[k][i]);
    } else if (k === 'maxWinX') {
      out[k] = Math.max(a[k], b[k]);
    } else {
      out[k] = a[k] + b[k];
    }
  }
  return out;
}

const pct = (x: number, d = 2): string => `${(x * 100).toFixed(d)}%`;
const oneIn = (p: number): string => (p > 0 ? `1 in ${(1 / p).toLocaleString('en', { maximumFractionDigits: 1 })}` : 'never');

function report(t: Tally, seconds: number): void {
  const rtp = t.won / t.wagered;
  const mean = rtp;
  const variance = t.sumSq / t.spins - mean * mean;
  const sd = Math.sqrt(variance);
  const ci = (1.96 * sd) / Math.sqrt(t.spins);
  const line = (label: string, value: string, target = ''): void =>
    console.log(`${label.padEnd(22)}${value.padEnd(26)}${target}`);

  console.log(`\nNeon Drive simulation: ${t.spins.toLocaleString('en')} rounds in ${seconds.toFixed(1)}s\n`);
  line('Metric', 'Result', 'Target');
  line('RTP', `${pct(rtp, 3)} ± ${pct(ci, 3)}`, '98%');
  line('  base game', pct(t.baseWon / t.wagered), '~70%');
  line('    of which scatter', pct(t.scatterWon / t.wagered));
  line('  free spins', pct(t.bonusWon / t.wagered), '~28%');
  line('Hit frequency', pct(t.hits / t.spins), '~40%');
  line('Bonus frequency', oneIn(t.bonuses / t.spins), '~1 in 100');
  line('Avg free spins/bonus', (t.freeSpins / Math.max(1, t.bonuses)).toFixed(2));
  line('Avg bonus win', `${(t.bonusWon / Math.max(1, t.bonuses) / config.betLevels[0]).toFixed(1)}x bet`);
  line('Std dev per spin', `${sd.toFixed(2)}x bet`, 'medium (~4-7)');
  line('Max win seen', `${t.maxWinX.toLocaleString('en')}x`, 'cap 5,000x');
  line('Capped rounds', `${t.capped} (${oneIn(t.capped / t.spins)})`);

  console.log('\nRound win distribution (x bet):');
  const losses = t.spins - t.hits;
  console.log(`  ${'no win'.padEnd(16)} ${pct(losses / t.spins, 4).padStart(9)}`);
  BUCKETS.forEach((b, i) => {
    const hi = BUCKETS[i + 1];
    const label = i === 0 ? 'win below bet' : hi ? `${b}x to <${hi}x` : `${b}x+`;
    const n = i === 0 ? t.buckets[0] - losses : t.buckets[i];
    if (n > 0) console.log(`  ${label.padEnd(16)} ${pct(n / t.spins, 4).padStart(9)}   ${oneIn(n / t.spins)}`);
  });
  console.log('\nBonus win distribution (x bet):');
  BUCKETS.forEach((b, i) => {
    const hi = BUCKETS[i + 1];
    const n = t.bonusBuckets[i];
    const label = hi ? `${b}x to <${hi}x` : `${b}x+`;
    if (n > 0) console.log(`  ${label.padEnd(16)} ${pct(n / Math.max(1, t.bonuses), 2).padStart(8)} of bonuses`);
  });
}

if (isMainThread) {
  const args = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = args.indexOf(`--${name}`);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const spins = Number(arg('spins') ?? 10_000_000);
  const seed = arg('seed') ?? 'neon-sim';
  const workers = Math.max(1, Number(arg('workers') ?? Math.min(8, availableParallelism())));
  const start = performance.now();
  const per = Math.ceil(spins / workers);
  const self = fileURLToPath(import.meta.url);

  Promise.all(
    Array.from({ length: workers }, (_, w) =>
      new Promise<Tally>((resolve, reject) => {
        const worker = new Worker(self, {
          workerData: { spins: Math.min(per, spins - w * per), seed: `${seed}-${w}` },
          execArgv: process.execArgv,
        });
        worker.once('message', resolve);
        worker.once('error', reject);
      }),
    ),
  ).then((tallies) => {
    report(tallies.reduce(merge, emptyTally()), (performance.now() - start) / 1000);
  });
} else {
  const { spins, seed } = workerData as { spins: number; seed: string };
  parentPort!.postMessage(run(spins, seed));
}
