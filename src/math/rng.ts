/**
 * Random number sources for the math engine.
 *
 * The engine never calls Math.random directly. It takes an `Rng`, so the
 * simulator can use a seeded generator (reproducible runs, replayable bugs)
 * and the game can use the browser's crypto source.
 */
export interface Rng {
  /** Uniform 32-bit unsigned integer. */
  nextU32(): number;
}

/** Uniform integer in [0, n). Rejection sampling, so there is no modulo bias. */
export function randInt(rng: Rng, n: number): number {
  if (n <= 0 || n > 0x100000000 || !Number.isInteger(n)) {
    throw new RangeError(`randInt: invalid range ${n}`);
  }
  const limit = 0x100000000 - (0x100000000 % n);
  let x = rng.nextU32();
  while (x >= limit) x = rng.nextU32();
  return x % n;
}

/**
 * sfc32: small, fast, well-tested 128-bit-state generator.
 * Good enough for simulation; not for real-money play.
 */
export class SeededRng implements Rng {
  private a: number;
  private b: number;
  private c: number;
  private d: number;

  constructor(seed: number | string) {
    const h = hashSeed(String(seed));
    this.a = h[0];
    this.b = h[1];
    this.c = h[2];
    this.d = h[3];
    for (let i = 0; i < 16; i++) this.nextU32();
  }

  nextU32(): number {
    const t = (((this.a + this.b) | 0) + this.d) | 0;
    this.d = (this.d + 1) | 0;
    this.a = this.b ^ (this.b >>> 9);
    this.b = (this.c + (this.c << 3)) | 0;
    this.c = (this.c << 21) | (this.c >>> 11);
    this.c = (this.c + t) | 0;
    return t >>> 0;
  }
}

/** cyrb128 string hash, used to expand a seed into four 32-bit words. */
function hashSeed(str: string): [number, number, number, number] {
  let h1 = 1779033703;
  let h2 = 3144134277;
  let h3 = 1013904242;
  let h4 = 2773480762;
  for (let i = 0; i < str.length; i++) {
    const k = str.charCodeAt(i);
    h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
    h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
    h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
    h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
  }
  h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
  h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
  h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
  h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
  return [
    (h1 ^ h2 ^ h3 ^ h4) >>> 0,
    (h2 ^ h1) >>> 0,
    (h3 ^ h1) >>> 0,
    (h4 ^ h1) >>> 0,
  ];
}

/** Browser/Node crypto source, buffered for speed. Used by the live game. */
export class CryptoRng implements Rng {
  private buf = new Uint32Array(256);
  private i = 256;

  nextU32(): number {
    if (this.i >= this.buf.length) {
      globalThis.crypto.getRandomValues(this.buf);
      this.i = 0;
    }
    return this.buf[this.i++];
  }
}

/** Replays a fixed list of values, for unit tests. */
export class ScriptedRng implements Rng {
  private i = 0;
  constructor(private readonly values: number[]) {}
  nextU32(): number {
    if (this.i >= this.values.length) throw new Error('ScriptedRng exhausted');
    return this.values[this.i++] >>> 0;
  }
}
