/**
 * Full-screen moments: big-win tiers, the Overdrive intro and outro, and the
 * retrigger and max-win callouts. The dim covers the whole screen; the
 * content is laid out in design space and scaled like the rest of the game.
 */
import { BlurFilter, Container, Graphics, Text } from 'pixi.js';
import { C, FONT_LOGO, FONT_UI, mix } from './palette';
import { chromeFill, labelStyle } from './hud';
import { ease, type Tweener } from './tween';

export class Overlay {
  readonly view = new Container();
  readonly content = new Container();
  private dim = new Graphics();
  private titleGlow: Text;
  readonly title: Text;
  readonly amount: Text;
  readonly subtitle: Text;
  readonly hint: Text;
  /** Called when the overlay is tapped. Set by whoever is waiting on it. */
  onTap: (() => void) | null = null;
  private w = 1;
  private h = 1;

  constructor(private tween: Tweener) {
    const titleStyle = { fontFamily: FONT_LOGO, fontSize: 104, fill: 0xffe0f0, letterSpacing: 4, align: 'center' as const };
    this.titleGlow = new Text({ text: '', style: { ...titleStyle, fill: C.magenta } });
    this.titleGlow.filters = [new BlurFilter({ strength: 22, quality: 3 })];
    this.title = new Text({ text: '', style: { ...titleStyle, stroke: { color: C.magenta, width: 3 } } });
    this.amount = new Text({
      text: '',
      style: {
        fontFamily: FONT_UI,
        fontWeight: '900',
        fontStyle: 'italic',
        fontSize: 150,
        fill: chromeFill(),
        stroke: { color: C.cyan, width: 4, join: 'round' },
        dropShadow: { color: C.cyan, blur: 24, distance: 0, alpha: 0.6, angle: 0 },
        padding: 20,
      },
    });
    this.subtitle = new Text({
      text: '',
      style: { fontFamily: FONT_UI, fontWeight: '600', fontSize: 40, fill: C.white, align: 'center', wordWrap: true, wordWrapWidth: 900 },
    });
    this.hint = new Text({ text: '', style: labelStyle(28) });
    for (const t of [this.titleGlow, this.title, this.amount, this.subtitle, this.hint]) t.anchor.set(0.5);
    this.titleGlow.y = this.title.y = -150;
    this.amount.y = 10;
    this.subtitle.y = 150;
    this.hint.y = 250;
    this.content.addChild(this.titleGlow, this.title, this.amount, this.subtitle, this.hint);
    this.view.addChild(this.dim, this.content);
    this.view.visible = false;
    this.view.eventMode = 'static';
    this.view.on('pointertap', (e) => {
      e.stopPropagation();
      this.onTap?.();
    });
  }

  resize(w: number, h: number, scale: number, cx: number, cy: number): void {
    this.w = w;
    this.h = h;
    this.content.scale.set(Math.min(scale * 1.15, w / 980, h / 720));
    this.content.position.set(cx, cy);
    this.redrawDim();
  }

  private hot = 0;
  setHot(t: number): void {
    this.hot = t;
    const c = mix(C.magenta, C.crimson, t);
    this.titleGlow.style.fill = c;
    this.title.style.stroke = { color: c, width: 3 };
    this.redrawDim();
  }

  private redrawDim(): void {
    this.dim.clear();
    this.dim.rect(0, 0, this.w, this.h).fill({ color: mix(C.nightDeep, 0x0a0003, this.hot), alpha: 0.72 });
  }

  setTitle(text: string): void {
    this.title.text = text;
    this.titleGlow.text = text;
  }

  /** Show with the given texts. */
  async show(opts: { title: string; amount?: string; subtitle?: string; hint?: string }): Promise<void> {
    this.setTitle(opts.title);
    this.amount.text = opts.amount ?? '';
    this.subtitle.text = opts.subtitle ?? '';
    this.hint.text = opts.hint ?? '';
    this.subtitle.y = opts.amount ? 150 : 20;
    this.hint.y = opts.amount ? 250 : 130;
    this.view.visible = true;
    this.view.alpha = 0;
    this.content.pivot.set(0, 0);
    const s = this.content.scale.x;
    this.content.scale.set(s * 0.6);
    await Promise.all([
      this.tween.to(this.view, { alpha: 1 }, { duration: 0.25, skippable: false }),
      this.tween.run(0.55, (t) => this.content.scale.set(s * (0.6 + 0.4 * t)), { ease: ease.outBack, skippable: false }),
    ]);
  }

  /** Resolves on a tap anywhere, or after `timeout` seconds. */
  waitTap(timeout: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        if (this.onTap === finish) this.onTap = null;
        resolve();
      };
      this.onTap = finish;
      void this.tween.wait(timeout, false).then(finish);
    });
  }

  /** Programmatic tap (keyboard). */
  tap(): boolean {
    if (!this.view.visible || !this.onTap) return false;
    this.onTap();
    return true;
  }

  pop(): void {
    void this.tween.run(
      0.35,
      (t) => {
        const k = 1 + 0.14 * Math.sin(t * Math.PI);
        this.title.scale.set(k);
        this.titleGlow.scale.set(k);
      },
      { skippable: false },
    );
  }

  async hide(): Promise<void> {
    this.onTap = null;
    await this.tween.to(this.view, { alpha: 0 }, { duration: 0.25, skippable: false });
    this.view.visible = false;
  }

  get visible(): boolean {
    return this.view.visible;
  }
}
