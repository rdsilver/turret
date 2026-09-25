/**
 * End-of-level results: animated count-up of each ScoreLine, grade, titles,
 * lesson learned, buttons: Continue (to upgrades) / Retry. OWNER: UI agent.
 *
 * Everything animates from a single clock (`t`, seconds since show) so the
 * whole sequence can be fast-forwarded with one assignment (Enter / Space /
 * click on the backdrop while it is still counting).
 */
import type * as Phaser from 'phaser';
import type { LevelResult, ScoreLine } from '../game/Economy';
import type { LevelDef } from '../game/LevelDefinition';
import { THEME, SIZE, GRADE_COLOR, css } from './theme';
import { display, fitText, mono } from './text';
import { money, signedMoney } from './format';
import { Button } from './Button';
import { onceEach } from './keys';
import { AudioManager } from '../audio/AudioManager';

export interface ResultsCallbacks {
  onContinue: () => void;
  onRetry: () => void;
}

/** Optional context from the caller (all fields optional). */
export interface ResultsInfo {
  /** Money actually credited (replays only pay the improvement over the best payout). */
  credited?: number;
  /** Small tag in the header, e.g. "LEVEL 03 / 10". */
  levelLabel?: string;
  /** Header title (default "DEMOLITION REPORT"). */
  report?: string;
  /** Primary button label (default "CONTINUE"). */
  continueLabel?: string;
}

type Text = Phaser.GameObjects.Text;
type GO = Phaser.GameObjects.GameObject & { alpha: number; x: number; y: number };

const PANEL_W = 860;
const PAD = 44;
const ROW_H = 46;
const DEPTH = 100;

const T_PANEL = 0.3;
const T_FIRST_LINE = 0.5;
const LINE_GAP = 0.36;
const LINE_COUNT = 0.3;
const TOTAL_COUNT = 1.15;

const easeOutCubic = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

interface Row {
  line: ScoreLine;
  parts: GO[];
  label: Text;
  detail: Text | null;
  amount: Text;
  x0: number;
  start: number;
  shown: number;
  ticked: boolean;
}

interface Chip {
  g: Phaser.GameObjects.Graphics;
  text: Text;
  y0: number;
  at: number;
}

export class ResultsPanel {
  visible = false;

  private readonly audio: AudioManager;
  private readonly W: number;
  private readonly H: number;
  private objs: Phaser.GameObjects.GameObject[] = [];
  private buttons: Button[] = [];
  private rows: Row[] = [];
  private chips: Chip[] = [];
  private lesson: GO[] = [];
  private dim: Phaser.GameObjects.Rectangle | null = null;
  private panel: Phaser.GameObjects.Container | null = null;
  private totalText: Text | null = null;
  private totalLabel: Text | null = null;
  private gradeText: Text | null = null;
  private gradeFrame: Phaser.GameObjects.Graphics | null = null;
  private gradeFlash: Phaser.GameObjects.Rectangle | null = null;
  private cb: ResultsCallbacks | null = null;
  private info: ResultsInfo = {};
  private creditText: Text | null = null;
  private result: LevelResult | null = null;

  private t = 0;
  private tTotal = 0;
  private tGrade = 0;
  private tEnd = 0;
  private totalShown = Number.NaN;
  private lastTick = -1;
  private cashPlayed = false;
  private gradePlayed = false;

  // Real frame time (like GameScene), not Phaser's smoothed delta, which lags far
  // behind at low frame rates and stretches the count-up.
  private readonly onUpdate = (): void => this.tick(Math.min(0.25, Math.max(0, this.scene.game.loop.rawDelta) / 1000));
  // Phaser can deliver the same keydown more than once per frame (see keys.ts).
  private readonly onKey = onceEach((e: KeyboardEvent): void => this.handleKey(e));

  constructor(readonly scene: Phaser.Scene) {
    this.W = scene.scale.width;
    this.H = scene.scale.height;
    this.audio = new AudioManager(scene);
  }

  show(result: LevelResult, level: Pick<LevelDef, 'name' | 'subtitle' | 'lesson'>, cb: ResultsCallbacks, info: ResultsInfo = {}): void {
    this.clear();
    this.info = info;
    this.visible = true;
    this.cb = cb;
    this.result = result;
    this.t = 0;
    this.totalShown = Number.NaN;
    this.cashPlayed = false;
    this.gradePlayed = false;
    this.lastTick = -1;
    this.build(result, level);
    this.scene.events.on('update', this.onUpdate);
    this.scene.input.keyboard?.on('keydown', this.onKey);
    this.tick(0);
  }

  hide(): void {
    this.visible = false;
    this.clear();
  }

  destroy(): void {
    this.visible = false;
    this.clear();
  }

  /** True once the count-up sequence has finished (or was skipped). */
  get finished(): boolean {
    return this.t >= this.tEnd;
  }

  // ------------------------------------------------------------------ build

  private build(result: LevelResult, level: Pick<LevelDef, 'name' | 'subtitle' | 'lesson'>): void {
    const s = this.scene;
    const W = this.W;
    const H = this.H;

    // Backdrop: dims the world and swallows clicks (click = skip the count-up).
    this.dim = s.add.rectangle(0, 0, W, H, 0x07080a, 0.66).setOrigin(0, 0).setDepth(DEPTH);
    this.dim.setInteractive();
    this.dim.on('pointerdown', () => this.skip());
    this.objs.push(this.dim);

    const c = s.add.container(W / 2, H / 2).setDepth(DEPTH + 1);
    this.panel = c;
    this.objs.push(c);
    const put = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      c.add(o);
      return o;
    };

    const lines = result.lines;
    const innerW = PANEL_W - PAD * 2;
    const lessonText = (level.lesson ?? '').trim();

    // Measure the variable-height parts first, then lay out around them.
    const lessonBody = lessonText ? mono(s, 0, 0, lessonText, SIZE.sm, THEME.text, { wrap: innerW - 8, lineSpacing: 6 }) : null;
    const headerH = 200;
    const chipsH = result.titles.length ? 50 : 0;
    const cr = this.info.credited;
    const creditMsg =
      cr !== undefined && Math.round(cr) !== Math.round(result.total)
        ? cr > 0
          ? `REPLAY · ${money(cr)} CREDITED (IMPROVEMENT OVER YOUR BEST)`
          : 'REPLAY · BEST PAYOUT ALREADY CLAIMED'
        : '';
    const totalH = creditMsg ? 120 : 96;
    const lessonH = lessonBody ? 58 + lessonBody.height + 30 : 0;
    const buttonsH = 100;
    // Rows shrink (down to 32 px) rather than letting a long report leave the screen.
    const fixedH = headerH + chipsH + 24 + totalH + lessonH + buttonsH;
    const nRows = Math.max(1, lines.length);
    const rowH = Math.max(32, Math.min(ROW_H, Math.floor((H - 32 - fixedH) / nRows)));
    const rowsH = nRows * rowH;
    const panelH = fixedH + rowsH;
    const px = -PANEL_W / 2;
    const py = -panelH / 2;

    // Panel body
    const g = put(s.add.graphics());
    g.fillStyle(THEME.panel, 0.97);
    g.fillRoundedRect(px, py, PANEL_W, panelH, 6);
    g.lineStyle(1, THEME.panelEdge, 1);
    g.strokeRoundedRect(px + 0.5, py + 0.5, PANEL_W - 1, panelH - 1, 6);
    g.fillStyle(THEME.accentNum, 1);
    g.fillRect(px, py + 30, 4, 22);

    // Header
    let y = py + 32;
    put(mono(s, px + PAD, y, this.info.levelLabel ? `${this.info.report ?? 'DEMOLITION REPORT'} · ${this.info.levelLabel}` : this.info.report ?? 'DEMOLITION REPORT', SIZE.micro, THEME.textDim, { weight: 600, spacing: 3 }));
    // Long (procedural) names shrink / wrap instead of running through the grade box.
    const title = put(display(s, px + PAD - 2, y + 26, level.name, SIZE.xxl - 8, THEME.text));
    fitText(title, innerW - 200, SIZE.xxl - 8, SIZE.xl - 4);
    put(mono(s, px + PAD, Math.max(y + 92, title.y + title.height + 6), level.subtitle, SIZE.sm, THEME.textDim, { wrap: innerW - 200 }));

    // Grade box (top-right)
    const gs = 150;
    const gx = px + PANEL_W - PAD - gs;
    const gy = py + 36;
    const gradeCol = GRADE_COLOR[result.grade] ?? THEME.textNum;
    this.gradeFrame = put(s.add.graphics());
    this.gradeFrame.fillStyle(gradeCol, 0.07);
    this.gradeFrame.fillRoundedRect(gx, gy, gs, gs, 4);
    this.gradeFrame.lineStyle(2, gradeCol, 1);
    this.gradeFrame.strokeRoundedRect(gx, gy, gs, gs, 4);
    put(mono(s, gx + gs / 2, gy, ' GRADE ', SIZE.micro, THEME.textDim, { weight: 600, spacing: 3, originX: 0.5, originY: 0.5 })).setBackgroundColor(css(THEME.panel));
    this.gradeText = put(display(s, gx + gs / 2, gy + gs / 2 + 4, result.grade, 118, css(gradeCol), { originX: 0.5, originY: 0.5 }));
    this.gradeFlash = put(s.add.rectangle(gx + gs / 2, gy + gs / 2, gs, gs, gradeCol, 0).setOrigin(0.5));

    // Title chips ("ONE SHOT", "DOMINO EFFECT")
    y = py + headerH;
    if (result.titles.length) {
      let cx = px + PAD;
      for (const title of result.titles) {
        const text = mono(s, 0, y + 16, title.toUpperCase(), SIZE.micro, THEME.accent, { weight: 700, spacing: 2, originY: 0.5 });
        const w = text.width + 28;
        if (cx + w > px + PANEL_W - PAD) {
          text.destroy();
          break;
        }
        text.x = cx + 14;
        const cg = put(s.add.graphics({ x: cx, y }));
        cg.fillStyle(THEME.accentNum, 0.1);
        cg.fillRoundedRect(0, 0, w, 32, 16);
        cg.lineStyle(1, THEME.accentNum, 0.85);
        cg.strokeRoundedRect(0.5, 0.5, w - 1, 31, 16);
        put(text);
        this.chips.push({ g: cg, text, y0: y, at: 0 });
        cx += w + 10;
      }
      y += chipsH;
    }

    // Score lines
    put(s.add.rectangle(px + PAD, y + 8, innerW, 1, THEME.rule).setOrigin(0, 0.5));
    y += 24;
    const amountX = px + PANEL_W - PAD;
    if (lines.length === 0) put(mono(s, px + PAD, y + rowH / 2, 'No score lines recorded.', SIZE.sm, THEME.textFaint, { originY: 0.5 }));
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const ry = y + i * rowH + rowH / 2;
      const col = line.kind === 'bonus' ? THEME.good : line.kind === 'cost' ? THEME.bad : THEME.text;
      const mkCol = line.kind === 'bonus' ? THEME.goodNum : line.kind === 'cost' ? THEME.badNum : THEME.textDimNum;
      const mk = put(s.add.rectangle(px + PAD - 16, ry, 3, 16, mkCol));
      const label = put(mono(s, px + PAD, ry, line.label, SIZE.md - 1, THEME.text, { weight: 600, originY: 0.5 }));
      const detail = line.detail ? put(mono(s, px + PAD + label.width + 14, ry + 1, line.detail, SIZE.xs - 1, THEME.textDim, { originY: 0.5 })) : null;
      const amount = put(mono(s, amountX, ry, '', SIZE.md, col, { weight: 700, originX: 1, originY: 0.5 }));
      const parts: GO[] = [mk, label, amount];
      if (detail) parts.push(detail);
      if (i < lines.length - 1) parts.push(put(s.add.rectangle(px + PAD, ry + rowH / 2, innerW, 1, THEME.panelEdge, 0.6).setOrigin(0, 0.5)));
      this.rows.push({ line, parts, label, detail, amount, x0: px + PAD, start: T_FIRST_LINE + i * LINE_GAP, shown: Number.NaN, ticked: false });
    }
    y += rowsH;

    // Total
    put(s.add.rectangle(px + PAD, y + 10, innerW, 1, THEME.rule).setOrigin(0, 0.5));
    put(s.add.rectangle(px + PAD, y + 14, innerW, 1, THEME.rule).setOrigin(0, 0.5));
    this.totalLabel = put(mono(s, px + PAD, y + 56, 'TOTAL PAYOUT', SIZE.md, THEME.textDim, { weight: 700, spacing: 3, originY: 0.5 }));
    this.totalText = put(display(s, amountX, y + 56, money(0), SIZE.xxl - 4, THEME.money, { originX: 1, originY: 0.5 }));
    if (creditMsg) this.creditText = put(mono(s, amountX, y + 98, creditMsg, SIZE.micro, THEME.textDim, { weight: 600, spacing: 1, originX: 1, originY: 0.5 }));
    y += totalH;

    // Lesson
    if (lessonBody) {
      const lg = put(s.add.graphics());
      lg.fillStyle(THEME.bgDeep, 0.6);
      lg.fillRoundedRect(px + PAD - 16, y, innerW + 32, lessonH - 16, 4);
      lg.fillStyle(THEME.infoNum, 0.9);
      lg.fillRect(px + PAD - 16, y, 3, lessonH - 16);
      const lt = put(mono(s, px + PAD, y + 18, 'WHAT YOU LEARNED', SIZE.micro, THEME.info, { weight: 700, spacing: 3 }));
      lessonBody.setPosition(px + PAD, y + 44);
      put(lessonBody);
      this.lesson.push(lg, lt, lessonBody);
      y += lessonH;
    }

    // Buttons (children of the panel so they ride its entrance)
    const by = py + panelH - 58;
    const retry = new Button(s, { x: px + PAD + 130, y: by, width: 260, height: 58, label: 'RETRY', hint: 'R', variant: 'secondary', audio: this.audio, onClick: () => this.cb?.onRetry() });
    const cont = new Button(s, { x: px + PANEL_W - PAD - 170, y: by, width: 340, height: 58, label: this.info.continueLabel ?? 'CONTINUE', hint: 'ENTER', variant: 'primary', audio: this.audio, onClick: () => this.cb?.onContinue() });
    c.add(retry.container);
    c.add(cont.container);
    this.buttons.push(retry, cont);

    // Timeline
    const n = lines.length;
    this.tTotal = (n ? T_FIRST_LINE + (n - 1) * LINE_GAP + LINE_COUNT : T_FIRST_LINE) + 0.35;
    this.tGrade = this.tTotal + TOTAL_COUNT + 0.3;
    for (let i = 0; i < this.chips.length; i++) this.chips[i]!.at = this.tGrade + 0.35 + i * 0.14;
    this.tEnd = this.tGrade + 0.55 + this.chips.length * 0.14 + 0.25;
  }

  private clear(): void {
    this.scene.events.off('update', this.onUpdate);
    this.scene.input?.keyboard?.off('keydown', this.onKey);
    for (const b of this.buttons) b.destroy();
    this.buttons = [];
    for (const o of this.objs) o.destroy();
    this.objs = [];
    this.rows = [];
    this.chips = [];
    this.lesson = [];
    this.dim = null;
    this.panel = null;
    this.totalText = null;
    this.totalLabel = null;
    this.creditText = null;
    this.gradeText = null;
    this.gradeFrame = null;
    this.gradeFlash = null;
    this.cb = null;
    this.result = null;
  }

  // ------------------------------------------------------------------ input

  private skip(): void {
    if (!this.visible || this.finished) return;
    // Jump to the end: no per-line ticks, just the final cash + grade stamp.
    this.t = this.tEnd;
    for (const r of this.rows) r.ticked = true;
    this.tick(0);
  }

  private handleKey(e: KeyboardEvent): void {
    if (!this.visible || e.repeat) return;
    const code = e.code;
    if (code === 'Enter' || code === 'NumpadEnter' || code === 'Space') {
      // Phaser's stopPropagation: the key does not reach scenes below (GameScene).
      e.stopPropagation();
      if (!this.finished) this.skip();
      else this.buttons[1]?.trigger();
    } else if (code === 'KeyR') {
      // GameScene binds R to reload too: stop it there so the level reloads once.
      e.stopPropagation();
      this.buttons[0]?.trigger();
    }
  }

  // ------------------------------------------------------------------ animation

  private tick(dt: number): void {
    if (!this.visible || !this.panel || !this.result) return;
    this.t += dt;
    const t = this.t;

    // Backdrop + panel entrance
    const pin = easeOutCubic(clamp01(t / T_PANEL));
    if (this.dim) this.dim.alpha = clamp01(t / 0.25);
    this.panel.alpha = pin;
    this.panel.y = this.H / 2 + (1 - pin) * 28;

    // Score lines: slide in, count up, tick.
    for (let i = 0; i < this.rows.length; i++) {
      const r = this.rows[i]!;
      const a = easeOutCubic(clamp01((t - r.start) / 0.22));
      for (const p of r.parts) p.alpha = a;
      r.label.x = r.x0 - (1 - a) * 14;
      if (r.detail) r.detail.x = r.label.x + r.label.width + 14;
      if (t >= r.start && !r.ticked) {
        r.ticked = true;
        this.audio.play('ui_click', { volume: 0.55, rate: 0.9 + i * 0.05 });
      }
      const v = Math.round(r.line.amount * easeOutCubic(clamp01((t - r.start) / LINE_COUNT)));
      if (v !== r.shown) {
        r.shown = v;
        r.amount.setText(r.line.kind === 'base' ? money(v) : signedMoney(v));
      }
    }

    // Total: count up with rising ticks, then pop + cash.
    const tk = clamp01((t - this.tTotal) / TOTAL_COUNT);
    if (this.totalText && this.totalLabel) {
      const tv = Math.round(this.result.total * easeOutCubic(tk));
      if (tv !== this.totalShown) {
        this.totalShown = tv;
        this.totalText.setText(money(tv));
        if (tk > 0 && tk < 1 && t - this.lastTick > 0.075 && dt > 0) {
          this.lastTick = t;
          this.audio.play('ui_click', { volume: 0.3, rate: 1 + tk * 0.6 });
        }
      }
      const pop = clamp01((t - this.tTotal - TOTAL_COUNT) / 0.35);
      this.totalText.setScale(tk >= 1 ? 1 + 0.14 * (1 - easeOutCubic(pop)) : 1);
      if (tk >= 1 && !this.cashPlayed) {
        this.cashPlayed = true;
        this.audio.play('cash');
        this.totalLabel.setColor(THEME.text);
      }
    }
    const la = easeOutCubic(clamp01((t - this.tTotal - 0.2) / 0.5));
    for (const o of this.lesson) o.alpha = la;
    if (this.creditText) this.creditText.alpha = easeOutCubic(clamp01((t - this.tTotal - TOTAL_COUNT) / 0.4));

    // Grade stamp
    if (this.gradeText && this.gradeFrame && this.gradeFlash) {
      const vis = t >= this.tGrade;
      const gk = clamp01((t - this.tGrade) / 0.24);
      this.gradeText.visible = vis;
      this.gradeText.setScale(2.4 - 1.4 * easeOutCubic(gk));
      this.gradeText.alpha = clamp01(gk * 2);
      this.gradeFrame.alpha = 0.3 + 0.7 * gk;
      const fl = clamp01((t - this.tGrade - 0.24) / 0.4);
      this.gradeFlash.fillAlpha = vis && gk >= 1 ? 0.4 * (1 - fl) : 0;
      if (vis && gk >= 1 && !this.gradePlayed) {
        this.gradePlayed = true;
        this.audio.play('ui_buy', { rate: this.result.grade === 'S' ? 1.12 : 1 });
      }
    }

    // Title chips pop in one after another.
    for (const ch of this.chips) {
      const k = easeOutCubic(clamp01((t - ch.at) / 0.25));
      ch.g.alpha = k;
      ch.text.alpha = k;
      ch.g.y = ch.y0 + (1 - k) * 10;
      ch.text.y = ch.y0 + 16 + (1 - k) * 10;
    }
  }
}
