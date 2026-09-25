/**
 * Text helpers for the lab UI: two families (mono labels, display titles),
 * web-font loading, and a re-layout hook once the fonts arrive (Canvas text
 * rasterises with whatever font is available at creation time).
 */
import type * as Phaser from 'phaser';
import { THEME } from './theme';

type Text = Phaser.GameObjects.Text;
type TextStyle = Phaser.Types.GameObjects.Text.TextStyle;

let loaded = false;
let loading: Promise<void> | null = null;
const pending = new Set<Text>();
const listeners = new Set<() => void>();

/** Kick off loading of the UI web fonts (idempotent). Resolves on success, failure or timeout. */
export function loadUiFonts(): Promise<void> {
  if (loading) return loading;
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts || typeof fonts.load !== 'function') {
    loaded = true;
    loading = Promise.resolve();
    return loading;
  }
  const specs = ['400 16px "JetBrains Mono"', '600 16px "JetBrains Mono"', '800 16px "JetBrains Mono"', '500 16px "Space Grotesk"', '700 16px "Space Grotesk"'];
  const all = Promise.all(specs.map((s) => fonts.load(s).catch(() => [])));
  const timeout = new Promise<void>((res) => setTimeout(res, 4000));
  loading = Promise.race([all.then(() => undefined), timeout]).then(() => {
    loaded = true;
    for (const t of pending) {
      // Re-measure with the real font (metrics were taken from the fallback).
      if (t.scene && t.active !== false) t.style.update(true);
    }
    pending.clear();
    for (const fn of [...listeners]) fn();
    listeners.clear();
  });
  return loading;
}

export function uiFontsLoaded(): boolean {
  return loaded;
}

/**
 * Run `fn` once the UI fonts are ready (immediately if they already are).
 * Returns an unsubscribe function (call it on shutdown).
 */
export function onUiFonts(fn: () => void): () => void {
  if (loaded) {
    fn();
    return () => {};
  }
  listeners.add(fn);
  void loadUiFonts();
  return () => listeners.delete(fn);
}

function track(t: Text): Text {
  if (!loaded) {
    pending.add(t);
    t.once('destroy', () => pending.delete(t));
    void loadUiFonts();
  }
  return t;
}

export interface LabelOpts {
  weight?: 400 | 500 | 600 | 700 | 800;
  /** Extra letter spacing in px (static labels only: it is slow to rasterise). */
  spacing?: number;
  align?: 'left' | 'center' | 'right';
  wrap?: number;
  lineSpacing?: number;
  originX?: number;
  originY?: number;
}

function style(family: string, size: number, color: string, o: LabelOpts): TextStyle {
  const s: TextStyle = {
    fontFamily: family,
    fontSize: `${size}px`,
    fontStyle: String(o.weight ?? 400),
    color,
  };
  if (o.align) s.align = o.align;
  if (o.wrap) s.wordWrap = { width: o.wrap, useAdvancedWrap: true };
  if (o.lineSpacing) s.lineSpacing = o.lineSpacing;
  if (o.spacing) s.letterSpacing = o.spacing;
  return s;
}

/** Monospace label (numbers, readouts, small caps tags). */
export function mono(scene: Phaser.Scene, x: number, y: number, text: string, size: number, color: string = THEME.text, o: LabelOpts = {}): Text {
  const t = scene.add.text(x, y, text, style(THEME.font, size, color, o));
  t.setOrigin(o.originX ?? 0, o.originY ?? 0);
  return track(t);
}

/** Display face (titles, level names, grades). */
export function display(scene: Phaser.Scene, x: number, y: number, text: string, size: number, color: string = THEME.text, o: LabelOpts = {}): Text {
  const t = scene.add.text(x, y, text, style(THEME.fontDisplay, size, color, { weight: 700, ...o }));
  t.setOrigin(o.originX ?? 0, o.originY ?? 0);
  return track(t);
}

/** setText only when the content actually changed (Text re-rasterises on every call). */
export function setTextIfChanged(t: Text, s: string): void {
  if (t.text !== s) t.setText(s);
}

/** setColor only when it changed. */
export function setColorIfChanged(t: Text, c: string): void {
  if (t.style.color !== c) t.setColor(c);
}
