/**
 * Game events. Nothing listens yet; they're the hooks for sound (and
 * analytics) so audio can be added without touching game logic.
 */
export interface GameEvents {
  spinStart: { bet: number };
  reelStop: { reel: number };
  anticipation: { reel: number };
  win: { amount: number; bet: number; celebrate: boolean };
  bigWin: { amount: number; bet: number; tier: string };
  bonusTrigger: { scatters: number; spins: number };
  bonusStart: { spins: number };
  multiplier: { multiplier: number };
  retrigger: { spins: number };
  bonusEnd: { win: number };
  roundEnd: { win: number; bet: number };
  betChange: { bet: number };
}

type Handler<T> = (payload: T) => void;

export class Emitter<E extends object> {
  private handlers = new Map<keyof E, Set<Handler<never>>>();

  on<K extends keyof E>(type: K, fn: Handler<E[K]>): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    set.add(fn as Handler<never>);
    return () => set!.delete(fn as Handler<never>);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    for (const fn of this.handlers.get(type) ?? []) (fn as Handler<E[K]>)(payload);
  }
}
