import { Application } from 'pixi.js';
import { Game } from './game/game';
import config from './math/neon-drive.json';
import type { GameConfig } from './math/types';

/** Measured by `npm run sim` over 60 million rounds. */
const RTP_LABEL = '96.15%';

async function loadFonts(): Promise<void> {
  const faces = ['400 20px Kanit', '600 40px Kanit', '800 12px Kanit', 'italic 900 50px Kanit', '900 50px Kanit', '80px Monoton'];
  const all = Promise.all(faces.map((f) => document.fonts.load(f)));
  // Don't hang forever on a slow font CDN: fall back to system fonts after 4s.
  await Promise.race([all, new Promise((r) => setTimeout(r, 4000))]);
}

async function boot(): Promise<void> {
  const status = document.querySelector<HTMLElement>('.boot-status')!;
  try {
    await loadFonts();
    const coarse = matchMedia('(pointer: coarse)').matches;
    const app = new Application();
    await app.init({
      resizeTo: window,
      background: '#12052e',
      antialias: true,
      autoDensity: true,
      resolution: Math.min(window.devicePixelRatio || 1, coarse ? 2 : 2),
      preference: 'webgl',
      powerPreference: 'high-performance',
    });
    app.canvas.setAttribute('aria-label', 'Neon Drive slot game');
    document.body.prepend(app.canvas);

    const game = new Game(app, config as GameConfig, RTP_LABEL);
    await game.init();
    (window as unknown as { neonDrive: Game }).neonDrive = game;

    const bootEl = document.getElementById('boot')!;
    bootEl.classList.add('gone');
    setTimeout(() => bootEl.remove(), 500);
  } catch (err) {
    console.error(err);
    status.textContent = 'This browser could not start the game. It needs WebGL; try a recent Chrome, Safari or Firefox.';
    status.classList.add('error');
  }
}

void boot();
