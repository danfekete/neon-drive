/**
 * The info screen: paytable drawn with the real symbol art, rules and RTP.
 * Plain DOM so it scrolls, wraps and reads well on any screen.
 */
import type { GameConfig } from '../math/types';
import { fmt } from './hud';

export interface InfoScreen {
  open(bet: number): void;
  close(): void;
  readonly isOpen: boolean;
}

export function createInfoScreen(cfg: GameConfig, images: Record<string, string>, rtp: string): InfoScreen {
  const root = document.getElementById('info') as HTMLDivElement;
  const unit = (bet: number): number => bet / cfg.coinsPerBet;
  const paying = cfg.symbols.filter((s) => s.kind === 'low' || s.kind === 'high').reverse();

  const render = (bet: number): void => {
    const rows = paying
      .map((s) => {
        const p = cfg.paytable[s.id];
        const cell = (n: '5' | '4' | '3'): string =>
          `<span class="pay"><b>${n}</b>${fmt(p[n] * unit(bet))}</span>`;
        return `<li><img src="${images[s.id]}" alt="${s.name}" width="72" height="72"><span class="pays">${cell('5')}${cell('4')}${cell('3')}</span></li>`;
      })
      .join('');
    const sp = cfg.scatter.pays;
    const aw = cfg.scatter.awards;
    root.innerHTML = `
      <div class="sheet" role="dialog" aria-modal="true" aria-labelledby="info-title">
        <button class="close" type="button" aria-label="Close">×</button>
        <h1 id="info-title">How Neon Drive pays</h1>
        <p class="note">Pays shown in credits per way at your bet of ${fmt(bet)}.</p>
        <ul class="paytable">${rows}</ul>
        <div class="specials">
          <div class="special"><img src="${images.WILD}" alt="Wild" width="88" height="88"><p>Wild lands on reels 2, 3 and 4 and stands in for every symbol except the vinyl.</p></div>
          <div class="special"><img src="${images.SCAT}" alt="Vinyl scatter" width="88" height="88"><p>Vinyl pays anywhere on the reels. 3, 4 or 5 pay ${sp['3']}×, ${sp['4']}× or ${sp['5']}× your bet and start ${aw['3']}, ${aw['4']} or ${aw['5']} free spins.</p></div>
        </div>
        <h2>Overdrive free spins</h2>
        <p>The multiplier starts at ×${cfg.multiplier.start} and climbs by ${cfg.multiplier.step} after every winning free spin, so long bonuses build up. Land 3 or more vinyls during free spins for ${cfg.scatter.retrigger.spins} more.</p>
        <h2>243 ways</h2>
        <p>Matching symbols on neighbouring reels, starting from the left, pay. Every combination of positions counts: 2 matches on reel 1 and 2 on reel 2 is 4 ways. Wins on different symbols add up.</p>
        <h2>The fine print</h2>
        <p>A round can win at most ${fmt(cfg.maxWinX)}× your bet. Return to player is ${rtp}, measured over 60 million simulated rounds. Neon Drive uses play credits only: they have no cash value and can't be bought or cashed out.</p>
        <p class="keys">Keyboard: Space or Enter spins and stops, the arrow keys change your bet, I opens this screen, Escape closes it.</p>
      </div>`;
    root.querySelector<HTMLButtonElement>('.close')!.addEventListener('click', close);
  };

  let isOpen = false;
  let lastFocus: Element | null = null;

  function close(): void {
    if (!isOpen) return;
    isOpen = false;
    root.hidden = true;
    root.innerHTML = '';
    (lastFocus as HTMLElement | null)?.focus?.();
  }

  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });

  return {
    open(bet: number) {
      lastFocus = document.activeElement;
      render(bet);
      root.hidden = false;
      isOpen = true;
      root.querySelector<HTMLButtonElement>('.close')!.focus();
    },
    close,
    get isOpen() {
      return isOpen;
    },
  };
}
