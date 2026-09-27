/**
 * Smoke clouds (sim/creature/smoke.ts), drawn over the creatures: each cloud
 * a soft grey puff as big as it is, as opaque as it is thick, so whatever
 * walks inside the smoke really can't be seen. (What the top turret can't
 * see is decided in the sim, from the same clouds.)
 *
 * Owned by WorldRenderer: update() each frame, clear() between levels.
 */
import * as Phaser from 'phaser';
import type { Simulation } from '../sim/Simulation';
import { smokeClouds, smokeDensity } from '../sim/creature/smoke';
import { PPM } from '../config/constants';
import type { TextureFactory } from './TextureFactory';
import { RK } from './render/RenderKeys';
import { DEPTH } from './depths';

type Image = Phaser.GameObjects.Image;

/** Smoke grey, and how opaque the thickest part of a cloud gets. */
const SMOKE_COLOR = 0x6a6e76;
const MAX_ALPHA = 0.97;
/** The art's cloud fills about this share of its frame. */
const FILL = 0.8;

export class SmokeView {
  private readonly images: Image[] = [];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sim: Simulation,
    private readonly textures: TextureFactory,
  ) {}

  update(): void {
    const clouds = smokeClouds(this.sim);
    let n = 0;
    for (const c of clouds) {
      const img = this.images[n] ?? this.make();
      this.images[n++] = img;
      const d = (c.r * 2 * PPM) / (64 * FILL);
      img.setPosition(c.x * PPM, c.y * PPM).setScale(d, d * 0.85).setRotation(c.spin + c.age * 0.05);
      img.setAlpha(MAX_ALPHA * smokeDensity(c)).setVisible(true);
    }
    for (let i = n; i < this.images.length; i++) this.images[i]!.setVisible(false);
  }

  clear(): void {
    for (const img of this.images) img.setVisible(false);
  }

  destroy(): void {
    for (const img of this.images) img.destroy();
    this.images.length = 0;
  }

  private make(): Image {
    const f = this.textures.miscFrame(RK.smoke);
    return this.scene.add.image(0, 0, f.key, f.frame).setTint(SMOKE_COLOR).setDepth(DEPTH.stress + 0.5).setVisible(false);
  }
}
