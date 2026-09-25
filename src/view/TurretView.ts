/**
 * The player's cannon + trajectory preview. OWNER: render agent.
 *
 * - Large, readable geometric cannon at weapon.pivotX/pivotY (sim meters) on
 *   a platform; barrel rotates to weapon.angle; barrel recoils by weapon.kick;
 *   reload indicator ring around the breech driven by weapon.reloadProgress;
 *   power shown on the barrel (weapon.power); ammo colour accent.
 * - Trajectory preview: dotted arc from prediction.points (sim meters, flat
 *   array, `count` points, sampled every 1/30 s); dots fade out along the
 *   path and are gone by `weapon.stats.previewTime` seconds of flight; an
 *   impact reticle at (hitX, hitY) when prediction.hit within the preview
 *   time; a faint cone for spread (weapon.stats.spread). Hidden when
 *   `showPreview` is false.
 *
 * Cost per frame: a handful of transform writes, one small Graphics for the
 * spread cone, and a pooled set of dot images (no allocations).
 */
import type * as Phaser from 'phaser';
import type { Weapon, TrajectoryPrediction } from '../sim/weapons/Weapon';
import type { AmmoDef } from '../sim/weapons/Ammo';
import { PPM } from '../config/constants';
import { DEPTH } from './depths';
import { RK } from './render/RenderKeys';
import { TEXTURE_RES, TextureFactory } from './TextureFactory';
import { generateTurretArt, regionOrigin, TURRET_GEOM as G } from './render/TurretArt';
import { miscFrame } from './render/MiscAtlas';
import { lerpColor, luminance } from './render/color';

type Image = Phaser.GameObjects.Image;

/** Prediction sample interval (Weapon.predict default). */
const SAMPLE_DT = 1 / 30;
/** Spacing between preview dots along the arc (m). */
const DOT_SPACING = 0.62;
/** Marching speed of the dots (m/s). */
const DOT_MARCH = 1.4;
const MAX_DOTS = 220;
const RECOIL = 0.55;

const DOT_COLOR = 0xe8ecf1;
const RETICLE_COLOR = 0xffb547;
const RING_BG = 0x8b95a5;
const RING_LOADING = 0xffb547;
const RING_READY = 0x6fe3a1;
const POWER_LOW = 0x58d6c9;
const POWER_HIGH = 0xffb547;
const SLOT_OFF = 0x1c2129;
const POWER_SEGMENTS = 10;

export class TurretView {
  showPreview = true;

  private readonly base: Image;
  private readonly barrel: Image;
  private readonly hub: Image;
  private readonly barrelFx: Phaser.GameObjects.Graphics;
  private readonly hubFx: Phaser.GameObjects.Graphics;
  private readonly cone: Phaser.GameObjects.Graphics;
  private readonly reticle: Image;
  private readonly dots: Image[] = [];
  private dotsUsed = 0;

  private time = 0;
  private lastPower = -1;
  private lastAmmo: AmmoDef | null = null;
  private lastReload = -1;
  private readyFlash = 0;
  private previewVisible = true;
  private destroyed = false;

  constructor(
    readonly scene: Phaser.Scene,
    readonly weapon: Weapon,
  ) {
    TextureFactory.generateCommon(scene);
    generateTurretArt(scene.textures);
    const px = weapon.pivotX * PPM;
    const py = weapon.pivotY * PPM;
    const inv = 1 / TEXTURE_RES;

    // All turret art lives in the shared misc atlas (one texture with the rest of the world).
    const img = (name: string): Image => {
      const f = miscFrame(scene.textures, name);
      return scene.add.image(px, py, f.key, f.frame);
    };
    const ob = regionOrigin(G.baseRegion);
    this.base = img(RK.turretBase).setOrigin(ob.x, ob.y).setScale(inv).setDepth(DEPTH.turret);
    const ol = regionOrigin(G.barrelRegion);
    this.barrel = img(RK.turretBarrel).setOrigin(ol.x, ol.y).setScale(inv).setDepth(DEPTH.turret + 0.1);
    this.barrelFx = scene.add.graphics().setDepth(DEPTH.turret + 0.2);
    const oh = regionOrigin(G.hubRegion);
    this.hub = img(RK.turretHub).setOrigin(oh.x, oh.y).setScale(inv).setDepth(DEPTH.turret + 0.3);
    this.hubFx = scene.add.graphics().setDepth(DEPTH.turret + 0.4);
    this.hubFx.setPosition(px, py);

    this.cone = scene.add.graphics().setDepth(DEPTH.trajectory - 0.5);
    this.reticle = img(RK.reticle).setDepth(DEPTH.trajectory + 0.1).setScale(inv).setTint(RETICLE_COLOR);
    this.reticle.setVisible(false);
  }

  update(realDt: number, prediction: TrajectoryPrediction): void {
    if (this.destroyed) return;
    this.time += realDt;
    const w = this.weapon;
    const px = w.pivotX * PPM;
    const py = w.pivotY * PPM;
    const a = w.angle;
    const c = Math.cos(a);
    const s = Math.sin(a);

    // ---- barrel + recoil slide
    const k = w.kick;
    const recoil = RECOIL * PPM * (k * k * (3 - 2 * k));
    const bx = px - c * recoil;
    const by = py - s * recoil;
    this.barrel.setPosition(bx, by).setRotation(a);
    this.barrelFx.setPosition(bx, by).setRotation(a);
    this.hub.setRotation(a);

    // ---- power slot + ammo accent (redrawn only on change)
    const ammo = w.ammo;
    const accent = accentColor(ammo.color, ammo.trailColor);
    const power = Math.round(w.power * 100);
    const ammoChanged = ammo !== this.lastAmmo;
    this.lastAmmo = ammo;
    if (power !== this.lastPower || ammoChanged) {
      this.lastPower = power;
      this.drawBarrelFx(w.power, accent);
    }

    // ---- reload ring + shell window
    const rp = w.reloadProgress;
    if (rp >= 1 && this.lastReload >= 0 && this.lastReload < 1) this.readyFlash = 1;
    const flashing = this.readyFlash > 0;
    if (flashing) this.readyFlash = Math.max(0, this.readyFlash - realDt * 2.6);
    if (rp !== this.lastReload || flashing || ammoChanged) {
      this.lastReload = rp;
      this.drawHubFx(rp, accent, ammo.color);
    }

    // ---- trajectory preview
    const show = this.showPreview && prediction.count > 1;
    if (show) this.drawPreview(prediction);
    else if (this.previewVisible) this.hidePreview();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.base.destroy();
    this.barrel.destroy();
    this.hub.destroy();
    this.barrelFx.destroy();
    this.hubFx.destroy();
    this.cone.destroy();
    this.reticle.destroy();
    for (const d of this.dots) d.destroy();
    this.dots.length = 0;
  }

  // ------------------------------------------------------------------ cannon overlays

  private drawBarrelFx(power: number, accent: number): void {
    const g = this.barrelFx;
    g.clear();
    const m = PPM;
    // Power: segmented bar in the slot, lit up to the current power (0.35..1).
    const f = Math.max(0, Math.min(1, (power - 0.35) / 0.65));
    const lit = Math.max(1, Math.ceil(f * POWER_SEGMENTS - 1e-6));
    const len = (G.slotEnd - G.slotStart) * m;
    const seg = len / POWER_SEGMENTS;
    const h = G.slotHalf * 2 * m;
    for (let i = 0; i < POWER_SEGMENTS; i++) {
      const on = i < lit;
      const col = on ? lerpColor(POWER_LOW, POWER_HIGH, i / (POWER_SEGMENTS - 1)) : SLOT_OFF;
      g.fillStyle(col, on ? 1 : 0.9);
      g.fillRect(G.slotStart * m + i * seg + 1, -h / 2, seg - 2, h);
    }
    // Ammo accent band near the muzzle.
    g.fillStyle(accent, 1);
    g.fillRect((G.accentX - G.accentW / 2) * m, -G.accentHalf * m, G.accentW * m, G.accentHalf * 2 * m);
    g.lineStyle(1, 0x0b0d11, 0.9);
    g.strokeRect((G.accentX - G.accentW / 2) * m, -G.accentHalf * m, G.accentW * m, G.accentHalf * 2 * m);
  }

  private drawHubFx(progress: number, accent: number, shellColor: number): void {
    const g = this.hubFx;
    g.clear();
    const r = G.ringRadius * PPM;
    const start = -Math.PI / 2;
    // Track.
    g.lineStyle(3, RING_BG, 0.14);
    g.strokeCircle(0, 0, r);
    if (progress < 1) {
      g.lineStyle(3.5, RING_LOADING, 0.95);
      g.beginPath();
      g.arc(0, 0, r, start, start + Math.PI * 2 * progress, false);
      g.strokePath();
    } else {
      const fl = this.readyFlash;
      g.lineStyle(2.5 + fl * 3, RING_READY, 0.26 + fl * 0.65);
      g.strokeCircle(0, 0, r + fl * 4);
    }
    // Shell window: the loaded round grows in as the reload completes.
    const wr = G.hubRadius * 0.4 * PPM;
    const shell = luminance(shellColor) < 0.25 ? lerpColor(shellColor, 0xffffff, 0.25) : shellColor;
    const k = progress < 1 ? 0.35 + 0.5 * progress : 1;
    g.fillStyle(shell, progress < 1 ? 0.6 : 1);
    g.fillCircle(0, 0, wr * k);
    g.lineStyle(1.5, accent, progress < 1 ? 0.5 : 0.95);
    g.strokeCircle(0, 0, wr * k);
    if (progress >= 1) {
      g.fillStyle(0xffffff, 0.6);
      g.fillCircle(-wr * 0.3, -wr * 0.3, wr * 0.22);
    }
  }

  // ------------------------------------------------------------------ preview

  private drawPreview(pred: TrajectoryPrediction): void {
    this.previewVisible = true;
    const pts = pred.points;
    const n = pred.count;
    const maxT = Math.max(0.05, this.weapon.stats.previewTime);
    const spread = this.weapon.stats.spread;
    const m = PPM;

    // Spread cone: quads along the path, half-width ~ 2 sigma * distance, fading out.
    const cone = this.cone;
    cone.clear();
    const mx = pts[0]!;
    const my = pts[1]!;
    const tanS = Math.tan(Math.min(0.5, spread * 1.5));
    let prevLx = mx;
    let prevLy = my;
    let prevRx = mx;
    let prevRy = my;
    for (let i = 1; i < n; i++) {
      const t = i * SAMPLE_DT;
      if (t - SAMPLE_DT > maxT) break;
      const x = pts[i * 2]!;
      const y = pts[i * 2 + 1]!;
      const dx = x - pts[i * 2 - 2]!;
      const dy = y - pts[i * 2 - 1]!;
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const dist = Math.sqrt((x - mx) * (x - mx) + (y - my) * (y - my));
      const hw = dist * tanS;
      const nx = -dy / len;
      const ny = dx / len;
      const lx = x + nx * hw;
      const ly = y + ny * hw;
      const rx = x - nx * hw;
      const ry = y - ny * hw;
      const f = 1 - Math.min(1, t / maxT);
      if (f > 0) {
        cone.fillStyle(DOT_COLOR, 0.05 * f);
        cone.beginPath();
        cone.moveTo(prevLx * m, prevLy * m);
        cone.lineTo(lx * m, ly * m);
        cone.lineTo(rx * m, ry * m);
        cone.lineTo(prevRx * m, prevRy * m);
        cone.closePath();
        cone.fillPath();
      }
      prevLx = lx;
      prevLy = ly;
      prevRx = rx;
      prevRy = ry;
    }

    // Dots at fixed arc-length spacing, marching outward; alpha by flight time.
    let used = 0;
    let carry = DOT_SPACING - ((this.time * DOT_MARCH) % DOT_SPACING);
    for (let i = 1; i < n && used < MAX_DOTS; i++) {
      const x0 = pts[i * 2 - 2]!;
      const y0 = pts[i * 2 - 1]!;
      const x1 = pts[i * 2]!;
      const y1 = pts[i * 2 + 1]!;
      const dx = x1 - x0;
      const dy = y1 - y0;
      const segLen = Math.sqrt(dx * dx + dy * dy);
      if (segLen < 1e-6) continue;
      let d = carry;
      let stop = false;
      while (d <= segLen && used < MAX_DOTS) {
        const u = d / segLen;
        const t = (i - 1 + u) * SAMPLE_DT;
        const f = 1 - t / maxT;
        if (f <= 0) {
          stop = true;
          break;
        }
        const dot = this.dot(used++);
        dot.x = (x0 + dx * u) * m;
        dot.y = (y0 + dy * u) * m;
        const ease = f * f * (3 - 2 * f);
        dot.alpha = 0.9 * ease;
        dot.setScale((0.36 + 0.2 * f) * (1 / TEXTURE_RES) * 2);
        d += DOT_SPACING;
      }
      if (stop) break;
      carry = d - segLen;
    }
    for (let i = used; i < this.dotsUsed; i++) this.dots[i]!.setVisible(false);
    this.dotsUsed = used;

    // Impact reticle (only when the hit happens inside the preview window).
    const r = this.reticle;
    if (pred.hit && pred.time <= maxT + 1e-6) {
      const f = 1 - Math.min(1, pred.time / maxT);
      r.setVisible(true);
      r.x = pred.hitX * m;
      r.y = pred.hitY * m;
      r.rotation = this.time * 0.9;
      const pulse = 1 + 0.06 * Math.sin(this.time * 6);
      r.setScale((1 / TEXTURE_RES) * (0.62 + 0.18 * f) * pulse);
      r.alpha = 0.55 + 0.4 * f;
    } else r.setVisible(false);
  }

  private dot(i: number): Image {
    let d = this.dots[i];
    if (!d) {
      const f = miscFrame(this.scene.textures, RK.pdot);
      d = this.scene.add.image(0, 0, f.key, f.frame).setDepth(DEPTH.trajectory).setTint(DOT_COLOR);
      this.dots.push(d);
    }
    if (!d.visible) d.setVisible(true);
    return d;
  }

  private hidePreview(): void {
    this.previewVisible = false;
    this.cone.clear();
    for (let i = 0; i < this.dotsUsed; i++) this.dots[i]!.setVisible(false);
    this.dotsUsed = 0;
    this.reticle.setVisible(false);
  }
}

/** A readable accent for the ammo: its colour unless too dark on the barrel, then its trail colour. */
function accentColor(color: number, trail: number): number {
  return luminance(color) < 0.25 ? trail : color;
}
