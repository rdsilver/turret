/**
 * Main menu. OWNER: UI agent.
 * Title, short tagline, buttons: PLAY (continue campaign at gameState().levelIndex),
 * NEW GAME (resetGameState()), SANDBOX (debug testbed), DAILY SEED (hash of
 * today's date), SEED (enter a structure code -> procedural structure),
 * a controls legend and a live physics vignette.
 * Start the game with: this.scene.start('Game', { mode: 'campaign' | 'sandbox' | 'seed', seed? }).
 */
import * as Phaser from 'phaser';
import { THEME, SIZE } from '../ui/theme';
import { display, loadUiFonts, mono, onUiFonts, setTextIfChanged } from '../ui/text';
import { money, pad2, todayKey } from '../ui/format';
import { Button } from '../ui/Button';
import { LabBackdrop } from '../ui/LabBackdrop';
import { MenuVignette, type CellRect } from '../ui/MenuVignette';
import { AudioManager } from '../audio/AudioManager';
import { gameState, resetGameState } from '../game/GameState';
import { levelManager } from '../game/LevelManager';
import { hashString } from '../core/Random';

/** Parse a user-entered structure code: base-36 codes (as shown in-game) or any text (hashed). */
export function parseSeed(input: string): number | null {
  const s = input.trim();
  if (!s) return null;
  if (/^[0-9a-z]{1,7}$/i.test(s)) {
    const v = parseInt(s, 36);
    if (v <= 0xffffffff) return v >>> 0;
  }
  return hashString(s.toLowerCase());
}

export function dailySeed(d: Date = new Date()): number {
  return hashString(`turret-daily-${todayKey(d)}`);
}

const LEGEND: Array<[string, string]> = [
  ['MOUSE', 'aim'],
  ['CLICK', 'fire'],
  ['WHEEL · W/S', 'power'],
  ['S', 'stress scan'],
  ['Q/E', 'ammo'],
  ['R', 'restart'],
  ['ESC', 'menu'],
  ['`', 'debug'],
  ['F3', 'overlay'],
];

export class MenuScene extends Phaser.Scene {
  private audio!: AudioManager;
  private backdrop!: LabBackdrop;
  private vignette: MenuVignette | null = null;
  private buttons: Button[] = [];
  private cellCaption!: Phaser.GameObjects.Text;
  private cellStats!: Phaser.GameObjects.Text;
  private liveDot!: Phaser.GameObjects.Arc;
  private statAcc = 0;
  private leaving = false;
  private confirmReset = 0;
  private newGameBtn!: Button;
  private readonly vstats = { joints: 0, intact: 0, time: 0, name: '' };

  constructor() {
    super('Menu');
  }

  create(): void {
    void loadUiFonts();
    this.leaving = false;
    this.confirmReset = 0;
    this.buttons = [];
    const W = this.scale.width;
    const H = this.scale.height;
    this.audio = new AudioManager(this);
    this.backdrop = new LabBackdrop(this);
    const gs = gameState();

    // ------------------------------------------------------------ title block
    const X = 140;
    this.add.rectangle(X, 166, 10, 10, THEME.accentNum).setOrigin(0, 0.5);
    mono(this, X + 22, 166, 'STRUCTURAL DEMOLITION LABORATORY', SIZE.xs, THEME.textDim, { weight: 600, spacing: 4, originY: 0.5 });
    display(this, X - 8, 186, 'TURRET', SIZE.hero, THEME.text, { spacing: 10 });
    mono(this, X, 392, 'Structural analysis, applied at high velocity.', SIZE.lg - 4, THEME.textDim);
    this.add.rectangle(X, 446, 600, 1, THEME.rule).setOrigin(0, 0.5);
    this.add.rectangle(X, 446, 60, 3, THEME.accentNum).setOrigin(0, 0.5);

    // ------------------------------------------------------------ buttons
    const campaignDone = gs.levelIndex >= levelManager.count;
    const started = gs.levelIndex > 0;
    const playSub = campaignDone
      ? `ENDLESS · STRUCTURE ${pad2(gs.levelIndex - levelManager.count + 1)}`
      : `CAMPAIGN · LEVEL ${pad2(gs.levelIndex + 1)} / ${pad2(levelManager.count)}${gs.money > 0 ? ` · ${money(gs.money)}` : ''}`;
    const bw = 560;
    const bh = 64;
    const bx = X + bw / 2;
    let by = 512;
    const step = bh + 14;
    const mk = (label: string, sub: string, hint: string, keys: string[], onClick: () => void, variant: 'primary' | 'secondary' = 'secondary'): Button => {
      const b = new Button(this, { x: bx, y: by, width: bw, height: bh, label, sub, hint, keys, variant, align: 'left', fontSize: SIZE.md + 2, audio: this.audio, onClick });
      this.buttons.push(b);
      by += step;
      return b;
    };
    mk(started ? 'CONTINUE' : 'PLAY', playSub, 'ENTER', ['Enter', 'NumpadEnter', 'Space'], () => this.go({ mode: 'campaign' }), 'primary');
    this.newGameBtn = mk('NEW GAME', started || gs.money > 0 ? 'ERASES CAMPAIGN PROGRESS' : 'START THE CAMPAIGN FROM LEVEL 01', 'N', ['KeyN'], () => this.newGame());
    mk('SANDBOX', 'TESTBED · SPAWN, GRAB, BREAK · DEBUG TOOLS', 'B', ['KeyB'], () => this.go({ mode: 'sandbox' }));
    const daily = dailySeed();
    mk('DAILY SEED', `${todayKey()} · STRUCTURE ${daily.toString(36).toUpperCase()}`, 'D', ['KeyD'], () => this.go({ mode: 'seed', seed: daily }));
    mk('ENTER SEED…', 'PLAY A SHARED STRUCTURE CODE', 'K', ['KeyK'], () => this.promptSeed());

    // ------------------------------------------------------------ live vignette cell
    const cell: CellRect = { x: 1000, y: 180, w: 780, h: 600 };
    const frame = this.add.graphics();
    frame.fillStyle(THEME.bgDeep, 0.55);
    frame.fillRect(cell.x, cell.y, cell.w, cell.h);
    frame.lineStyle(1, THEME.panelEdge, 1);
    frame.strokeRect(cell.x - 0.5, cell.y - 0.5, cell.w + 1, cell.h + 1);
    // Corner brackets
    frame.lineStyle(2, THEME.textDimNum, 0.9);
    const L = 18;
    for (const [cx, cy, sx, sy] of [
      [cell.x, cell.y, 1, 1],
      [cell.x + cell.w, cell.y, -1, 1],
      [cell.x, cell.y + cell.h, 1, -1],
      [cell.x + cell.w, cell.y + cell.h, -1, -1],
    ] as const) {
      frame.lineBetween(cx - sx * 6, cy - sy * 6, cx - sx * 6 + sx * L, cy - sy * 6);
      frame.lineBetween(cx - sx * 6, cy - sy * 6, cx - sx * 6, cy - sy * 6 + sy * L);
    }
    this.liveDot = this.add.circle(cell.x + 6, cell.y - 26, 5, THEME.badNum);
    this.cellCaption = mono(this, cell.x + 20, cell.y - 26, 'SPECIMEN', SIZE.xs, THEME.textDim, { weight: 600, spacing: 3, originY: 0.5 });
    this.cellStats = mono(this, cell.x + cell.w, cell.y - 26, '', SIZE.xs, THEME.textDim, { originX: 1, originY: 0.5 });
    mono(this, cell.x, cell.y + cell.h + 22, 'Real-time rigid-body simulation. Every joint is measured; every failure is physical.', SIZE.xs, THEME.textFaint);

    // ------------------------------------------------------------ controls legend
    this.buildLegend(X, H - 96, W - X * 2);

    // ------------------------------------------------------------ footer
    const stats = `${money(gs.money)} FUNDS · ${gs.totalShots} SHOTS FIRED · ${gs.totalJointsBroken} JOINTS BROKEN`;
    mono(this, X, H - 40, stats, SIZE.micro, THEME.textFaint, { originY: 0.5 });
    mono(this, W - X, H - 40, 'PROTOTYPE BUILD · PHASER 4 · RAPIER 2D', SIZE.micro, THEME.textFaint, { originX: 1, originY: 0.5 });

    // Vignette last so it can ignore everything above (and anything added later).
    try {
      this.vignette = new MenuVignette(this, cell);
    } catch (e) {
      console.warn('Menu vignette disabled', e);
      this.vignette = null;
    }

    this.input.keyboard?.on('keydown-ESC', () => this.cancelConfirm());
    for (const c of this.cameras.cameras) c.fadeIn(350, 13, 15, 18);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.1, deltaMs / 1000);
    this.backdrop.update(dt);
    this.vignette?.update(dt);
    this.liveDot.alpha = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(this.time.now * 0.006));
    this.statAcc += dt;
    if (this.statAcc > 0.2) {
      this.statAcc = 0;
      if (this.vignette) {
        this.vignette.stats(this.vstats);
        const v = this.vstats;
        setTextIfChanged(this.cellCaption, `SPECIMEN · ${v.name} · LIVE`);
        setTextIfChanged(this.cellStats, `JOINTS ${v.intact}/${v.joints}   t = ${v.time.toFixed(1)} s`);
      }
    }
    if (this.confirmReset > 0) {
      this.confirmReset -= dt;
      if (this.confirmReset <= 0) this.cancelConfirm();
    }
  }

  // ------------------------------------------------------------------ actions

  private go(data: { mode: 'campaign' | 'sandbox' | 'seed'; seed?: number }): void {
    if (this.leaving) return;
    this.leaving = true;
    const cams = this.cameras.cameras;
    cams.forEach((c) => c.fadeOut(220, 13, 15, 18));
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.start('Game', data));
  }

  private newGame(): void {
    const gs = gameState();
    const hasProgress = gs.levelIndex > 0 || gs.money > 0 || Object.keys(gs.upgrades).length > 0;
    if (hasProgress && this.confirmReset <= 0) {
      this.confirmReset = 3;
      this.newGameBtn.setLabel('CONFIRM: ERASE PROGRESS?').setSub('PRESS AGAIN WITHIN 3 S · ESC TO CANCEL');
      return;
    }
    resetGameState();
    this.go({ mode: 'campaign' });
  }

  private cancelConfirm(): void {
    this.confirmReset = 0;
    this.newGameBtn?.setLabel('NEW GAME').setSub('ERASES CAMPAIGN PROGRESS');
  }

  private promptSeed(): void {
    if (this.leaving) return;
    let raw: string | null = null;
    try {
      raw = window.prompt('Structure code (as shown under a level name, e.g. K3F9Z) or any word:', '');
    } catch {
      raw = null;
    }
    if (raw === null) return;
    const seed = parseSeed(raw);
    if (seed === null) {
      this.audio.play('ui_deny');
      return;
    }
    this.go({ mode: 'seed', seed });
  }

  private buildLegend(x: number, y: number, width: number): void {
    this.add.rectangle(x, y - 30, width, 1, THEME.panelEdge).setOrigin(0, 0.5);
    mono(this, x, y - 30, ' CONTROLS ', SIZE.micro, THEME.textFaint, { weight: 600, spacing: 3, originY: 0.5 }).setBackgroundColor('#121418');
    const g = this.add.graphics();
    const items: Array<{ key: Phaser.GameObjects.Text; label: Phaser.GameObjects.Text }> = [];
    for (const [k, l] of LEGEND) {
      items.push({
        key: mono(this, 0, y, k, SIZE.micro, THEME.text, { weight: 700, originY: 0.5 }),
        label: mono(this, 0, y, l, SIZE.xs, THEME.textDim, { originY: 0.5 }),
      });
    }
    const layout = (): void => {
      g.clear();
      let cx = x;
      const gap = 30;
      let total = 0;
      for (const it of items) total += it.key.width + 16 + 10 + it.label.width;
      const spacing = Math.max(gap, (width - total) / Math.max(1, items.length - 1));
      for (const it of items) {
        const kw = it.key.width + 16;
        g.lineStyle(1, THEME.rule, 1);
        g.fillStyle(THEME.panelHi, 1);
        g.fillRoundedRect(cx, y - 13, kw, 26, 3);
        g.strokeRoundedRect(cx + 0.5, y - 12.5, kw - 1, 25, 3);
        it.key.x = cx + 8;
        it.label.x = cx + kw + 10;
        cx += kw + 10 + it.label.width + spacing;
      }
    };
    layout();
    // Re-measure once the web fonts arrive.
    const off = onUiFonts(layout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, off);
  }

  private teardown(): void {
    for (const b of this.buttons) b.destroy();
    this.buttons = [];
    this.vignette?.destroy();
    this.vignette = null;
    this.backdrop.destroy();
    this.input.keyboard?.removeAllListeners();
  }
}
