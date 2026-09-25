/**
 * Procedural textures (no art assets). OWNER: render agent.
 *
 * - generateCommon(): particle/UI textures listed in TextureKeys (called once in BootScene)
 *   plus the render module's private keys (render/RenderKeys.ts).
 * - partFrame(part): atlas frame for a structure part: material fill + outline +
 *   material pattern, sized to the part (TEXTURE_RES texels per world pixel,
 *   i.e. PPM * TEXTURE_RES per meter). Cached per (material, shape dims).
 *   Handles box, circle and poly shapes. Frames live in shared canvas atlas
 *   pages so a whole structure renders from one GPU texture.
 * - partKey(part): same art as a standalone texture key (for external callers).
 * - projectileKey(radiusPx, color): cached round-shot texture.
 *
 * Every texture returned by partFrame/partKey/projectileKey is drawn at
 * TEXTURE_RES texels per world pixel: display it with setScale(1 / TEXTURE_RES).
 */
import type * as Phaser from 'phaser';
import type { StructurePart } from '../sim/StructurePart';
import type { MaterialDef, MaterialId } from '../sim/Materials';
import { TEX } from './TextureKeys';
import { RK } from './render/RenderKeys';
import { TextureAtlas, type AtlasFrame } from './render/TextureAtlas';
import { hashString, measurePart, paintPart, shapeKey } from './render/PartPainter';
import { glyphSet, miscAtlas, miscFrame, paintShot, shotFrame } from './render/MiscAtlas';
import { generateTurretArt } from './render/TurretArt';
import { TEXELS_PER_M, TEXTURE_RES } from './render/res';

export { TEXELS_PER_M, TEXTURE_RES };

export interface PartFrame {
  key: string;
  frame: string;
  /** Normalised origin (body origin inside the frame). */
  originX: number;
  originY: number;
}

/** Frames whose larger side is at most this go to the small (fragment) pages. */
const SMALL_MAX = 110;

interface AtlasSet {
  big: TextureAtlas;
  small: TextureAtlas;
  frames: Map<string, PartFrame>;
}

/** One atlas set per game (texture manager); survives scene restarts. */
const atlases = new WeakMap<Phaser.Textures.TextureManager, AtlasSet>();

function atlasFor(textures: Phaser.Textures.TextureManager): AtlasSet {
  let a = atlases.get(textures);
  if (!a) {
    a = {
      big: new TextureAtlas(textures, 'rk_parts', 2048),
      small: new TextureAtlas(textures, 'rk_frags', 1024),
      frames: new Map(),
    };
    atlases.set(textures, a);
  }
  return a;
}

export class TextureFactory {
  private readonly set: AtlasSet;

  constructor(readonly scene: Phaser.Scene) {
    this.set = atlasFor(scene.textures);
    // Make sure shared textures exist even if the Boot scene was skipped.
    TextureFactory.generateCommon(scene);
  }

  static generateCommon(scene: Phaser.Scene): void {
    const t = scene.textures;
    if (t.exists(TEX.pixel) && t.exists(RK.hatch)) {
      miscAtlas(t);
      return;
    }
    const make = (key: string, w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void): void => {
      if (t.exists(key)) return;
      const tex = t.createCanvas(key, w, h);
      if (!tex) return;
      const ctx = tex.context;
      ctx.clearRect(0, 0, w, h);
      draw(ctx);
      tex.refresh();
    };

    // ---- shared keys (TextureKeys.ts) ----
    make(TEX.pixel, 8, 8, (c) => {
      c.fillStyle = '#fff';
      c.fillRect(0, 0, 8, 8);
    });
    make(TEX.soft, 32, 32, (c) => {
      const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.7, 'rgba(255,255,255,0.15)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 32, 32);
    });
    make(TEX.dot, 16, 16, (c) => {
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(8, 8, 7, 0, Math.PI * 2);
      c.fill();
    });
    make(TEX.sliver, 12, 4, (c) => {
      c.fillStyle = '#fff';
      c.beginPath();
      c.moveTo(0, 2);
      c.lineTo(2, 0.4);
      c.lineTo(11, 1);
      c.lineTo(12, 2);
      c.lineTo(11, 3);
      c.lineTo(2, 3.6);
      c.closePath();
      c.fill();
    });
    make(TEX.shard, 10, 10, (c) => {
      c.fillStyle = '#fff';
      c.beginPath();
      c.moveTo(1, 9);
      c.lineTo(4.5, 0.5);
      c.lineTo(9.5, 7);
      c.closePath();
      c.fill();
    });
    make(TEX.ring, 64, 64, (c) => {
      c.strokeStyle = '#fff';
      c.lineWidth = 4;
      c.beginPath();
      c.arc(32, 32, 29, 0, Math.PI * 2);
      c.stroke();
    });
    make(TEX.glow, 64, 64, (c) => {
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.12, 'rgba(255,255,255,0.8)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.3)');
      g.addColorStop(0.65, 'rgba(255,255,255,0.08)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 64);
    });
    make(TEX.bolt, 10, 10, (c) => {
      c.fillStyle = '#1a1d22';
      c.beginPath();
      c.arc(5, 5, 4.6, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#fff';
      c.beginPath();
      c.arc(5, 5, 3.3, 0, Math.PI * 2);
      c.fill();
    });

    // ---- render-private art (misc atlas) + standalone hatch tile ----
    miscAtlas(t);
    glyphSet(t);
    generateTurretArt(t);
    make(RK.hatch, 24, 24, (c) => {
      c.strokeStyle = 'rgba(255,255,255,1)';
      c.lineWidth = 1.2;
      c.beginPath();
      // Seamless 45° hatch: main diagonal plus the two corner stubs.
      c.moveTo(-2, 26);
      c.lineTo(26, -2);
      c.moveTo(-2, 2);
      c.lineTo(2, -2);
      c.moveTo(22, 26);
      c.lineTo(26, 22);
      c.stroke();
    });
  }

  /**
   * Atlas frame for a part (generated on first use, then cached).
   * `neutral` = light-grey variant of the same art for the stress heat map
   * (tinted by the heat colour with a plain MULTIPLY tint).
   */
  partFrame(part: StructurePart, neutral = false): PartFrame {
    const mat = neutral ? neutralMaterial(part.material) : part.material;
    const name = partName(part, neutral);
    const cached = this.set.frames.get(name);
    if (cached) return cached;
    const s = TEXELS_PER_M;
    const lay = measurePart(part.shape, s);
    const atlas = Math.max(lay.w, lay.h) <= SMALL_MAX ? this.set.small : this.set.big;
    const seed = hashString(partName(part, false));
    let f: PartFrame | null = null;
    if (atlas.fits(lay.w, lay.h)) {
      const af = atlas.add(name, lay.w, lay.h, (ctx) => paintPart(ctx, part.shape, mat, s, lay, { fixed: part.fixed, seed }));
      if (af) f = { key: af.key, frame: af.frame, originX: lay.ox / af.width, originY: lay.oy / af.height };
    }
    if (!f) {
      // Oversized (or atlas failure): standalone texture.
      const key = this.standalonePart(part, name, mat);
      f = { key, frame: '__BASE', originX: lay.ox / lay.w, originY: lay.oy / lay.h };
    }
    this.set.frames.set(name, f);
    return f;
  }

  /** Standalone texture key with the same art as partFrame (external callers). */
  partKey(part: StructurePart): string {
    return this.standalonePart(part, partName(part, false), part.material);
  }

  /** Round shot (standalone texture key): fill colour, light rim so dark rounds read on the dark backdrop, specular dot. */
  projectileKey(radiusPx: number, color: number): string {
    const rt = Math.max(3, Math.round(radiusPx * TEXTURE_RES));
    const key = `rk_shot_${rt}_${color.toString(16)}`;
    const t = this.scene.textures;
    if (t.exists(key)) return key;
    const d = rt * 2 + 4;
    const tex = t.createCanvas(key, d, d);
    if (!tex) return TEX.dot;
    paintShot(tex.context, d, rt, color);
    tex.refresh();
    return key;
  }

  /** Round shot as a misc-atlas frame (preferred: shares the world texture). */
  projectileFrame(radiusPx: number, color: number): AtlasFrame {
    return shotFrame(this.scene.textures, radiusPx, color, TEXTURE_RES);
  }

  /** Frame of a render-private art piece (RK.*) in the misc atlas. */
  miscFrame(name: string): AtlasFrame {
    return miscFrame(this.scene.textures, name);
  }

  /** Number of atlas pages in use (debug / memory trimming). */
  get atlasPages(): number {
    return this.set.big.pageCount + this.set.small.pageCount;
  }

  /**
   * Drop every cached part texture. Only call when no display object uses
   * them any more (e.g. between levels after WorldRenderer.clear()).
   */
  resetPartTextures(): void {
    this.set.big.reset();
    this.set.small.reset();
    for (const f of this.set.frames.values()) {
      if (f.frame === '__BASE' && this.scene.textures.exists(f.key)) this.scene.textures.remove(f.key);
    }
    this.set.frames.clear();
  }

  private standalonePart(part: StructurePart, name: string, mat: MaterialDef): string {
    const key = `rk_part_${name}`;
    const t = this.scene.textures;
    if (t.exists(key)) return key;
    const s = TEXELS_PER_M;
    const lay = measurePart(part.shape, s);
    const tex = t.createCanvas(key, lay.w, lay.h);
    if (!tex) return TEX.pixel;
    paintPart(tex.context, part.shape, mat, s, lay, { fixed: part.fixed, seed: hashString(partName(part, false)) });
    tex.refresh();
    return key;
  }
}

function partName(part: StructurePart, neutral: boolean): string {
  return `${part.material.id}:${shapeKey(part.shape)}${part.fixed ? ':f' : ''}${neutral ? ':n' : ''}`;
}

const neutralCache = new Map<MaterialId, MaterialDef>();

/** Same material, repainted light grey (keeps pattern + outline) for heat-map tinting. */
function neutralMaterial(m: MaterialDef): MaterialDef {
  let n = neutralCache.get(m.id);
  if (!n) {
    n = { ...m, color: 0xe3e7ed, outline: 0x3a4049, alpha: m.alpha < 1 ? 0.8 : 1 };
    neutralCache.set(m.id, n);
  }
  return n;
}
