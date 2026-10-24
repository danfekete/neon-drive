/**
 * The game controller: owns balance and bet, asks the math engine for a
 * round, then plays the result back through the reels, effects and HUD.
 * The outcome is fully decided before the reels move; everything here is
 * presentation.
 */
import { Application, BlurFilter, Container, Graphics, Point, Sprite, Text } from 'pixi.js';
import { compileConfig, gridAt, playRound, randomStops, type CompiledConfig } from '../math/engine';
import { CryptoRng, type Rng } from '../math/rng';
import type { GameConfig, RoundResult, SpinStep, WayWin } from '../math/types';
import { Background } from './background';
import { Emitter, type GameEvents } from './events';
import { BonusPanel, Logo, Readout, RoundButton, fmt, icons, labelStyle } from './hud';
import { createInfoScreen, type InfoScreen } from './info';
import { Overlay } from './overlay';
import { C, FONT_UI, mix } from './palette';
import { Particles, type EmitOptions } from './particles';
import { ReelSet } from './reels';
import { createSymbolTextures, symbolColor, type SymbolTextures } from './symbols';
import { ease, Tweener } from './tween';

type Phase = 'idle' | 'spin' | 'present' | 'bonus';
type Mode = 'landscape' | 'portrait';

const STORAGE_KEY = 'neon-drive:v1';
const TIERS: { x: number; title: string }[] = [
  { x: 10, title: 'Big win' },
  { x: 25, title: 'Mega win' },
  { x: 50, title: 'Epic win' },
];

interface Highlight {
  source: Sprite;
  glow: Sprite;
  core: Sprite;
  color: number;
}

export class Game {
  readonly events = new Emitter<GameEvents>();
  private cc: CompiledConfig;
  private cfg: GameConfig;
  private rng: Rng = new CryptoRng();
  private tween: Tweener;
  private tex!: SymbolTextures;

  private bg = new Background();
  private world = new Container();
  private fx = new Container();
  private dash = new Graphics();
  private fxGlow = new Container();
  private fxCore = new Container();
  private particles!: Particles;
  private overlay: Overlay;
  private logo = new Logo();
  private bonusPanel = new BonusPanel();
  private reels!: ReelSet;
  private message: Text;
  private balanceReadout = new Readout('Balance', 44);
  private betReadout = new Readout('Bet', 44);
  private winReadout = new Readout('Win', 56);
  private spinButton: RoundButton;
  private betDown: RoundButton;
  private betUp: RoundButton;
  private infoButton: RoundButton;
  private refillButton: RoundButton;
  private refillLabel: Text;
  private info!: InfoScreen;

  private phase: Phase = 'idle';
  private mode: Mode = 'landscape';
  private balance: number;
  private bet: number;
  private shownWin = 0;
  private highlights: Highlight[] = [];
  private cycleToken = 0;
  private hot = 0;
  private reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private coarse = matchMedia('(pointer: coarse)').matches;

  constructor(private app: Application, config: GameConfig, private rtpLabel: string) {
    this.cfg = config;
    this.cc = compileConfig(config);
    this.tween = new Tweener(app.ticker);
    this.overlay = new Overlay(this.tween);

    const saved = this.load();
    this.balance = saved?.balance ?? config.startingBalance;
    this.bet = saved && config.betLevels.includes(saved.bet) ? saved.bet : config.defaultBet;

    this.message = new Text({
      text: '',
      style: { fontFamily: FONT_UI, fontWeight: '400', fontSize: 30, fill: C.lilac, align: 'center' },
    });
    this.message.anchor.set(0.5);

    this.spinButton = new RoundButton(84, C.magenta, icons.spin, () => void this.spin(), 'Spin');
    this.betDown = new RoundButton(30, C.cyan, icons.minus, () => this.changeBet(-1), 'Lower bet');
    this.betUp = new RoundButton(30, C.cyan, icons.plus, () => this.changeBet(1), 'Raise bet');
    this.infoButton = new RoundButton(32, C.lilac, icons.info, () => this.openInfo(), 'Game info');
    this.refillButton = new RoundButton(30, C.amber, icons.refill, () => this.refill(), 'Refill credits');
    this.refillLabel = new Text({ text: 'Refill', style: labelStyle(22) });
    this.refillLabel.anchor.set(0.5, 0);
  }

  async init(): Promise<void> {
    const app = this.app;
    const ids = this.cfg.symbols.map((s) => s.id);
    this.tex = createSymbolTextures(app.renderer, ids);
    this.particles = new Particles(this.tex.spark, this.tex.shard);
    this.particles.quality = this.reducedMotion ? 0.35 : this.coarse ? 0.65 : 1;
    this.particles.maxParticles = this.coarse ? 900 : 2200;

    const stops = randomStops(this.cc.base, this.rng);
    const grid = gridAt(this.cc.base, stops, this.cc.rows).map((col) => col.map((v) => this.cc.ids[v]));
    this.reels = new ReelSet(this.tex, grid, this.cc.rows, {
      onReelStop: (r) => this.events.emit('reelStop', { reel: r }),
      onAnticipation: (r) => this.events.emit('anticipation', { reel: r }),
    });

    this.fxGlow.filters = [new BlurFilter({ strength: 16, quality: 3 })];
    this.fxGlow.blendMode = 'add';
    this.fxCore.blendMode = 'add';
    this.fx.addChild(this.fxGlow, this.fxCore);

    this.world.addChild(
      this.logo,
      this.bonusPanel,
      this.reels.view,
      this.fx,
      this.dash,
      this.message,
      this.balanceReadout,
      this.betReadout,
      this.betDown,
      this.betUp,
      this.winReadout,
      this.refillButton,
      this.refillLabel,
      this.spinButton,
      this.infoButton,
    );
    app.stage.addChild(this.bg.view, this.world, this.overlay.view, this.particles.view);

    // Tap anywhere to hurry: slam the reels or skip the celebration.
    app.stage.eventMode = 'static';
    app.stage.hitArea = app.screen;
    app.stage.on('pointertap', () => this.hurry());

    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('resize', () => this.layout());
    app.ticker.add((t) => this.update(t.deltaMS / 1000));

    this.info = createInfoScreen(this.cfg, await this.symbolImages(), this.rtpLabel);
    this.refreshHud();
    this.winReadout.set(0);
    this.layout();
    this.message.text = 'Tap spin or press Space to play';
  }

  private async symbolImages(): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const [id, tex] of Object.entries(this.tex.normal)) {
      const s = new Sprite(tex);
      out[id] = await this.app.renderer.extract.base64({ target: s, format: 'png' });
      s.destroy();
    }
    return out;
  }

  // ---------------------------------------------------------------- layout

  private layout(): void {
    const { width: w, height: h } = this.app.screen;
    this.mode = h > w * 1.05 ? 'portrait' : 'landscape';
    const portrait = this.mode === 'portrait';
    const dw = portrait ? 1080 : 1920;
    // Portrait stretches to the phone's aspect so the controls sit at the bottom
    // of the screen instead of floating in a letterbox.
    const dh = portrait ? Math.max(1760, Math.min(2340, (dw * h) / w)) : 1080;
    const scale = Math.min(w / dw, h / dh);
    this.world.scale.set(scale);
    this.world.position.set((w - dw * scale) / 2, (h - dh * scale) / 2);
    this.app.stage.hitArea = this.app.screen;

    const P = (x: number, y: number) => new Point(x, y);
    let reelsAt: Point;
    let reelScale = 1;
    let ui = 1;
    if (!portrait) {
      reelsAt = P(510, 190);
      this.logo.position.set(960, 98);
      this.logo.scale.set(1);
      this.bonusPanel.arrange('sides', 480, 1440, 470);
      this.message.position.set(960, 790);
      this.balanceReadout.position.set(330, 912);
      this.betReadout.position.set(700, 912);
      this.betDown.position.set(586, 942);
      this.betUp.position.set(814, 942);
      this.spinButton.position.set(960, 930);
      this.winReadout.position.set(1360, 905);
      this.refillButton.position.set(120, 930);
      this.refillLabel.position.set(120, 966);
      this.infoButton.position.set(1846, 70);
      this.drawDash(150, 852, 1620, 178);
    } else {
      ui = 1.45;
      reelScale = 1.1;
      reelsAt = P(45, 440);
      const reelsBottom = reelsAt.y + this.reels.height * reelScale;
      this.logo.position.set(540, 170);
      this.logo.scale.set(1.12);
      this.bonusPanel.arrange('row', 0, 0, 330);
      this.message.position.set(540, reelsBottom + 62);
      const spinY = dh - 250;
      const rowY = spinY - 330;
      this.winReadout.position.set(540, (reelsBottom + 62 + rowY - 90) / 2 + 10);
      this.balanceReadout.position.set(250, rowY);
      this.betReadout.position.set(800, rowY);
      this.betDown.position.set(640, rowY + 46);
      this.betUp.position.set(960, rowY + 46);
      this.spinButton.position.set(540, spinY);
      this.refillButton.position.set(130, spinY);
      this.refillLabel.position.set(130, spinY + 52);
      this.infoButton.position.set(1000, 80);
      this.drawDash(30, rowY - 90, 1020, dh - rowY + 60);
    }
    for (const r of [this.balanceReadout, this.betReadout]) r.scale.set(ui);
    this.winReadout.scale.set(portrait ? 1.35 : 1);
    this.message.scale.set(portrait ? 1.3 : 1);
    for (const b of [this.betDown, this.betUp, this.refillButton, this.infoButton]) b.scale.set(portrait ? 1.5 : 1);
    this.refillLabel.scale.set(portrait ? 1.4 : 1);
    this.spinButton.scale.set(portrait ? 1.55 : 1);
    this.reels.view.scale.set(reelScale);
    this.fx.scale.set(reelScale);
    this.reels.view.position.copyFrom(reelsAt);
    this.fx.position.copyFrom(reelsAt);
    this.reelScale = reelScale;

    // Put the horizon a little above the bottom of the reels, so the sun rises behind them.
    const horizonY = this.world.y + (reelsAt.y + this.reels.height * reelScale - 110) * scale;
    this.bg.horizon = horizonY / h;
    this.bg.sunRadius = (290 * reelScale * scale) / h;
    this.bg.resize(w, h);

    const center = this.world.toGlobal(P(dw / 2, reelsAt.y + (this.reels.height * reelScale) / 2));
    this.overlay.resize(w, h, scale, center.x, center.y);
  }

  private reelScale = 1;

  /** Reel cell centre in world (design) space. */
  private cellInWorld(r: number, row: number): { x: number; y: number } {
    const c = this.reels.cellCenter(r, row);
    return { x: this.reels.view.x + c.x * this.reelScale, y: this.reels.view.y + c.y * this.reelScale };
  }

  /** A dark dashboard behind the controls, so the road grid doesn't fight the numbers. */
  private drawDash(x: number, y: number, w: number, h: number): void {
    const g = this.dash;
    g.clear();
    g.roundRect(x, y, w, h, 36).fill({ color: C.nightDeep, alpha: 0.62 });
    g.roundRect(x, y, w, h, 36).stroke({ width: 2, color: C.violet, alpha: 0.45 });
    g.moveTo(x + 40, y + 1).lineTo(x + w - 40, y + 1).stroke({ width: 2, color: C.cyan, alpha: 0.5 });
  }

  // ---------------------------------------------------------------- loop

  private update(dt: number): void {
    dt = Math.min(dt, 0.05);
    this.reels.update(dt, this.tween);
    this.particles.update(dt);
    this.logo.update(dt);
    this.bg.pulse = Math.max(0, this.bg.pulse - dt * 1.6);
    this.bg.update(this.tween.time, dt);

    const t = this.tween.time;
    for (const [i, h] of this.highlights.entries()) {
      const k = 0.5 + 0.5 * Math.sin(t * 6 + i * 0.5);
      h.glow.alpha = 0.55 + 0.45 * k;
      h.core.alpha = 0.25 + 0.3 * k;
      const s = 1.02 + 0.06 * k;
      h.glow.scale.set(s);
      h.core.scale.set(s);
      h.glow.rotation = h.core.rotation = h.source.rotation;
    }
  }

  // ---------------------------------------------------------------- input

  private hurry(): void {
    if (this.info.isOpen) return;
    if (this.phase === 'spin' && this.reels.spinning) this.reels.slam();
    else if (this.phase === 'present') this.tween.skip();
  }

  private onKey(e: KeyboardEvent): void {
    if (this.info.isOpen) {
      if (e.key === 'Escape' || e.key === 'i' || e.key === 'I') {
        e.preventDefault();
        this.info.close();
      }
      return;
    }
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      if (this.overlay.tap()) return;
      if (this.phase === 'idle') void this.spin();
      else this.hurry();
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      this.changeBet(1);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      this.changeBet(-1);
    } else if (e.key === 'i' || e.key === 'I') {
      this.openInfo();
    }
  }

  private openInfo(): void {
    if (this.phase !== 'idle' && this.phase !== 'present') return;
    this.info.open(this.bet);
  }

  private changeBet(dir: number): void {
    if (this.phase !== 'idle') return;
    const levels = this.cfg.betLevels;
    const i = Math.max(0, Math.min(levels.length - 1, levels.indexOf(this.bet) + dir));
    if (levels[i] === this.bet) return;
    this.bet = levels[i];
    this.save();
    this.refreshHud();
    this.events.emit('betChange', { bet: this.bet });
  }

  private refill(): void {
    if (this.phase !== 'idle') return;
    this.balance = this.cfg.startingBalance;
    this.save();
    this.refreshHud();
    this.message.text = `Topped up to ${fmt(this.balance)} play credits`;
    this.burstWorld(this.balanceReadout.x, this.balanceReadout.y + 30, {
      count: 40,
      colors: [C.amber, C.white],
      speed: [80, 260],
      life: [0.4, 0.9],
    });
  }

  private refreshHud(): void {
    this.balanceReadout.set(this.balance);
    this.betReadout.set(this.bet);
    const idle = this.phase === 'idle';
    const levels = this.cfg.betLevels;
    this.betDown.enabled = idle && this.bet > levels[0];
    this.betUp.enabled = idle && this.bet < levels[levels.length - 1];
    const broke = this.balance < this.bet;
    this.refillButton.visible = this.refillLabel.visible = broke && idle;
    this.spinButton.setIcon(this.phase === 'spin' ? icons.stop : icons.spin);
  }

  // ---------------------------------------------------------------- round

  async spin(): Promise<void> {
    if (this.info.isOpen) return;
    if (this.phase !== 'idle') {
      this.hurry();
      return;
    }
    if (this.balance < this.bet) {
      const cheapest = this.cfg.betLevels[0];
      this.message.text = this.balance >= cheapest ? 'Not enough credits for this bet. Lower it or refill.' : 'Out of credits. Tap refill to keep playing.';
      this.refreshHud();
      return;
    }

    this.cycleToken++;
    this.clearHighlights();
    this.balance -= this.bet;
    this.save();
    const result = this.nextRound();

    this.phase = 'spin';
    this.refreshHud();
    this.message.text = '';
    this.shownWin = 0;
    this.winReadout.set(0);
    this.events.emit('spinStart', { bet: this.bet });

    this.speedUp(true);
    await this.reels.spin(result.base.grid, this.cfg.strips.base);
    this.speedUp(false);

    this.phase = 'present';
    await this.presentStep(result.base, result);
    this.balance += result.baseWin;
    this.refreshHud();

    if (result.freeSpins.length > 0) {
      await this.playBonus(result);
      this.balance += result.bonusWin;
    }

    this.phase = 'idle';
    this.save();
    this.refreshHud();
    this.events.emit('roundEnd', { win: result.totalWin, bet: this.bet });
    if (result.freeSpins.length === 0 && result.base.wins.length > 0) void this.cycleWins(result.base);
    if (this.balance < this.bet) this.message.text = 'Out of credits for this bet. Lower it or refill.';
  }

  /**
   * Demo hook for testing and showing off: `?demo=bonus` or `?demo=bigwin` in the URL
   * (or `neonDrive.demo = 'bonus'` in the console) makes the next spin play a real,
   * engine-generated round of that kind, found by sampling. Play money only.
   */
  demo: 'bonus' | 'bigwin' | null = (new URLSearchParams(location.search).get('demo') as 'bonus' | 'bigwin' | null) ?? null;

  private nextRound(): RoundResult {
    const want = this.demo;
    this.demo = null;
    if (!want) return playRound(this.cc, this.bet, this.rng);
    for (let i = 0; i < 200000; i++) {
      const r = playRound(this.cc, this.bet, this.rng);
      if (want === 'bonus' && r.freeSpins.length > 0 && r.bonusWin >= this.bet * 10) return r;
      if (want === 'bigwin' && r.freeSpins.length === 0 && r.totalWin >= this.bet * 25) return r;
    }
    return playRound(this.cc, this.bet, this.rng);
  }

  private speedUp(on: boolean): void {
    if (this.reducedMotion) return;
    this.tween.kill(this.bg);
    void this.tween.to(this.bg, { speed: on ? 4 : 1 }, { duration: on ? 0.4 : 0.9, ease: ease.outQuad, skippable: false });
  }

  /** Celebrate one spin's result (base or free spin). */
  private async presentStep(step: SpinStep, round: RoundResult, bonusTotal?: { before: number }): Promise<void> {
    const inBonus = bonusTotal !== undefined;
    const triggers = step.spinsAwarded > 0;
    const win = step.totalWin;
    if (win <= 0 && !triggers) return;

    const bet = round.bet;
    const celebrate = win >= bet || triggers;
    const cells = new Map<string, number>();
    for (const w of step.wins) for (const [r, row] of w.cells) cells.set(`${r},${row}`, symbolColor(w.symbol));
    if (triggers || step.scatterWin > 0) for (const [r, row] of step.scatterCells) cells.set(`${r},${row}`, C.magenta);

    this.reels.setDim(celebrate ? 0.3 : 0.55, new Set(cells.keys()));
    if (celebrate) {
      this.highlightCells(cells);
      for (const [key, color] of cells) {
        const [r, row] = key.split(',').map(Number);
        const c = this.cellInWorld(r, row);
        this.burstWorld(c.x, c.y, {
          count: 16,
          colors: [color, C.white],
          speed: [60, 260],
          life: [0.4, 0.9],
          spreadX: 40,
          spreadY: 40,
          stretch: true,
        });
      }
      this.bg.pulse = 1;
    }
    this.message.text = this.describe(step, inBonus);
    this.events.emit('win', { amount: win, bet, celebrate });

    const x = win / bet;
    if (!inBonus && x >= TIERS[0].x) {
      await this.bigWin(win, bet);
      this.shownWin = win;
      this.winReadout.set(win);
    } else {
      const from = inBonus ? bonusTotal.before : this.shownWin;
      const to = from + win;
      const dur = !celebrate ? 0 : x < 2 ? 0.5 : x < 5 ? 0.9 : 1.4;
      await this.rollReadout(from, to, dur);
      this.shownWin = to;
    }

    if (triggers && !inBonus) {
      this.events.emit('bonusTrigger', { scatters: step.scatterCount, spins: step.spinsAwarded });
      await this.tween.wait(1.1);
    } else {
      await this.tween.wait(celebrate ? 0.7 : 0.35);
    }
  }

  private describe(step: SpinStep, inBonus: boolean): string {
    const parts: string[] = [];
    const name = (id: string): string => this.cfg.symbols.find((s) => s.id === id)?.name ?? id;
    if (step.wins.length === 1) {
      const w = step.wins[0];
      parts.push(`${name(w.symbol)} on ${w.count} reels, ${w.ways} ${w.ways === 1 ? 'way' : 'ways'}`);
    } else if (step.wins.length > 1) {
      parts.push(`${step.wins.length} wins`);
    }
    if (inBonus && step.wayWin > 0 && step.multiplier > 1) {
      parts.push(`${fmt(step.wayWin / step.multiplier)} × ${step.multiplier} = ${fmt(step.wayWin)}`);
    } else if (step.wayWin > 0) {
      parts.push(`pays ${fmt(step.wayWin)}`);
    }
    if (step.scatterWin > 0) parts.push(`vinyls pay ${fmt(step.scatterWin)}`);
    if (step.spinsAwarded > 0) {
      parts.push(inBonus ? `${step.spinsAwarded} more free spins` : `${step.spinsAwarded} free spins`);
    }
    const s = parts.join(', ');
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  private rollReadout(from: number, to: number, duration: number): Promise<void> {
    if (duration <= 0) {
      this.winReadout.set(to);
      return Promise.resolve();
    }
    return this.tween.run(duration, (t) => this.winReadout.set(from + (to - from) * t), { ease: ease.outCubic });
  }

  private async bigWin(win: number, bet: number): Promise<void> {
    const x = win / bet;
    const top = [...TIERS].reverse().find((t) => x >= t.x)!;
    const steps = TIERS.indexOf(top);
    const duration = 2.4 + steps * 1.3;
    let tier = 0;
    this.events.emit('bigWin', { amount: win, bet, tier: top.title });

    await this.overlay.show({ title: TIERS[0].title, amount: '0', hint: 'Tap to skip' });
    this.overlay.onTap = () => this.tween.skip();
    const center = this.overlay.content.position;
    const fountain = (t: number): void => {
      const v = win * t;
      this.overlay.amount.text = fmt(v);
      this.winReadout.set(v);
      while (tier + 1 < TIERS.length && v / bet >= TIERS[tier + 1].x) {
        tier++;
        this.overlay.setTitle(TIERS[tier].title);
        this.overlay.pop();
        this.burstScreen(center.x, center.y, { count: 90, colors: [C.amber, C.magenta, C.cyan], speed: [300, 900], life: [0.8, 1.6], kind: 'shard', spin: 8, gravity: 300 });
      }
      if (Math.random() < 0.6) {
        const w = this.app.screen.width;
        this.burstScreen(Math.random() * w, -20, {
          count: 3,
          colors: [C.amber, C.magenta, C.cyan, C.white],
          speed: [40, 160],
          angle: [Math.PI * 0.3, Math.PI * 0.7],
          life: [1.6, 2.6],
          gravity: 420,
          kind: Math.random() < 0.5 ? 'shard' : 'spark',
          spin: 6,
          scale: [0.9, 0.4],
        });
      }
    };
    await this.tween.run(duration, fountain, { ease: ease.outQuad });
    fountain(1);
    this.overlay.hint.text = 'Tap to continue';
    await this.overlay.waitTap(2.5);
    await this.overlay.hide();
  }

  // ---------------------------------------------------------------- bonus

  private async playBonus(round: RoundResult): Promise<void> {
    const base = round.base;
    this.phase = 'bonus';
    this.refreshHud();
    await this.overlay.show({
      title: 'Overdrive',
      amount: String(base.spinsAwarded),
      subtitle: 'free spins. The multiplier climbs after every win.',
      hint: 'Tap to start',
    });
    this.burstScreen(this.overlay.content.x, this.overlay.content.y, { count: 120, colors: [C.magenta, C.crimson, C.amber], speed: [300, 1000], life: [0.8, 1.6], kind: 'shard', spin: 8, gravity: 200 });
    await this.overlay.waitTap(4);
    this.clearHighlights();
    this.reels.setDim(1);
    void this.overlay.hide();
    this.events.emit('bonusStart', { spins: base.spinsAwarded });

    await this.setHot(1);
    this.bonusPanel.visible = true;
    this.bonusPanel.alpha = 0;
    this.bonusPanel.setMultiplier(this.cfg.multiplier.start);
    this.bonusPanel.setSpins(base.spinsAwarded);
    void this.tween.to(this.bonusPanel, { alpha: 1 }, { duration: 0.4 });
    this.winReadout.caption.text = 'Bonus win';
    this.winReadout.set(0);

    let total = 0;
    let topMultiplier = this.cfg.multiplier.start;
    for (const step of round.freeSpins) {
      this.clearHighlights();
      this.reels.setDim(1);
      this.bonusPanel.setSpins(step.spinsLeft - step.spinsAwarded);
      this.phase = 'spin';
      this.refreshHud();
      this.speedUp(true);
      await this.reels.spin(step.grid, this.cfg.strips.free, { quick: true });
      this.speedUp(false);
      this.phase = 'present';
      this.refreshHud();

      await this.presentStep(step, round, { before: total });
      total += step.totalWin;
      this.shownWin = total;

      if (step.multiplierAfter > step.multiplier) {
        topMultiplier = step.multiplierAfter;
        await this.multiplierUp(step.multiplierAfter);
      }
      if (step.spinsAwarded > 0) {
        this.events.emit('retrigger', { spins: step.spinsAwarded });
        await this.overlay.show({ title: 'Encore', amount: `+${step.spinsAwarded}`, subtitle: 'free spins' });
        await this.overlay.waitTap(1.6);
        await this.overlay.hide();
        this.bonusPanel.setSpins(step.spinsLeft);
      }
      await this.tween.wait(0.3);
    }

    this.clearHighlights();
    this.reels.setDim(1);
    this.phase = 'bonus';
    const x = round.bonusWin / round.bet;
    const tier = [...TIERS].reverse().find((t) => x >= t.x);
    const parts = [`${round.freeSpins.length} spins, top multiplier ×${topMultiplier}`];
    if (round.capped) parts.unshift(`Max win of ${fmt(this.cfg.maxWinX)}× reached`);
    await this.overlay.show({
      title: round.capped ? 'Max win' : tier ? tier.title : 'Overdrive complete',
      amount: fmt(round.bonusWin),
      subtitle: parts.join('. '),
      hint: 'Tap to continue',
    });
    if (round.bonusWin >= round.bet) {
      this.burstScreen(this.overlay.content.x, this.overlay.content.y, {
        count: tier ? 160 : 70,
        colors: [C.amber, C.magenta, C.cyan],
        speed: [300, 1000],
        life: [0.9, 1.8],
        kind: 'shard',
        spin: 8,
        gravity: 300,
      });
    }
    this.events.emit('bonusEnd', { win: round.bonusWin });
    await this.overlay.waitTap(6);
    void this.overlay.hide();

    void this.tween.to(this.bonusPanel, { alpha: 0 }, { duration: 0.4 }).then(() => (this.bonusPanel.visible = false));
    await this.setHot(0);
    this.winReadout.caption.text = 'Win';
    this.winReadout.set(round.totalWin);
    this.shownWin = round.totalWin;
    this.message.text = `Overdrive paid ${fmt(round.bonusWin)}`;
  }

  private async multiplierUp(m: number): Promise<void> {
    this.events.emit('multiplier', { multiplier: m });
    this.bonusPanel.setMultiplier(m);
    const target = this.bonusPanel.multiplier;
    this.burstWorld(target.x, target.y, { count: 50, colors: [C.crimson, C.amber, C.white], speed: [150, 520], life: [0.5, 1.1], kind: 'shard', spin: 10 });
    this.bg.pulse = 1;
    const s0 = target.scale.x;
    await this.tween.run(0.45, (t) => target.scale.set(s0 * (1 + 0.35 * Math.sin(t * Math.PI))), { ease: ease.outQuad });
    target.scale.set(s0);
  }

  private setHot(to: number): Promise<void> {
    const from = this.hot;
    return this.tween.run(
      1.1,
      (t) => {
        this.hot = from + (to - from) * t;
        this.bg.hot = this.hot;
        this.reels.hot = this.hot;
        this.reels.drawFrame();
        this.logo.setHot(this.hot);
        this.overlay.setHot(this.hot);
        this.spinButton.setColor(mix(C.magenta, C.crimson, this.hot));
      },
      { ease: ease.inOutQuad, skippable: false },
    );
  }

  // ---------------------------------------------------------------- effects

  private highlightCells(cells: Map<string, number>): void {
    for (const [key, color] of cells) {
      const [r, row] = key.split(',').map(Number);
      const source = this.reels.sprite(r, row);
      const c = this.reels.cellCenter(r, row);
      const make = (): Sprite => {
        const s = new Sprite(source.texture);
        s.anchor.set(0.5);
        s.position.set(c.x, c.y);
        s.rotation = source.rotation;
        return s;
      };
      const glow = make();
      glow.tint = color;
      const core = make();
      this.fxGlow.addChild(glow);
      this.fxCore.addChild(core);
      this.highlights.push({ source, glow, core, color });
    }
  }

  private clearHighlights(): void {
    for (const h of this.highlights) {
      h.glow.destroy();
      h.core.destroy();
    }
    this.highlights = [];
  }

  /** After a base-game win, step through each way-win while idle. */
  private async cycleWins(step: SpinStep): Promise<void> {
    if (step.wins.length < 2) return;
    const token = this.cycleToken;
    await this.tween.wait(1.2, false);
    let i = 0;
    while (token === this.cycleToken && this.phase === 'idle') {
      const w: WayWin = step.wins[i % step.wins.length];
      const cells = new Map<string, number>();
      for (const [r, row] of w.cells) cells.set(`${r},${row}`, symbolColor(w.symbol));
      this.clearHighlights();
      this.reels.setDim(0.35, new Set(cells.keys()));
      if (step.totalWin >= this.bet) this.highlightCells(cells);
      const name = this.cfg.symbols.find((s) => s.id === w.symbol)?.name ?? w.symbol;
      this.message.text = `${name} on ${w.count} reels, ${w.ways} ${w.ways === 1 ? 'way' : 'ways'}, pays ${fmt(w.win)}`;
      i++;
      await this.tween.wait(1.5, false);
    }
  }

  private toScreen(x: number, y: number): Point {
    return this.world.toGlobal(new Point(x, y));
  }

  /** Particle burst at a design-space point; speeds and sizes scale with the world. */
  private burstWorld(x: number, y: number, o: Omit<EmitOptions, 'x' | 'y'>): void {
    const p = this.toScreen(x, y);
    const k = this.world.scale.x;
    this.particles.emit({
      ...o,
      x: p.x,
      y: p.y,
      spreadX: (o.spreadX ?? 0) * k,
      spreadY: (o.spreadY ?? 0) * k,
      speed: o.speed ? [o.speed[0] * k, o.speed[1] * k] : undefined,
      gravity: (o.gravity ?? 0) * k,
      scale: o.scale ? [o.scale[0] * k * 1.6, o.scale[1] * k * 1.6] : [0.8 * k * 1.6, 0],
    });
  }

  private burstScreen(x: number, y: number, o: Omit<EmitOptions, 'x' | 'y'>): void {
    const k = Math.max(0.45, this.overlay.content.scale.x);
    this.particles.emit({
      ...o,
      x,
      y,
      speed: o.speed ? [o.speed[0] * k, o.speed[1] * k] : undefined,
      gravity: (o.gravity ?? 0) * k,
      scale: o.scale ? [o.scale[0] * k, o.scale[1] * k] : undefined,
    });
  }

  // ---------------------------------------------------------------- storage

  private load(): { balance: number; bet: number } | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const v = JSON.parse(raw) as { balance?: unknown; bet?: unknown };
      if (typeof v.balance === 'number' && typeof v.bet === 'number' && Number.isFinite(v.balance) && v.balance >= 0) {
        return { balance: Math.floor(v.balance), bet: v.bet };
      }
    } catch {
      // Storage unavailable (private mode etc): start fresh.
    }
    return null;
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ balance: this.balance, bet: this.bet }));
    } catch {
      // Ignore: the game works without persistence.
    }
  }
}

