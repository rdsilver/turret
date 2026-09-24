/**
 * Tiny free-list object pool. Used for frequently spawned transient objects
 * (projectiles, effect records) so steady-state play allocates nothing.
 */
export class Pool<T> {
  private free: T[] = [];
  private created = 0;

  constructor(
    private readonly factory: () => T,
    private readonly reset?: (item: T) => void,
    private readonly max = 512,
  ) {}

  acquire(): T {
    const item = this.free.pop();
    if (item !== undefined) return item;
    this.created++;
    return this.factory();
  }

  release(item: T): void {
    if (this.reset) this.reset(item);
    if (this.free.length < this.max) this.free.push(item);
  }

  get available(): number {
    return this.free.length;
  }

  get totalCreated(): number {
    return this.created;
  }
}
