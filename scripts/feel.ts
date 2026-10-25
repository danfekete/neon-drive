/**
 * How the game feels to play, as opposed to its long-run return: how often a
 * spin pays at least the bet back, how long the dry spells are, and what a
 * typical 200-spin session looks like.
 *
 *   npx tsx scripts/feel.ts [config.json] [--rounds 2000000]
 */
import { readFileSync } from 'node:fs';
import { compileConfig, playRound } from '../src/math/engine';
import { SeededRng } from '../src/math/rng';
import type { GameConfig } from '../src/math/types';

const args = process.argv.slice(2);
const path = args.find((a) => a.endsWith('.json')) ?? new URL('../src/math/neon-drive.json', import.meta.url).pathname;
const roundsArg = args.indexOf('--rounds');
const N = roundsArg >= 0 ? Number(args[roundsArg + 1]) : 2_000_000;

const cfg = JSON.parse(readFileSync(path, 'utf8')) as GameConfig;
const cc = compileConfig(cfg);
const bet = cfg.betLevels[0];
const rng = new SeededRng('feel');

let any = 0;
let atLeast1 = 0;
let atLeast2 = 0;
let atLeast5 = 0;
let bonuses = 0;
let won = 0;
let dry = 0;
const dryRuns: number[] = [];

for (let i = 0; i < N; i++) {
  const r = playRound(cc, bet, rng);
  const x = r.totalWin / bet;
  won += r.totalWin;
  if (r.totalWin > 0) any++;
  if (r.freeSpins.length > 0) bonuses++;
  if (x >= 2) atLeast2++;
  if (x >= 5) atLeast5++;
  if (x >= 1) {
    atLeast1++;
    dryRuns.push(dry);
    dry = 0;
  } else {
    dry++;
  }
}
dryRuns.sort((a, b) => a - b);
const q = (p: number): number => dryRuns[Math.floor(p * (dryRuns.length - 1))];
const longDry = dryRuns.filter((d) => d >= 20).length / dryRuns.length;

// 200-spin sessions starting with 100 bets.
const sessions = 20000;
const S = 200;
const results: number[] = [];
let busted = 0;
let ahead = 0;
let sawBonus = 0;
for (let s = 0; s < sessions; s++) {
  let bal = 100 * bet;
  let bonus = false;
  let spins = 0;
  for (; spins < S && bal >= bet; spins++) {
    bal -= bet;
    const r = playRound(cc, bet, rng);
    bal += r.totalWin;
    if (r.freeSpins.length > 0) bonus = true;
  }
  if (spins < S) busted++;
  if (bal > 100 * bet) ahead++;
  if (bonus) sawBonus++;
  results.push(bal / bet);
}
results.sort((a, b) => a - b);

const pct = (x: number, d = 1): string => `${(x * 100).toFixed(d)}%`;
const line = (k: string, v: string): void => console.log(`${k.padEnd(34)}${v}`);
console.log(`\n${path.split('/').pop()}  (${N.toLocaleString('en')} rounds)\n`);
line('RTP (sampled)', pct(won / (N * bet), 2));
line('Any win', pct(any / N));
line('Win of at least 1x bet', `${pct(atLeast1 / N)}  (1 in ${(N / atLeast1).toFixed(1)})`);
line('Win of at least 2x bet', `${pct(atLeast2 / N)}  (1 in ${(N / atLeast2).toFixed(1)})`);
line('Win of at least 5x bet', `${pct(atLeast5 / N)}  (1 in ${(N / atLeast5).toFixed(1)})`);
line('Bonus', `1 in ${(N / bonuses).toFixed(0)}`);
line('Spins between 1x+ wins (median)', `${q(0.5)}`);
line('  90th percentile', `${q(0.9)}`);
line('  dry spells of 20+ spins', pct(longDry));
console.log(`\n200-spin session, starting with 100 bets:`);
line('  Ran out before 200 spins', pct(busted / sessions));
line('  Finished ahead', pct(ahead / sessions));
line('  Saw a bonus', pct(sawBonus / sessions));
line('  Median balance at the end', `${results[sessions / 2].toFixed(0)} bets`);
