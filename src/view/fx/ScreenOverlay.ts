/**
 * Full-screen overlays drawn in the game camera (so they sit above the world
 * but below the UI scene): a dark vignette that breathes in during slow
 * motion, an additive coloured vignette pulse (objective complete) and a brief
 * additive flash (explosions). Only touched while something is visible.
 */
import * as Phaser from 'phaser';
import { DEPTH } from '../depths';
import { FX_TEX, ensureFxTextures } from './FxTextures';

export class ScreenOverlay {
  private readonly dark: Phaser.GameObjects.Image;
  private readonly glow: Phaser.GameObjects.Image;
  private readonly flashImg: Phaser.GameObjects.Image;
  private darkAmt = 0;
  private pulseT = 0;
  private pulseDur = 1;
  private pulseAlpha = 0;
  private flashA = 0;
  private flashDecay = 8;

  constructor(readonly scene: Phaser.Scene) {
    ensureFxTextures(scene);
    const mk = (tex: string, depth: number, blend: Phaser.BlendModes): Phaser.GameObjects.Image => {
      const img = scene.add.image(0, 0, tex);
      img.setScrollFactor(0).setDepth(depth).setBlendMode(blend).setVisible(false).setAlpha(0);
      return img;
    };
    this.dark = mk(FX_TEX.vignette, DEPTH.flash + 2, Phaser.BlendModes.NORMAL);
    this.dark.setTint(0x05070a);
    this.glow = mk(FX_TEX.vignette, DEPTH.flash + 3, Phaser.BlendModes.ADD);
    this.flashImg = mk(FX_TEX.white, DEPTH.flash + 4, Phaser.BlendModes.ADD);
  }

  /** Coloured vignette pulse (0..1 strength). */
  pulse(color: number, strength = 1, seconds = 1.1): void {
    this.glow.setTint(color);
    this.pulseT = seconds;
    this.pulseDur = seconds;
    this.pulseAlpha = 0.5 * strength;
  }

  /** Whole-screen additive flash. */
  flash(alpha: number, color = 0xffffff, decayPerSec = 8): void {
    if (alpha > this.flashA) {
      this.flashA = Math.min(0.5, alpha);
      this.flashImg.setTint(color);
      this.flashDecay = decayPerSec;
    }
  }

  /** `slow` is 0..1 (how deep into slow motion we are). */
  update(realDt: number, slow: number): void {
    const dt = Math.min(0.1, realDt);
    this.darkAmt += (slow - this.darkAmt) * (1 - Math.exp(-10 * dt));
    if (this.darkAmt < 0.003) this.darkAmt = 0;
    if (this.pulseT > 0) this.pulseT = Math.max(0, this.pulseT - dt);
    if (this.flashA > 0) this.flashA = Math.max(0, this.flashA - this.flashA * this.flashDecay * dt - 0.02 * dt);

    const cam = this.scene.cameras.main;
    const w = (cam.width / cam.zoom) * 1.12;
    const h = (cam.height / cam.zoom) * 1.12;
    const cx = cam.width / 2;
    const cy = cam.height / 2;
    this.place(this.dark, this.darkAmt * 0.42, cx, cy, w, h);
    const p = this.pulseT > 0 ? this.pulseT / this.pulseDur : 0;
    // Quick rise, slow fall.
    const env = p > 0.85 ? (1 - p) / 0.15 : p / 0.85;
    this.place(this.glow, this.pulseAlpha * env * env, cx, cy, w, h);
    this.place(this.flashImg, this.flashA, cx, cy, w, h);
  }

  reset(): void {
    this.darkAmt = 0;
    this.pulseT = 0;
    this.flashA = 0;
    this.dark.setVisible(false);
    this.glow.setVisible(false);
    this.flashImg.setVisible(false);
  }

  destroy(): void {
    this.dark.destroy();
    this.glow.destroy();
    this.flashImg.destroy();
  }

  private place(img: Phaser.GameObjects.Image, alpha: number, cx: number, cy: number, w: number, h: number): void {
    if (alpha <= 0.002) {
      if (img.visible) img.setVisible(false);
      return;
    }
    img.setVisible(true);
    img.setAlpha(alpha);
    img.setPosition(cx, cy);
    img.setDisplaySize(w, h);
  }
}
