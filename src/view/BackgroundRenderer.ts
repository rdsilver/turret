/**
 * Static backdrop in a minimalist "physics laboratory" style. OWNER: render agent.
 * Dark neutral background, faint measurement grid (1 m minor / 5 m major),
 * height ruler near the structure, ground slab with hatching, and the
 * objective's destruction line (dashed, labelled) when set.
 * World coordinates: pixels = meters * PPM, ground surface at y = 0.
 *
 * Everything static is drawn once per layout(); only the destruction line
 * (marching dashes, progress colour) is redrawn per frame, and it is cheap.
 */
import type * as Phaser from 'phaser';
import { PPM } from '../config/constants';
import { DEPTH } from './depths';
import { RK } from './render/RenderKeys';
import { TextureFactory } from './TextureFactory';
import { lerpColor } from './render/color';
import { GlyphText } from './render/GlyphText';

export interface BackgroundBounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Extra margin (m) drawn around the framed rectangle (camera shake / zoom-out). */
const MARGIN_X = 60;
const MARGIN_TOP = 45;
const GROUND_DEPTH = 60;

const GRID_MINOR = 0x8fa0b8;
const GRID_MAJOR = 0x9fb2cc;
const GROUND_FILL = 0x1a1d23;
const GROUND_EDGE = 0x6b7587;
const RULER = 0x8b95a5;
const LABEL_COLOR = 0x8b95a5;
const LINE_IDLE = 0xff5a3c;
const LINE_CLOSE = 0xffb547;
const LINE_DONE = 0x6fe3a1;

export class BackgroundRenderer {
  private readonly grid: Phaser.GameObjects.Graphics;
  private readonly ruler: Phaser.GameObjects.Graphics;
  private readonly groundFill: Phaser.GameObjects.Rectangle;
  private readonly groundHatch: Phaser.GameObjects.TileSprite;
  private readonly groundEdge: Phaser.GameObjects.Graphics;
  private readonly line: Phaser.GameObjects.Graphics;
  private readonly lineLabel: GlyphText;
  private readonly lineValue: GlyphText;
  private readonly groundLabels = new LabelPool(DEPTH.ground + 0.3);
  private readonly rulerLabels = new LabelPool(DEPTH.ruler);

  private bounds: BackgroundBounds = { left: -2.5, right: 50, top: -15, bottom: 3.5 };
  private lineHeight: number | null = null;
  private lineX0 = 0;
  private lineX1 = 0;
  private progress = 0;
  private shownProgress = 0;
  private dash = 0;
  private rulerX = 45;
  private lineDirty = true;
  private labelColor = -1;
  private valueKey = -1;

  constructor(readonly scene: Phaser.Scene) {
    TextureFactory.generateCommon(scene);
    // The backdrop colour itself is the camera clear colour (#121418, game config);
    // no full-screen quad needed.
    this.grid = scene.add.graphics().setDepth(DEPTH.grid);
    this.ruler = scene.add.graphics().setDepth(DEPTH.ruler);
    this.groundFill = scene.add.rectangle(0, 0, 10, 10, GROUND_FILL, 1).setOrigin(0, 0).setDepth(DEPTH.ground);
    this.groundHatch = scene.add.tileSprite(0, 0, 10, 10, RK.hatch).setOrigin(0, 0).setDepth(DEPTH.ground + 0.1);
    this.groundHatch.setAlpha(0.05);
    this.groundEdge = scene.add.graphics().setDepth(DEPTH.ground + 0.2);
    this.line = scene.add.graphics().setDepth(DEPTH.destructionLine);
    // Labels sit left of the line (the height ruler lives on the right).
    this.lineLabel = new GlyphText(scene, 13, LINE_IDLE, DEPTH.destructionLine, 1.2).setText('DESTRUCTION LINE').setOrigin(1, 1);
    this.lineValue = new GlyphText(scene, 12, LINE_IDLE, DEPTH.destructionLine, 0.8).setOrigin(1, 0);
    this.lineLabel.setVisible(false);
    this.lineValue.setVisible(false);
    this.layout(this.bounds);
  }

  /** (Re)draw for the given visible sim-space bounds (meters). */
  layout(bounds: { left: number; right: number; top: number; bottom: number }): void {
    this.bounds = { ...bounds };
    const L = Math.floor(bounds.left - MARGIN_X);
    const R = Math.ceil(bounds.right + MARGIN_X);
    const T = Math.floor(bounds.top - MARGIN_TOP);
    const B = GROUND_DEPTH;

    // ---- measurement grid (sky only; the ground slab covers y > 0)
    const g = this.grid;
    g.clear();
    for (let x = L; x <= R; x++) {
      const major = x % 5 === 0;
      g.lineStyle(major ? 1.5 : 1, major ? GRID_MAJOR : GRID_MINOR, major ? 0.075 : 0.035);
      g.lineBetween(x * PPM, T * PPM, x * PPM, 0);
    }
    for (let y = 0; y >= T; y--) {
      const major = y % 5 === 0;
      g.lineStyle(major ? 1.5 : 1, major ? GRID_MAJOR : GRID_MINOR, major ? 0.075 : 0.035);
      g.lineBetween(L * PPM, y * PPM, R * PPM, y * PPM);
    }

    // ---- ground slab
    this.groundFill.setPosition(L * PPM, 0).setSize((R - L) * PPM, B * PPM);
    this.groundHatch.setPosition(L * PPM, 0).setSize((R - L) * PPM, B * PPM);
    // Keep the hatch phase anchored to world x so it doesn't swim between layouts.
    this.groundHatch.tilePositionX = L * PPM;
    this.groundHatch.tilePositionY = 0;

    this.groundLabels.begin();
    const e = this.groundEdge;
    e.clear();
    // Soft contact shadow just below the surface.
    e.fillStyle(0x000000, 0.28);
    e.fillRect(L * PPM, 0, (R - L) * PPM, 5);
    e.fillStyle(0x000000, 0.14);
    e.fillRect(L * PPM, 5, (R - L) * PPM, 8);
    // Crisp surface edge.
    e.lineStyle(2, GROUND_EDGE, 1);
    e.lineBetween(L * PPM, 1, R * PPM, 1);
    e.lineStyle(1, 0xffffff, 0.1);
    e.lineBetween(L * PPM, -0.5, R * PPM, -0.5);
    // Distance ticks along the ground (1 m / 5 m) with labels every 10 m.
    const x0 = Math.max(L, Math.floor(bounds.left));
    const x1 = Math.min(R, Math.ceil(bounds.right + 20));
    for (let x = x0; x <= x1; x++) {
      const major = x % 5 === 0;
      e.lineStyle(1, RULER, major ? 0.55 : 0.22);
      e.lineBetween(x * PPM, 2, x * PPM, major ? 10 : 5);
      if (x % 10 === 0 && x > 0) this.groundLabels.put(this, `${x} m`, x * PPM + 3, 12, 0, 0, 0.42);
    }
    this.groundLabels.end();

    this.placeRuler();
    this.lineDirty = true;
  }

  /** Destruction line at `height` m above ground spanning [x0, x1] m, or null to hide. */
  setDestructionLine(height: number | null, x0?: number, x1?: number): void {
    this.lineHeight = height;
    this.lineX0 = x0 ?? this.bounds.left + 8;
    this.lineX1 = x1 ?? this.bounds.right - 4;
    const on = height !== null;
    this.lineLabel.setVisible(on);
    this.lineValue.setVisible(on);
    this.shownProgress = this.progress;
    this.labelColor = -1;
    this.valueKey = -1;
    // Ruler sits just right of the structure.
    if (x1 !== undefined) {
      this.rulerX = Math.min(x1 + 1.5, this.bounds.right - 1.5);
      this.redrawRuler();
    }
    this.lineDirty = true;
  }

  /** 0..1 objective progress, used to color/animate the line. */
  setProgress(p: number): void {
    this.progress = Math.max(0, Math.min(1, p));
  }

  update(realDt: number): void {
    if (this.lineHeight === null) {
      if (this.lineDirty) {
        this.line.clear();
        this.lineDirty = false;
      }
      return;
    }
    // Ease the displayed progress so jumps read as motion.
    this.shownProgress += (this.progress - this.shownProgress) * Math.min(1, realDt * 5);
    const speed = 12 + this.shownProgress * 40;
    this.dash = (this.dash + realDt * speed) % 18;
    // Cheap (a few dozen segments): redraw every frame for the marching dashes.
    this.drawLine();
  }

  destroy(): void {
    this.grid.destroy();
    this.ruler.destroy();
    this.groundFill.destroy();
    this.groundHatch.destroy();
    this.groundEdge.destroy();
    this.line.destroy();
    this.lineLabel.destroy();
    this.lineValue.destroy();
    this.groundLabels.destroy();
    this.rulerLabels.destroy();
  }

  // ------------------------------------------------------------------ internals

  private placeRuler(): void {
    this.rulerX = this.lineHeight !== null ? Math.min(this.lineX1 + 1.5, this.bounds.right - 1.5) : this.bounds.right - 3;
    this.redrawRuler();
  }

  private redrawRuler(): void {
    const r = this.ruler;
    r.clear();
    const x = this.rulerX * PPM;
    const top = Math.floor(this.bounds.top + 1);
    r.lineStyle(1.5, RULER, 0.28);
    r.lineBetween(x, 0, x, top * PPM);
    this.rulerLabels.begin();
    for (let m = 0; m >= top; m--) {
      const h = -m;
      const major = h % 5 === 0;
      r.lineStyle(1, RULER, major ? 0.5 : 0.25);
      r.lineBetween(x - (major ? 9 : 5), m * PPM, x, m * PPM);
      if (major && h > 0) this.rulerLabels.put(this, `${h} m`, x - 12, m * PPM, 1, 0.5, 0.5);
    }
    this.rulerLabels.end();
  }

  private drawLine(): void {
    this.lineDirty = false;
    const g = this.line;
    g.clear();
    const h = this.lineHeight;
    if (h === null) return;
    const p = this.shownProgress;
    const done = this.progress >= 1;
    const color = done ? LINE_DONE : lerpColor(LINE_IDLE, LINE_CLOSE, Math.min(1, p * 1.1));
    const alpha = done ? 0.95 : 0.5 + 0.4 * p;
    const y = -h * PPM;
    const x0 = (this.lineX0 - 1) * PPM;
    const x1 = (this.lineX1 + 1) * PPM;
    // Faint band above the line: the mass that has to come down.
    g.fillStyle(color, 0.035 + 0.03 * p);
    g.fillRect(x0, y - 16, x1 - x0, 16);
    // Marching dashes.
    const dashLen = 11;
    const period = 18;
    g.lineStyle(2, color, alpha);
    for (let x = x0 - period + this.dash; x < x1; x += period) {
      const a = Math.max(x0, x);
      const b = Math.min(x1, x + dashLen);
      if (b > a) g.lineBetween(a, y, b, y);
    }
    // End caps.
    g.lineStyle(2, color, alpha);
    g.lineBetween(x0, y - 6, x0, y + 6);
    g.lineBetween(x1, y - 6, x1, y + 6);
    // Progress fill along the line (how much of the objective is met).
    if (p > 0.001 && !done) {
      g.lineStyle(3, color, 0.9);
      g.lineBetween(x0, y + 5, x0 + (x1 - x0) * p, y + 5);
    }
    this.lineLabel.setPosition(x0 - 10, y - 1).setAlpha(0.75 + 0.25 * p);
    this.lineValue.setPosition(x0 - 10, y + 2).setAlpha(0.6 + 0.3 * p);
    // Only touch the labels when the rounded values move (no per-frame string building).
    const pct = Math.round(p * 100);
    const colorKey = done ? LINE_DONE : lerpColor(LINE_IDLE, LINE_CLOSE, Math.round(Math.min(1, p * 1.1) * 8) / 8);
    if (colorKey !== this.labelColor) {
      this.labelColor = colorKey;
      this.lineLabel.setColor(colorKey);
      this.lineValue.setColor(colorKey);
      this.lineLabel.setText(done ? 'DESTRUCTION LINE ✓' : 'DESTRUCTION LINE');
    }
    const valueKey = pct * 100000 + Math.round(h * 10);
    if (valueKey !== this.valueKey) {
      this.valueKey = valueKey;
      this.lineValue.setText(`${h.toFixed(1)} m · ${pct}%`);
    }
  }

  /** @internal used by LabelPool. */
  makeText(size: number, color: number, depth: number): GlyphText {
    return new GlyphText(this.scene, size, color, depth);
  }
}

/** Small pool of world-space labels, refilled on each (rare) redraw. */
class LabelPool {
  private items: GlyphText[] = [];
  private used = 0;

  constructor(private readonly depth: number) {}

  begin(): void {
    this.used = 0;
  }

  put(owner: BackgroundRenderer, text: string, x: number, y: number, ox: number, oy: number, alpha: number): void {
    let t = this.items[this.used];
    if (!t) {
      t = owner.makeText(11, LABEL_COLOR, this.depth);
      this.items.push(t);
    }
    this.used++;
    t.setText(text).setOrigin(ox, oy).setPosition(x, y).setAlpha(alpha).setVisible(true);
  }

  end(): void {
    for (let i = this.used; i < this.items.length; i++) this.items[i]!.setVisible(false);
  }

  destroy(): void {
    for (const t of this.items) t.destroy();
    this.items.length = 0;
  }
}
