/**
 * Tiny monospace label built from glyph frames in the misc atlas: one quad
 * per character, all from the same texture as the rest of the world art
 * (Phaser Text objects each own a texture and re-rasterise on change).
 * Changing the text only re-lays pooled images; nothing is re-uploaded.
 */
import type * as Phaser from 'phaser';
import { glyphSet, type GlyphSet } from './MiscAtlas';

type Image = Phaser.GameObjects.Image;

export class GlyphText {
  text = '';
  private readonly imgs: Image[] = [];
  private used = 0;
  private readonly set: GlyphSet;
  private x = 0;
  private y = 0;
  private originX = 0;
  private originY = 0;
  private alpha = 1;
  private color: number;
  private visible = true;

  constructor(
    private readonly scene: Phaser.Scene,
    /** Display size in world pixels (cap height ~ 0.72 of this). */
    private readonly size: number,
    color: number,
    private readonly depth: number,
    /** Extra spacing between characters (world px). */
    private readonly spacing = 0.6,
  ) {
    this.set = glyphSet(scene.textures);
    this.color = color;
  }

  get width(): number {
    return this.text.length * this.advance;
  }

  get height(): number {
    return this.set.cellH * this.scale;
  }

  private get scale(): number {
    return this.size / this.set.fontPx;
  }

  private get advance(): number {
    return this.set.advance * this.scale + this.spacing;
  }

  setText(t: string): this {
    if (t === this.text) return this;
    this.text = t;
    this.layout();
    return this;
  }

  setPosition(x: number, y: number): this {
    if (x === this.x && y === this.y) return this;
    this.x = x;
    this.y = y;
    this.layout();
    return this;
  }

  setOrigin(ox: number, oy: number): this {
    this.originX = ox;
    this.originY = oy;
    this.layout();
    return this;
  }

  setColor(c: number): this {
    if (c === this.color) return this;
    this.color = c;
    for (let i = 0; i < this.used; i++) this.imgs[i]!.setTint(c);
    return this;
  }

  setAlpha(a: number): this {
    if (a === this.alpha) return this;
    this.alpha = a;
    for (let i = 0; i < this.used; i++) this.imgs[i]!.alpha = a;
    return this;
  }

  setVisible(v: boolean): this {
    if (v === this.visible) return this;
    this.visible = v;
    for (let i = 0; i < this.used; i++) this.imgs[i]!.setVisible(v);
    return this;
  }

  destroy(): void {
    for (const img of this.imgs) img.destroy();
    this.imgs.length = 0;
    this.used = 0;
  }

  private layout(): void {
    const s = this.scale;
    const adv = this.advance;
    const x0 = this.x - this.originX * this.width;
    const y0 = this.y - this.originY * this.height;
    let n = 0;
    for (let i = 0; i < this.text.length; i++) {
      const frame = this.set.frameOf(this.text[i]!);
      if (!frame) continue;
      let img = this.imgs[n];
      if (!img) {
        img = this.scene.add.image(0, 0, this.set.key, frame).setDepth(this.depth);
        this.imgs.push(img);
      } else img.setFrame(frame);
      img.setOrigin(this.set.padX / this.set.cellW, 0);
      img.setScale(s);
      img.setTint(this.color);
      img.alpha = this.alpha;
      img.setVisible(this.visible);
      img.x = x0 + i * adv;
      img.y = y0;
      n++;
    }
    for (let i = n; i < this.used; i++) this.imgs[i]!.setVisible(false);
    this.used = n;
  }
}
