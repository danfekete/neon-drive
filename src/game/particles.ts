/**
 * A lightweight particle system on Pixi's ParticleContainer. Additive
 * blending makes overlapping sparks bloom, which is most of the neon look.
 */
import { Particle, ParticleContainer, type Texture, Container } from 'pixi.js';

interface Live {
  p: Particle;
  vx: number;
  vy: number;
  life: number;
  age: number;
  gravity: number;
  drag: number;
  s0: number;
  s1: number;
  spin: number;
  stretch: boolean;
  pool: ParticleContainer;
}

export interface EmitOptions {
  x: number;
  y: number;
  count: number;
  colors: number[];
  /** Spawn area half-size around x, y. */
  spreadX?: number;
  spreadY?: number;
  speed?: [number, number];
  /** Direction range in radians. Default: all around. */
  angle?: [number, number];
  life?: [number, number];
  gravity?: number;
  drag?: number;
  scale?: [number, number];
  kind?: 'spark' | 'shard';
  spin?: number;
  /** Stretch sparks along their velocity, like streaks. */
  stretch?: boolean;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

export class Particles {
  readonly view = new Container();
  private sparks: ParticleContainer;
  private shards: ParticleContainer;
  private live: Live[] = [];
  /** Scales every emit count (lower on phones / reduced motion). */
  quality = 1;
  maxParticles = 2000;

  constructor(private spark: Texture, private shard: Texture) {
    const opts = {
      dynamicProperties: { position: true, rotation: true, vertex: true, color: true },
    };
    this.sparks = new ParticleContainer({ ...opts, texture: spark });
    this.shards = new ParticleContainer({ ...opts, texture: shard });
    this.sparks.blendMode = 'add';
    this.shards.blendMode = 'add';
    this.view.addChild(this.shards, this.sparks);
  }

  emit(o: EmitOptions): void {
    const n = Math.round(o.count * this.quality);
    const kind = o.kind ?? 'spark';
    const pool = kind === 'spark' ? this.sparks : this.shards;
    const texture = kind === 'spark' ? this.spark : this.shard;
    for (let i = 0; i < n && this.live.length < this.maxParticles; i++) {
      const a = o.angle ? rand(o.angle[0], o.angle[1]) : Math.random() * Math.PI * 2;
      const sp = o.speed ? rand(o.speed[0], o.speed[1]) : rand(80, 320);
      const s = o.scale ?? (kind === 'spark' ? [0.5, 0] : [1, 0.2]);
      const p = new Particle({
        texture,
        x: o.x + rand(-(o.spreadX ?? 0), o.spreadX ?? 0),
        y: o.y + rand(-(o.spreadY ?? 0), o.spreadY ?? 0),
        anchorX: 0.5,
        anchorY: 0.5,
        tint: o.colors[(Math.random() * o.colors.length) | 0],
        rotation: Math.random() * Math.PI * 2,
      });
      p.scaleX = p.scaleY = s[0];
      pool.addParticle(p);
      this.live.push({
        p,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life: o.life ? rand(o.life[0], o.life[1]) : rand(0.5, 1.1),
        age: 0,
        gravity: o.gravity ?? 0,
        drag: o.drag ?? 1.6,
        s0: s[0],
        s1: s[1],
        spin: o.spin ? rand(-o.spin, o.spin) : 0,
        stretch: o.stretch ?? false,
        pool,
      });
    }
  }

  update(dt: number): void {
    const keep: Live[] = [];
    for (const l of this.live) {
      l.age += dt;
      if (l.age >= l.life) {
        l.pool.removeParticle(l.p);
        continue;
      }
      const k = Math.exp(-l.drag * dt);
      l.vx *= k;
      l.vy = l.vy * k + l.gravity * dt;
      l.p.x += l.vx * dt;
      l.p.y += l.vy * dt;
      const t = l.age / l.life;
      const s = l.s0 + (l.s1 - l.s0) * t;
      if (l.stretch) {
        const v = Math.hypot(l.vx, l.vy);
        l.p.rotation = Math.atan2(l.vy, l.vx) + Math.PI / 2;
        l.p.scaleX = s * 0.6;
        l.p.scaleY = s * (1 + Math.min(4, v / 140));
      } else {
        l.p.rotation += l.spin * dt;
        l.p.scaleX = l.p.scaleY = s;
      }
      l.p.alpha = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85;
      keep.push(l);
    }
    this.live = keep;
  }

  clear(): void {
    for (const l of this.live) l.pool.removeParticle(l.p);
    this.live = [];
  }

  get count(): number {
    return this.live.length;
  }
}
