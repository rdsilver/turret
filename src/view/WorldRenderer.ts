/**
 * Draws the simulation: structure parts, fragments, projectiles (+ trails),
 * joints (welds/hinges/cables), the stress heat map and collider debug view.
 * OWNER: render agent.
 *
 * Contract
 *  - Subscribe to sim.events: entityAdded / entityRemoved / entityFading /
 *    jointBroken to create/destroy/fade display objects. Store the display
 *    object record in `entity.view` (sim never reads it).
 *  - update(alpha): ONLY iterate `sim.physics.active` (entities awake last
 *    step) plus entities that just went to sleep (final sync) — never all
 *    entities every frame. Interpolate: pos = prev + (cur - prev) * alpha
 *    (angles via lerpAngle). Pixels = meters * PPM (see coords.ts).
 *  - Parts: Image with an atlas frame from TextureFactory; material alpha is
 *    baked into the texture; subtle darkening by part.wear. Weapon damage
 *    (partDamaged) tints a part redder as its integrity drops, flashes it on
 *    every hit and makes it throb once it is close to breaking. Fading
 *    entities: alpha = fading/fadeDuration.
 *  - Joints: small markers at weld anchors (dark bolts), hinges as rings,
 *    cables as lines (sagging when slack). Only updated while a side is awake.
 *  - Stress view (setStressView): parts tinted by the max joint.stressVis of
 *    their joints (green -> yellow -> red, pulsing when yielding); joint
 *    markers coloured by stress, sized by damage.
 *  - Collider debug (setColliderDebug): sim.physics.world.debugRender() lines.
 */
import * as Phaser from 'phaser';
import type { Simulation } from '../sim/Simulation';
import type { Entity } from '../sim/Entity';
import { StructurePart } from '../sim/StructurePart';
import { Projectile } from '../sim/weapons/Projectile';
import type { BreakableJoint } from '../sim/BreakableJoint';
import { PPM } from '../config/constants';
import { lerpAngle } from '../core/math';
import { TextureFactory, TEXTURE_RES } from './TextureFactory';
import { TEX } from './TextureKeys';
import { RK } from './render/RenderKeys';
import { DEPTH } from './depths';
import { grey, lerpColor, stressColor } from './render/color';

type Image = Phaser.GameObjects.Image;

interface JointVis {
  joint: BreakableJoint;
  /** null for cables (drawn into the cable Graphics). */
  marker: Image | null;
  /** Frame counter of the last update (dedupe when both sides are awake). */
  stamp: number;
  /** Last applied style signature (skip redundant tint calls). */
  sig: number;
}

interface PartVis {
  kind: 0;
  entity: StructurePart;
  img: Image;
  joints: JointVis[];
  glow: Image | null;
  tintSig: number;
  tintStamp: number;
  depth: number;
  /** Showing the neutral (heat-map) texture variant. */
  neutral: boolean;
  /** Hit flash 1..0 (decays in real time). */
  flash: number;
  /** In the `animated` list (flashing or throbbing). */
  animated: boolean;
}

interface ProjVis {
  kind: 1;
  entity: Projectile;
  img: Image;
}

type Vis = PartVis | ProjVis;

const MARKER_SCALE_WELD = 0.36;
/** Undamaged weld bolts stay quiet so dense walls don't turn into dot patterns. */
const WELD_ALPHA = 0.62;
const MARKER_SCALE_HINGE = 0.5;
const MARKER_SCALE_NODE = 0.5;
/** Trail = the ballistic path over the last TRAIL_TIME seconds (frame-rate independent). */
const TRAIL_TIME = 0.07;
const TRAIL_SEGMENTS = 6;
const TRAIL_MIN_SPEED = 9;
const DAMAGE_COLOR = 0xff5a2a;
const WELD_GREY = 0x59616d;
const DETACHED_STRESS_TINT = 0x5a6573;
const CABLE_COLOR = 0xcfd6e0;
/** Seconds a hit flash takes to fade. */
const HIT_FLASH_TIME = 0.16;
/** Integrity below which a part throbs (about to break). */
const CRITICAL_INTEGRITY = 0.3;
/** Lowest y (world px) a sagging cable is drawn at: resting on the ground surface (y = 0). */
const CABLE_FLOOR = -1;

export class WorldRenderer {
  stressView = false;
  colliderDebug = false;

  private readonly offs: Array<() => void> = [];
  private readonly parts = new Set<PartVis>();
  /** Small lists iterated every frame: arrays (no iterator allocations). */
  private readonly projs: ProjVis[] = [];
  private readonly joints = new Set<JointVis>();
  private readonly cables: JointVis[] = [];
  private readonly cores: PartVis[] = [];
  /** Damaged parts whose tint animates (hit flash, critical throb). */
  private readonly animated: PartVis[] = [];
  private readonly fading: Entity[] = [];

  /** Entities positioned last frame / this frame (final sync when they fall asleep). */
  private syncPrev: Entity[] = [];
  private syncCur: Entity[] = [];

  private readonly pools = new Map<number, Image[]>();
  private readonly markerPool: Image[] = [];
  private readonly glowPool: Image[] = [];

  private readonly trailGfx: Phaser.GameObjects.Graphics;
  private readonly cableGfx: Phaser.GameObjects.Graphics;
  private debugGfx: Phaser.GameObjects.Graphics | null = null;

  private frame = 0;
  private time = 0;
  private cablesDirty = true;
  private needsResync = false;
  private trailsDrawn = false;
  private destroyed = false;

  constructor(
    readonly scene: Phaser.Scene,
    readonly sim: Simulation,
    readonly textures: TextureFactory,
  ) {
    this.trailGfx = scene.add.graphics().setDepth(DEPTH.projectiles - 0.5);
    this.cableGfx = scene.add.graphics().setDepth(DEPTH.cables);
    const ev = sim.events;
    this.offs.push(
      ev.on('entityAdded', ({ entity }) => this.onAdded(entity)),
      ev.on('entityRemoved', ({ entity }) => this.onRemoved(entity)),
      ev.on('entityFading', ({ entity }) => {
        if (entity.view && !this.fading.includes(entity)) this.fading.push(entity);
      }),
      ev.on('jointBroken', ({ joint }) => this.onJointBroken(joint)),
      ev.on('partDetached', ({ part }) => {
        const v = part.view as PartVis | null;
        if (v && v.kind === 0) this.applyPartTint(v, true);
      }),
      ev.on('structureLoaded', () => this.onStructureLoaded()),
      ev.on('partDamaged', ({ part }) => this.onPartDamaged(part)),
    );
    // Adopt anything that already exists (renderer created after the sim filled up).
    this.needsResync = sim.physics.entities.size > 0;
  }

  // ------------------------------------------------------------------ frame

  update(alpha: number, realDt: number): void {
    if (this.destroyed) return;
    this.frame++;
    this.time += realDt;
    if (this.needsResync) this.resync();

    const physics = this.sim.physics;
    const step = physics.stepIndex;
    const active = physics.active;
    const cur = this.syncCur;
    cur.length = 0;
    let cableTouched = false;

    for (let i = 0; i < active.length; i++) {
      const e = active[i]!;
      const v = e.view as Vis | null;
      if (!v || e.removed) continue;
      const x = e.px + (e.x - e.px) * alpha;
      const y = e.py + (e.y - e.py) * alpha;
      const a = lerpAngle(e.pangle, e.angle, alpha);
      if (v.kind === 0) this.placePart(v, x, y, a);
      else this.placeProjectile(v, x, y);
      cur.push(e);
    }

    // Final sync for entities that just fell asleep.
    const prev = this.syncPrev;
    for (let i = 0; i < prev.length; i++) {
      const e = prev[i]!;
      if (e.activeStamp === step || e.removed) continue;
      const v = e.view as Vis | null;
      if (!v) continue;
      if (v.kind === 0) {
        this.placePart(v, e.x, e.y, e.angle);
      } else {
        v.img.x = e.x * PPM;
        v.img.y = e.y * PPM;
      }
    }

    // Joint markers follow part A's rendered pose, so place them only once
    // every part of this frame is placed (A may come after B in the lists).
    for (let i = 0; i < cur.length; i++) {
      const v = cur[i]!.view as Vis | null;
      if (v && v.kind === 0 && this.touchJoints(v)) cableTouched = true;
    }
    for (let i = 0; i < prev.length; i++) {
      const e = prev[i]!;
      if (e.activeStamp === step || e.removed) continue;
      const v = e.view as Vis | null;
      if (v && v.kind === 0 && this.touchJoints(v)) cableTouched = true;
    }
    this.syncPrev = cur;
    this.syncCur = prev;

    if (this.fading.length) this.updateFading();
    if (this.cores.length) this.updateCores();
    if (this.animated.length) this.updateAnimated(realDt);
    if (this.projs.length || this.trailsDrawn) this.drawTrails();
    if (this.cables.length && (cableTouched || this.cablesDirty)) this.drawCables();
    else if (!this.cables.length && this.cablesDirty) {
      this.cableGfx.clear();
      this.cablesDirty = false;
    }
    if (this.colliderDebug) this.drawColliders();
  }

  setStressView(on: boolean): void {
    if (on === this.stressView) return;
    this.stressView = on;
    // One full restyle on toggle; afterwards only awake parts are touched.
    for (const v of this.parts) this.applyPartTint(v, true);
    for (const jv of this.joints) this.styleJoint(jv, true);
    this.cablesDirty = true;
  }

  setColliderDebug(on: boolean): void {
    this.colliderDebug = on;
    if (on && !this.debugGfx) this.debugGfx = this.scene.add.graphics().setDepth(DEPTH.debug);
    if (!on && this.debugGfx) this.debugGfx.clear();
  }

  /**
   * Remove all display objects (level change). `trimTextures` drops the part
   * atlas when it has grown large; destroy() skips it because the pooled
   * images may already be destroyed by the scene shutdown (setTexture would
   * throw) and the next level load trims anyway.
   */
  clear(trimTextures = true): void {
    for (const v of this.parts) this.releasePart(v, false);
    for (const v of this.projs) this.releaseProj(v);
    for (const jv of this.joints) this.releaseMarker(jv);
    this.parts.clear();
    this.projs.length = 0;
    this.joints.clear();
    this.cables.length = 0;
    this.cores.length = 0;
    this.animated.length = 0;
    this.fading.length = 0;
    this.syncPrev.length = 0;
    this.syncCur.length = 0;
    this.trailGfx.clear();
    this.cableGfx.clear();
    this.debugGfx?.clear();
    this.trailsDrawn = false;
    this.cablesDirty = true;
    // Keep texture memory bounded across many (procedural) levels.
    if (trimTextures && this.textures.atlasPages > 6) {
      for (const pool of this.pools.values()) for (const img of pool) img.setTexture(TEX.pixel);
      this.textures.resetPartTextures();
    }
    // Entities that survive the clear get re-adopted on the next update.
    this.needsResync = true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear(false);
    this.destroyed = true;
    for (const off of this.offs) off();
    this.offs.length = 0;
    for (const pool of this.pools.values()) for (const img of pool) img.destroy();
    this.pools.clear();
    for (const img of this.markerPool) img.destroy();
    for (const img of this.glowPool) img.destroy();
    this.markerPool.length = 0;
    this.glowPool.length = 0;
    this.trailGfx.destroy();
    this.cableGfx.destroy();
    this.debugGfx?.destroy();
    this.debugGfx = null;
  }

  // ------------------------------------------------------------------ events

  private onAdded(e: Entity): void {
    if (this.destroyed || e.removed) return;
    if (e.view) {
      // Stale record (pooled projectile revived): drop it first.
      this.dropView(e);
    }
    if (e instanceof StructurePart) this.createPart(e);
    else if (e instanceof Projectile) this.createProj(e);
  }

  private onRemoved(e: Entity): void {
    this.dropView(e);
  }

  private dropView(e: Entity): void {
    const v = e.view as Vis | null;
    const fi = this.fading.indexOf(e);
    if (fi >= 0) this.fading.splice(fi, 1);
    if (!v) return;
    if (v.kind === 0) {
      this.releasePart(v, true);
      this.parts.delete(v);
    } else {
      this.releaseProj(v);
      const pi = this.projs.indexOf(v);
      if (pi >= 0) this.projs.splice(pi, 1);
    }
  }

  private onJointBroken(j: BreakableJoint): void {
    this.removeJointVis(j);
    const a = j.a.view as PartVis | null;
    if (a && a.kind === 0) this.applyPartTint(a, true);
    const b = j.b?.view as PartVis | null | undefined;
    if (b && b.kind === 0) this.applyPartTint(b, true);
  }

  private onPartDamaged(p: StructurePart): void {
    const v = p.view as PartVis | null;
    if (!v || v.kind !== 0 || p.removed) return;
    v.flash = 1;
    if (!v.animated) {
      v.animated = true;
      this.animated.push(v);
    }
    this.applyPartTint(v, true);
  }

  private onStructureLoaded(): void {
    const s = this.sim.structure;
    if (!s) return;
    // Snap everything to its settled pose, then build joint visuals once.
    for (const p of s.parts) {
      const v = p.view as PartVis | null;
      if (!v || p.removed) continue;
      this.placePart(v, p.x, p.y, p.angle);
    }
    this.buildJoints(s.joints);
    for (const p of s.parts) {
      const v = p.view as PartVis | null;
      if (v && !p.removed) this.applyPartTint(v, true);
    }
  }

  /** Re-adopt entities that exist without a view (after clear() or late construction). */
  private resync(): void {
    this.needsResync = false;
    for (const e of this.sim.physics.entities.values()) {
      if (!e.view && !e.removed) this.onAdded(e);
    }
    const s = this.sim.structure;
    if (s && this.joints.size === 0) {
      this.buildJoints(s.joints);
      for (const p of s.parts) {
        const v = p.view as PartVis | null;
        if (v && !p.removed) this.applyPartTint(v, true);
      }
    }
  }

  // ------------------------------------------------------------------ parts

  private createPart(p: StructurePart): void {
    const f = this.textures.partFrame(p);
    // Far-side creature limbs sit just behind the body.
    const depth = p.isFragment ? DEPTH.debris : p.hasTag('back') ? DEPTH.structure - 0.4 : DEPTH.structure;
    const img = this.acquire(depth);
    img.setTexture(f.key, f.frame);
    img.setOrigin(f.originX, f.originY);
    img.setScale(1 / TEXTURE_RES);
    img.setAlpha(1);
    img.clearTint();
    img.x = p.x * PPM;
    img.y = p.y * PPM;
    img.rotation = p.angle;
    const v: PartVis = { kind: 0, entity: p, img, joints: [], glow: null, tintSig: -1, tintStamp: -1, depth, neutral: false, flash: 0, animated: false };
    if (p.material.id === 'core' || p.isCore) {
      const gf = this.textures.miscFrame(RK.glow);
      const g = this.glowPool.pop() ?? this.scene.add.image(0, 0, gf.key, gf.frame);
      g.setTexture(gf.key, gf.frame);
      g.setBlendMode(Phaser.BlendModes.ADD);
      g.setDepth(DEPTH.structure - 0.2);
      g.setTint(p.material.color);
      g.setScale((p.extent * PPM * 2 * 2.4) / 64);
      g.setAlpha(0.3);
      g.setVisible(true).setActive(true);
      g.x = img.x;
      g.y = img.y;
      v.glow = g;
      this.cores.push(v);
    }
    p.view = v;
    this.parts.add(v);
    this.applyPartTint(v, true);
  }

  private releasePart(v: PartVis, detachJoints: boolean): void {
    const e = v.entity;
    if (detachJoints) {
      // Joints of a removed part break silently ('removed' emits no event).
      for (let i = v.joints.length - 1; i >= 0; i--) this.removeJointVis(v.joints[i]!.joint);
    }
    v.joints.length = 0;
    if (v.animated) {
      v.animated = false;
      const i = this.animated.indexOf(v);
      if (i >= 0) this.animated.splice(i, 1);
    }
    this.release(v.img, v.depth);
    if (v.glow) {
      v.glow.setVisible(false).setActive(false);
      this.glowPool.push(v.glow);
      v.glow = null;
      const i = this.cores.indexOf(v);
      if (i >= 0) this.cores.splice(i, 1);
    }
    if (e.view === v) e.view = null;
  }

  private placePart(v: PartVis, x: number, y: number, a: number): void {
    const img = v.img;
    img.x = x * PPM;
    img.y = y * PPM;
    img.rotation = a;
  }

  /**
   * Update joint markers attached to an awake part (and restyle the part in
   * stress view). Returns true when a cable end moved.
   */
  private touchJoints(v: PartVis): boolean {
    let cable = false;
    const js = v.joints;
    const stress = this.stressView;
    for (let k = 0; k < js.length; k++) {
      const jv = js[k]!;
      if (jv.stamp === this.frame) continue;
      jv.stamp = this.frame;
      if (!jv.marker) {
        cable = true;
        continue;
      }
      this.placeJoint(jv);
      this.styleJoint(jv, false);
      if (stress) {
        // The other side's utilisation changed too.
        const j = jv.joint;
        const o = (j.a === v.entity ? j.b : j.a)?.view as PartVis | null | undefined;
        if (o && o.kind === 0) this.applyPartTint(o, false);
      }
    }
    if (stress) this.applyPartTint(v, false);
    return cable;
  }

  /**
   * Normal view: wear darkening, and weapon damage pulls the green and blue
   * channels down so the part turns redder as its integrity drops (multiply).
   * Stress view: the part swaps to its neutral light-grey texture variant
   * multiplied by the heat colour (keeps outline + pattern readable), pulsing
   * when yielding.
   *
   * Only the MULTIPLY tint mode is used on purpose: Phaser decodes other tint
   * modes with an exact float compare on an interpolated varying, which drops
   * the tint on individual triangles on some rasterisers.
   */
  private applyPartTint(v: PartVis, force: boolean): void {
    if (!force && v.tintStamp === this.frame) return;
    v.tintStamp = this.frame;
    const p = v.entity;
    const img = v.img;
    if (v.neutral !== this.stressView) {
      v.neutral = this.stressView;
      const f = this.textures.partFrame(p, v.neutral);
      img.setTexture(f.key, f.frame);
      img.setOrigin(f.originX, f.originY);
      force = true;
    }
    if (this.stressView) {
      let color: number;
      if (p.joints.length === 0) color = DETACHED_STRESS_TINT;
      else {
        let s = 0;
        let yielding = false;
        for (let i = 0; i < p.joints.length; i++) {
          const j = p.joints[i]!;
          if (j.stressVis > s) s = j.stressVis;
          if (j.yielding) yielding = true;
        }
        color = stressColor(s);
        if (yielding && p.activeStamp === this.sim.physics.stepIndex) {
          const k = 0.5 + 0.5 * Math.sin(this.time * 16);
          color = lerpColor(color, 0xffffff, 0.15 + 0.3 * k);
        }
      }
      const sig = color | 0x1000000;
      if (sig === v.tintSig && !force) return;
      v.tintSig = sig;
      img.setTint(color);
    } else {
      const color = this.damageTint(v);
      if (color === v.tintSig && !force) return;
      v.tintSig = color;
      if (color === 0xffffff) img.clearTint();
      else img.setTint(color);
    }
  }

  /** Normal-view multiply tint: wear darkening, damage reddening, hit flash, critical throb. */
  private damageTint(v: PartVis): number {
    const p = v.entity;
    // Far-side limbs (2D side view) render darker so overlapping legs read apart.
    const back = p.hasTag('back');
    const d = 1 - p.integrity;
    if (d < 0.005 && v.flash <= 0) {
      const w = p.wear;
      const k = (w > 0.01 ? 1 - 0.26 * Math.min(1, w) : 1) * (back ? 0.62 : 1);
      return grey(k);
    }
    // Ease-out: the first hits already show, half integrity reads clearly red.
    let e = 1 - (1 - d) * (1 - d);
    if (v.flash > 0) e += (1 - e) * 0.7 * v.flash;
    let k = back ? 0.62 + 0.25 * e : 1;
    if (p.integrity < CRITICAL_INTEGRITY && !p.wrecked && this.throbbing(p)) {
      k *= 0.78 + 0.22 * Math.sin(this.time * 11 + p.id);
    }
    const r = 255 * k;
    const g = 255 * k * (1 - 0.8 * e);
    const b = 255 * k * (1 - 0.86 * e);
    return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255);
  }

  /** Critical parts throb only while their creature is still a threat. */
  private throbbing(p: StructurePart): boolean {
    const c = this.sim.creatures.creatureOf(p);
    return !!c && c.active && (p.joints.length > 0 || !!c.spec.float);
  }

  private updateAnimated(realDt: number): void {
    const decay = realDt / HIT_FLASH_TIME;
    for (let i = this.animated.length - 1; i >= 0; i--) {
      const v = this.animated[i]!;
      const p = v.entity;
      if (v.flash > 0) v.flash = Math.max(0, v.flash - decay);
      const keep = !p.removed && (v.flash > 0 || (p.integrity < CRITICAL_INTEGRITY && !p.wrecked && this.throbbing(p)));
      if (!this.stressView) this.applyPartTint(v, false);
      if (!keep) {
        v.animated = false;
        this.animated.splice(i, 1);
      }
    }
  }

  private updateCores(): void {
    const t = this.time;
    const show = !this.stressView;
    for (let i = 0; i < this.cores.length; i++) {
      const v = this.cores[i]!;
      const g = v.glow;
      if (!g) continue;
      // The glow would muddy the heat colours: hide it in stress view.
      if (g.visible !== show) g.setVisible(show);
      if (!show) continue;
      g.x = v.img.x;
      g.y = v.img.y;
      const pulse = 0.26 + 0.1 * Math.sin(t * 2.6 + v.entity.id);
      g.alpha = pulse * v.img.alpha;
    }
  }

  // ------------------------------------------------------------------ projectiles

  private createProj(p: Projectile): void {
    const f = this.textures.projectileFrame(p.radius * PPM, p.ammo.color);
    const img = this.acquire(DEPTH.projectiles);
    img.setTexture(f.key, f.frame);
    img.setOrigin(0.5, 0.5);
    img.setScale(1 / TEXTURE_RES);
    img.setAlpha(1);
    img.clearTint();
    img.rotation = 0;
    img.x = p.x * PPM;
    img.y = p.y * PPM;
    const v: ProjVis = { kind: 1, entity: p, img };
    p.view = v;
    this.projs.push(v);
  }

  private releaseProj(v: ProjVis): void {
    this.release(v.img, DEPTH.projectiles);
    if (v.entity.view === v) v.entity.view = null;
  }

  private placeProjectile(v: ProjVis, x: number, y: number): void {
    v.img.x = x * PPM;
    v.img.y = y * PPM;
  }

  private drawTrails(): void {
    const g = this.trailGfx;
    g.clear();
    let drew = false;
    const grav = this.sim.physics.gravity;
    for (let i = 0; i < this.projs.length; i++) {
      const v = this.projs[i]!;
      const p = v.entity;
      if (p.state !== 'flying' || p.fading > 0 || p.removed) continue;
      const sp2 = p.vx * p.vx + p.vy * p.vy;
      if (sp2 < TRAIL_MIN_SPEED * TRAIL_MIN_SPEED) continue;
      const color = p.ammo.trailColor;
      const r = p.radius * PPM;
      const hx = v.img.x;
      const hy = v.img.y;
      let x0 = hx;
      let y0 = hy;
      // Walk back along the ballistic path: p(t - tau) = p - v*tau + g*tau^2/2.
      for (let k = 1; k <= TRAIL_SEGMENTS; k++) {
        const tau = (TRAIL_TIME * k) / TRAIL_SEGMENTS;
        const x1 = hx - p.vx * tau * PPM;
        const y1 = hy - (p.vy * tau - 0.5 * grav * tau * tau) * PPM;
        const f = 1 - (k - 0.5) / TRAIL_SEGMENTS;
        g.lineStyle(Math.max(1, r * 1.5 * f), color, 0.4 * f);
        g.lineBetween(x0, y0, x1, y1);
        x0 = x1;
        y0 = y1;
      }
      drew = true;
    }
    this.trailsDrawn = drew;
  }

  // ------------------------------------------------------------------ joints

  private buildJoints(list: readonly BreakableJoint[]): void {
    for (const j of list) {
      // Tethers are invisible slack safety cables on loose props (see StructureGenerator).
      if (j.broken || j.tags.includes('tether')) continue;
      const a = j.a.view as PartVis | null;
      if (!a || a.kind !== 0) continue;
      const jv: JointVis = { joint: j, marker: null, stamp: -1, sig: -1 };
      if (j.kind !== 'cable') {
        const wf = this.textures.miscFrame(RK.weld);
        const m = this.markerPool.pop() ?? this.scene.add.image(0, 0, wf.key, wf.frame).setDepth(DEPTH.joints);
        m.setVisible(true).setActive(true);
        m.setAlpha(1);
        m.rotation = 0;
        jv.marker = m;
      } else {
        this.cables.push(jv);
        this.cablesDirty = true;
      }
      this.joints.add(jv);
      a.joints.push(jv);
      const b = j.b?.view as PartVis | null | undefined;
      if (b && b.kind === 0) b.joints.push(jv);
      if (jv.marker) {
        this.placeJoint(jv);
        this.styleJoint(jv, true);
      }
    }
  }

  private removeJointVis(j: BreakableJoint): void {
    const a = j.a.view as PartVis | null;
    let jv: JointVis | null = null;
    if (a && a.kind === 0) jv = takeJoint(a.joints, j);
    const b = j.b?.view as PartVis | null | undefined;
    if (b && b.kind === 0) jv = takeJoint(b.joints, j) ?? jv;
    if (!jv) return;
    this.releaseMarker(jv);
    this.joints.delete(jv);
    if (j.kind === 'cable') {
      const i = this.cables.indexOf(jv);
      if (i >= 0) this.cables.splice(i, 1);
      this.cablesDirty = true;
    }
  }

  private releaseMarker(jv: JointVis): void {
    if (!jv.marker) return;
    jv.marker.setVisible(false).setActive(false);
    this.markerPool.push(jv.marker);
    jv.marker = null;
  }

  /** Marker follows the rendered pose of part A at the joint's local anchor. */
  private placeJoint(jv: JointVis): void {
    const m = jv.marker;
    if (!m) return;
    const j = jv.joint;
    const a = j.a.view as PartVis | null;
    if (!a) return;
    const img = a.img;
    const c = Math.cos(img.rotation);
    const s = Math.sin(img.rotation);
    const lx = j.lax * PPM;
    const ly = j.lay * PPM;
    m.x = img.x + c * lx - s * ly;
    m.y = img.y + s * lx + c * ly;
    m.alpha = img.alpha * this.markerAlpha(jv);
  }

  private markerAlpha(jv: JointVis): number {
    if (this.stressView || jv.joint.kind !== 'weld') return 1;
    return jv.joint.damage > 1 / 32 ? 1 : WELD_ALPHA;
  }

  private styleJoint(jv: JointVis, force: boolean): void {
    const m = jv.marker;
    if (!m) return;
    const j = jv.joint;
    if (this.stressView) {
      let color = stressColor(j.stressVis);
      const dmg = Math.min(1, j.damage);
      if (j.yielding) color = lerpColor(color, 0xffffff, 0.25 + 0.25 * Math.sin(this.time * 18));
      const sig = (color & 0xffffff) + Math.round(dmg * 20) * 0x1000000 + 0x40000000;
      if (sig === jv.sig && !force) return;
      jv.sig = sig;
      this.setMisc(m, RK.node);
      m.setScale(MARKER_SCALE_NODE * (0.85 + dmg * 1.1));
      m.setTint(color);
      m.alpha = 1;
    } else {
      const dmg = Math.min(1, j.damage);
      const q = Math.round(dmg * 16);
      const sig = q + (j.kind === 'hinge' ? 100 : 0);
      if (sig === jv.sig && !force) return;
      jv.sig = sig;
      if (j.kind === 'hinge') {
        this.setMisc(m, RK.hinge);
        m.setScale(MARKER_SCALE_HINGE);
        if (q === 0) m.clearTint();
        else m.setTint(lerpColor(0xffffff, DAMAGE_COLOR, Math.min(1, dmg * 1.3)));
      } else if (q === 0) {
        this.setMisc(m, RK.weld);
        m.setScale(MARKER_SCALE_WELD);
        m.clearTint();
        m.alpha = WELD_ALPHA * ((j.a.view as PartVis | null)?.img.alpha ?? 1);
      } else {
        // The dark bolt heats up toward orange as the weld accumulates plastic damage.
        this.setMisc(m, RK.node);
        m.setScale(MARKER_SCALE_WELD * (14 / 16) * (1 + dmg * 0.4));
        m.setTint(lerpColor(WELD_GREY, DAMAGE_COLOR, Math.min(1, 0.25 + dmg * 1.1)));
        m.alpha = ((j.a.view as PartVis | null)?.img.alpha ?? 1);
      }
    }
  }

  private drawCables(): void {
    this.cablesDirty = false;
    const g = this.cableGfx;
    g.clear();
    for (let i = 0; i < this.cables.length; i++) {
      const jv = this.cables[i]!;
      const j = jv.joint;
      const av = j.a.view as PartVis | null;
      if (!av) continue;
      let img = av.img;
      let c = Math.cos(img.rotation);
      let s = Math.sin(img.rotation);
      const ax = img.x + c * j.lax * PPM - s * j.lay * PPM;
      const ay = img.y + s * j.lax * PPM + c * j.lay * PPM;
      let bx: number;
      let by: number;
      const bv = j.b?.view as PartVis | null | undefined;
      if (bv) {
        img = bv.img;
        c = Math.cos(img.rotation);
        s = Math.sin(img.rotation);
        bx = img.x + c * j.lbx * PPM - s * j.lby * PPM;
        by = img.y + s * j.lbx * PPM + c * j.lby * PPM;
      } else {
        bx = j.lbx * PPM;
        by = j.lby * PPM;
      }
      const dx = bx - ax;
      const dy = by - ay;
      const d = Math.sqrt(dx * dx + dy * dy);
      const L = j.restLength * PPM;
      let color = CABLE_COLOR;
      let alpha = 0.9;
      let width = 2;
      if (this.stressView) {
        color = stressColor(j.stressVis);
        width = 2.6;
        alpha = 1;
      } else if (!j.slack && j.stress > 0.6) {
        // Taut and loaded: warms up slightly.
        color = lerpColor(CABLE_COLOR, 0xffb070, Math.min(1, (j.stress - 0.6) * 2.5));
      }
      if (d < L - 0.5) {
        // Slack: parabolic sag with the rope's excess length.
        const sag = Math.min(L * 0.5, Math.sqrt((3 * d * (L - d)) / 8));
        g.lineStyle(width, color, alpha * 0.85);
        g.beginPath();
        g.moveTo(ax, ay);
        const n = 14;
        for (let k = 1; k <= n; k++) {
          const t = k / n;
          const ly = ay + dy * t;
          let y = ly + 4 * sag * t * (1 - t);
          // The rope lies on the ground instead of hanging through it.
          if (y > CABLE_FLOOR) y = Math.max(ly, CABLE_FLOOR);
          g.lineTo(ax + dx * t, y);
        }
        g.strokePath();
      } else {
        g.lineStyle(width, color, alpha);
        g.lineBetween(ax, ay, bx, by);
      }
      g.fillStyle(0x15181d, 1);
      g.fillCircle(ax, ay, 3.2);
      g.fillCircle(bx, by, 3.2);
      g.fillStyle(color, 1);
      g.fillCircle(ax, ay, 1.8);
      g.fillCircle(bx, by, 1.8);
    }
  }

  // ------------------------------------------------------------------ fading / debug

  private updateFading(): void {
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const e = this.fading[i]!;
      const v = e.view as Vis | null;
      if (!v || e.removed) {
        this.fading.splice(i, 1);
        continue;
      }
      const a = e.fadeDuration > 0 ? Math.max(0, Math.min(1, e.fading / e.fadeDuration)) : 1;
      v.img.alpha = a;
      if (v.kind === 0) {
        for (let k = 0; k < v.joints.length; k++) {
          const jv = v.joints[k]!;
          if (jv.marker) jv.marker.alpha = a * this.markerAlpha(jv);
        }
      }
    }
  }

  private drawColliders(): void {
    const g = this.debugGfx;
    if (!g) return;
    g.clear();
    const buf = this.sim.physics.world.debugRender();
    const v = buf.vertices;
    const c = buf.colors;
    let last = -1;
    const n = v.length / 4;
    for (let i = 0; i < n; i++) {
      const ci = i * 8;
      const col = (((c[ci]! * 255) & 255) << 16) | (((c[ci + 1]! * 255) & 255) << 8) | ((c[ci + 2]! * 255) & 255);
      if (col !== last) {
        g.lineStyle(1.25, lerpColor(col, 0xffffff, 0.25), 0.9);
        last = col;
      }
      const vi = i * 4;
      g.lineBetween(v[vi]! * PPM, v[vi + 1]! * PPM, v[vi + 2]! * PPM, v[vi + 3]! * PPM);
    }
  }

  // ------------------------------------------------------------------ pooling

  private setMisc(img: Image, name: string): void {
    const f = this.textures.miscFrame(name);
    img.setTexture(f.key, f.frame);
  }

  private acquire(depth: number): Image {
    let pool = this.pools.get(depth);
    if (!pool) {
      pool = [];
      this.pools.set(depth, pool);
    }
    const img = pool.pop() ?? this.scene.add.image(0, 0, TEX.pixel).setDepth(depth);
    img.setVisible(true).setActive(true);
    return img;
  }

  private release(img: Image, depth: number): void {
    img.setVisible(false).setActive(false);
    let pool = this.pools.get(depth);
    if (!pool) {
      pool = [];
      this.pools.set(depth, pool);
    }
    pool.push(img);
  }
}

function takeJoint(list: JointVis[], j: BreakableJoint): JointVis | null {
  for (let i = 0; i < list.length; i++) {
    if (list[i]!.joint === j) {
      const jv = list[i]!;
      list.splice(i, 1);
      return jv;
    }
  }
  return null;
}
