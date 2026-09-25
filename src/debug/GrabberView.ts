/**
 * Visual for the MouseGrabber: a thin spring line from the grab point on the
 * held body to the cursor, with a small ring at each end. Line colour shifts
 * from info blue to warning red as the spring stretches (i.e. as force rises).
 * One Graphics object, redrawn only while a grab is active. OWNER: debug agent.
 *
 * Usage (GameScene): `this.grabView = new GrabberView(this, this.grabber)`,
 * call `update()` once per frame after `world.update()`, `destroy()` on teardown.
 */
import type * as Phaser from 'phaser';
import type { MouseGrabber } from './MouseGrabber';
import { DEPTH } from '../view/depths';
import { PPM } from '../config/constants';

const CALM = 0x9fd3ff;
const TENSE = 0xff6b5e;
/** Stretch (m) at which the line is fully "tense". */
const TENSE_AT = 3;

export class GrabberView {
  private readonly g: Phaser.GameObjects.Graphics;
  private readonly p = { x: 0, y: 0 };
  private drawn = false;

  constructor(
    scene: Phaser.Scene,
    private readonly grabber: MouseGrabber,
  ) {
    this.g = scene.add.graphics().setDepth(DEPTH.debug);
  }

  update(): void {
    const gr = this.grabber;
    if (!gr.active) {
      if (this.drawn) {
        this.g.clear();
        this.drawn = false;
      }
      return;
    }
    const a = gr.anchorWorld(this.p);
    const ax = a.x * PPM;
    const ay = a.y * PPM;
    const bx = gr.targetX * PPM;
    const by = gr.targetY * PPM;
    const stretch = Math.hypot(gr.targetX - a.x, gr.targetY - a.y);
    const k = Math.min(1, stretch / TENSE_AT);
    const color = lerpColor(CALM, TENSE, k);
    const g = this.g;
    g.clear();
    g.lineStyle(2, color, 0.9);
    g.lineBetween(ax, ay, bx, by);
    g.fillStyle(color, 1);
    g.fillCircle(ax, ay, 3.5);
    g.lineStyle(1.5, color, 0.9);
    g.strokeCircle(bx, by, 7);
    this.drawn = true;
  }

  destroy(): void {
    this.g.destroy();
  }
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const r = Math.round(ar + (((b >> 16) & 255) - ar) * t);
  const gg = Math.round(ag + (((b >> 8) & 255) - ag) * t);
  const bb = Math.round(ab + ((b & 255) - ab) * t);
  return (r << 16) | (gg << 8) | bb;
}
