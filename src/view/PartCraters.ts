/**
 * Impact craters on weapon-damaged parts. OWNER: render agent.
 *
 * A part's art normally comes from a shared atlas frame. On its first weapon
 * hit it moves to a region of a shared crater page holding its art with
 * craters painted in (render/CraterPainter.ts). Craters live in the part's
 * local frame (texels of its frame), so they move and rotate with the part.
 *
 * - hit(): every partDamaged adds a crater where the round struck: the hit
 *   point is projected onto the part's silhouette (bullets stop at the edge)
 *   and pushed a random depth inward, so some craters chip the edge and some
 *   are pits just inside it. A hit next to an existing crater merges into it
 *   (that crater grows); past MAX_CRATERS every hit merges into the nearest
 *   one, so the painting cost of a part stays bounded however long it is shot.
 * - Craters grow as the part's integrity drops (GROW_STEPS steps): a part
 *   about to break looks chewed, and growing craters near the edge turn into
 *   chips.
 * - flush() (end of WorldRenderer.update): each dirty part repaints at most
 *   once per frame into its own small CPU canvas — just the new / merged
 *   craters on top, or everything on a fresh copy of its base art when the
 *   growth step or the base (stress view) changes — and uploads only its
 *   region (texSubImage2D through Phaser's texture state tracking).
 *   Undamaged parts cost nothing.
 * - Nothing is ever read back from a big canvas: base art comes from a small
 *   per-art cache painted by PartPainter (drawing FROM a large canvas that
 *   changed makes the browser snapshot the whole bitmap, milliseconds each).
 * - One shared page texture instead of a texture per part: Phaser's
 *   multi-texture batch picks the sampler with an exact float compare, and
 *   many distinct textures in one batch drop triangles (see MiscAtlas.ts).
 *   Regions and scratch canvases are recycled by size while a level runs.
 *   clear() frees scratch canvases, cached art and every page but the first,
 *   which is only emptied (creating a page costs a 4 MB texture upload, a
 *   hitch if it happened on a hit; warm() makes it at level load instead),
 *   so memory stays bounded across levels; destroy() frees everything.
 */
import type * as Phaser from 'phaser';
import type { PartShape, StructurePart } from '../sim/StructurePart';
import { neutralMaterial, type TextureFactory } from './TextureFactory';
import { TEXELS_PER_M } from './render/res';
import { measurePart } from './render/PartPainter';
import { craterStyle, paintCraters, type Crater, type CraterGeom, type CraterStyle } from './render/CraterPainter';

type Image = Phaser.GameObjects.Image;
type Ctx = CanvasRenderingContext2D;

/** The renderer's part record, as far as craters are concerned. */
export interface CraterHost {
  entity: StructurePart;
  img: Image;
  /** Showing the neutral (stress view) texture variant. */
  neutral: boolean;
  craters: CraterSet | null;
}

interface Shelf {
  y: number;
  h: number;
  x: number;
}

interface CraterPage {
  key: string;
  tex: Phaser.Textures.CanvasTexture;
  ctx: Ctx;
  shelves: Shelf[];
  nextY: number;
  /** Released regions by size bucket. */
  free: Map<number, Region[]>;
  /** Frame names of every region carved from this page. */
  frames: string[];
}

interface Region {
  page: CraterPage;
  x: number;
  y: number;
  /** Bucket size (texels); the part's frame sits at the region's top-left. */
  w: number;
  h: number;
  frame: string;
}

export interface CraterSet {
  host: CraterHost;
  region: Region | null;
  /** Private CPU canvas of the region's size: painted, then uploaded. */
  scratch: Ctx | null;
  list: Crater[];
  /** Indices of craters added or merged since the last paint. */
  fresh: number[];
  /** Growth step the art was painted at. */
  step: number;
  /** Next paint starts from a fresh copy of the base art. */
  full: boolean;
  dirty: boolean;
  released: boolean;
  style: CraterStyle;
  geom: CraterGeom;
  /** Frame size and body origin inside it (texels). */
  w: number;
  h: number;
  ox: number;
  oy: number;
  /** Largest crater radius (texels): keeps thin limbs from vanishing under one crater. */
  maxR: number;
  /** Half the smaller dimension of the part (texels). */
  halfMin: number;
}

export interface CraterStats {
  /** Parts showing craters. */
  live: number;
  craters: number;
  pages: number;
  /** Regions carved out of the pages (in use + recycled). */
  regions: number;
  /** Cached base arts / pooled scratch canvases. */
  arts: number;
  scratchPooled: number;
  paints: number;
  fullPaints: number;
  uploads: number;
  /** Paints that found no room on the pages (drawn without craters until room frees up). */
  skipped: number;
  /** Total milliseconds spent painting + uploading. */
  paintMs: number;
}

/** Crater radius of a standard machine-gun round (m) before material / damage scaling. */
const CRATER_R = 0.12;
/** Crater cap per part: further hits merge into the nearest crater. */
const MAX_CRATERS = 22;
/** A hit closer than MERGE * (r1 + r2) to a crater deepens that crater instead of adding one. */
const MERGE = 0.6;
/** Crater radius multiplier at zero integrity is 1 + GROW. */
const GROW = 0.8;
/** Growth is quantised: each step repaints the part once. */
const GROW_STEPS = 4;
const PAGE_SIZE = 1024;
const MAX_PAGES = 3;
/** Transparent gutter between regions (texels) so bilinear filtering never bleeds. */
const GAP = 2;
/** Region sizes round up to this many texels so parts of one kind recycle each other's regions. */
const BUCKET = 8;
/** Free scratch canvases kept for reuse, and cached base arts. */
const SCRATCH_POOL_MAX = 24;
const ART_CACHE_MAX = 64;

let pageSerial = 0;
let regionSerial = 0;

interface Surface {
  /** Signed distance to the boundary (m, < 0 inside). */
  d: number;
  /** Inward normal of the nearest boundary piece. */
  nx: number;
  ny: number;
}

const SF: Surface = { d: 0, nx: 0, ny: 0 };

/** The bits of Phaser's WebGL renderer used for sub-region uploads. */
interface GLTextureLike {
  webGLTexture: WebGLTexture | null;
  flipY: boolean;
  pma: boolean;
}
interface GLRendererLike {
  gl?: WebGLRenderingContext;
  glTextureUnits?: { bind(texture: GLTextureLike, unit: number): void };
  glWrapper?: { updateTexturing(state: { texturing: { flipY: boolean; premultiplyAlpha: boolean } }): void };
}

export class PartCraters {
  private readonly dirty: CraterSet[] = [];
  private readonly live = new Set<CraterSet>();
  private pages: CraterPage[] = [];
  private regionCount = 0;
  private readonly scratchPool = new Map<number, Ctx[]>();
  private scratchPooled = 0;
  private readonly arts = new Map<string, Ctx>();
  private seed = 0x2f6b1c3d;
  private readonly counters = { paints: 0, fullPaints: 0, uploads: 0, skipped: 0, paintMs: 0 };

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly textures: TextureFactory,
  ) {}

  /** Any part waiting for a repaint this frame. */
  get pending(): boolean {
    return this.dirty.length > 0;
  }

  get stats(): CraterStats {
    let craters = 0;
    for (const s of this.live) craters += s.list.length;
    return {
      live: this.live.size,
      craters,
      pages: this.pages.length,
      regions: this.regionCount,
      arts: this.arts.size,
      scratchPooled: this.scratchPooled,
      ...this.counters,
    };
  }

  /**
   * A round hit `host`'s part at world point (x, y) (sim meters). `amount` is
   * the damage dealt after `armor` absorbed its share.
   */
  hit(host: CraterHost, x: number, y: number, amount: number, armor: number): void {
    const p = host.entity;
    if (p.removed) return;
    const set = host.craters ?? this.create(host);
    if (!set) return;
    const S = TEXELS_PER_M;
    // Impact point in the part's local frame.
    const dx = x - p.x;
    const dy = y - p.y;
    const c = Math.cos(p.angle);
    const s = Math.sin(p.angle);
    const lx = c * dx + s * dy;
    const ly = -s * dx + c * dy;
    surface(p.shape, lx, ly, SF);
    // Bigger rounds leave bigger craters (the event carries damage after armour).
    const raw = armor < 0.98 ? amount / (1 - armor) : amount;
    const round = Math.max(0.6, Math.min(1.5, 0.55 + 0.45 * Math.sqrt(Math.max(0, raw))));
    const r = Math.min(set.maxR, Math.max(2.5, CRATER_R * S * set.style.size * round * (0.8 + 0.4 * this.rand())));
    let depth: number;
    if (SF.d > (-0.35 * r) / S) {
      // Surface hit: from the edge point, a random depth inward (roughly 20-50% chip the edge,
      // depending on the material; the rest are pits just inside it).
      depth = Math.min(r * (0.1 + 3 * Math.pow(this.rand(), 1.4)), set.halfMin * 0.85);
    } else depth = -SF.d * S;
    const cx = set.ox + (lx + SF.nx * SF.d) * S + SF.nx * depth;
    const cy = set.oy + (ly + SF.ny * SF.d) * S + SF.ny * depth;

    const list = set.list;
    let best = -1;
    let bestD2 = Infinity;
    for (let i = 0; i < list.length; i++) {
      const k = list[i]!;
      const d2 = (k.x - cx) * (k.x - cx) + (k.y - cy) * (k.y - cy);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = i;
      }
    }
    if (best >= 0 && (list.length >= MAX_CRATERS || Math.sqrt(bestD2) < MERGE * (list[best]!.r + r))) {
      // A merged hit widens the crater by how much of the part it destroyed: heavy
      // plate soaking up a hundred rounds stays scuffed, a wooden limb gets gouged.
      const share = p.maxHp > 0 ? amount / p.maxHp : 1;
      this.merge(set, list[best]!, cx, cy, r * Math.max(0.08, Math.min(0.55, share * 6)));
      if (!set.fresh.includes(best)) set.fresh.push(best);
    } else {
      list.push({ x: cx, y: cy, r, nx: SF.nx, ny: SF.ny, depth: Math.max(0, depth), seed: (this.rand() * 0x7fffffff) | 0 });
      set.fresh.push(list.length - 1);
    }
    this.markDirty(set);
  }

  /**
   * The part's base art changed (stress view toggled): repaint on the other
   * variant. Returns false when the part shows no crater art yet (the caller
   * swaps its plain atlas frame as usual).
   */
  rebase(host: CraterHost): boolean {
    const set = host.craters;
    if (!set) return false;
    set.style = craterStyle(host.neutral ? neutralMaterial(host.entity.material) : host.entity.material);
    set.full = true;
    this.markDirty(set);
    return set.region !== null;
  }

  /** The part's display object goes away: region and scratch are recycled. Never touches the image. */
  release(host: CraterHost): void {
    const set = host.craters;
    if (!set) return;
    host.craters = null;
    set.released = true;
    this.live.delete(set);
    const r = set.region;
    if (r) {
      set.region = null;
      const key = bucketKey(r.w, r.h);
      let list = r.page.free.get(key);
      if (!list) {
        list = [];
        r.page.free.set(key, list);
      }
      list.push(r);
    }
    if (set.scratch) {
      this.recycleScratch(set.scratch);
      set.scratch = null;
    }
  }

  /** Repaint and upload every dirty part (at most once per part per frame). */
  flush(): void {
    const t0 = performance.now();
    for (let i = 0; i < this.dirty.length; i++) {
      const set = this.dirty[i]!;
      set.dirty = false;
      if (!set.released && !set.host.entity.removed) this.paint(set);
    }
    this.dirty.length = 0;
    this.counters.paintMs += performance.now() - t0;
  }

  /** Create the first page now (level load) rather than on the first hit, where it would hitch. */
  warm(): void {
    if (this.pages.length === 0) this.newPage();
  }

  /**
   * Level change: drop every crater, free scratch canvases, cached art and all
   * pages but the first, which is emptied for reuse. No part may show crater
   * art afterwards (the renderer releases all parts first).
   */
  clear(): void {
    this.reset(1);
  }

  destroy(): void {
    this.reset(0);
  }

  private reset(keepPages: number): void {
    for (const set of [...this.live]) this.release(set.host);
    const t = this.scene.textures;
    for (let i = keepPages; i < this.pages.length; i++) {
      const page = this.pages[i]!;
      if (t.exists(page.key)) t.remove(page.key);
    }
    this.pages.length = Math.min(this.pages.length, keepPages);
    for (const page of this.pages) {
      // Only the CPU copy is cleared: every region is repainted and uploaded before it is shown again.
      for (const name of page.frames) page.tex.remove(name);
      page.frames.length = 0;
      page.shelves.length = 0;
      page.nextY = GAP;
      page.free.clear();
      page.ctx.clearRect(0, 0, PAGE_SIZE, PAGE_SIZE);
    }
    this.regionCount = 0;
    for (const list of this.scratchPool.values()) for (const ctx of list) freeCanvas(ctx);
    this.scratchPool.clear();
    this.scratchPooled = 0;
    for (const ctx of this.arts.values()) freeCanvas(ctx);
    this.arts.clear();
    this.dirty.length = 0;
  }

  // ------------------------------------------------------------------ craters

  private create(host: CraterHost): CraterSet | null {
    const p = host.entity;
    const S = TEXELS_PER_M;
    const lay = measurePart(p.shape, S);
    // Parts bigger than a page (huge demolition slabs) keep their plain art.
    if (lay.w + GAP * 2 > PAGE_SIZE || lay.h + GAP * 2 > PAGE_SIZE) return null;
    const dims = shapeDims(p.shape);
    const minDim = Math.min(dims.w, dims.h) * S;
    const set: CraterSet = {
      host,
      region: null,
      scratch: null,
      list: [],
      fresh: [],
      step: 0,
      full: true,
      dirty: false,
      released: false,
      style: craterStyle(host.neutral ? neutralMaterial(p.material) : p.material),
      geom: {
        horizontal: dims.w >= dims.h,
        // Same outline width as PartPainter: ~1.5 world px, thinner on small parts.
        lw: Math.max(1.5, Math.min(S * 0.05, minDim * 0.16)),
        maxNotch: minDim * 0.42,
      },
      w: lay.w,
      h: lay.h,
      ox: lay.ox,
      oy: lay.oy,
      maxR: Math.max(2.5, Math.min(minDim * 0.34, 0.42 * S)),
      halfMin: minDim / 2,
    };
    host.craters = set;
    this.live.add(set);
    return set;
  }

  /** Fold a hit at (cx, cy) into crater k, widening it by `grow` (texels, added in quadrature). */
  private merge(set: CraterSet, k: Crater, cx: number, cy: number, grow: number): void {
    // Area-weighted centre: small additions barely move the crater.
    const w1 = k.r * k.r;
    const w2 = grow * grow * 2;
    k.x = (k.x * w1 + cx * w2) / (w1 + w2);
    k.y = (k.y * w1 + cy * w2) / (w1 + w2);
    k.r = Math.min(set.maxR, Math.hypot(k.r, grow));
    const S = TEXELS_PER_M;
    surface(set.host.entity.shape, (k.x - set.ox) / S, (k.y - set.oy) / S, SF);
    k.depth = Math.max(0, -SF.d * S);
    k.nx = SF.nx;
    k.ny = SF.ny;
  }

  private markDirty(set: CraterSet): void {
    if (set.dirty) return;
    set.dirty = true;
    this.dirty.push(set);
  }

  private paint(set: CraterSet): void {
    const host = set.host;
    const p = host.entity;
    const step = Math.min(GROW_STEPS, Math.round((1 - Math.max(0, p.integrity)) * GROW_STEPS));
    if (step !== set.step) {
      set.step = step;
      set.full = true;
    }
    let attach = false;
    if (!set.region) {
      const r = this.allocate(set.w, set.h);
      if (!r) {
        // No room: keep the craters and try again on the next hit.
        this.counters.skipped++;
        return;
      }
      r.page.tex.get(r.frame).setSize(set.w, set.h, r.x, r.y);
      set.region = r;
      set.scratch = this.acquireScratch(r.w, r.h);
      set.full = true;
      attach = true;
    }
    const r = set.region;
    const ctx = set.scratch!;
    const grow = 1 + (GROW * set.step) / GROW_STEPS;
    if (set.full) {
      ctx.clearRect(0, 0, r.w, r.h);
      ctx.drawImage(this.baseArt(p, host.neutral, set.w, set.h).canvas, 0, 0);
      paintCraters(ctx, set.list, null, grow, set.maxR, set.style, set.geom);
      set.full = false;
      this.counters.fullPaints++;
    } else {
      paintCraters(ctx, set.list, set.fresh, grow, set.maxR, set.style, set.geom);
    }
    set.fresh.length = 0;
    this.counters.paints++;
    this.upload(r, ctx.canvas);
    if (attach) {
      const f = this.textures.partFrame(p, host.neutral);
      host.img.setTexture(r.page.key, r.frame);
      host.img.setOrigin(f.originX, f.originY);
    }
  }

  /** A part's art, painted once per look into a small canvas (cached until clear()). */
  private baseArt(p: StructurePart, neutral: boolean, w: number, h: number): Ctx {
    const name = this.textures.artName(p, neutral);
    let ctx = this.arts.get(name);
    if (!ctx) {
      if (this.arts.size >= ART_CACHE_MAX) {
        const [k0, old] = this.arts.entries().next().value as [string, Ctx];
        freeCanvas(old);
        this.arts.delete(k0);
      }
      ctx = cpuCanvas(w, h);
      this.textures.paintArt(ctx, p, neutral);
      this.arts.set(name, ctx);
    }
    return ctx;
  }

  // ------------------------------------------------------------------ pages

  /**
   * Put a part's freshly painted scratch into its page region. The page
   * canvas gets a copy (it stays the source of truth for the canvas renderer
   * and a WebGL context restore; drawing INTO it is cheap); WebGL gets just
   * the region, bound via Phaser's own texture-unit tracking so its state
   * cache stays right.
   */
  private upload(r: Region, src: HTMLCanvasElement): void {
    const pctx = r.page.ctx;
    pctx.clearRect(r.x, r.y, r.w, r.h);
    pctx.drawImage(src, r.x, r.y);
    const renderer = this.scene.renderer as unknown as GLRendererLike;
    const gl = renderer.gl;
    const units = renderer.glTextureUnits;
    const state = renderer.glWrapper;
    if (!gl || !units || !state) return;
    const glTex = (r.page.tex.source[0] as unknown as { glTexture: GLTextureLike | null }).glTexture;
    if (!glTex || !glTex.webGLTexture) return;
    units.bind(glTex, 0);
    state.updateTexturing({ texturing: { flipY: glTex.flipY, premultiplyAlpha: glTex.pma } });
    // Phaser uploads canvases flipped (UNPACK_FLIP_Y, v = 1 - y / height): GL row 0 is the canvas bottom.
    const y = glTex.flipY ? PAGE_SIZE - r.y - r.h : r.y;
    gl.texSubImage2D(gl.TEXTURE_2D, 0, r.x, y, gl.RGBA, gl.UNSIGNED_BYTE, src);
    this.counters.uploads++;
  }

  private acquireScratch(w: number, h: number): Ctx {
    const ctx = this.scratchPool.get(bucketKey(w, h))?.pop();
    if (ctx) {
      this.scratchPooled--;
      return ctx;
    }
    return cpuCanvas(w, h);
  }

  private recycleScratch(ctx: Ctx): void {
    if (this.scratchPooled >= SCRATCH_POOL_MAX) {
      freeCanvas(ctx);
      return;
    }
    const key = bucketKey(ctx.canvas.width, ctx.canvas.height);
    let list = this.scratchPool.get(key);
    if (!list) {
      list = [];
      this.scratchPool.set(key, list);
    }
    list.push(ctx);
    this.scratchPooled++;
  }

  private allocate(w: number, h: number): Region | null {
    const bw = Math.ceil(w / BUCKET) * BUCKET;
    const bh = Math.ceil(h / BUCKET) * BUCKET;
    const key = bucketKey(bw, bh);
    for (const page of this.pages) {
      const r = page.free.get(key)?.pop();
      if (r) return r;
    }
    for (const page of this.pages) {
      const r = this.carve(page, bw, bh);
      if (r) return r;
    }
    if (this.pages.length >= MAX_PAGES) return null;
    const page = this.newPage();
    return page ? this.carve(page, bw, bh) : null;
  }

  private newPage(): CraterPage | null {
    const key = `rk_craters_${pageSerial++}`;
    const tex = this.scene.textures.createCanvas(key, PAGE_SIZE, PAGE_SIZE);
    if (!tex) return null;
    const page: CraterPage = { key, tex, ctx: tex.context, shelves: [], nextY: GAP, free: new Map(), frames: [] };
    this.pages.push(page);
    return page;
  }

  /** Shelf-pack a new region (best-fitting shelf that is not much taller). */
  private carve(page: CraterPage, w: number, h: number): Region | null {
    let best: Shelf | null = null;
    for (const s of page.shelves) {
      if (s.h >= h && s.h <= h * 1.5 + 8 && s.x + w + GAP <= PAGE_SIZE && (!best || s.h < best.h)) best = s;
    }
    if (!best) {
      if (page.nextY + h + GAP > PAGE_SIZE) return null;
      best = { y: page.nextY, h, x: GAP };
      page.shelves.push(best);
      page.nextY += h + GAP;
    }
    const r: Region = { page, x: best.x, y: best.y, w, h, frame: `r${regionSerial++}` };
    best.x += w + GAP;
    page.tex.add(r.frame, 0, r.x, r.y, w, h);
    page.frames.push(r.frame);
    this.regionCount++;
    return r;
  }

  /** Small LCG: craters vary without touching the simulation's RNG. */
  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) >>> 0;
    return this.seed / 4294967296;
  }
}

function bucketKey(w: number, h: number): number {
  return w * 65536 + h;
}

/**
 * CPU-backed canvas, like Phaser's own canvas textures: blits between such
 * canvases and texture uploads from them are plain memory copies.
 */
function cpuCanvas(w: number, h: number): Ctx {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  return canvas.getContext('2d', { willReadFrequently: true })!;
}

function freeCanvas(ctx: Ctx): void {
  ctx.canvas.width = 0;
  ctx.canvas.height = 0;
}

/** Bounding size of a shape (m). */
function shapeDims(shape: PartShape): { w: number; h: number } {
  switch (shape.kind) {
    case 'box':
      return { w: shape.hw * 2, h: shape.hh * 2 };
    case 'circle':
      return { w: shape.r * 2, h: shape.r * 2 };
    case 'poly': {
      const p = shape.points;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < p.length; i += 2) {
        minX = Math.min(minX, p[i]!);
        maxX = Math.max(maxX, p[i]!);
        minY = Math.min(minY, p[i + 1]!);
        maxY = Math.max(maxY, p[i + 1]!);
      }
      return { w: maxX - minX, h: maxY - minY };
    }
  }
}

/**
 * Signed distance from a local point (sim space, m) to the shape's boundary
 * (< 0 inside) and the inward normal of the nearest boundary piece. The
 * nearest boundary point is (x, y) + n * d.
 */
function surface(shape: PartShape, x: number, y: number, out: Surface): void {
  switch (shape.kind) {
    case 'box': {
      const sx = x < 0 ? -1 : 1;
      const sy = y < 0 ? -1 : 1;
      const qx = Math.abs(x) - shape.hw;
      const qy = Math.abs(y) - shape.hh;
      if (qx > 0 || qy > 0) {
        const ex = Math.max(qx, 0);
        const ey = Math.max(qy, 0);
        const d = Math.hypot(ex, ey);
        out.d = d;
        out.nx = (-sx * ex) / d;
        out.ny = (-sy * ey) / d;
      } else if (qx > qy) {
        out.d = qx;
        out.nx = -sx;
        out.ny = 0;
      } else {
        out.d = qy;
        out.nx = 0;
        out.ny = -sy;
      }
      return;
    }
    case 'circle': {
      const len = Math.hypot(x, y);
      out.d = len - shape.r;
      if (len > 1e-6) {
        out.nx = -x / len;
        out.ny = -y / len;
      } else {
        out.nx = 1;
        out.ny = 0;
      }
      return;
    }
    case 'poly': {
      // Convex polygon: the distance is the largest signed edge-line distance.
      const p = shape.points;
      const n = p.length;
      let area2 = 0;
      for (let i = 0; i < n; i += 2) area2 += p[i]! * p[(i + 3) % n]! - p[(i + 2) % n]! * p[i + 1]!;
      const wind = area2 > 0 ? 1 : -1;
      let best = -Infinity;
      let bnx = 1;
      let bny = 0;
      for (let i = 0; i < n; i += 2) {
        const ax = p[i]!;
        const ay = p[i + 1]!;
        const ex = p[(i + 2) % n]! - ax;
        const ey = p[(i + 3) % n]! - ay;
        const len = Math.hypot(ex, ey) || 1;
        // Outward normal.
        const onx = (wind * ey) / len;
        const ony = (-wind * ex) / len;
        const d = (x - ax) * onx + (y - ay) * ony;
        if (d > best) {
          best = d;
          bnx = -onx;
          bny = -ony;
        }
      }
      out.d = best;
      out.nx = bnx;
      out.ny = bny;
      return;
    }
  }
}
