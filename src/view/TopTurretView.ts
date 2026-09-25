/**
 * The top turret: a steel mast behind the main turret carrying a small
 * automatic gun. The mast is drawn once; per frame only the gun head's
 * rotation, recoil and heat glow change.
 */
import type * as Phaser from 'phaser';
import type { Weapon } from '../sim/weapons/Weapon';
import { PPM, TURRET } from '../config/constants';
import { DEPTH } from './depths';
import { lerpColor } from './render/color';

const STEEL = 0x5b6573;
const STEEL_DARK = 0x2a2f37;
const EDGE = 0x15181d;
const BARREL = 0x9aa4b2;
const HOT = 0xff7a30;
const ACCENT = 0xffb547;

export class TopTurretView {
  private readonly mast: Phaser.GameObjects.Graphics;
  private readonly head: Phaser.GameObjects.Container;
  private readonly barrel: Phaser.GameObjects.Rectangle;
  private readonly hub: Phaser.GameObjects.Arc;
  private lastHeat = -1;

  constructor(
    scene: Phaser.Scene,
    readonly weapon: Weapon,
  ) {
    const px = weapon.pivotX * PPM;
    const py = weapon.pivotY * PPM;
    const baseY = -TURRET.pivotHeight * 0.55 * PPM;
    const w = 0.34 * PPM;
    this.mast = scene.add.graphics().setDepth(DEPTH.turret - 0.5);
    const g = this.mast;
    // Column from the turret deck up to the gun, with a diagonal brace to the base.
    g.fillStyle(STEEL_DARK, 1);
    g.fillRect(px - w / 2, py, w, baseY - py);
    g.lineStyle(2, EDGE, 1);
    g.strokeRect(px - w / 2, py, w, baseY - py);
    g.lineStyle(0.12 * PPM, STEEL, 1);
    g.lineBetween(px, py + 0.35 * (baseY - py), TURRET.x * PPM, baseY);
    // Rungs.
    g.lineStyle(1.5, STEEL, 0.9);
    for (let y = py + 0.6 * PPM; y < baseY; y += 0.7 * PPM) g.lineBetween(px - w / 2, y, px + w / 2, y);
    // Gun head.
    const len = weapon.barrelLength * PPM;
    this.barrel = scene.add.rectangle(0, 0, len, 0.22 * PPM, BARREL).setOrigin(0.05, 0.5).setStrokeStyle(2, EDGE);
    const breech = scene.add.rectangle(0, 0, 0.9 * PPM, 0.46 * PPM, STEEL).setOrigin(0.35, 0.5).setStrokeStyle(2, EDGE);
    const band = scene.add.rectangle(len * 0.55, 0, 0.12 * PPM, 0.3 * PPM, ACCENT).setOrigin(0.5, 0.5);
    this.hub = scene.add.circle(0, 0, 0.36 * PPM, STEEL_DARK).setStrokeStyle(2, EDGE);
    this.head = scene.add.container(px, py, [this.barrel, band, breech, this.hub]).setDepth(DEPTH.turret + 0.6);
    this.head.rotation = weapon.angle;
  }

  update(): void {
    const w = this.weapon;
    this.head.rotation = w.angle;
    // Recoil: the barrel slides back along its axis.
    this.barrel.x = -w.kick * 0.25 * PPM;
    const heat = Math.round(w.heat * 20) / 20;
    if (heat !== this.lastHeat) {
      this.lastHeat = heat;
      this.barrel.fillColor = lerpColor(BARREL, HOT, Math.min(1, heat * 1.1));
      this.hub.fillColor = w.overheated ? 0x4a2a20 : STEEL_DARK;
    }
  }

  destroy(): void {
    this.mast.destroy();
    this.head.destroy();
  }
}
