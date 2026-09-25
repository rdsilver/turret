/**
 * Static turret art (pedestal + mount, barrel, breech hub) painted once into
 * frames of the shared misc atlas at TEXTURE_RES. All geometry is in meters relative to the
 * barrel pivot (sim y down); `TURRET_GEOM` exposes the numbers TurretView
 * needs to place dynamic overlays (power slot, accent band, reload ring).
 */
import type * as Phaser from 'phaser';
import { PPM, TURRET } from '../../config/constants';
import { TEXTURE_RES } from './res';
import { RK } from './RenderKeys';
import { miscAtlas } from './MiscAtlas';

const S = PPM * TEXTURE_RES;
const PAD = 3;

export const TURRET_GEOM = {
  /** Pedestal box relative to the pivot (matches the static collider). */
  baseLeft: -1.7,
  baseRight: 1.7,
  baseTop: TURRET.pivotHeight - 2.0,
  baseBottom: TURRET.pivotHeight,
  /** Barrel extents along its axis. */
  breech: -1.02,
  muzzle: TURRET.barrelLength,
  /** Power slot along the tube. */
  slotStart: 0.62,
  slotEnd: 2.72,
  slotHalf: 0.09,
  /** Ammo accent band. */
  accentX: 2.86,
  accentW: 0.1,
  accentHalf: 0.39,
  hubRadius: 0.7,
  ringRadius: 1.1,
  /** Texture regions (meters, relative to pivot). */
  baseRegion: { x0: -1.95, y0: -0.95, x1: 1.95, y1: TURRET.pivotHeight + 0.05 },
  barrelRegion: { x0: -1.1, y0: -0.66, x1: TURRET.barrelLength + 0.05, y1: 0.66 },
  hubRegion: { x0: -0.8, y0: -0.8, x1: 0.8, y1: 0.8 },
} as const;

type Region = { x0: number; y0: number; x1: number; y1: number };

function regionCanvas(textures: Phaser.Textures.TextureManager, key: string, r: Region, draw: (c: CanvasRenderingContext2D) => void): void {
  const atlas = miscAtlas(textures);
  if (atlas.get(key)) return;
  const w = Math.ceil((r.x1 - r.x0) * S + PAD * 2);
  const h = Math.ceil((r.y1 - r.y0) * S + PAD * 2);
  atlas.add(key, w, h, (c) => {
    // Work in meters with the pivot at the origin.
    c.translate(PAD - r.x0 * S, PAD - r.y0 * S);
    c.scale(S, S);
    draw(c);
  });
}

/** Normalised origin of a region texture (the pivot). */
export function regionOrigin(r: Region): { x: number; y: number } {
  const w = Math.ceil((r.x1 - r.x0) * S + PAD * 2);
  const h = Math.ceil((r.y1 - r.y0) * S + PAD * 2);
  return { x: (PAD - r.x0 * S) / w, y: (PAD - r.y0 * S) / h };
}

const OUT = '#0b0d11';
const LW = 3 / S; // 1.5 world px outline

function roundRect(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y);
  c.arcTo(x + w, y, x + w, y + r, r);
  c.lineTo(x + w, y + h - r);
  c.arcTo(x + w, y + h, x + w - r, y + h, r);
  c.lineTo(x + r, y + h);
  c.arcTo(x, y + h, x, y + h - r, r);
  c.lineTo(x, y + r);
  c.arcTo(x, y, x + r, y, r);
  c.closePath();
}

function bolt(c: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  c.fillStyle = '#0d1014';
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#5b6574';
  c.beginPath();
  c.arc(x - r * 0.1, y - r * 0.1, r * 0.68, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(255,255,255,0.5)';
  c.beginPath();
  c.arc(x - r * 0.3, y - r * 0.3, r * 0.25, 0, Math.PI * 2);
  c.fill();
}

export function generateTurretArt(textures: Phaser.Textures.TextureManager): void {
  const G = TURRET_GEOM;

  // ---------------------------------------------------------------- pedestal + mount
  regionCanvas(textures, RK.turretBase, G.baseRegion, (c) => {
    const L = G.baseLeft;
    const R = G.baseRight;
    const T = G.baseTop;
    const B = G.baseBottom;
    // Trunnion cheeks (behind the pedestal top plate).
    c.beginPath();
    c.moveTo(-1.05, T + 0.05);
    c.lineTo(-0.84, 0);
    c.arc(0, 0, 0.84, Math.PI, Math.PI * 2, false);
    c.lineTo(1.05, T + 0.05);
    c.closePath();
    const cheek = c.createLinearGradient(0, -0.8, 0, T);
    cheek.addColorStop(0, '#3d4552');
    cheek.addColorStop(1, '#2a3039');
    c.fillStyle = cheek;
    c.fill();
    c.lineWidth = LW * 2;
    c.strokeStyle = OUT;
    c.stroke();
    // Bearing ring.
    c.lineWidth = 0.07;
    c.strokeStyle = '#4c5563';
    c.beginPath();
    c.arc(0, 0, 0.8, Math.PI * 0.9, Math.PI * 0.1, false);
    c.stroke();
    // Cheek lightening holes.
    c.fillStyle = '#1b1f26';
    for (const sx of [-0.62, 0.62]) {
      c.beginPath();
      c.arc(sx, T - 0.22, 0.1, 0, Math.PI * 2);
      c.fill();
    }

    // Pedestal body.
    roundRect(c, L, T, R - L, B - T, 0.06);
    const body = c.createLinearGradient(0, T, 0, B);
    body.addColorStop(0, '#2d333c');
    body.addColorStop(1, '#21262d');
    c.fillStyle = body;
    c.fill();
    c.save();
    c.clip();
    // Top plate.
    c.fillStyle = '#3b434f';
    c.fillRect(L, T, R - L, 0.2);
    c.fillStyle = 'rgba(255,255,255,0.12)';
    c.fillRect(L, T, R - L, 0.035);
    // Amber accent line under the plate.
    c.fillStyle = '#ffb547';
    c.fillRect(L, T + 0.2, R - L, 0.035);
    // Inset front panel.
    c.lineWidth = 0.03;
    c.strokeStyle = 'rgba(255,255,255,0.08)';
    roundRect(c, L + 0.22, T + 0.42, R - L - 0.44, 0.95, 0.05);
    c.stroke();
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    roundRect(c, L + 0.2, T + 0.4, R - L - 0.44, 0.95, 0.05);
    c.stroke();
    // Vent slits.
    c.fillStyle = '#15191f';
    for (let i = 0; i < 5; i++) {
      roundRect(c, -0.55 + i * 0.25, T + 0.62, 0.1, 0.52, 0.04);
      c.fill();
    }
    // Hazard skirt.
    const hy = B - 0.28;
    c.fillStyle = 'rgba(255,181,71,0.55)';
    c.fillRect(L, hy, R - L, 0.28);
    c.fillStyle = '#1a1d22';
    for (let x = L - 0.3; x < R; x += 0.36) {
      c.beginPath();
      c.moveTo(x, B);
      c.lineTo(x + 0.18, B);
      c.lineTo(x + 0.46, hy);
      c.lineTo(x + 0.28, hy);
      c.closePath();
      c.fill();
    }
    c.restore();
    // Outline.
    roundRect(c, L, T, R - L, B - T, 0.06);
    c.lineWidth = LW * 2;
    c.strokeStyle = OUT;
    c.save();
    c.clip();
    c.stroke();
    c.restore();
    // Corner bolts.
    for (const [bx, by] of [
      [L + 0.14, T + 0.1],
      [R - 0.14, T + 0.1],
      [L + 0.14, B - 0.42],
      [R - 0.14, B - 0.42],
    ] as const)
      bolt(c, bx, by, 0.055);
  });

  // ---------------------------------------------------------------- barrel (points +x)
  regionCanvas(textures, RK.turretBarrel, G.barrelRegion, (c) => {
    // Breech block.
    roundRect(c, G.breech, -0.6, 1.45, 1.2, 0.12);
    const bb = c.createLinearGradient(0, -0.6, 0, 0.6);
    bb.addColorStop(0, '#4a5361');
    bb.addColorStop(0.5, '#353c47');
    bb.addColorStop(1, '#262b33');
    c.fillStyle = bb;
    c.fill();
    c.lineWidth = LW * 2;
    c.strokeStyle = OUT;
    c.save();
    c.clip();
    c.stroke();
    c.restore();
    // Rear cap bolts.
    bolt(c, G.breech + 0.16, -0.4, 0.06);
    bolt(c, G.breech + 0.16, 0.4, 0.06);

    // Tapered tube with cylindrical shading.
    const x0 = 0.36;
    const x1 = G.muzzle - 0.4;
    c.beginPath();
    c.moveTo(x0, -0.45);
    c.lineTo(x1, -0.36);
    c.lineTo(x1, 0.36);
    c.lineTo(x0, 0.45);
    c.closePath();
    const tube = c.createLinearGradient(0, -0.45, 0, 0.45);
    tube.addColorStop(0, '#9aa5b6');
    tube.addColorStop(0.18, '#7a8698');
    tube.addColorStop(0.55, '#586375');
    tube.addColorStop(1, '#343b47');
    c.fillStyle = tube;
    c.fill();
    c.save();
    c.clip();
    c.lineWidth = LW * 2;
    c.strokeStyle = OUT;
    c.stroke();
    // Specular streak.
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.beginPath();
    c.moveTo(x0, -0.37);
    c.lineTo(x1, -0.295);
    c.lineTo(x1, -0.25);
    c.lineTo(x0, -0.315);
    c.closePath();
    c.fill();
    c.restore();

    // Reinforcement bands.
    for (const [bx, bw, bh] of [
      [1.1, 0.22, 0.52],
      [2.18, 0.18, 0.45],
    ] as const) {
      roundRect(c, bx - bw / 2, -bh, bw, bh * 2, 0.03);
      const g = c.createLinearGradient(0, -bh, 0, bh);
      g.addColorStop(0, '#8792a3');
      g.addColorStop(0.5, '#4f5968');
      g.addColorStop(1, '#2c323b');
      c.fillStyle = g;
      c.fill();
      c.lineWidth = LW * 1.5;
      c.strokeStyle = OUT;
      c.stroke();
    }

    // Power slot (recessed; lit by TurretView).
    roundRect(c, G.slotStart - 0.03, -G.slotHalf - 0.03, G.slotEnd - G.slotStart + 0.06, G.slotHalf * 2 + 0.06, 0.05);
    c.fillStyle = '#0f1216';
    c.fill();

    // Muzzle ring.
    const mx = G.muzzle - 0.44;
    roundRect(c, mx, -0.54, 0.44, 1.08, 0.07);
    const mg = c.createLinearGradient(0, -0.54, 0, 0.54);
    mg.addColorStop(0, '#b8c3d2');
    mg.addColorStop(0.3, '#8e9aab');
    mg.addColorStop(0.7, '#5b6676');
    mg.addColorStop(1, '#3a414d');
    c.fillStyle = mg;
    c.fill();
    c.lineWidth = LW * 2;
    c.strokeStyle = OUT;
    c.save();
    c.clip();
    c.stroke();
    c.restore();
    c.fillStyle = 'rgba(0,0,0,0.35)';
    c.fillRect(mx + 0.17, -0.54, 0.04, 1.08);
  });

  // ---------------------------------------------------------------- breech hub
  regionCanvas(textures, RK.turretHub, G.hubRegion, (c) => {
    const r = G.hubRadius;
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    const g = c.createRadialGradient(-0.18, -0.2, 0.05, 0, 0, r);
    g.addColorStop(0, '#5d6776');
    g.addColorStop(0.7, '#353c47');
    g.addColorStop(1, '#232830');
    c.fillStyle = g;
    c.fill();
    c.lineWidth = LW * 2;
    c.strokeStyle = OUT;
    c.save();
    c.clip();
    c.stroke();
    c.restore();
    // Inner ring + shell window socket (filled by TurretView).
    c.lineWidth = 0.035;
    c.strokeStyle = 'rgba(255,255,255,0.14)';
    c.beginPath();
    c.arc(0, 0, r * 0.72, 0, Math.PI * 2);
    c.stroke();
    c.fillStyle = '#0e1115';
    c.beginPath();
    c.arc(0, 0, r * 0.42, 0, Math.PI * 2);
    c.fill();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      bolt(c, Math.cos(a) * r * 0.86, Math.sin(a) * r * 0.86, 0.04);
    }
  });
}
