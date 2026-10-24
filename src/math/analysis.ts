/**
 * Exact (closed-form) analysis of a strip set. Reels are independent, so the
 * expected ways-win factorises per reel; hit frequency and scatter odds are
 * computed by enumeration. No sampling noise, so tuning loops are fast.
 */
import { gridAt, type CompiledConfig } from './engine';

export interface ExactStats {
  /** Expected way-win per spin, as a fraction of the bet (no multiplier). */
  wayRtp: number;
  /** Expected scatter pay per spin, as a fraction of the bet. */
  scatterRtp: number;
  /** P(exactly n scatters), n = 0..reels. */
  scatterDist: number[];
  /** P(the spin pays anything: a way-win or a scatter pay). */
  hitRate: number;
  /** P(any way-win). */
  wayHitRate: number;
  /** Way RTP contribution by symbol id. */
  bySymbol: Record<string, number>;
}

export function exactStats(cc: CompiledConfig, strips: Int16Array[]): ExactStats {
  const { reels, rows } = cc;

  // Per reel: mean count of (symbol or wild) in the window, and P(count = 0).
  const meanCount: number[][] = [];
  const pZero: number[][] = [];
  const scatterP: number[] = [];
  for (let r = 0; r < reels; r++) {
    const strip = strips[r];
    const L = strip.length;
    const mean = new Array(cc.ids.length).fill(0);
    const zero = new Array(cc.ids.length).fill(0);
    let sc = 0;
    for (let stop = 0; stop < L; stop++) {
      const win: number[] = [];
      for (let row = 0; row < rows; row++) win.push(strip[(stop + row) % L]);
      if (win.includes(cc.scatter)) sc++;
      for (const s of cc.paying) {
        let c = 0;
        for (const v of win) if (v === s || v === cc.wild) c++;
        mean[s] += c;
        if (c === 0) zero[s]++;
      }
    }
    meanCount.push(mean.map((x) => x / L));
    pZero.push(zero.map((x) => x / L));
    scatterP.push(sc / L);
  }

  const bySymbol: Record<string, number> = {};
  let wayCoins = 0;
  for (const s of cc.paying) {
    let ev = 0;
    for (let n = 3; n <= reels; n++) {
      const p = cc.pay[s][n];
      if (!p) continue;
      let term = p;
      for (let r = 0; r < n; r++) term *= meanCount[r][s];
      if (n < reels) term *= pZero[n][s];
      ev += term;
    }
    bySymbol[cc.ids[s]] = ev / cc.cfg.coinsPerBet;
    wayCoins += ev;
  }

  // Scatter count distribution (at most one per reel, enforced by the config).
  let dist = [1];
  for (let r = 0; r < reels; r++) {
    const p = scatterP[r];
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((q, n) => {
      next[n] += q * (1 - p);
      next[n + 1] += q * p;
    });
    dist = next;
  }
  const scatterRtp = dist.reduce((acc, q, n) => acc + q * (cc.scatterPay[n] ?? 0), 0);

  // Hit rate: enumerate reels 1-3 (a way-win needs a match on all three),
  // and fold in scatter pays using the scatter distribution of reels 4+.
  let tail = [1];
  for (let r = 3; r < reels; r++) {
    const p = scatterP[r];
    const next = new Array(tail.length + 1).fill(0);
    tail.forEach((q, n) => {
      next[n] += q * (1 - p);
      next[n + 1] += q * p;
    });
    tail = next;
  }
  const minScatterPay = cc.scatterPay.findIndex((x, n) => n > 0 && x > 0);
  const pTailAtLeast = (k: number): number => {
    if (minScatterPay < 0) return 0;
    let s = 0;
    for (let n = Math.max(0, k); n < tail.length; n++) s += tail[n];
    return s;
  };

  const [L0, L1, L2] = [strips[0].length, strips[1].length, strips[2].length];
  let hit = 0;
  let wayHit = 0;
  const stops = new Array(reels).fill(0);
  for (let a = 0; a < L0; a++) {
    stops[0] = a;
    for (let b = 0; b < L1; b++) {
      stops[1] = b;
      for (let c = 0; c < L2; c++) {
        stops[2] = c;
        const g = gridAt(strips.slice(0, 3), stops, rows);
        let any = false;
        for (const s of cc.paying) {
          if (!cc.pay[s][3]) continue;
          let ok = true;
          for (let r = 0; r < 3 && ok; r++) {
            ok = g[r].some((v) => v === s || v === cc.wild);
          }
          if (ok) {
            any = true;
            break;
          }
        }
        if (any) {
          wayHit++;
          hit++;
        } else {
          let sc = 0;
          for (let r = 0; r < 3; r++) if (g[r].includes(cc.scatter)) sc++;
          hit += minScatterPay < 0 ? 0 : pTailAtLeast(minScatterPay - sc);
        }
      }
    }
  }
  const combos = L0 * L1 * L2;

  return {
    wayRtp: wayCoins / cc.cfg.coinsPerBet,
    scatterRtp,
    scatterDist: dist,
    hitRate: hit / combos,
    wayHitRate: wayHit / combos,
    bySymbol,
  };
}
