/**
 * Camera framing and shake. OWNER: effects agent.
 *
 * - frame(bounds): smoothly fit a sim-space rectangle (meters) into view
 *   (zoom + scroll), always keeping ground near the bottom; instant=true snaps.
 * - Trauma-based shake: addTrauma(0..1) accumulates; offset = maxOffset *
 *   trauma^2 * noise(t); decays over time. Subtle by default.
 * - punch(amount): brief zoom-in kick that springs back (big impacts).
 * - toSim(pointer): convert a screen pointer to sim meters.
 * - update(realDt) applies everything (uses real time so it works in slow-mo).
 */
import type * as Phaser from 'phaser';

export interface SimRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export class CameraDirector {
  constructor(readonly scene: Phaser.Scene) {}

  frame(bounds: SimRect, instant = false): void {
    void bounds;
    void instant; // IMPLEMENT
  }

  addTrauma(amount: number): void {
    void amount;
  }

  punch(amount: number): void {
    void amount;
  }

  toSim(screenX: number, screenY: number, out: { x: number; y: number }): { x: number; y: number } {
    void screenX;
    void screenY;
    return out; // IMPLEMENT
  }

  update(realDt: number): void {
    void realDt;
  }
}
