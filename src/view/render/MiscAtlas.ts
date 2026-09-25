/**
 * One shared canvas atlas for every small piece of render art (joint markers,
 * preview dots, reticle, core glow, round shots, turret art, label glyphs).
 *
 * Why: Phaser's multi-texture batch selects the sampler with an exact float
 * compare on an interpolated varying; with many distinct textures in one
 * batch, high texture indices can drop whole triangles on some GPUs /
 * software rasterisers. Keeping the world to ~2-3 textures (this atlas + the
 * part atlas pages) keeps indices low and batches large.
 */
import type * as Phaser from 'phaser';
import { TextureAtlas, type AtlasFrame } from './TextureAtlas';
import { RK } from './RenderKeys';
import { css, lerpColor, luminance, scaleColor } from './color';
import { THEME } from '../../ui/theme';

const atlases = new WeakMap<Phaser.Textures.TextureManager, TextureAtlas>();

export function miscAtlas(textures: Phaser.Textures.TextureManager): TextureAtlas {
  let a = atlases.get(textures);
  if (!a) {
    a = new TextureAtlas(textures, 'rk_misc', 1024);
    atlases.set(textures, a);
    paintStatic(a);
  }
  return a;
}

/** Frame lookup; falls back to the weld marker so callers never get undefined. */
export function miscFrame(textures: Phaser.Textures.TextureManager, name: string): AtlasFrame {
  const a = miscAtlas(textures);
  return a.get(name) ?? a.get(RK.weld)!;
}

function circle(c: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string): void {
  c.fillStyle = fill;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

function paintStatic(a: TextureAtlas): void {
  a.add(RK.weld, 14, 14, (c) => {
    circle(c, 7, 7, 6.2, 'rgba(12,14,18,0.9)');
    circle(c, 7, 7, 4.4, '#4a515c');
    circle(c, 5.8, 5.8, 1.6, 'rgba(255,255,255,0.55)');
  });
  a.add(RK.node, 16, 16, (c) => {
    circle(c, 8, 8, 7.5, 'rgba(10,12,16,0.95)');
    circle(c, 8, 8, 5.6, '#fff');
  });
  a.add(RK.hinge, 26, 26, (c) => {
    circle(c, 13, 13, 12, 'rgba(10,12,16,0.85)');
    c.strokeStyle = '#dfe5ee';
    c.lineWidth = 3.2;
    c.beginPath();
    c.arc(13, 13, 8.6, 0, Math.PI * 2);
    c.stroke();
    circle(c, 13, 13, 3.6, '#8f99a8');
    circle(c, 12, 12, 1.4, 'rgba(255,255,255,0.8)');
  });
  a.add(RK.reticle, 64, 64, (c) => {
    c.strokeStyle = '#fff';
    c.lineWidth = 3;
    c.beginPath();
    c.arc(32, 32, 17, 0, Math.PI * 2);
    c.stroke();
    c.lineCap = 'round';
    c.beginPath();
    for (let i = 0; i < 4; i++) {
      const ang = (i * Math.PI) / 2;
      c.moveTo(32 + Math.cos(ang) * 22, 32 + Math.sin(ang) * 22);
      c.lineTo(32 + Math.cos(ang) * 30, 32 + Math.sin(ang) * 30);
    }
    c.stroke();
    circle(c, 32, 32, 3, '#fff');
  });
  a.add(RK.pdot, 12, 12, (c) => {
    const g = c.createRadialGradient(6, 6, 0, 6, 6, 6);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.95)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 12, 12);
  });
  a.add(RK.glow, 64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.12, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.3)');
    g.addColorStop(0.65, 'rgba(255,255,255,0.08)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  });
}

// ------------------------------------------------------------------ round shots

/** Round shot frame (drawn at `res` texels per world px). */
export function shotFrame(textures: Phaser.Textures.TextureManager, radiusPx: number, color: number, res: number): AtlasFrame {
  const a = miscAtlas(textures);
  const rt = Math.max(3, Math.round(radiusPx * res));
  const name = `shot_${rt}_${color.toString(16)}`;
  const existing = a.get(name);
  if (existing) return existing;
  const d = rt * 2 + 4;
  return a.add(name, d, d, (c) => paintShot(c, d, rt, color)) ?? a.get(RK.weld)!;
}

export function paintShot(c: CanvasRenderingContext2D, d: number, rt: number, color: number): void {
  const cx = d / 2;
  const dark = luminance(color) < 0.3;
  const rim = dark ? 0x9aa4b4 : scaleColor(color, 0.45);
  const g = c.createRadialGradient(cx - rt * 0.35, cx - rt * 0.35, rt * 0.1, cx, cx, rt);
  g.addColorStop(0, css(lerpColor(color, 0xffffff, dark ? 0.35 : 0.45)));
  g.addColorStop(0.55, css(color));
  g.addColorStop(1, css(scaleColor(color, 0.7)));
  c.fillStyle = g;
  c.beginPath();
  c.arc(cx, cx, rt, 0, Math.PI * 2);
  c.fill();
  c.lineWidth = Math.max(1.5, rt * 0.14);
  c.strokeStyle = css(rim, 1);
  c.beginPath();
  c.arc(cx, cx, rt - c.lineWidth / 2, 0, Math.PI * 2);
  c.stroke();
  circle(c, cx - rt * 0.38, cx - rt * 0.38, Math.max(1, rt * 0.18), 'rgba(255,255,255,0.85)');
}

// ------------------------------------------------------------------ glyphs

/** Monospace glyph set painted white (tint per label). */
export interface GlyphSet {
  /** Font size the glyphs were painted at (texels). */
  fontPx: number;
  /** Horizontal advance per character (texels). */
  advance: number;
  /** Cell size (texels). */
  cellW: number;
  cellH: number;
  /** Left padding inside a cell (texels). */
  padX: number;
  frameOf(ch: string): string | null;
  key: string;
}

const GLYPHS = '0123456789.,:%·✓-+/×()ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const FONT_PX = 26;
const glyphSets = new WeakMap<Phaser.Textures.TextureManager, GlyphSet>();

export function glyphSet(textures: Phaser.Textures.TextureManager): GlyphSet {
  const cached = glyphSets.get(textures);
  if (cached) return cached;
  const a = miscAtlas(textures);
  const font = `600 ${FONT_PX}px ${THEME.font}`;
  const measure = (): number => {
    const cv = document.createElement('canvas').getContext('2d');
    if (!cv) return FONT_PX * 0.6;
    cv.font = font;
    return cv.measureText('0').width || FONT_PX * 0.6;
  };
  const padX = 3;
  const cellW = Math.ceil(FONT_PX * 0.75) + padX * 2;
  const cellH = Math.ceil(FONT_PX * 1.3);
  const paintGlyph = (ch: string) => (c: CanvasRenderingContext2D) => {
    c.font = font;
    c.textBaseline = 'alphabetic';
    c.fillStyle = '#fff';
    c.fillText(ch, padX, Math.round(FONT_PX * 1.0));
  };
  let key = '';
  for (const ch of GLYPHS) {
    const f = a.add(`g_${ch}`, cellW, cellH, paintGlyph(ch));
    if (f) key = f.key;
  }
  const set: GlyphSet = {
    fontPx: FONT_PX,
    advance: measure(),
    cellW,
    cellH,
    padX,
    key,
    frameOf: (ch: string) => (GLYPHS.includes(ch) ? `g_${ch}` : null),
  };
  glyphSets.set(textures, set);
  // Web fonts may arrive after boot: repaint glyphs in place once they do.
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (fonts && fonts.status !== 'loaded') {
    void fonts.ready.then(() => {
      for (const ch of GLYPHS) a.repaint(`g_${ch}`, paintGlyph(ch));
      set.advance = measure();
    });
  }
  return set;
}
