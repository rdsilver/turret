/**
 * Lab-style button: flat panel, thin rule, monospace small-caps label and an
 * optional keycap hint ("ENTER"). States: idle / hover / pressed / disabled /
 * selected. Keyboard shortcuts (KeyboardEvent.code) trigger it too.
 *
 * The container is centred on (x, y) (Container hit areas are centred).
 */
import * as Phaser from 'phaser';
import { THEME, SIZE, css } from './theme';
import { mono, onUiFonts } from './text';
import { onceEach } from './keys';
import type { AudioManager } from '../audio/AudioManager';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface ButtonOpts {
  x: number;
  y: number;
  width: number;
  height?: number;
  label: string;
  /** Second, dimmer line under the label (e.g. "LEVEL 04 / 10"). */
  sub?: string;
  variant?: ButtonVariant;
  /** Keycap text drawn at the right edge (e.g. "ENTER", "R"). */
  hint?: string;
  /** KeyboardEvent.code values that press the button (e.g. ['Enter', 'Space']). */
  keys?: string[];
  /** Extra condition for keyboard activation (e.g. "panel visible"). */
  keyGuard?: () => boolean;
  align?: 'left' | 'center';
  fontSize?: number;
  audio?: AudioManager | null;
  /** Sound on click (default ui_click; null = silent). */
  sound?: 'ui_click' | 'ui_buy' | null;
  onClick: () => void;
  /** Called when a disabled button is clicked (after the deny feedback). */
  onDenied?: () => void;
}

const PAD = 20;

export class Button {
  readonly container: Phaser.GameObjects.Container;
  private readonly bg: Phaser.GameObjects.Graphics;
  private readonly label: Phaser.GameObjects.Text;
  private readonly subText: Phaser.GameObjects.Text | null = null;
  private readonly hintText: Phaser.GameObjects.Text | null = null;
  private readonly w: number;
  private readonly h: number;
  private readonly variant: ButtonVariant;
  private enabled = true;
  private selected = false;
  private hover = false;
  private pressed = false;
  private offFonts: () => void = () => {};
  // Phaser can deliver the same keydown more than once per frame (see keys.ts).
  private readonly onKey = onceEach((e: KeyboardEvent): void => this.handleKey(e));

  constructor(
    readonly scene: Phaser.Scene,
    private readonly opts: ButtonOpts,
  ) {
    this.w = opts.width;
    this.h = opts.height ?? 56;
    this.variant = opts.variant ?? 'secondary';
    const fs = opts.fontSize ?? SIZE.md;
    const left = -this.w / 2;

    this.bg = scene.add.graphics();
    const align = opts.align ?? 'center';
    const lx = align === 'left' ? left + PAD : 0;
    // Two-line block (label + sub) centred vertically.
    const subFs = SIZE.micro;
    const block = fs * 1.15 + 4 + subFs * 1.2;
    const ly = opts.sub !== undefined ? -block / 2 + fs * 0.575 : 0;
    const sy = -block / 2 + fs * 1.15 + 4 + subFs * 0.6;
    this.label = mono(scene, lx, ly, opts.label, fs, THEME.text, { weight: 600, originX: align === 'left' ? 0 : 0.5, originY: 0.5 });
    const parts: Phaser.GameObjects.GameObject[] = [this.bg, this.label];
    if (opts.sub !== undefined) {
      this.subText = mono(scene, lx, sy, opts.sub, subFs, THEME.textDim, { originX: align === 'left' ? 0 : 0.5, originY: 0.5 });
      parts.push(this.subText);
    }
    if (opts.hint) {
      this.hintText = mono(scene, this.w / 2 - 14, 0, opts.hint, SIZE.micro - 1, THEME.textDim, { weight: 600, originX: 1, originY: 0.5 });
      parts.push(this.hintText);
    }
    this.container = scene.add.container(opts.x, opts.y, parts);
    this.container.setSize(this.w, this.h);
    this.container.setInteractive({ useHandCursor: true });

    this.container.on('pointerover', () => {
      this.hover = true;
      this.redraw();
    });
    this.container.on('pointerout', () => {
      this.hover = false;
      this.pressed = false;
      this.container.setScale(1);
      this.redraw();
    });
    this.container.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!p.leftButtonDown()) return;
      this.pressed = true;
      if (this.enabled) this.container.setScale(0.985);
      this.redraw();
    });
    this.container.on('pointerup', () => {
      if (!this.pressed) return;
      this.pressed = false;
      this.container.setScale(1);
      this.redraw();
      this.activate();
    });

    if (opts.keys?.length) scene.input.keyboard?.on('keydown', this.onKey);
    this.redraw();
    // Keycap outline depends on the measured hint width.
    if (this.hintText) this.offFonts = onUiFonts(() => this.container.scene && this.redraw());
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(on: boolean): this {
    if (this.enabled === on) return this;
    this.enabled = on;
    if (this.container.input) this.container.input.cursor = on ? 'pointer' : 'default';
    this.redraw();
    return this;
  }

  setSelected(on: boolean): this {
    if (this.selected === on) return this;
    this.selected = on;
    this.redraw();
    return this;
  }

  setLabel(s: string): this {
    if (this.label.text !== s) this.label.setText(s);
    return this;
  }

  setSub(s: string): this {
    if (this.subText && this.subText.text !== s) this.subText.setText(s);
    return this;
  }

  setVisible(v: boolean): this {
    this.container.setVisible(v);
    if (!v) {
      this.hover = false;
      this.pressed = false;
      this.container.setScale(1);
      this.redraw();
    }
    return this;
  }

  setPosition(x: number, y: number): this {
    this.container.setPosition(x, y);
    return this;
  }

  /** Press programmatically (keyboard): brief pressed flash, then click. */
  trigger(): void {
    this.pressed = true;
    this.redraw();
    this.scene.time.delayedCall(90, () => {
      if (!this.container.scene) return;
      this.pressed = false;
      this.redraw();
    });
    this.activate();
  }

  destroy(): void {
    this.offFonts();
    this.scene.tweens?.killTweensOf(this.container);
    this.scene.input?.keyboard?.off('keydown', this.onKey);
    this.container.destroy();
  }

  // ------------------------------------------------------------------ internals

  private handleKey(e: KeyboardEvent): void {
    if (!this.opts.keys?.includes(e.code)) return;
    if (!this.container.active || !this.container.visible) return;
    if (this.opts.keyGuard && !this.opts.keyGuard()) return;
    if (e.repeat) return;
    this.trigger();
  }

  private activate(): void {
    if (!this.enabled) {
      this.opts.audio?.play('ui_deny');
      this.shake();
      this.opts.onDenied?.();
      return;
    }
    const snd = this.opts.sound === undefined ? 'ui_click' : this.opts.sound;
    if (snd) this.opts.audio?.play(snd);
    this.opts.onClick();
  }

  private shake(): void {
    const c = this.container;
    const x0 = this.opts.x;
    this.scene.tweens.killTweensOf(c);
    c.x = x0;
    this.scene.tweens.add({
      targets: c,
      x: { from: x0 - 6, to: x0 },
      duration: 260,
      ease: 'Elastic.easeOut',
      easeParams: [1.2, 0.3],
    });
  }

  /** Move the stored rest x (used by shake) when a layout moves the button. */
  relayout(x: number, y: number): void {
    this.opts.x = x;
    this.opts.y = y;
    this.container.setPosition(x, y);
  }

  private redraw(): void {
    const g = this.bg;
    const w = this.w;
    const h = this.h;
    const x = -w / 2;
    const y = -h / 2;
    const r = 3;
    g.clear();

    let fill: number = THEME.panelHi;
    let fillA = 1;
    let edge: number = THEME.rule;
    let edgeA = 1;
    let text: string = THEME.text;
    let hint: string = THEME.textDim;
    let bar = false;

    const hot = this.enabled && (this.hover || this.pressed);
    if (this.variant === 'primary') {
      fill = this.pressed && this.enabled ? 0xe89a2c : this.hover && this.enabled ? 0xffc46b : THEME.accentNum;
      edge = fill;
      text = css(THEME.bgDeep);
      hint = 'rgba(13,15,18,0.7)';
    } else if (this.variant === 'ghost') {
      fillA = hot ? 0.8 : 0;
      fill = THEME.panelHi;
      edgeA = hot ? 1 : 0;
      text = hot ? THEME.text : THEME.textDim;
    } else {
      fill = this.pressed && this.enabled ? THEME.panel : hot ? 0x2a303c : THEME.panelHi;
      edge = hot ? THEME.accentNum : THEME.rule;
      bar = hot;
    }
    if (this.selected) {
      edge = THEME.accentNum;
      bar = true;
      text = THEME.text;
    }
    if (!this.enabled) {
      fill = THEME.panel;
      fillA = this.variant === 'ghost' ? 0 : 1;
      edge = THEME.panelEdge;
      edgeA = this.variant === 'ghost' ? 0 : 1;
      text = THEME.textFaint;
      hint = THEME.textFaint;
      bar = false;
    }

    if (fillA > 0) {
      g.fillStyle(fill, fillA);
      g.fillRoundedRect(x, y, w, h, r);
    }
    if (edgeA > 0) {
      g.lineStyle(this.selected ? 2 : 1, edge, edgeA);
      g.strokeRoundedRect(x + 0.5, y + 0.5, w - 1, h - 1, r);
    }
    if (bar) {
      g.fillStyle(THEME.accentNum, 1);
      g.fillRect(x, y + 6, 3, h - 12);
    }
    // Keycap outline around the hint.
    if (this.hintText) {
      const hw = this.hintText.width + 12;
      const hx = w / 2 - 14 - this.hintText.width - 6;
      g.lineStyle(1, this.variant === 'primary' && this.enabled ? 0x0d0f12 : this.enabled ? THEME.rule : THEME.panelEdge, this.variant === 'primary' ? 0.45 : 1);
      g.strokeRoundedRect(hx + 0.5, -12.5, hw, 24, 3);
    }

    if (this.label.style.color !== text) this.label.setColor(text);
    if (this.hintText && this.hintText.style.color !== hint) this.hintText.setColor(hint);
    if (this.subText) {
      const sc = !this.enabled ? THEME.textFaint : this.variant === 'primary' ? 'rgba(13,15,18,0.72)' : THEME.textDim;
      if (this.subText.style.color !== sc) this.subText.setColor(sc);
    }
  }
}
