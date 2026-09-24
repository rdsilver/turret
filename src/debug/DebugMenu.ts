/**
 * Debug menu (DOM panel, toggle with backquote `). OWNER: debug agent.
 * Buttons/sliders call into DebugApi (implemented by GameScene).
 */
import type { MaterialId } from '../sim/Materials';

export type DebugTool = 'fire' | 'grab' | 'block' | 'ball' | 'explode';

export interface DebugApi {
  reloadLevel(): void;
  randomizeStructure(): void;
  setPaused(p: boolean): void;
  isPaused(): boolean;
  stepOnce(): void;
  setSlowMo(on: boolean): void;
  isSlowMo(): boolean;
  setGravity(g: number): void;
  getGravity(): number;
  setProjectileMassScale(s: number): void;
  getProjectileMassScale(): number;
  setColliderDebug(on: boolean): void;
  isColliderDebug(): boolean;
  setStressView(on: boolean): void;
  isStressView(): boolean;
  setTool(t: DebugTool): void;
  getTool(): DebugTool;
  setSpawnMaterial(m: MaterialId): void;
  getSpawnMaterial(): MaterialId;
  setUnlimitedFire(on: boolean): void;
  isUnlimitedFire(): boolean;
  /** Spawn a benchmark structure with ~n parts. */
  benchmark(n: number): void;
  clearDebris(): void;
  addMoney(n: number): void;
  skipLevel(): void;
  getSeed(): number;
  loadSeed(seed: number): void;
}

export class DebugMenu {
  visible = false;

  constructor(readonly api: DebugApi) {}

  toggle(): void {
    this.visible = !this.visible;
  }

  /** Refresh displayed values (called a few times per second while visible). */
  refresh(): void {}

  destroy(): void {}
}
