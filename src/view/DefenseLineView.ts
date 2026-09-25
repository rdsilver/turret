/**
 * Assault mode: the defense line in front of the turret (creatures must not
 * cross it) plus a "closest threat" distance marker. Static geometry is drawn
 * once; only the marker moves and the line pulses when a creature is close.
 */
import type * as Phaser from 'phaser';
import { PPM } from '../config/constants';
import { DEPTH } from './depths';
import { GlyphText } from './render/GlyphText';

const LINE = 0xff5a3c;
const WARN = 0xffb547;

export class DefenseLineView {
  private readonly line: Phaser.GameObjects.Graphics;
  private readonly glow: Phaser.GameObjects.Rectangle;
  private readonly label: GlyphText;
  private readonly marker: Phaser.GameObjects.Graphics;
  private readonly distance: GlyphText;
  private t = 0;

  constructor(
    scene: Phaser.Scene,
    private readonly lineX: number,
  ) {
    const x = lineX * PPM;
    this.line = scene.add.graphics().setDepth(DEPTH.destructionLine + 0.5);
    this.line.lineStyle(3, LINE, 0.9);
    const top = -16 * PPM;
    for (let y = 0; y > top; y -= 18) this.line.lineBetween(x, y, x, Math.max(top, y - 10));
    // Hazard ticks on the ground.
    this.line.fillStyle(LINE, 0.85);
    for (let k = 0; k < 4; k++) this.line.fillRect(x - 4 - k * 14, 2, 8, 6);
    this.glow = scene.add.rectangle(x - 0.6 * PPM, -8 * PPM, 1.2 * PPM, 16 * PPM, LINE, 0.06).setDepth(DEPTH.destructionLine);
    this.label = new GlyphText(scene, 13, LINE, DEPTH.destructionLine + 0.6).setText('DEFENSE LINE').setOrigin(0.5, 1).setPosition(x, top - 6);
    this.marker = scene.add.graphics().setDepth(DEPTH.destructionLine + 0.4);
    this.distance = new GlyphText(scene, 12, WARN, DEPTH.destructionLine + 0.6).setOrigin(0.5, 0).setPosition(x, 12);
  }

  /** closestX = sim x of the nearest active creature (Infinity when none). */
  update(realDt: number, closestX: number): void {
    this.t += realDt;
    const d = closestX - this.lineX;
    const danger = Number.isFinite(d) ? Math.max(0, Math.min(1, 1 - d / 20)) : 0;
    const pulse = 0.06 + danger * (0.12 + 0.1 * Math.sin(this.t * (4 + danger * 8)));
    this.glow.setFillStyle(LINE, pulse);
    this.marker.clear();
    if (Number.isFinite(d)) {
      const x0 = this.lineX * PPM;
      const x1 = closestX * PPM;
      this.marker.lineStyle(2, danger > 0.5 ? LINE : WARN, 0.55);
      this.marker.lineBetween(x0, 16, x1, 16);
      this.marker.fillStyle(danger > 0.5 ? LINE : WARN, 0.8);
      this.marker.fillTriangle(x1, 16, x1 + 7, 11, x1 + 7, 21);
      this.distance.setText(`${Math.max(0, d).toFixed(0)} m`).setPosition((x0 + x1) / 2, 22).setColor(danger > 0.5 ? LINE : WARN).setVisible(true);
    } else {
      this.distance.setVisible(false);
    }
  }

  destroy(): void {
    this.line.destroy();
    this.glow.destroy();
    this.label.destroy();
    this.marker.destroy();
    this.distance.destroy();
  }
}
