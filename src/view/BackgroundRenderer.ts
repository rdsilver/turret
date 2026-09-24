/**
 * Static backdrop in a minimalist "physics laboratory" style. OWNER: render agent.
 * Dark neutral background, faint measurement grid (1 m minor / 5 m major),
 * height ruler near the structure, ground slab with hatching, and the
 * objective's destruction line (dashed, labelled) when set.
 * World coordinates: pixels = meters * PPM, ground surface at y = 0.
 */
import type * as Phaser from 'phaser';

export class BackgroundRenderer {
  constructor(readonly scene: Phaser.Scene) {}

  /** (Re)draw for the given visible sim-space bounds (meters). */
  layout(bounds: { left: number; right: number; top: number; bottom: number }): void {
    void bounds; // IMPLEMENT
  }

  /** Destruction line at `height` m above ground spanning [x0, x1] m, or null to hide. */
  setDestructionLine(height: number | null, x0?: number, x1?: number): void {
    void height;
    void x0;
    void x1; // IMPLEMENT
  }

  /** 0..1 objective progress, used to color/animate the line. */
  setProgress(p: number): void {
    void p;
  }

  update(realDt: number): void {
    void realDt;
  }

  destroy(): void {}
}
