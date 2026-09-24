/**
 * Minimal, typed, synchronous publish/subscribe bus.
 *
 * Gameplay systems communicate through events instead of holding references
 * to each other (the sim emits "jointBroken"; audio, effects, scoring and UI
 * each listen independently).
 */
export type Listener<T> = (payload: T) => void;

export class EventBus<Events extends object> {
  private listeners = new Map<keyof Events, Listener<never>[]>();

  on<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    const list = this.listeners.get(type);
    // Copy-on-write (see off()).
    this.listeners.set(type, list ? [...list, fn as Listener<never>] : [fn as Listener<never>]);
    return () => this.off(type, fn);
  }

  once<K extends keyof Events>(type: K, fn: Listener<Events[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, fn: Listener<Events[K]>): void {
    const list = this.listeners.get(type);
    if (!list) return;
    const i = list.indexOf(fn as Listener<never>);
    // Copy-on-write so an in-progress emit() keeps iterating its own snapshot.
    if (i >= 0) this.listeners.set(type, list.filter((_, k) => k !== i));
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.listeners.get(type);
    if (!list || list.length === 0) return;
    // `list` is never mutated in place, so listeners may (un)subscribe while dispatching.
    for (let i = 0, n = list.length; i < n; i++) (list[i] as Listener<Events[K]>)(payload);
  }

  hasListeners<K extends keyof Events>(type: K): boolean {
    const list = this.listeners.get(type);
    return !!list && list.length > 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
