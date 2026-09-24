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
 *    baked into the texture; subtle darkening by part.wear. Fading entities:
 *    alpha = fading/fadeDuration.
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
import { grey, lerpColor, scaleColor, stressColor } from './render/color';

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
}

interface ProjVis {
  kind: 1;
  entity: Projectile;
  img: Image;
  /** Ring buffer of recent rendered positions: x, y, time. */
  trail: Float32Array;
  head: number;
  count: number;
}

type Vis = PartVis | ProjVis;

const MARKER_SCALE_WELD = 0.42;
const MARKER_SCALE_HINGE = 0.5;
const MARKER_SCALE_NODE = 0.5;
const TRAIL_N = 18;
const TRAIL_TIME = 0.075;
const TRAIL_MIN_SPEED = 9;
const DAMAGE_COLOR = 0xff5a2a;
const DETACHED_STRESS_TINT = 0x5a6573;
const CABLE_COLOR = 0xcfd6e0;

export class WorldRenderer {
  stressView = false;
  colliderDebug = false;

  private readonly offs: Array<() => void> = [];
  private readonly parts = new Set<PartVis>();
  private readonly projs = new Set<ProjVis>();
  private readonly joints = new Set<JointVis>();
  private readonly cables: JointVis[] = [];
  private readonly cores: PartVis[] = [];
  private readonly fading = new Set<Entity>();

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
        if (entity.view) this.fading.add(entity);
      }),
      ev.on('jointBroken', ({ joint }) => this.onJointBroken(joint)),
      ev.on('partDetached', ({ part }) => {
        const v = part.view as PartVis | null;
        if (v && v.kind === 0) this.applyPartTint(v, true);
      }),
      ev.on('structureLoaded', () => this.onStructureLoaded()),
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
      if (v.kind === 0) {
        this.placePart(v, x, y, a);
        if (this.touchJoints(v)) cableTouched = true;
      } else {
        this.placeProjectile(v, x, y);
      }
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
        if (this.touchJoints(v)) cableTouched = true;
      } else {
        v.img.x = e.x * PPM;
        v.img.y = e.y * PPM;
      }
    }
    this.syncPrev = cur;
    this.syncCur = prev;

    if (this.fading.size) this.updateFading();
    if (this.cores.length) this.updateCores();
    if (this.projs.size || this.trailsDrawn) this.drawTrails();
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

  /** Remove all display objects (level change). */
  clear(): void {
    for (const v of this.parts) this.releasePart(v, false);
    for (const v of this.projs) this.releaseProj(v);
    for (const jv of this.joints) this.releaseMarker(jv);
    this.parts.clear();
    this.projs.clear();
    this.joints.clear();
    this.cables.length = 0;
    this.cores.length = 0;
    this.fading.clear();
    this.syncPrev.length = 0;
    this.syncCur.length = 0;
    this.trailGfx.clear();
    this.cableGfx.clear();
    this.debugGfx?.clear();
    this.trailsDrawn = false;
    this.cablesDirty = true;
    // Keep texture memory bounded across many (procedural) levels.
    if (this.textures.atlasPages > 6) {
      for (const pool of this.pools.values()) for (const img of pool) img.setTexture(TEX.pixel);
      this.textures.resetPartTextures();
    }
    // Entities that survive the clear get re-adopted on the next update.
    this.needsResync = true;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.clear();
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
    this.fading.delete(e);
    if (!v) return;
    if (v.kind === 0) {
      this.releasePart(v, true);
      this.parts.delete(v);
    } else {
      this.releaseProj(v);
      this.projs.delete(v);
    }
  }

  private onJointBroken(j: BreakableJoint): void {
    this.removeJointVis(j);
    const a = j.a.view as PartVis | null;
    if (a && a.kind === 0) this.applyPartTint(a, true);
    const b = j.b?.view as PartVis | null | undefined;
    if (b && b.kind === 0) this.applyPartTint(b, true);
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
    const depth = p.isFragment ? DEPTH.debris : DEPTH.structure;
    const img = this.acquire(depth);
    img.setTexture(f.key, f.frame);
    img.setOrigin(f.originX, f.originY);
    img.setScale(1 / TEXTURE_RES);
    img.setAlpha(1);
    img.clearTint();
    img.x = p.x * PPM;
    img.y = p.y * PPM;
    img.rotation = p.angle;
    const v: PartVis = { kind: 0, entity: p, img, joints: [], glow: null, tintSig: -1, tintStamp: -1, depth };
    if (p.material.id === 'core' || p.isCore) {
      const g = this.glowPool.pop() ?? this.scene.add.image(0, 0, TEX.glow);
      g.setTexture(TEX.glow);
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
   * Normal view: wear darkening (multiply). Stress view: heat colour via the
   * two-colour tint (keeps outline + pattern readable), pulsing when yielding.
   */
  private applyPartTint(v: PartVis, force: boolean): void {
    if (!force && v.tintStamp === this.frame) return;
    v.tintStamp = this.frame;
    const p = v.entity;
    const img = v.img;
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
      img.setTintMode(Phaser.TintModes.MULTIPLY_TWO);
      img.setTint(color);
      img.setTint2(scaleColor(color, 0.18));
    } else {
      const w = p.wear;
      const k = w > 0.01 ? 1 - 0.26 * Math.min(1, w) : 1;
      const color = grey(k);
      if (color === v.tintSig && !force) return;
      v.tintSig = color;
      if (k >= 1) img.clearTint();
      else {
        img.setTintMode(Phaser.TintModes.MULTIPLY);
        img.setTint(color);
      }
    }
  }

  private updateCores(): void {
    const t = this.time;
    for (let i = 0; i < this.cores.length; i++) {
      const v = this.cores[i]!;
      const g = v.glow;
      if (!g) continue;
      g.x = v.img.x;
      g.y = v.img.y;
      const pulse = 0.26 + 0.1 * Math.sin(t * 2.6 + v.entity.id);
      g.alpha = pulse * v.img.alpha;
    }
  }

  // ------------------------------------------------------------------ projectiles

  private createProj(p: Projectile): void {
    const key = this.textures.projectileKey(p.radius * PPM, p.ammo.color);
    const img = this.acquire(DEPTH.projectiles);
    img.setTexture(key);
    img.setOrigin(0.5, 0.5);
    img.setScale(1 / TEXTURE_RES);
    img.setAlpha(1);
    img.clearTint();
    img.rotation = 0;
    img.x = p.x * PPM;
    img.y = p.y * PPM;
    const v: ProjVis = { kind: 1, entity: p, img, trail: new Float32Array(TRAIL_N * 3), head: 0, count: 0 };
    p.view = v;
    this.projs.add(v);
  }

  private releaseProj(v: ProjVis): void {
    this.release(v.img, DEPTH.projectiles);
    v.count = 0;
    if (v.entity.view === v) v.entity.view = null;
  }

  private placeProjectile(v: ProjVis, x: number, y: number): void {
    const px = x * PPM;
    const py = y * PPM;
    v.img.x = px;
    v.img.y = py;
    // Trail sample (rendered positions, real time).
    const t = v.trail;
    const i = v.head * 3;
    t[i] = px;
    t[i + 1] = py;
    t[i + 2] = this.time;
    v.head = (v.head + 1) % TRAIL_N;
    if (v.count < TRAIL_N) v.count++;
  }

  private drawTrails(): void {
    const g = this.trailGfx;
    g.clear();
    let drew = false;
    const now = this.time;
    for (const v of this.projs) {
      const p = v.entity;
      if (v.count < 2 || p.fading > 0) continue;
      const sp2 = p.vx * p.vx + p.vy * p.vy;
      if (sp2 < TRAIL_MIN_SPEED * TRAIL_MIN_SPEED) continue;
      const color = p.ammo.trailColor;
      const r = p.radius * PPM;
      let idx = (v.head - 1 + TRAIL_N) % TRAIL_N;
      let x0 = v.img.x;
      let y0 = v.img.y;
      for (let k = 1; k < v.count; k++) {
        idx = (idx - 1 + TRAIL_N) % TRAIL_N;
        const b = idx * 3;
        const age = now - v.trail[b + 2]!;
        if (age > TRAIL_TIME) break;
        const x1 = v.trail[b]!;
        const y1 = v.trail[b + 1]!;
        const f = 1 - age / TRAIL_TIME;
        g.lineStyle(Math.max(1, r * 1.5 * f), color, 0.42 * f);
        g.lineBetween(x0, y0, x1, y1);
        x0 = x1;
        y0 = y1;
        drew = true;
      }
    }
    this.trailsDrawn = drew;
  }

  // ------------------------------------------------------------------ joints

  private buildJoints(list: readonly BreakableJoint[]): void {
    for (const j of list) {
      if (j.broken) continue;
      const a = j.a.view as PartVis | null;
      if (!a || a.kind !== 0) continue;
      const jv: JointVis = { joint: j, marker: null, stamp: -1, sig: -1 };
      if (j.kind !== 'cable') {
        const m = this.markerPool.pop() ?? this.scene.add.image(0, 0, RK.weld).setDepth(DEPTH.joints);
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
    m.alpha = img.alpha;
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
      m.setTexture(RK.node);
      m.setScale(MARKER_SCALE_NODE * (0.85 + dmg * 1.1));
      m.setTintMode(Phaser.TintModes.MULTIPLY);
      m.setTint(color);
    } else {
      const dmg = Math.min(1, j.damage);
      const q = Math.round(dmg * 16);
      const sig = q + (j.kind === 'hinge' ? 100 : 0);
      if (sig === jv.sig && !force) return;
      jv.sig = sig;
      if (j.kind === 'hinge') {
        m.setTexture(RK.hinge);
        m.setScale(MARKER_SCALE_HINGE);
      } else {
        m.setTexture(RK.weld);
        m.setScale(MARKER_SCALE_WELD * (1 + dmg * 0.35));
      }
      if (q === 0) m.clearTint();
      else {
        // Dark bolt heats up toward orange as the weld accumulates plastic damage.
        m.setTintMode(Phaser.TintModes.MULTIPLY_TWO);
        m.setTint(0xffffff);
        m.setTint2(lerpColor(0x000000, DAMAGE_COLOR, Math.min(1, dmg * 1.3)));
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
          g.lineTo(ax + dx * t, ay + dy * t + 4 * sag * t * (1 - t));
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
    for (const e of this.fading) {
      const v = e.view as Vis | null;
      if (!v || e.removed) {
        this.fading.delete(e);
        continue;
      }
      const a = e.fadeDuration > 0 ? Math.max(0, Math.min(1, e.fading / e.fadeDuration)) : 1;
      v.img.alpha = a;
      if (v.kind === 0) {
        for (let k = 0; k < v.joints.length; k++) {
          const m = v.joints[k]!.marker;
          if (m) m.alpha = a;
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
