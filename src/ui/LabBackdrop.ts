/**
 * Static lab backdrop for menu-style scenes: dark field, fine measuring grid,
 * registration marks, plus one slow scan band (the only moving part).
 * Drawn once; update() only moves a rectangle.
 */
import type * as Phaser from 'phaser';
import { THEME } from './theme';

export class LabBackdrop {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly scan: Phaser.GameObjects.Rectangle;
  private t = 0;

  constructor(
    readonly scene: Phaser.Scene,
    opts: { minor?: number; major?: number } = {},
  ) {
    const W = scene.scale.width;
    const H = scene.scale.height;
    const minor = opts.minor ?? 40;
    const major = opts.major ?? 200;
    const g = scene.add.graphics().setDepth(-10);
    this.g = g;
    g.fillStyle(THEME.bg, 1);
    g.fillRect(0, 0, W, H);
    g.lineStyle(1, THEME.grid, 1);
    for (let x = 0; x <= W; x += minor) g.lineBetween(x + 0.5, 0, x + 0.5, H);
    for (let y = 0; y <= H; y += minor) g.lineBetween(0, y + 0.5, W, y + 0.5);
    g.lineStyle(1, THEME.gridMajor, 1);
    for (let x = 0; x <= W; x += major) g.lineBetween(x + 0.5, 0, x + 0.5, H);
    for (let y = 0; y <= H; y += major) g.lineBetween(0, y + 0.5, W, y + 0.5);
    // Registration crosses on major intersections.
    g.lineStyle(1, THEME.rule, 0.8);
    for (let x = major; x < W; x += major) {
      for (let y = major; y < H; y += major) {
        g.lineBetween(x - 5 + 0.5, y + 0.5, x + 5 + 0.5, y + 0.5);
        g.lineBetween(x + 0.5, y - 5 + 0.5, x + 0.5, y + 5 + 0.5);
      }
    }
    // Darken the edges a touch (cheap vignette: stacked translucent frames).
    for (let i = 0; i < 6; i++) {
      g.lineStyle(40, THEME.bgDeep, 0.1);
      g.strokeRect(i * 20 - 20, i * 20 - 20, W - i * 40 + 40, H - i * 40 + 40);
    }
    this.scan = scene.add.rectangle(0, 0, W, 140, 0xffffff, 0.018).setOrigin(0, 0.5).setDepth(-9);
  }

  update(dt: number): void {
    this.t += dt;
    const H = this.scene.scale.height;
    const p = (this.t / 14) % 1;
    this.scan.y = -100 + p * (H + 200);
  }

  destroy(): void {
    this.g.destroy();
    this.scan.destroy();
  }
}
