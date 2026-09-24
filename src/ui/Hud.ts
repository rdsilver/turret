/**
 * In-game HUD (screen space, scrollFactor 0 on the UI camera/scene). OWNER: UI agent.
 * Shows level title/objective, shots vs par, money, objective progress bar,
 * reload + power, ammo name, scanner charges, short popups ("CHAIN x12") and
 * a big banner when the structure collapses. Minimal, readable, lab-style.
 */
import type * as Phaser from 'phaser';
import type { SimPhase } from '../sim/Simulation';

export interface HudLevelInfo {
  index: number;
  total: number;
  name: string;
  subtitle: string;
  objective: string;
  par: number;
}

export interface HudState {
  shots: number;
  par: number;
  money: number;
  /** Objective progress 0..1. */
  progress: number;
  /** Reload 0..1 (1 = ready). */
  reload: number;
  /** Power 0.35..1. */
  power: number;
  ammoName: string;
  ammoCost: number;
  scanCharges: number;
  scanActive: boolean;
  phase: SimPhase;
  sandbox: boolean;
}

export class Hud {
  constructor(readonly scene: Phaser.Scene) {}

  setLevel(info: HudLevelInfo): void {
    void info; // IMPLEMENT
  }

  update(state: HudState, realDt: number): void {
    void state;
    void realDt; // IMPLEMENT
  }

  /** Short popup near the top center (chain counters, "+$40"). */
  flash(text: string, color?: string): void {
    void text;
    void color;
  }

  /** Big centered title (e.g. "STRUCTURE COLLAPSED"). */
  banner(title: string, subtitle?: string): void {
    void title;
    void subtitle;
  }

  /** Contextual hint line near the bottom. Empty string hides it. */
  hint(text: string): void {
    void text;
  }

  destroy(): void {}
}
