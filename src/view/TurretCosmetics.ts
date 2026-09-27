/**
 * The fun stuff the player has bought for the turret (data/cosmetics.ts),
 * whatever they are wearing right now (GameState.equipped):
 *
 * - Hats on the breech, upright whatever the aim: sombrero, top hat, party
 *   hat or crown (one at a time).
 * - Googly eyes on the pedestal, pupils looking where the gun points and
 *   rattling when it fires; a curled mustache under them.
 * - Gold plating (TurretView.setGold), rainbow tracers (WorldRenderer), and
 *   confetti when a creature is stopped (EffectsManager.confetti).
 *
 * Vector art in Graphics objects at the turret pivot, drawn in metres x PPM,
 * redrawn only when what is worn changes (the pupils every frame).
 */
import type * as Phaser from 'phaser';
import type { Simulation } from '../sim/Simulation';
import type { TurretView } from './TurretView';
import type { WorldRenderer } from './WorldRenderer';
import type { EffectsManager } from './EffectsManager';
import { gameState } from '../game/GameState';
import { PPM } from '../config/constants';
import { DEPTH } from './depths';

type Graphics = Phaser.GameObjects.Graphics;

const U = PPM;
/** Where the eyes sit on the pedestal (m from the pivot, y down), their size, and the pupils'. */
const EYES: Array<[number, number]> = [
  [-0.62, 1.2],
  [0.36, 1.2],
];
const EYE_R = 0.38;
const PUPIL_R = 0.17;
const OUTLINE = 0x1a1c20;

export class TurretCosmetics {
  private readonly hat: Graphics;
  private readonly face: Graphics;
  private readonly pupils: Graphics;
  private worn = '';
  private has = new Set<string>();
  /** Pupil rattle after a shot (m) and its velocity. */
  private jig = 0;
  private jigV = 0;
  private readonly offs: Array<() => void> = [];

  constructor(
    scene: Phaser.Scene,
    private readonly sim: Simulation,
    private readonly turret: TurretView,
    private readonly world: WorldRenderer,
    private readonly effects: EffectsManager,
  ) {
    const w = sim.weapon;
    const px = w.pivotX * PPM;
    const py = w.pivotY * PPM;
    this.face = scene.add.graphics({ x: px, y: py }).setDepth(DEPTH.turret + 0.05);
    this.pupils = scene.add.graphics({ x: px, y: py }).setDepth(DEPTH.turret + 0.06);
    this.hat = scene.add.graphics({ x: px, y: py }).setDepth(DEPTH.turret + 0.35);
    this.offs.push(
      sim.events.on('projectileFired', ({ projectile }) => {
        if (projectile.shot > 0 && this.has.has('googly')) this.jigV += 2.5;
      }),
      sim.events.on('creatureNeutralized', ({ creature }) => {
        if (this.has.has('confetti')) this.effects.confetti(creature.core.x, creature.core.y - 1.5);
      }),
    );
  }

  update(realDt: number): void {
    const eq = gameState().equipped;
    const sig = eq.join(',');
    if (sig !== this.worn) {
      this.worn = sig;
      this.has = new Set(eq);
      this.redraw();
    }
    if (!this.has.has('googly')) return;
    // A springy rattle, settling in about half a second.
    this.jigV += (-this.jig * 160 - this.jigV * 9) * realDt;
    this.jig += this.jigV * realDt;
    const a = this.sim.weapon.angle;
    const dx = Math.cos(a) * 0.15;
    const dy = Math.sin(a) * 0.15 + this.jig * 0.08;
    const g = this.pupils;
    g.clear();
    g.fillStyle(OUTLINE, 1);
    for (const [ex, ey] of EYES) g.fillCircle((ex + dx) * U, (ey + dy) * U, PUPIL_R * U);
  }

  destroy(): void {
    for (const off of this.offs) off();
    this.offs.length = 0;
    this.hat.destroy();
    this.face.destroy();
    this.pupils.destroy();
  }

  private redraw(): void {
    const has = this.has;
    this.turret.setGold(has.has('gold'));
    this.world.rainbowTracers = has.has('rainbow');
    const h = this.hat;
    h.clear();
    if (has.has('sombrero')) sombrero(h);
    else if (has.has('tophat')) topHat(h);
    else if (has.has('partyhat')) partyHat(h);
    else if (has.has('crown')) crown(h);
    const f = this.face;
    f.clear();
    this.pupils.clear();
    if (has.has('googly')) {
      for (const [ex, ey] of EYES) {
        f.fillStyle(0xffffff, 1);
        f.fillCircle(ex * U, ey * U, EYE_R * U);
        f.lineStyle(2, OUTLINE, 1);
        f.strokeCircle(ex * U, ey * U, EYE_R * U);
      }
    }
    if (has.has('mustache')) mustache(f);
  }
}

/** Polygon from metre points (relative to the pivot). */
function poly(g: Graphics, color: number, pts: Array<[number, number]>): void {
  g.fillStyle(color, 1);
  g.beginPath();
  g.moveTo(pts[0]![0] * U, pts[0]![1] * U);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]![0] * U, pts[i]![1] * U);
  g.closePath();
  g.fillPath();
}

function sombrero(g: Graphics): void {
  const straw = 0xe8c35a;
  const dark = 0xb08a2c;
  // Brim (with a darker underside), crown, band, and a zigzag trim round the brim edge.
  g.fillStyle(dark, 1);
  g.fillEllipse(0, -0.72 * U, 3.2 * U, 0.5 * U);
  g.fillStyle(straw, 1);
  g.fillEllipse(0, -0.8 * U, 3.1 * U, 0.42 * U);
  poly(g, straw, [
    [-0.56, -0.82],
    [0.56, -0.82],
    [0.44, -1.72],
    [0.22, -1.95],
    [-0.22, -1.95],
    [-0.44, -1.72],
  ]);
  poly(g, 0xd8433a, [
    [-0.55, -0.86],
    [0.55, -0.86],
    [0.52, -1.08],
    [-0.52, -1.08],
  ]);
  for (let i = 0; i < 8; i++) {
    const x = -1.35 + i * 0.36;
    poly(g, i % 2 ? 0xd8433a : 0x3aa35a, [
      [x, -0.72],
      [x + 0.36, -0.72],
      [x + 0.18, -0.86],
    ]);
  }
  g.lineStyle(2, dark, 1);
  g.strokeEllipse(0, -0.8 * U, 3.1 * U, 0.42 * U);
}

function topHat(g: Graphics): void {
  const black = 0x1b1d22;
  g.fillStyle(black, 1);
  g.fillEllipse(0, -0.77 * U, 1.95 * U, 0.28 * U);
  poly(g, black, [
    [-0.55, -0.8],
    [0.55, -0.8],
    [0.58, -2.25],
    [-0.58, -2.25],
  ]);
  poly(g, 0xb3261e, [
    [-0.555, -0.84],
    [0.555, -0.84],
    [0.56, -1.08],
    [-0.56, -1.08],
  ]);
  // A glint down one side.
  poly(g, 0x3a3e47, [
    [0.3, -1.12],
    [0.4, -1.12],
    [0.42, -2.18],
    [0.32, -2.18],
  ]);
}

function partyHat(g: Graphics): void {
  poly(g, 0xff6fa8, [
    [-0.62, -0.72],
    [0.62, -0.72],
    [0, -2.3],
  ]);
  // Stripes: bands across the cone at even heights.
  const band = (y0: number, y1: number, color: number) => {
    const w = (y: number) => 0.62 * ((2.3 + y) / (2.3 - 0.72));
    poly(g, color, [
      [-w(y0), y0],
      [w(y0), y0],
      [w(y1), y1],
      [-w(y1), y1],
    ]);
  };
  band(-0.95, -1.18, 0xffd24a);
  band(-1.45, -1.64, 0x58d6c9);
  band(-1.9, -2.03, 0xffd24a);
  g.fillStyle(0xfff3a0, 1);
  g.fillCircle(0, -2.34 * U, 0.2 * U);
}

function crown(g: Graphics): void {
  const gold = 0xffcf3a;
  poly(g, gold, [
    [-0.72, -0.74],
    [0.72, -0.74],
    [0.72, -1.62],
    [0.46, -1.16],
    [0.23, -1.66],
    [0, -1.2],
    [-0.23, -1.66],
    [-0.46, -1.16],
    [-0.72, -1.62],
  ]);
  poly(g, 0xd9a520, [
    [-0.72, -0.74],
    [0.72, -0.74],
    [0.72, -0.86],
    [-0.72, -0.86],
  ]);
  g.fillStyle(0xfff0a0, 1);
  for (const x of [-0.72, -0.23, 0.23, 0.72]) g.fillCircle(x * U, -1.66 * U, 0.08 * U);
  for (const [x, c] of [
    [-0.42, 0x3f7fff],
    [0, 0xe0304a],
    [0.42, 0x2fbf6a],
  ] as const) {
    g.fillStyle(c, 1);
    g.fillCircle(x * U, -0.98 * U, 0.11 * U);
  }
}

function mustache(g: Graphics): void {
  // A light chestnut, so it stands out on the dark pedestal.
  const brown = 0xa8703a;
  g.fillStyle(brown, 1);
  g.fillEllipse(-0.42 * U, 1.78 * U, 0.78 * U, 0.26 * U);
  g.fillEllipse(0.16 * U, 1.78 * U, 0.78 * U, 0.26 * U);
  // Curled tips.
  g.fillCircle(-0.84 * U, 1.66 * U, 0.1 * U);
  g.fillCircle(0.58 * U, 1.66 * U, 0.1 * U);
  g.fillEllipse(-0.76 * U, 1.72 * U, 0.2 * U, 0.12 * U);
  g.fillEllipse(0.5 * U, 1.72 * U, 0.2 * U, 0.12 * U);
}
