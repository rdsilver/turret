/**
 * Roaming weak spots (sim/creature/weakSpot.ts), drawn so they can't be
 * missed. The one part of a creature that can be hurt right now glows cyan:
 * a bright rim around its silhouette, its own art lit up (an additive copy,
 * so damage tint and craters still show through) and a soft halo. The glow
 * breathes, and dims as the visit's damage allowance burns out. For the last
 * moments before a timed move the next part's rim flickers into life while
 * the current glow stutters; when the spot moves, the new part flares.
 *
 * Owned by WorldRenderer (which knows each part's image): update() runs after
 * the parts are placed for the frame. The rim and lit copies sit directly
 * below / above the part in the display list, so parts in front of it (an
 * arm over the body) still cover its glow.
 */
import * as Phaser from 'phaser';
import type { Simulation } from '../sim/Simulation';
import type { Creature } from '../sim/creature/Creature';
import type { StructurePart } from '../sim/StructurePart';
import { weakSpotTelegraph } from '../sim/creature/weakSpot';
import { PPM } from '../config/constants';
import type { TextureFactory } from './TextureFactory';
import { RK } from './render/RenderKeys';

type Image = Phaser.GameObjects.Image;

/** Weak-spot colour: cold cyan, nothing like damage red, explosions or sparks. */
export const WEAK_SPOT_COLOR = 0x2ee8ff;
/** Seconds the flare on a newly lit part lasts. */
const FLARE_TIME = 0.45;
/** Rim width around the silhouette (world px). */
const RIM = 9;
/** Halo size relative to the part. */
const HALO = 2.2;

interface Mark {
  spot: StructurePart | null;
  /** Glowing rim: a slightly enlarged copy of the spot's art just below it. */
  rim: Image;
  /** Additive copy of the spot's art just above it. */
  lit: Image;
  /** Soft glow further back. */
  halo: Image;
  /** Rim on the part the spot moves to next (telegraph). */
  next: Image;
  /** 1..0 flare after a move. */
  flare: number;
  stamp: number;
}

export class WeakSpotView {
  private readonly marks = new Map<Creature, Mark>();
  private readonly pool: Mark[] = [];
  private time = 0;
  private frame = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly sim: Simulation,
    private readonly textures: TextureFactory,
    /** The part's image this frame (null if it has none). */
    private readonly artOf: (p: StructurePart) => Image | null,
  ) {}

  update(realDt: number, hidden: boolean): void {
    this.time += realDt;
    const frame = ++this.frame;
    for (const c of this.sim.creatures.list) {
      const spot = c.active ? c.weakSpot : null;
      if (!spot || spot.removed) continue;
      let m = this.marks.get(c);
      if (!m) {
        m = this.acquire();
        this.marks.set(c, m);
      }
      m.stamp = frame;
      if (m.spot !== spot) {
        if (m.spot) m.flare = 1;
        m.spot = spot;
      }
      m.flare = Math.max(0, m.flare - realDt / FLARE_TIME);
      this.draw(c, m, spot, hidden);
    }
    for (const [c, m] of this.marks) {
      if (m.stamp === frame) continue;
      this.marks.delete(c);
      this.release(m);
    }
  }

  clear(): void {
    for (const m of this.marks.values()) this.release(m);
    this.marks.clear();
  }

  destroy(): void {
    this.clear();
    for (const m of this.pool) for (const img of [m.rim, m.lit, m.halo, m.next]) img.destroy();
    this.pool.length = 0;
  }

  private draw(c: Creature, m: Mark, spot: StructurePart, hidden: boolean): void {
    const art = this.artOf(spot);
    if (hidden || !art) {
      this.hide(m);
      return;
    }
    const t = this.time;
    const info = weakSpotTelegraph(c);
    const warn = info?.part ? info.progress : 0;
    // A breathing pulse, dimming as this visit burns out.
    let k = (0.78 + 0.22 * Math.sin(t * 6.5)) * (1 - 0.45 * (info?.burn ?? 0));
    // About to move: the glow stutters, harder as the move nears.
    if (warn > 0) k *= 1 - 0.7 * warn * (Math.sin(t * 38) > 0 ? 1 : 0.15);
    k = Math.min(1, k + 0.5 * m.flare);
    const a = art.alpha;
    this.rim(m.rim, art, spot, 1 + 0.8 * m.flare);
    m.rim.setAlpha(k * a).setVisible(true);
    copyArt(m.lit, art);
    this.stack(m.lit, art, true);
    m.lit.setAlpha((0.16 + 0.2 * k + 0.35 * m.flare) * a).setVisible(true);
    this.halo(m.halo, spot, art, (0.45 + 0.35 * m.flare) * k * a, 1 + 0.6 * m.flare);
    const nextPart = info?.part ?? null;
    const nextArt = nextPart && nextPart !== spot ? this.artOf(nextPart) : null;
    if (nextArt && warn > 0) {
      this.rim(m.next, nextArt, nextPart!, 0.9);
      m.next.setAlpha(Math.min(1, warn * 1.8) * (Math.sin(t * 30) > -0.2 ? 1 : 0.2) * nextArt.alpha).setVisible(true);
    } else m.next.setVisible(false);
  }

  /** A copy of `art` enlarged by `RIM * width` px all round, just below it. */
  private rim(img: Image, art: Image, p: StructurePart, width: number): void {
    copyArt(img, art);
    const s = p.shape;
    // The part's own size in world px (its art is scaled about its centre).
    const w = (s.kind === 'box' ? s.hw * 2 : s.kind === 'circle' ? s.r * 2 : p.extent * 2) * PPM;
    const h = s.kind === 'box' ? s.hh * 2 * PPM : w;
    img.setScale(art.scaleX * (1 + (2 * RIM * width) / w), art.scaleY * (1 + (2 * RIM * width) / h));
    this.stack(img, art, false);
  }

  private halo(h: Image, p: StructurePart, art: Image, alpha: number, grow: number): void {
    const s = p.shape;
    const w = s.kind === 'box' ? s.hw * 2 : s.kind === 'circle' ? s.r * 2 : p.extent * 2;
    const hh = s.kind === 'box' ? s.hh * 2 : w;
    // Thin limbs get a halo at least a third as wide as they are long.
    const hw = Math.max(w, hh * 0.35);
    const hy = Math.max(hh, w * 0.35);
    h.setPosition(art.x, art.y);
    h.setRotation(art.rotation);
    h.setScale((hw * PPM * HALO * grow) / 64, (hy * PPM * HALO * grow) / 64);
    // Behind every part on its side of the body.
    // (Setting a depth, even an unchanged one, queues a sort of the whole display list.)
    if (h.depth !== art.depth - 0.3) h.setDepth(art.depth - 0.3);
    h.setAlpha(alpha).setVisible(true);
  }

  /** Put `img` at `art`'s depth, directly above (or below) it in the display list. */
  private stack(img: Image, art: Image, above: boolean): void {
    if (img.depth !== art.depth) img.setDepth(art.depth);
    const list = this.scene.children.getChildren() as Phaser.GameObjects.GameObject[];
    const i = list.indexOf(art);
    if (i < 0 || list[above ? i + 1 : i - 1] === img) return;
    const j = list.indexOf(img);
    if (j >= 0) list.splice(j, 1);
    list.splice(above ? list.indexOf(art) + 1 : list.indexOf(art), 0, img);
  }

  private hide(m: Mark): void {
    m.rim.setVisible(false);
    m.lit.setVisible(false);
    m.halo.setVisible(false);
    m.next.setVisible(false);
  }

  private acquire(): Mark {
    const m = this.pool.pop();
    if (m) {
      m.spot = null;
      m.flare = 0;
      return m;
    }
    const gf = this.textures.miscFrame(RK.glow);
    const mk = () => this.scene.add.image(0, 0, gf.key, gf.frame).setBlendMode(Phaser.BlendModes.ADD).setTint(WEAK_SPOT_COLOR).setVisible(false);
    return { spot: null, rim: mk(), lit: mk(), halo: mk(), next: mk(), flare: 0, stamp: 0 };
  }

  private release(m: Mark): void {
    this.hide(m);
    m.spot = null;
    this.pool.push(m);
  }
}

/** Make `img` an exact overlay of `art` (same frame, pose and size). */
function copyArt(img: Image, art: Image): void {
  if (img.texture !== art.texture || img.frame !== art.frame) img.setTexture(art.texture.key, art.frame.name);
  img.setOrigin(art.originX, art.originY);
  img.setScale(art.scaleX, art.scaleY);
  img.setPosition(art.x, art.y);
  img.setRotation(art.rotation);
}
