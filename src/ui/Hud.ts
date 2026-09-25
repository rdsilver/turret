/**
 * In-game HUD (screen space, scrollFactor 0 on the UI camera/scene). OWNER: UI agent.
 * Shows level title/objective, shots vs par, money, objective progress bar,
 * reload + power, ammo name, scanner charges, short popups ("CHAIN x12") and
 * a big banner when the structure collapses. Minimal, readable, lab-style.
 *
 * Performance: text is only re-rasterised when its value changes; bars are
 * Rectangle shapes driven by scaleX; popups/banner are pooled and animated
 * from their age in update() (no per-frame allocations, no tween churn).
 */
import type * as Phaser from 'phaser';
import type { SimPhase } from '../sim/Simulation';
import { THEME, SIZE } from './theme';
import { display, mono, onUiFonts, setColorIfChanged, setTextIfChanged } from './text';
import { money, pad2 } from './format';
import { AMMO } from '../data/ammo';
import { UpgradeSystem } from '../game/UpgradeSystem';
import { gameState } from '../game/GameState';

export interface HudLevelInfo {
  index: number;
  total: number;
  name: string;
  subtitle: string;
  objective: string;
  par: number;
  /** Optional: lets the HUD label endless/seed/sandbox runs precisely (inferred when absent). */
  mode?: 'campaign' | 'sandbox' | 'seed' | 'endless';
}

export interface HudState {
  shots: number;
  par: number;
  money: number;
  /** Objective progress 0..1. */
  progress: number;
  /** Reload 0..1 (1 = ready). */
  reload: number;
  /** Power 0.35..1. */
  power: number;
  ammoName: string;
  ammoCost: number;
  scanCharges: number;
  scanActive: boolean;
  phase: SimPhase;
  sandbox: boolean;
  /** Optional: current ammo id (otherwise matched by name). */
  ammoId?: string;
}

type Text = Phaser.GameObjects.Text;
type Rect = Phaser.GameObjects.Rectangle;

const M = 48;
const POWER_SEGS = 14;
const POWER_MIN = 0.35;
const MAX_AMMO_PIPS = 4;

const easeOutCubic = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);
const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

interface Popup {
  text: Text;
  key: string;
  age: number;
  life: number;
  active: boolean;
  slot: number;
}

export class Hud {
  private readonly W: number;
  private readonly H: number;
  private readonly objs: Phaser.GameObjects.GameObject[] = [];
  private offFonts: () => void = () => {};

  // Level block (top-left)
  private readonly levelTag: Text;
  private readonly levelName: Text;
  private readonly levelSub: Text;
  private readonly objLabel: Text;
  private readonly objText: Text;
  private readonly levelRule: Rect;
  private readonly levelMark: Rect;
  private introT = 1;

  // Shots / progress (top-centre)
  private readonly shotsText: Text;
  private readonly progLabel: Text;
  private readonly progPct: Text;
  private readonly progFill: Rect;
  private readonly progW = 420;
  private progShown = 0;

  // Money (top-right)
  private readonly moneyText: Text;
  private moneyShown = Number.NaN;
  private moneyFrom = 0;
  private moneyTo = 0;
  private moneyT = 1;

  // Instrument strip (bottom-left)
  private readonly ammoDot: Phaser.GameObjects.Arc;
  private readonly ammoName: Text;
  private readonly ammoLabel: Text;
  private readonly ammoPips: Phaser.GameObjects.Arc[] = [];
  private readonly ammoPipRing: Phaser.GameObjects.Arc;
  private ammoIds: string[] = [];
  private readonly reloadFill: Rect;
  private readonly reloadText: Text;
  private readonly reloadW = 150;
  private readonly powerSegs: Rect[] = [];
  private readonly powerText: Text;
  private readonly scanKey: Phaser.GameObjects.Graphics;
  private readonly scanText: Text;

  // Hint (bottom-centre)
  private readonly hintBg: Phaser.GameObjects.Graphics;
  private readonly hintTag: Text;
  private readonly hintText: Text;
  private hintT = -1;

  // Popups + banner
  private readonly popups: Popup[] = [];
  private readonly bannerBand: Rect;
  private readonly bannerTitle: Text;
  private readonly bannerSub: Text;
  private readonly bannerRuleL: Rect;
  private readonly bannerRuleR: Rect;
  private bannerT = -1;

  // Last-shown values (update text only on change)
  private last = {
    shots: -1,
    par: -1,
    sandbox: false,
    pct: -1,
    phase: '' as string,
    reloadReady: -1,
    power: -1,
    ammo: '',
    cost: -1,
    scan: -1,
    scanActive: false,
  };

  constructor(readonly scene: Phaser.Scene) {
    this.W = scene.scale.width;
    this.H = scene.scale.height;
    const W = this.W;
    const H = this.H;
    const add = <T extends Phaser.GameObjects.GameObject>(o: T): T => {
      this.objs.push(o);
      return o;
    };

    // ---------------------------------------------------------------- top-left: level
    this.levelMark = add(scene.add.rectangle(M, 47, 8, 8, THEME.accentNum).setOrigin(0, 0.5));
    this.levelTag = add(mono(scene, M + 18, 47, '', SIZE.xs, THEME.textDim, { weight: 600, spacing: 2, originY: 0.5 }));
    this.levelName = add(display(scene, M - 2, 64, '', SIZE.xl + 4, THEME.text));
    this.levelSub = add(mono(scene, M, 112, '', SIZE.sm, THEME.textDim, { wrap: 560, lineSpacing: 3 }));
    this.levelRule = add(scene.add.rectangle(M, 146, 420, 1, THEME.rule).setOrigin(0, 0.5));
    this.objLabel = add(mono(scene, M, 158, 'OBJECTIVE', SIZE.micro, THEME.textFaint, { weight: 600, spacing: 2 }));
    this.objText = add(mono(scene, M, 178, '', SIZE.sm, THEME.text, { wrap: 560, lineSpacing: 4 }));

    // ---------------------------------------------------------------- top-centre: shots + progress
    const cx = W / 2;
    this.shotsText = add(mono(scene, cx, 44, '', SIZE.lg, THEME.text, { weight: 600, originX: 0.5, originY: 0.5 }));
    const py = 84;
    const pw = this.progW;
    add(scene.add.rectangle(cx - pw / 2, py, pw, 4, THEME.panelEdge).setOrigin(0, 0.5));
    this.progFill = add(scene.add.rectangle(cx - pw / 2, py, pw, 4, THEME.accentNum).setOrigin(0, 0.5));
    this.progFill.scaleX = 0;
    for (let i = 1; i < 4; i++) add(scene.add.rectangle(cx - pw / 2 + (pw * i) / 4, py + 6, 1, 4, THEME.rule).setOrigin(0.5, 0));
    add(scene.add.rectangle(cx + pw / 2, py, 2, 12, THEME.textDimNum).setOrigin(0.5, 0.5));
    this.progLabel = add(mono(scene, cx - pw / 2 - 14, py, 'OBJECTIVE', SIZE.micro, THEME.textDim, { weight: 600, spacing: 2, originX: 1, originY: 0.5 }));
    this.progPct = add(mono(scene, cx + pw / 2 + 14, py, '0%', SIZE.xs, THEME.text, { weight: 600, originY: 0.5 }));

    // ---------------------------------------------------------------- top-right: money
    add(mono(scene, W - M, 40, 'FUNDS', SIZE.micro, THEME.textFaint, { weight: 600, spacing: 2, originX: 1, originY: 0.5 }));
    this.moneyText = add(mono(scene, W - M, 70, '$0', SIZE.xl - 4, THEME.money, { weight: 800, originX: 1, originY: 0.5 }));

    // ---------------------------------------------------------------- bottom-left: instrument strip
    const sy = H - 58; // label row
    const vy = H - 32; // value row
    const strip = add(scene.add.graphics());
    strip.fillStyle(THEME.bgDeep, 0.72);
    strip.fillRoundedRect(M - 16, H - 78, 1040, 66, 4);
    strip.lineStyle(1, THEME.panelEdge, 1);
    strip.strokeRoundedRect(M - 15.5, H - 77.5, 1039, 65, 4);
    for (const x of [352, 612, 900]) {
      strip.fillStyle(THEME.panelEdge, 1);
      strip.fillRect(M + x - 20, H - 66, 1, 42);
    }

    // AMMO
    this.ammoLabel = add(mono(scene, M, sy, 'AMMO', SIZE.micro, THEME.textFaint, { weight: 600, spacing: 1, originY: 0.5 }));
    this.ammoDot = add(scene.add.circle(M + 6, vy, 6, 0xffffff));
    this.ammoDot.setStrokeStyle(1.5, THEME.textDimNum);
    this.ammoName = add(mono(scene, M + 20, vy, '', SIZE.md, THEME.text, { weight: 700, originY: 0.5 }));
    this.ammoPipRing = add(scene.add.circle(0, vy, 7));
    this.ammoPipRing.setStrokeStyle(1.5, THEME.accentNum).setVisible(false);
    for (let i = 0; i < MAX_AMMO_PIPS; i++) {
      const pip = add(scene.add.circle(M + 250 + i * 20, vy, 4, 0xffffff));
      pip.setVisible(false);
      this.ammoPips.push(pip);
    }

    // RELOAD
    const rx = M + 352;
    add(mono(scene, rx, sy, 'RELOAD', SIZE.micro, THEME.textFaint, { weight: 600, spacing: 1, originY: 0.5 }));
    add(scene.add.rectangle(rx, vy, this.reloadW, 6, THEME.panelEdge).setOrigin(0, 0.5));
    this.reloadFill = add(scene.add.rectangle(rx, vy, this.reloadW, 6, THEME.goodNum).setOrigin(0, 0.5));
    this.reloadText = add(mono(scene, rx + this.reloadW + 12, vy, 'READY', SIZE.xs, THEME.good, { weight: 600, originY: 0.5 }));

    // POWER
    const px = M + 612;
    add(mono(scene, px, sy, 'POWER', SIZE.micro, THEME.textFaint, { weight: 600, spacing: 1, originY: 0.5 }));
    add(mono(scene, px + 196, sy, 'WHEEL · W/S', SIZE.micro - 2, THEME.textFaint, { originX: 1, originY: 0.5 }));
    for (let i = 0; i < POWER_SEGS; i++) {
      const seg = add(scene.add.rectangle(px + i * 14, vy, 10, 14, THEME.panelEdge).setOrigin(0, 0.5));
      this.powerSegs.push(seg);
    }
    this.powerText = add(mono(scene, px + POWER_SEGS * 14 + 10, vy, '', SIZE.xs, THEME.text, { weight: 600, originY: 0.5 }));

    // SCANNER
    const scx = M + 900;
    add(mono(scene, scx, sy, 'SCANNER', SIZE.micro, THEME.textFaint, { weight: 600, spacing: 1, originY: 0.5 }));
    this.scanKey = add(scene.add.graphics({ x: scx, y: vy }));
    add(mono(scene, scx + 11, vy, 'S', SIZE.micro, THEME.textDim, { weight: 700, originX: 0.5, originY: 0.5 }));
    this.scanText = add(mono(scene, scx + 30, vy, '', SIZE.xs, THEME.text, { weight: 600, originY: 0.5 }));

    // ---------------------------------------------------------------- hint (bottom-centre, above the strip)
    this.hintBg = add(scene.add.graphics());
    this.hintTag = add(mono(scene, 0, H - 118, 'HINT', SIZE.micro, THEME.accent, { weight: 700, spacing: 2, originY: 0.5 }));
    this.hintText = add(mono(scene, 0, H - 118, '', SIZE.sm, THEME.text, { originY: 0.5 }));
    this.setHintAlpha(0);

    // ---------------------------------------------------------------- popups
    for (let i = 0; i < 4; i++) {
      const t = add(mono(scene, cx, 150, '', SIZE.xl - 4, THEME.accent, { weight: 800, originX: 0.5, originY: 0.5 }));
      t.setVisible(false).setDepth(20);
      this.popups.push({ text: t, key: '', age: 0, life: 1.3, active: false, slot: 0 });
    }

    // ---------------------------------------------------------------- banner
    const by = Math.round(H * 0.36);
    this.bannerBand = add(scene.add.rectangle(0, by + 14, W, 196, THEME.bgDeep, 0.55).setOrigin(0, 0.5).setDepth(30));
    this.bannerRuleL = add(scene.add.rectangle(cx - 40, by + 74, 520, 2, THEME.accentNum).setOrigin(1, 0.5).setDepth(31));
    this.bannerRuleR = add(scene.add.rectangle(cx + 40, by + 74, 520, 2, THEME.accentNum).setOrigin(0, 0.5).setDepth(31));
    this.bannerTitle = add(display(scene, cx, by, '', SIZE.xxl + 28, THEME.text, { spacing: 3, originX: 0.5, originY: 0.5 }).setDepth(32));
    this.bannerSub = add(mono(scene, cx, by + 74, '', SIZE.md, THEME.accent, { weight: 700, spacing: 6, originX: 0.5, originY: 0.5 }).setDepth(32));
    this.setBannerVisible(false);

    this.offFonts = onUiFonts(() => {
      this.layoutHint();
      this.layoutLevel();
    });
  }

  setLevel(info: HudLevelInfo): void {
    const mode = info.mode ?? (info.index > 0 ? 'campaign' : info.name === 'Sandbox' ? 'sandbox' : 'seed');
    const tag =
      info.index > 0 ? `LEVEL ${pad2(info.index)} / ${pad2(info.total)}` : mode === 'sandbox' ? 'SANDBOX · TESTBED' : mode === 'endless' ? 'ENDLESS · SEEDED STRUCTURE' : 'SEEDED STRUCTURE';
    setTextIfChanged(this.levelTag, tag);
    setTextIfChanged(this.levelName, info.name);
    setTextIfChanged(this.levelSub, info.subtitle);
    setTextIfChanged(this.objText, info.objective || '—');
    this.layoutLevel();
    this.last.shots = -1; // force shots line refresh (par may have changed)
    this.last.pct = -1;
    this.progShown = 0;
    this.progFill.scaleX = 0;
    this.introT = 0;
    this.hint('');
    // Unlocked ammo (for the loadout pips). Cheap: runs once per level load.
    try {
      this.ammoIds = new UpgradeSystem().unlockedAmmo(gameState().upgrades).filter((id) => !!AMMO[id]);
    } catch {
      this.ammoIds = ['standard'];
    }
    this.last.ammo = '';
  }

  update(state: HudState, realDt: number): void {
    const dt = realDt > 0.1 ? 0.1 : realDt;
    const L = this.last;

    // Level intro: slide the title block in.
    if (this.introT < 1) {
      this.introT = Math.min(1, this.introT + dt / 0.55);
      const k = easeOutCubic(this.introT);
      const off = (1 - k) * -28;
      this.levelName.x = M - 2 + off;
      this.levelName.alpha = k;
      this.levelSub.x = M + off * 0.6;
      this.levelSub.alpha = k;
      this.objText.alpha = clamp01(this.introT * 1.6 - 0.4);
      this.objLabel.alpha = this.objText.alpha;
      this.levelMark.scaleY = k;
      this.levelRule.scaleX = k;
    }

    // Shots vs par
    if (state.shots !== L.shots || state.par !== L.par || state.sandbox !== L.sandbox) {
      L.shots = state.shots;
      L.par = state.par;
      L.sandbox = state.sandbox;
      setTextIfChanged(this.shotsText, state.sandbox ? `SHOTS ${state.shots}` : `SHOTS ${state.shots} / PAR ${state.par}`);
      const over = !state.sandbox && state.shots > state.par;
      setColorIfChanged(this.shotsText, over ? (state.shots > state.par + 2 ? THEME.bad : THEME.accent) : state.shots === 0 ? THEME.textDim : THEME.text);
      if (state.shots > 0) this.pulse(this.shotsText);
    }

    // Objective progress (smoothed)
    const target = clamp01(state.progress);
    const d = target - this.progShown;
    if (Math.abs(d) > 0.0005) {
      this.progShown += d * Math.min(1, dt * 8);
      if (Math.abs(target - this.progShown) < 0.002) this.progShown = target;
      this.progFill.scaleX = this.progShown;
    }
    const pct = Math.floor(this.progShown * 100 + 0.0001);
    if (pct !== L.pct) {
      L.pct = pct;
      this.progPct.setText(`${pct}%`);
      const done = pct >= 100;
      this.progFill.fillColor = done ? THEME.goodNum : THEME.accentNum;
      setColorIfChanged(this.progPct, done ? THEME.good : THEME.text);
    }
    if (state.phase !== L.phase) {
      L.phase = state.phase;
      const label = state.phase === 'collapsing' ? 'COLLAPSING' : state.phase === 'settled' ? 'SETTLED' : 'OBJECTIVE';
      setTextIfChanged(this.progLabel, label);
      setColorIfChanged(this.progLabel, state.phase === 'collapsing' ? THEME.accent : THEME.textDim);
    }

    // Money (count towards the new value)
    if (state.money !== this.moneyTo || Number.isNaN(this.moneyShown)) {
      if (Number.isNaN(this.moneyShown)) {
        this.moneyShown = this.moneyFrom = this.moneyTo = state.money;
        this.moneyT = 1;
        this.moneyText.setText(money(state.money));
      } else {
        this.moneyFrom = this.moneyShown;
        this.moneyTo = state.money;
        this.moneyT = 0;
      }
    }
    if (this.moneyT < 1) {
      this.moneyT = Math.min(1, this.moneyT + dt / 0.9);
      const v = Math.round(this.moneyFrom + (this.moneyTo - this.moneyFrom) * easeOutCubic(this.moneyT));
      if (v !== this.moneyShown) {
        this.moneyShown = v;
        this.moneyText.setText(money(v));
      }
      if (this.moneyT >= 1) this.pulse(this.moneyText);
    }

    // Ammo
    if (state.ammoName !== L.ammo || state.ammoCost !== L.cost) {
      L.ammo = state.ammoName;
      L.cost = state.ammoCost;
      this.ammoName.setText(state.ammoName.toUpperCase());
      setTextIfChanged(this.ammoLabel, `AMMO · $${state.ammoCost}/SHOT${this.ammoIds.length > 1 ? ' · Q/E' : ''}`);
      let color = 0xd8dde6;
      let sel = -1;
      for (let i = 0; i < this.ammoIds.length; i++) {
        const id = this.ammoIds[i]!;
        const a = AMMO[id];
        if (state.ammoId ? id === state.ammoId : a && a.name === state.ammoName) sel = i;
      }
      for (const id in AMMO) if (state.ammoId ? id === state.ammoId : AMMO[id]!.name === state.ammoName) color = pipColor(AMMO[id]!.color);
      this.ammoDot.fillColor = color;
      const pipX = M + 20 + Math.max(170, this.ammoName.width + 22);
      for (let i = 0; i < MAX_AMMO_PIPS; i++) {
        const pip = this.ammoPips[i]!;
        const id = this.ammoIds[i];
        const show = this.ammoIds.length > 1 && !!id;
        pip.setVisible(show);
        if (!show) continue;
        pip.x = pipX + i * 20;
        pip.fillColor = pipColor(AMMO[id!]!.color);
        pip.alpha = i === sel ? 1 : 0.45;
      }
      this.ammoPipRing.setVisible(sel >= 0 && this.ammoIds.length > 1);
      if (sel >= 0) this.ammoPipRing.x = pipX + sel * 20;
    }

    // Reload
    const r = clamp01(state.reload);
    if (Math.abs(this.reloadFill.scaleX - r) > 0.002) this.reloadFill.scaleX = r;
    const ready = r >= 0.999 ? 1 : 0;
    if (ready !== L.reloadReady) {
      L.reloadReady = ready;
      this.reloadText.setText(ready ? 'READY' : 'LOADING');
      setColorIfChanged(this.reloadText, ready ? THEME.good : THEME.textDim);
      this.reloadFill.fillColor = ready ? THEME.goodNum : THEME.textDimNum;
    }

    // Power
    const pw = Math.round(clamp01(state.power) * 100);
    if (pw !== L.power) {
      L.power = pw;
      this.powerText.setText(`${pw}%`);
      const lit = Math.round(((pw / 100 - POWER_MIN) / (1 - POWER_MIN)) * (POWER_SEGS - 1)) + 1;
      for (let i = 0; i < POWER_SEGS; i++) {
        const on = i < lit;
        // Warm up towards the top of the range.
        this.powerSegs[i]!.fillColor = on ? (i >= POWER_SEGS - 3 ? THEME.accentNum : THEME.textNum) : THEME.panelEdge;
        this.powerSegs[i]!.alpha = on ? 0.55 + 0.45 * (i / (POWER_SEGS - 1)) : 1;
      }
    }

    // Scanner
    if (state.scanCharges !== L.scan || state.scanActive !== L.scanActive) {
      L.scan = state.scanCharges;
      L.scanActive = state.scanActive;
      const infinite = state.sandbox;
      const txt = state.scanActive ? 'SCANNING' : infinite ? 'SCAN ∞' : `SCAN ×${state.scanCharges}`;
      this.scanText.setText(txt);
      const col = state.scanActive ? THEME.info : state.scanCharges > 0 || infinite ? THEME.text : THEME.textFaint;
      setColorIfChanged(this.scanText, col);
      const g = this.scanKey;
      g.clear();
      if (state.scanActive) {
        g.fillStyle(THEME.infoNum, 0.2);
        g.fillRoundedRect(0, -11, 22, 22, 3);
      }
      g.lineStyle(1, state.scanActive ? THEME.infoNum : THEME.rule, 1);
      g.strokeRoundedRect(0.5, -10.5, 21, 21, 3);
    }
    if (state.scanActive) this.scanText.alpha = 0.65 + 0.35 * Math.sin(this.scene.time.now * 0.012);
    else if (this.scanText.alpha !== 1) this.scanText.alpha = 1;

    // Hint fade
    if (this.hintT >= 0 && this.hintT < 1) {
      this.hintT = Math.min(1, this.hintT + dt / 0.4);
      this.setHintAlpha(easeOutCubic(this.hintT));
    }

    this.updatePopups(dt);
    this.updateBanner(dt);
  }

  /** Short popup near the top center (chain counters, "+$40"). */
  flash(text: string, color?: string): void {
    const key = popupKey(text);
    const col = color ?? THEME.accent;
    // Same kind of message already on screen (e.g. a growing chain counter): retarget it.
    let p = this.popups.find((q) => q.active && q.key === key && q.age < q.life - 0.3);
    if (!p) {
      p = this.popups.find((q) => !q.active) ?? this.popups.reduce((a, b) => (a.age > b.age ? a : b));
      // Stack below any popups still showing.
      let slot = 0;
      for (const q of this.popups) if (q.active && q !== p) slot = Math.max(slot, q.slot + 1);
      p.slot = slot > 2 ? 0 : slot;
    }
    p.key = key;
    p.age = 0;
    p.active = true;
    p.life = 1.35;
    setTextIfChanged(p.text, text);
    setColorIfChanged(p.text, col);
    p.text.setVisible(true);
  }

  /** Big centered title (e.g. "STRUCTURE COLLAPSED"). */
  banner(title: string, subtitle?: string): void {
    setTextIfChanged(this.bannerTitle, title.toUpperCase());
    setTextIfChanged(this.bannerSub, (subtitle ?? '').toUpperCase());
    this.bannerT = 0;
    this.setBannerVisible(true);
    this.updateBanner(0);
  }

  /** Contextual hint line near the bottom. Empty string hides it. */
  hint(text: string): void {
    if (!text) {
      this.hintT = -1;
      this.setHintAlpha(0);
      return;
    }
    setTextIfChanged(this.hintText, text);
    this.layoutHint();
    this.hintT = 0;
  }

  destroy(): void {
    this.offFonts();
    this.scene.tweens?.killTweensOf(this.objs);
    for (const o of this.objs) o.destroy();
    this.objs.length = 0;
    this.popups.length = 0;
  }

  // ------------------------------------------------------------------ internals

  private pulse(t: Text): void {
    const tw = this.scene.tweens;
    tw.killTweensOf(t);
    t.setScale(1.18);
    tw.add({ targets: t, scale: 1, duration: 260, ease: 'Cubic.easeOut' });
  }

  /** Stack the top-left block (name, subtitle, rule, objective) by measured heights. */
  private layoutLevel(): void {
    let y = 64 + this.levelName.height + 2;
    this.levelSub.y = y;
    y += this.levelSub.height + 14;
    this.levelRule.y = y;
    this.objLabel.y = y + 12;
    this.objText.y = y + 32;
  }

  private layoutHint(): void {
    const H = this.H;
    const gap = 14;
    const w = this.hintTag.width + gap + this.hintText.width;
    const x0 = Math.round(this.W / 2 - w / 2);
    this.hintTag.x = x0;
    this.hintText.x = x0 + this.hintTag.width + gap;
    const g = this.hintBg;
    g.clear();
    if (!this.hintText.text) return;
    g.fillStyle(THEME.bgDeep, 0.82);
    g.fillRoundedRect(x0 - 18, H - 138, w + 36, 40, 4);
    g.lineStyle(1, THEME.accentNum, 0.5);
    g.strokeRoundedRect(x0 - 17.5, H - 137.5, w + 35, 39, 4);
  }

  private setHintAlpha(a: number): void {
    this.hintBg.alpha = a;
    this.hintTag.alpha = a;
    this.hintText.alpha = a;
    const vis = a > 0.001;
    this.hintBg.visible = vis;
    this.hintTag.visible = vis;
    this.hintText.visible = vis;
    if (vis) {
      const off = (1 - a) * 8;
      this.hintTag.y = this.H - 118 + off;
      this.hintText.y = this.H - 118 + off;
      this.hintBg.y = off;
    }
  }

  private updatePopups(dt: number): void {
    for (const p of this.popups) {
      if (!p.active) continue;
      p.age += dt;
      const t = p.age;
      if (t >= p.life) {
        p.active = false;
        p.text.setVisible(false);
        continue;
      }
      // Pop in (overshoot), hold, then drift up and fade.
      const popIn = clamp01(t / 0.2);
      const scale = t < 0.2 ? 1.6 - 0.6 * easeOutBack(popIn) : 1;
      const out = clamp01((t - (p.life - 0.45)) / 0.45);
      p.text.setScale(scale);
      p.text.alpha = Math.min(clamp01(t / 0.06), 1 - out);
      p.text.y = 150 + p.slot * 46 - out * 22;
    }
  }

  private setBannerVisible(v: boolean): void {
    this.bannerBand.visible = v;
    this.bannerTitle.visible = v;
    this.bannerSub.visible = v;
    this.bannerRuleL.visible = v;
    this.bannerRuleR.visible = v;
  }

  private updateBanner(dt: number): void {
    if (this.bannerT < 0) return;
    this.bannerT += dt;
    const t = this.bannerT;
    const HOLD = 2.5;
    const FADE = 0.5;
    if (t > HOLD + FADE) {
      this.bannerT = -1;
      this.setBannerVisible(false);
      return;
    }
    const fadeOut = 1 - clamp01((t - HOLD) / FADE);
    // Slam: large -> 1 fast, tiny settle.
    const s = clamp01(t / 0.22);
    const scale = t < 0.22 ? 2.1 - 1.1 * easeOutCubic(s) : 1 + 0.025 * Math.exp(-(t - 0.22) * 9) * Math.cos((t - 0.22) * 40);
    this.bannerTitle.setScale(scale);
    this.bannerTitle.alpha = clamp01(t / 0.12) * fadeOut;
    this.bannerBand.alpha = 0.55 * clamp01(t / 0.18) * fadeOut;
    this.bannerBand.scaleY = 0.6 + 0.4 * easeOutCubic(clamp01(t / 0.25));
    const rule = easeOutCubic(clamp01((t - 0.16) / 0.45));
    const hasSub = this.bannerSub.text.length > 0;
    const gap = hasSub ? this.bannerSub.width / 2 + 28 : 0;
    this.bannerRuleL.x = this.W / 2 - gap;
    this.bannerRuleR.x = this.W / 2 + gap;
    this.bannerRuleL.scaleX = rule;
    this.bannerRuleR.scaleX = rule;
    this.bannerRuleL.alpha = fadeOut * 0.9;
    this.bannerRuleR.alpha = fadeOut * 0.9;
    this.bannerSub.alpha = clamp01((t - 0.2) / 0.3) * fadeOut;
    this.bannerSub.y = Math.round(this.H * 0.36) + 74 + (1 - easeOutCubic(clamp01((t - 0.2) / 0.3))) * 10;
  }
}

/** "CHAIN ×12" -> "CHAIN"; "+$40" -> "+$". Popups with the same key replace each other. */
function popupKey(text: string): string {
  let i = 0;
  while (i < text.length) {
    const c = text.charCodeAt(i);
    if (c === 32 || (c >= 48 && c <= 57) || c === 215) break;
    i++;
  }
  return text.slice(0, i) || text;
}

/** Ammo colours can be very dark (iron): lift them so the pip reads on the dark UI. */
function pipColor(c: number): number {
  const r = (c >> 16) & 255;
  const g = (c >> 8) & 255;
  const b = c & 255;
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum < 90 ? 0xd8dde6 : c;
}

