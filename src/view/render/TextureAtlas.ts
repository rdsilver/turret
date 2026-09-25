/**
 * Runtime texture atlas built from 2D-canvas pages.
 *
 * Every procedurally painted part texture lands in a shared page so the
 * whole structure renders from one (or very few) GPU textures and batches
 * into a handful of draw calls. Regions are shelf-packed; dirty pages are
 * uploaded once per frame (game 'prerender') no matter how many frames were
 * painted that frame.
 */
import type * as Phaser from 'phaser';

export interface AtlasFrame {
  /** Texture key of the page. */
  key: string;
  /** Frame name inside the page. */
  frame: string;
  width: number;
  height: number;
}

interface Shelf {
  y: number;
  h: number;
  x: number;
}

interface Page {
  key: string;
  tex: Phaser.Textures.CanvasTexture;
  ctx: CanvasRenderingContext2D;
  shelves: Shelf[];
  nextY: number;
  dirty: boolean;
}

/** Transparent gutter between regions (texels) so bilinear filtering never bleeds. */
const GAP = 2;
let pageSerial = 0;

export class TextureAtlas {
  private pages: Page[] = [];
  private frames = new Map<string, AtlasFrame>();
  private flushBound = (): void => this.flush();

  constructor(
    private readonly textures: Phaser.Textures.TextureManager,
    private readonly prefix: string,
    readonly pageSize: number,
  ) {
    // Upload dirty pages right before the renderer draws (once per frame).
    textures.game.events.on('prerender', this.flushBound);
  }

  get pageCount(): number {
    return this.pages.length;
  }

  get frameCount(): number {
    return this.frames.size;
  }

  get(name: string): AtlasFrame | undefined {
    return this.frames.get(name);
  }

  /** True when a w x h region can ever fit a page. */
  fits(w: number, h: number): boolean {
    return w + GAP * 2 <= this.pageSize && h + GAP * 2 <= this.pageSize;
  }

  /**
   * Allocate a region and paint into it. `paint` receives the context
   * translated so (0,0) is the region's top-left, clipped to the region.
   */
  add(name: string, w: number, h: number, paint: (ctx: CanvasRenderingContext2D) => void): AtlasFrame | null {
    const existing = this.frames.get(name);
    if (existing) return existing;
    w = Math.ceil(w);
    h = Math.ceil(h);
    if (!this.fits(w, h)) return null;
    let page: Page | null = null;
    let sx = 0;
    let sy = 0;
    for (let i = this.pages.length - 1; i >= 0 && !page; i--) {
      const p = this.pages[i]!;
      const r = this.allocate(p, w, h);
      if (r) {
        page = p;
        sx = r.x;
        sy = r.y;
      }
    }
    if (!page) {
      page = this.newPage();
      if (!page) return null;
      const r = this.allocate(page, w, h);
      if (!r) return null;
      sx = r.x;
      sy = r.y;
    }
    const ctx = page.ctx;
    ctx.save();
    ctx.beginPath();
    ctx.rect(sx, sy, w, h);
    ctx.clip();
    ctx.translate(sx, sy);
    paint(ctx);
    ctx.restore();
    page.tex.add(name, 0, sx, sy, w, h);
    page.dirty = true;
    const f: AtlasFrame = { key: page.key, frame: name, width: w, height: h };
    this.frames.set(name, f);
    return f;
  }

  /** Clear a frame's region and paint it again (e.g. glyphs once web fonts load). */
  repaint(name: string, paint: (ctx: CanvasRenderingContext2D) => void): boolean {
    const f = this.frames.get(name);
    if (!f) return false;
    const page = this.pages.find((p) => p.key === f.key);
    const fr = page?.tex.get(name);
    if (!page || !fr) return false;
    const ctx = page.ctx;
    ctx.save();
    ctx.clearRect(fr.cutX, fr.cutY, f.width, f.height);
    ctx.beginPath();
    ctx.rect(fr.cutX, fr.cutY, f.width, f.height);
    ctx.clip();
    ctx.translate(fr.cutX, fr.cutY);
    paint(ctx);
    ctx.restore();
    page.dirty = true;
    return true;
  }

  /** Upload pages painted since the last flush. */
  flush(): void {
    for (let i = 0; i < this.pages.length; i++) {
      const p = this.pages[i]!;
      if (p.dirty) {
        p.dirty = false;
        p.tex.refresh();
      }
    }
  }

  /** Drop every page (only when no display object references them any more). */
  reset(): void {
    for (const p of this.pages) {
      if (this.textures.exists(p.key)) this.textures.remove(p.key);
    }
    this.pages.length = 0;
    this.frames.clear();
  }

  destroy(): void {
    this.reset();
    this.textures.game.events.off('prerender', this.flushBound);
  }

  private newPage(): Page | null {
    const key = `${this.prefix}_${pageSerial++}`;
    const tex = this.textures.createCanvas(key, this.pageSize, this.pageSize);
    if (!tex) return null;
    const ctx = tex.context;
    ctx.clearRect(0, 0, this.pageSize, this.pageSize);
    const page: Page = { key, tex, ctx, shelves: [], nextY: GAP, dirty: true };
    this.pages.push(page);
    return page;
  }

  private allocate(p: Page, w: number, h: number): { x: number; y: number } | null {
    const size = this.pageSize;
    // Best-fitting existing shelf (not too tall, so small frames don't waste big shelves).
    let best: Shelf | null = null;
    for (const s of p.shelves) {
      if (s.h >= h && s.h <= h * 1.5 + 4 && s.x + w + GAP <= size) {
        if (!best || s.h < best.h) best = s;
      }
    }
    if (best) {
      const x = best.x;
      best.x += w + GAP;
      return { x, y: best.y };
    }
    if (p.nextY + h + GAP > size) return null;
    const s: Shelf = { y: p.nextY, h, x: GAP + w + GAP };
    p.shelves.push(s);
    p.nextY += h + GAP;
    return { x: GAP, y: s.y };
  }
}
