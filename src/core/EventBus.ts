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
    let list = this.listeners.get(type);
    if (!list) {
      list = [];
      this.listeners.set(type, list);
    }
    list.push(fn as Listener<never>);
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
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.listeners.get(type);
    if (!list || list.length === 0) return;
    // Iterate over a snapshot-length so listeners may unsubscribe while dispatching.
    for (let i = 0, n = list.length; i < n; i++) {
      const fn = list[i] as Listener<Events[K]> | undefined;
      if (fn) fn(payload);
    }
  }

  hasListeners<K extends keyof Events>(type: K): boolean {
    const list = this.listeners.get(type);
    return !!list && list.length > 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
