/**
 * Between-level workshop. OWNER: UI agent.
 * Shows money, the upgrade catalogue grouped by branch (only branches with
 * defs), each card with name, description, level pips, "from -> to" preview
 * (UpgradeSystem.preview), cost and BUY button (disabled if unaffordable /
 * maxed / locked). Ammo selector for unlocked ammo (sets gameState().selectedAmmo).
 * A "NEXT: <level name>" panel with the next level's subtitle, and a DEPLOY
 * button -> this.scene.start('Game', { mode: 'campaign' }). Save on every purchase.
 * If the campaign is complete (levelIndex >= levelManager.count) say so and
 * deploy into procedural levels.
 *
 * Layout: one column per branch (a small tech tree). The catalogue is drawn
 * by its own camera (viewport = catalogue rect) so it clips and scrolls with
 * the mouse wheel when a branch is taller than the screen.
 */
import * as Phaser from 'phaser';
import { ASSAULT_LEVELS } from '../data/assault/levels';
import { THEME, SIZE, GRADE_COLOR, css } from '../ui/theme';
import { display, loadUiFonts, mono, onUiFonts, setColorIfChanged, setTextIfChanged } from '../ui/text';
import { money, pad2 } from '../ui/format';
import { Button } from '../ui/Button';
import { onceEach } from '../ui/keys';
import { LabBackdrop } from '../ui/LabBackdrop';
import { AudioManager } from '../audio/AudioManager';
import { gameState } from '../game/GameState';
import { levelManager } from '../game/LevelManager';
import { UpgradeSystem } from '../game/UpgradeSystem';
import type { UpgradeDef, UpgradeBranch } from '../data/upgrades';
import { AMMO } from '../data/ammo';

type Text = Phaser.GameObjects.Text;

const BRANCH_ORDER: UpgradeBranch[] = ['core', 'heavy', 'rapid', 'precision', 'demolition', 'experimental'];
const BRANCH_LABEL: Record<string, string> = {
  core: 'CANNON',
  heavy: 'HEAVY ORDNANCE',
  rapid: 'RAPID FIRE',
  precision: 'PRECISION',
  demolition: 'DEMOLITION',
  experimental: 'EXPERIMENTAL',
};

// Catalogue viewport (screen space).
const CAT = { x: 72, y: 196, w: 1340, h: 858 };
const COL_GAP = 20;
const CARD_H = 196;
const CARD_GAP = 10;
const HEAD_H = 40;
const MAX_COLS = 4;

const SIDE = { x: 1460, w: 388 };

interface Card {
  def: UpgradeDef;
  root: Phaser.GameObjects.Container;
  bg: Phaser.GameObjects.Graphics;
  name: Text;
  desc: Text;
  pips: Phaser.GameObjects.Graphics;
  lvl: Text;
  tag: Text;
  pvLabel: Text;
  pvFrom: Text;
  pvArrow: Text;
  pvTo: Text;
  cost: Text;
  note: Text;
  buy: Button;
  w: number;
  flash: number;
}

interface AmmoRow {
  id: string;
  btn: Button;
  dot: Phaser.GameObjects.Arc;
}

export class UpgradeScene extends Phaser.Scene {
  private upg = new UpgradeSystem();
  private audio!: AudioManager;
  private backdrop!: LabBackdrop;
  private cards: Card[] = [];
  private ammoRows: AmmoRow[] = [];
  private buttons: Button[] = [];
  private catalog!: Phaser.GameObjects.Container;
  private catCam!: Phaser.Cameras.Scene2D.Camera;
  private contentH = 0;
  private scrollY = 0;
  private scrollTarget = 0;
  private scrollThumb!: Phaser.GameObjects.Rectangle;
  private moneyText!: Text;
  private moneyShown = 0;
  private moneyFrom = 0;
  private moneyT = 1;
  private specTexts: Array<{ key: string; label: Text; value: Text; last: string; flash: number }> = [];
  private ammoDesc!: Text;
  private investedText: Text | null = null;
  /** Bottom edge of the SERVICE RECORD table (the NEXT DEPLOYMENT panel stays below it). */
  private recordBottom = 0;
  private leaving = false;
  private offFonts: () => void = () => {};

  constructor() {
    super('Upgrade');
  }

  /** Which campaign the workshop deploys back into. */
  private mode: 'assault' | 'campaign' = 'assault';

  init(data: { mode?: 'assault' | 'campaign' }): void {
    this.mode = data?.mode ?? 'assault';
  }

  create(): void {
    void loadUiFonts();
    this.upg = new UpgradeSystem();
    this.cards = [];
    this.ammoRows = [];
    this.buttons = [];
    this.specTexts = [];
    this.investedText = null;
    this.leaving = false;
    this.scrollY = this.scrollTarget = 0;
    this.moneyT = 1;
    this.audio = new AudioManager(this);
    this.backdrop = new LabBackdrop(this);
    const gs = gameState();
    const W = this.scale.width;

    // ------------------------------------------------------------ header
    this.add.rectangle(CAT.x, 50, 10, 10, THEME.accentNum).setOrigin(0, 0.5);
    mono(this, CAT.x + 22, 50, 'BETWEEN DEPLOYMENTS · FIELD WORKSHOP', SIZE.xs, THEME.textDim, { weight: 600, spacing: 4, originY: 0.5 });
    display(this, CAT.x - 3, 66, 'WORKSHOP', SIZE.xxl, THEME.text, { spacing: 4 });
    mono(this, W - 72, 50, 'FUNDS', SIZE.micro, THEME.textFaint, { weight: 600, spacing: 3, originX: 1, originY: 0.5 });
    this.moneyShown = gs.money;
    this.moneyText = display(this, W - 72, 94, money(gs.money), SIZE.xxl - 4, THEME.money, { originX: 1, originY: 0.5 });

    // Weapon spec readout
    this.add.rectangle(CAT.x, 140, W - 144, 1, THEME.panelEdge).setOrigin(0, 0.5);
    mono(this, CAT.x, 140, 'CANNON SPEC ', SIZE.micro - 1, THEME.textFaint, { weight: 700, spacing: 3, originY: 0.5 }).setBackgroundColor(css(THEME.bg));
    this.buildSpecStrip(CAT.x, 166);

    // ------------------------------------------------------------ catalogue
    this.catalog = this.add.container(0, 0);
    this.buildCatalogue();
    this.catCam = this.cameras.add(CAT.x, CAT.y, CAT.w + 12, CAT.h, false, 'catalogue');
    this.catCam.setScroll(0, 0);
    this.cameras.main.ignore(this.catalog);
    this.add.rectangle(CAT.x + CAT.w + 26, CAT.y, 2, CAT.h, THEME.panelEdge).setOrigin(0.5, 0);
    this.scrollThumb = this.add.rectangle(CAT.x + CAT.w + 26, CAT.y, 4, 60, THEME.textDimNum).setOrigin(0.5, 0);
    const scrollable = this.contentH > CAT.h;
    this.scrollThumb.setVisible(scrollable);
    this.scrollThumb.height = Math.max(40, (CAT.h * CAT.h) / Math.max(CAT.h, this.contentH));
    this.input.on('wheel', (p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      if (p.x < CAT.x || p.x > CAT.x + CAT.w + 40 || p.y < CAT.y || p.y > CAT.y + CAT.h) return;
      this.scrollTarget = Phaser.Math.Clamp(this.scrollTarget + dy * 0.8, 0, Math.max(0, this.contentH - CAT.h));
    });

    // ------------------------------------------------------------ sidebar
    this.buildAmmo();
    this.buildNext();

    // Keyboard
    const kb = this.input.keyboard;
    // onceEach: Phaser can deliver the same keydown more than once per frame (see ui/keys.ts).
    kb?.on('keydown', onceEach((e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.code.startsWith('Digit')) {
        const row = this.ammoRows[Number(e.code.slice(5)) - 1];
        if (row) row.btn.trigger();
      } else if (e.code === 'ArrowDown' || e.code === 'PageDown') {
        this.scrollTarget = Phaser.Math.Clamp(this.scrollTarget + 240, 0, Math.max(0, this.contentH - CAT.h));
      } else if (e.code === 'ArrowUp' || e.code === 'PageUp') {
        this.scrollTarget = Phaser.Math.Clamp(this.scrollTarget - 240, 0, Math.max(0, this.contentH - CAT.h));
      }
    }));

    this.refreshAll();
    this.isolateCatalogue();
    this.offFonts = onUiFonts(() => this.refreshAll());
    for (const c of this.cameras.cameras) c.fadeIn(300, 13, 15, 18);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
  }

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.1, deltaMs / 1000);
    this.backdrop.update(dt);

    // Smooth scroll
    const d = this.scrollTarget - this.scrollY;
    if (Math.abs(d) > 0.5) {
      this.scrollY += d * Math.min(1, dt * 14);
      this.catCam.setScroll(0, this.scrollY);
      const max = Math.max(1, this.contentH - CAT.h);
      const th = Math.max(40, (CAT.h * CAT.h) / this.contentH);
      this.scrollThumb.height = th;
      this.scrollThumb.y = CAT.y + (this.scrollY / max) * (CAT.h - th);
    }

    // Money count
    if (this.moneyT < 1) {
      this.moneyT = Math.min(1, this.moneyT + dt / 0.5);
      const to = gameState().money;
      const k = 1 - Math.pow(1 - this.moneyT, 3);
      const v = Math.round(this.moneyFrom + (to - this.moneyFrom) * k);
      if (v !== this.moneyShown) {
        this.moneyShown = v;
        this.moneyText.setText(money(v));
      }
    }

    // Card purchase flashes
    for (const c of this.cards) {
      if (c.flash > 0) {
        c.flash = Math.max(0, c.flash - dt / 0.6);
        this.drawCardBg(c);
      }
    }
    for (const s of this.specTexts) {
      if (s.flash > 0) {
        s.flash = Math.max(0, s.flash - dt / 1.2);
        setColorIfChanged(s.value, s.flash > 0 ? THEME.good : THEME.text);
      }
    }
  }

  // ------------------------------------------------------------------ catalogue

  private buildCatalogue(): void {
    const defs = this.upg.defs;
    const branches = BRANCH_ORDER.filter((b) => defs.some((d) => d.branch === b));
    // Branches not in our order list (future data) go last.
    for (const d of defs) if (!branches.includes(d.branch)) branches.push(d.branch);

    if (!defs.length) {
      const t = mono(this, 0, 20, 'No upgrades are available in this build.', SIZE.md, THEME.textDim);
      this.catalog.add(t);
      this.contentH = 80;
      return;
    }

    const cols = Math.min(MAX_COLS, branches.length);
    const colW = Math.floor((CAT.w - COL_GAP * (cols - 1)) / cols);
    let bandY = 0;
    let bandH = 0;
    branches.forEach((branch, i) => {
      const col = i % cols;
      if (col === 0 && i > 0) {
        bandY += bandH + 28;
        bandH = 0;
      }
      const x = col * (colW + COL_GAP);
      const list = defs.filter((d) => d.branch === branch);
      // Column header
      const head = mono(this, x, bandY + 10, BRANCH_LABEL[branch] ?? branch.toUpperCase(), SIZE.xs, THEME.textDim, { weight: 700, spacing: 3, originY: 0.5 });
      const count = mono(this, x + colW, bandY + 10, `${list.length} ${list.length === 1 ? 'SYSTEM' : 'SYSTEMS'}`, SIZE.micro, THEME.textFaint, { originX: 1, originY: 0.5 });
      const rule = this.add.rectangle(x, bandY + 28, colW, 1, THEME.rule).setOrigin(0, 0.5);
      const tick = this.add.rectangle(x, bandY + 28, 28, 3, THEME.accentNum).setOrigin(0, 0.5);
      this.catalog.add([head, count, rule, tick]);
      let y = bandY + HEAD_H;
      for (const def of list) {
        this.cards.push(this.buildCard(def, x, y, colW));
        y += CARD_H + CARD_GAP;
      }
      bandH = Math.max(bandH, y - CARD_GAP - bandY);
    });
    this.contentH = bandY + bandH;
  }

  private buildCard(def: UpgradeDef, x: number, y: number, w: number): Card {
    const root = this.add.container(x, y);
    this.catalog.add(root);
    const bg = this.add.graphics();
    const name = mono(this, 18, 14, def.name, SIZE.md - 1, THEME.text, { weight: 700 });
    const tag = mono(this, w - 16, 17, '', SIZE.micro - 1, THEME.textDim, { weight: 700, spacing: 2, originX: 1 });
    const pips = this.add.graphics({ x: 18, y: 47 });
    const lvl = mono(this, 18, 47, '', SIZE.micro - 1, THEME.textDim, { weight: 600, originY: 0.5 });
    const desc = mono(this, 18, 60, '', SIZE.micro, THEME.textDim, { wrap: w - 36, lineSpacing: 2 });
    setEllipsized(desc, def.description, 3);
    const pvLabel = mono(this, 18, 114, '', SIZE.micro - 1, THEME.textFaint, { weight: 600 });
    const pvFrom = mono(this, 18, 130, '', SIZE.sm, THEME.textDim, { weight: 600 });
    const pvArrow = mono(this, 0, 130, '→', SIZE.sm, THEME.textFaint, { weight: 600 });
    const pvTo = mono(this, 0, 130, '', SIZE.sm, THEME.good, { weight: 700 });
    const cost = mono(this, 18, CARD_H - 21, '', SIZE.lg - 4, THEME.money, { weight: 800, originY: 0.5 });
    const note = mono(this, 18, CARD_H - 21, '', SIZE.micro - 1, THEME.textDim, { weight: 600, spacing: 1, originY: 0.5 });
    const card: Card = { def, root, bg, name, desc, pips, lvl, tag, pvLabel, pvFrom, pvArrow, pvTo, cost, note, buy: null as unknown as Button, w, flash: 0 };
    card.buy = new Button(this, {
      x: w - 14 - 62,
      y: CARD_H - 21,
      width: 124,
      height: 32,
      label: 'BUY',
      variant: 'secondary',
      fontSize: SIZE.sm,
      audio: this.audio,
      sound: null,
      onClick: () => this.buy(card),
    });
    root.add([bg, name, tag, pips, lvl, desc, pvLabel, pvFrom, pvArrow, pvTo, cost, note, card.buy.container]);
    this.buttons.push(card.buy);
    return card;
  }

  private cardState(def: UpgradeDef): { level: number; cost: number | null; maxed: boolean; locked: string | null; affordable: boolean } {
    const gs = gameState();
    const owned = gs.upgrades;
    const level = owned[def.id] ?? 0;
    const maxed = level >= def.maxLevel;
    let locked: string | null = null;
    const req = def.requires;
    if (req && (owned[req.id] ?? 0) < req.level) {
      const rd = this.upg.defs.find((d) => d.id === req.id);
      const rn = rd?.name ?? req.id;
      locked = rd && rd.maxLevel > 1 ? `REQUIRES ${rn.toUpperCase()} LV${req.level}` : `REQUIRES ${rn.toUpperCase()}`;
    }
    const cost = maxed || locked ? null : this.upg.nextCost(def.id, owned);
    return { level, cost, maxed, locked, affordable: cost !== null && gs.money >= cost };
  }

  private refreshCard(c: Card): void {
    const st = this.cardState(c.def);
    const gs = gameState();

    // Level pips
    const g = c.pips;
    g.clear();
    const n = c.def.maxLevel;
    const pw = n > 6 ? 10 : 18;
    for (let i = 0; i < n; i++) {
      const px = i * (pw + 4);
      if (i < st.level) {
        g.fillStyle(st.maxed ? THEME.goodNum : THEME.accentNum, 1);
        g.fillRect(px, -3, pw, 6);
      } else {
        g.lineStyle(1, i === st.level && !st.locked ? THEME.textDimNum : THEME.rule, 1);
        g.strokeRect(px + 0.5, -2.5, pw - 1, 5);
      }
    }
    c.lvl.x = 18 + n * (pw + 4) + 8;
    setTextIfChanged(c.lvl, n > 1 ? `LV ${st.level}/${n}` : st.level ? 'INSTALLED' : 'NOT INSTALLED');

    // Tag (top-right)
    const tag = st.maxed ? 'MAXED' : st.locked ? 'LOCKED' : c.def.unlocksAmmo && st.level === 0 ? 'NEW AMMO' : '';
    setTextIfChanged(c.tag, tag);
    setColorIfChanged(c.tag, st.maxed ? THEME.good : st.locked ? THEME.textFaint : THEME.accent);

    // Preview
    let pv: { label: string; from: string; to: string } | null = null;
    try {
      pv = this.upg.preview(c.def.id, gs.upgrades);
    } catch {
      pv = null;
    }
    setTextIfChanged(c.pvLabel, pv ? pv.label : '');
    if (pv) {
      if (st.maxed || pv.from === pv.to) {
        setTextIfChanged(c.pvFrom, pv.from);
        setColorIfChanged(c.pvFrom, st.maxed ? THEME.good : THEME.text);
        c.pvArrow.setVisible(false);
        c.pvTo.setVisible(false);
      } else {
        setTextIfChanged(c.pvFrom, pv.from);
        setColorIfChanged(c.pvFrom, THEME.textDim);
        setTextIfChanged(c.pvTo, pv.to);
        c.pvArrow.x = c.pvFrom.x + c.pvFrom.width + 10;
        c.pvTo.x = c.pvArrow.x + c.pvArrow.width + 10;
        c.pvArrow.setVisible(true);
        c.pvTo.setVisible(true);
        setColorIfChanged(c.pvTo, st.locked ? THEME.textDim : THEME.good);
      }
    } else {
      setTextIfChanged(c.pvFrom, '');
      c.pvArrow.setVisible(false);
      c.pvTo.setVisible(false);
    }

    // Cost / note / button
    if (st.maxed) {
      c.cost.setVisible(false);
      c.note.setVisible(true);
      setTextIfChanged(c.note, 'FULLY UPGRADED');
      setColorIfChanged(c.note, THEME.good);
      c.note.x = 18;
      c.buy.setVisible(false);
    } else if (st.locked) {
      c.cost.setVisible(false);
      c.note.setVisible(true);
      setTextIfChanged(c.note, st.locked);
      setColorIfChanged(c.note, THEME.textDim);
      c.note.x = 18;
      c.buy.setVisible(false);
    } else {
      c.cost.setVisible(true);
      setTextIfChanged(c.cost, st.cost !== null ? money(st.cost) : '—');
      setColorIfChanged(c.cost, st.affordable ? THEME.money : THEME.bad);
      const short = !st.affordable && st.cost !== null && gs.money > 0;
      c.note.setVisible(short);
      if (short && st.cost !== null) {
        c.note.x = c.cost.x + c.cost.width + 12;
        setTextIfChanged(c.note, `NEED ${money(st.cost - gs.money)}`);
        setColorIfChanged(c.note, THEME.textDim);
      }
      c.buy.setVisible(true).setEnabled(st.affordable && st.cost !== null).setLabel(st.level > 0 ? 'UPGRADE' : 'BUY');
    }

    // Dim locked cards
    const a = st.locked ? 0.55 : 1;
    for (const o of [c.name, c.desc, c.pips, c.lvl, c.pvLabel, c.pvFrom, c.pvArrow, c.pvTo]) o.setAlpha(a);
    c.root.setData('state', st);
    this.drawCardBg(c);
  }

  private drawCardBg(c: Card): void {
    const st = c.root.getData('state') as ReturnType<UpgradeScene['cardState']> | undefined;
    const g = c.bg;
    const w = c.w;
    g.clear();
    g.fillStyle(st?.locked ? THEME.panel : THEME.panelHi, st?.locked ? 0.7 : 0.95);
    g.fillRoundedRect(0, 0, w, CARD_H, 4);
    const edge = st?.maxed ? THEME.goodNum : st?.affordable ? THEME.rule : THEME.panelEdge;
    g.lineStyle(1, edge, st?.maxed ? 0.55 : 1);
    g.strokeRoundedRect(0.5, 0.5, w - 1, CARD_H - 1, 4);
    if (st && st.level > 0) {
      g.fillStyle(st.maxed ? THEME.goodNum : THEME.accentNum, 1);
      g.fillRect(0, 14, 3, 24);
    }
    g.lineStyle(1, THEME.panelEdge, 1);
    g.lineBetween(14, CARD_H - 42.5, w - 14, CARD_H - 42.5);
    if (c.flash > 0) {
      g.fillStyle(THEME.accentNum, 0.22 * c.flash);
      g.fillRoundedRect(0, 0, w, CARD_H, 4);
      g.lineStyle(2, THEME.accentNum, c.flash);
      g.strokeRoundedRect(1, 1, w - 2, CARD_H - 2, 4);
    }
  }

  private buy(c: Card): void {
    const gs = gameState();
    const st = this.cardState(c.def);
    if (st.cost === null || gs.money < st.cost) {
      this.audio.play('ui_deny');
      return;
    }
    this.moneyFrom = gs.money;
    gs.money -= st.cost;
    gs.upgrades[c.def.id] = st.level + 1;
    gs.save();
    this.moneyT = 0;
    this.audio.play('ui_buy');
    c.flash = 1;
    // A freshly unlocked ammo type becomes the loadout (that is why you bought it).
    if (c.def.unlocksAmmo && st.level === 0 && AMMO[c.def.unlocksAmmo]) {
      gs.selectedAmmo = c.def.unlocksAmmo;
      gs.save();
    }
    this.refreshAll();
  }

  // ------------------------------------------------------------------ sidebar

  private buildSpecStrip(x: number, y: number): void {
    const items: Array<[string, string]> = [
      ['rate', 'FIRE RATE'],
      ['damage', 'DAMAGE'],
      ['spread', 'SPREAD'],
      ['cooling', 'COOLING'],
      ['muzzle', 'MUZZLE'],
      ['scans', 'SCANS'],
    ];
    let cx = x;
    for (const [key, label] of items) {
      const l = mono(this, cx, y, label, SIZE.micro, THEME.textFaint, { weight: 600, spacing: 2, originY: 0.5 });
      const v = mono(this, cx + 76, y, '', SIZE.sm, THEME.text, { weight: 600, originY: 0.5 });
      this.specTexts.push({ key, label: l, value: v, last: '', flash: 0 });
      cx += 214;
    }
  }

  private refreshSpec(): void {
    const gs = gameState();
    let stats: ReturnType<UpgradeSystem['weaponStats']>;
    let scans = 0;
    try {
      stats = this.upg.weaponStats(gs.upgrades);
      scans = this.upg.scanCharges(gs.upgrades);
    } catch {
      return;
    }
    const val: Record<string, string> = {
      rate: `${(1 / Math.max(0.01, stats.reloadTime)).toFixed(1)}/s`,
      damage: `${(stats.damage ?? 1).toFixed(2)}`,
      cooling: `${(stats.coolRate ?? 0).toFixed(2)}/s`,
      muzzle: `${stats.muzzleVelocity.toFixed(1)} m/s`,
      mass: `${Math.round(stats.projectileMass)} kg`,
      reload: `${stats.reloadTime.toFixed(2)} s`,
      spread: `${((stats.spread * 180) / Math.PI).toFixed(2)}°`,
      impact: `×${stats.impactMultiplier.toFixed(2)}`,
      scans: String(scans),
    };
    for (const s of this.specTexts) {
      const v = val[s.key] ?? '';
      if (s.last && s.last !== v) s.flash = 1;
      s.last = v;
      setTextIfChanged(s.value, v);
    }
  }

  private buildAmmo(): void {
    const x = SIDE.x;
    let y = CAT.y + 10;
    mono(this, x, y, 'AMMUNITION · LOADOUT', SIZE.xs, THEME.textDim, { weight: 700, spacing: 3, originY: 0.5 });
    this.add.rectangle(x, y + 18, SIDE.w, 1, THEME.rule).setOrigin(0, 0.5);
    this.add.rectangle(x, y + 18, 28, 3, THEME.accentNum).setOrigin(0, 0.5);
    y += 34;
    const ids = Object.keys(AMMO);
    ids.forEach((id, i) => {
      const a = AMMO[id]!;
      const btn = new Button(this, {
        x: x + SIDE.w / 2,
        y: y + 30,
        width: SIDE.w,
        height: 58,
        label: a.name.toUpperCase(),
        sub: '',
        hint: String(i + 1),
        align: 'left',
        fontSize: SIZE.sm,
        audio: this.audio,
        onClick: () => this.selectAmmo(id),
      });
      // Colour swatch inside the button, left of the label.
      const dot = this.add.circle(-SIDE.w / 2 + 22, 0, 7, swatch(a.color));
      dot.setStrokeStyle(1.5, 0x0d0f12);
      btn.container.add(dot);
      (btn.container.list[1] as Text).x += 22; // label
      (btn.container.list[2] as Text).x += 22; // sub
      this.ammoRows.push({ id, btn, dot });
      this.buttons.push(btn);
      y += 66;
    });
    this.ammoDesc = mono(this, x, y + 6, '', SIZE.micro, THEME.textDim, { wrap: SIDE.w, lineSpacing: 4 });
    this.buildRecord(x, y + 78);
  }

  /** Small campaign stats table (fills the sidebar, rewards progress). */
  private buildRecord(x: number, y: number): void {
    const gs = gameState();
    const w = SIDE.w;
    mono(this, x, y, 'SERVICE RECORD', SIZE.xs, THEME.textDim, { weight: 700, spacing: 3, originY: 0.5 });
    this.add.rectangle(x, y + 18, w, 1, THEME.rule).setOrigin(0, 0.5);
    // Campaign contracts only (endless / seed wins are stored as proc-<seed> records).
    const done = levelManager.levels.filter((l) => gs.records[l.id]?.completed).length;
    const rows: Array<[string, string]> = [
      ['Contracts completed', `${done} / ${levelManager.count}`],
      ['Total earned', money(gs.totalEarned)],
      ['Invested in workshop', money(this.upg.invested(gs.upgrades))],
      ['Shots fired', String(gs.totalShots)],
      ['Joints broken', String(gs.totalJointsBroken)],
    ];
    rows.forEach(([k, v], i) => {
      const ry = y + 42 + i * 26;
      mono(this, x, ry, k, SIZE.micro, THEME.textFaint, { originY: 0.5 });
      const t = mono(this, x + w, ry, v, SIZE.xs, THEME.text, { weight: 600, originX: 1, originY: 0.5 });
      if (k === 'Invested in workshop') this.investedText = t;
    });
    this.recordBottom = y + 42 + (rows.length - 1) * 26 + 12;
  }

  private refreshAmmo(): void {
    const gs = gameState();
    let unlocked: string[] = ['standard'];
    try {
      unlocked = this.upg.unlockedAmmo(gs.upgrades);
    } catch {
      /* keep default */
    }
    if (!unlocked.includes(gs.selectedAmmo)) gs.selectedAmmo = unlocked[0] ?? 'standard';
    for (const r of this.ammoRows) {
      const a = AMMO[r.id]!;
      const open = unlocked.includes(r.id);
      const src = this.upg.defs.find((d) => d.unlocksAmmo === r.id);
      r.btn.setEnabled(open);
      r.btn.setSelected(open && gs.selectedAmmo === r.id);
      r.btn.setSub(open ? `$${a.cost} / SHOT${gs.selectedAmmo === r.id ? ' · LOADED' : ''}` : `LOCKED · ${src ? src.name.toUpperCase() : 'NOT AVAILABLE'}`);
      r.dot.setAlpha(open ? 1 : 0.3);
    }
    const sel = AMMO[gs.selectedAmmo];
    setTextIfChanged(this.ammoDesc, sel ? sel.description : '');
  }

  private selectAmmo(id: string): void {
    const gs = gameState();
    gs.selectedAmmo = id;
    gs.save();
    this.refreshAmmo();
  }

  private buildNext(): void {
    const gs = gameState();
    const x = SIDE.x;
    const w = SIDE.w;
    const by = CAT.y + CAT.h - 32;
    const done = gs.levelIndex >= levelManager.count;
    const g = this.add.graphics();
    // Content first (measured), panel drawn behind it afterwards.
        let tagRight: string;
    let title: string;
    let body: string;
    let stats: string;
    let best: { grade: string } | null = null;
    if (this.mode === 'assault') {
      const total = ASSAULT_LEVELS.length;
      const i = Math.min(gs.assaultIndex, total - 1);
      const lvl = ASSAULT_LEVELS[i]!;
      tagRight = gs.assaultIndex >= total ? `ALL ${pad2(total)} CLEARED` : `LEVEL ${pad2(i + 1)} / ${pad2(total)}`;
      title = lvl.name;
      body = lvl.subtitle;
      stats = `${lvl.waves.length} CREATURE${lvl.waves.length > 1 ? 'S' : ''}  ·  CONTRACT ${money(lvl.reward)}`;
      const rec = gs.records[lvl.id];
      if (rec?.completed) best = { grade: rec.bestGrade };
    } else if (!done) {
      const lvl = levelManager.get(gs.levelIndex);
      tagRight = `LEVEL ${pad2(gs.levelIndex + 1)} / ${pad2(levelManager.count)}`;
      title = lvl.name;
      body = lvl.subtitle;
      stats = `PAR ${lvl.par}  ·  CONTRACT ${money(lvl.reward)}`;
      const rec = gs.records[lvl.id];
      if (rec?.completed) best = { grade: rec.bestGrade };
    } else {
      const k = gs.levelIndex - levelManager.count;
      tagRight = `ENDLESS · ${pad2(k + 1)}`;
      title = 'Campaign complete';
      body = 'Next: endless seeded structures.';
      stats = `STRUCTURE ${pad2(k + 1)}  ·  DIFFICULTY ${Math.round(Math.min(1, 0.55 + k * 0.05) * 100)}%`;
    }
    const head = mono(this, x + 20, 0, 'NEXT DEPLOYMENT', SIZE.micro, THEME.textDim, { weight: 700, spacing: 3, originY: 0.5 });
    const tag = mono(this, x + w - 20, 0, tagRight, SIZE.micro, THEME.accent, { weight: 700, spacing: 2, originX: 1, originY: 0.5 });
    const name = display(this, x + 18, 0, title, SIZE.xl, THEME.text, { wrap: w - 36 });
    const sub = mono(this, x + 20, 0, body, SIZE.xs, THEME.textDim, { wrap: w - 40, lineSpacing: 4 });
    const st = mono(this, x + 20, 0, stats, SIZE.xs, THEME.text, { weight: 600, originY: 0.5 });
    const bestT = best ? mono(this, x + w - 20, 0, `BEST ${best.grade}`, SIZE.xs, css(GRADE_COLOR[best.grade] ?? THEME.textNum), { weight: 700, originX: 1, originY: 0.5 }) : null;
    const layout = (): void => {
      // The panel grows up from the DEPLOY row: cut the body short rather than cover the service record.
      const room = by - 32 - 22 - (this.recordBottom + 16);
      sub.setText(body);
      for (let lines = sub.getWrappedText(body).length - 1; lines >= 1 && 50 + name.height + 8 + sub.height + 50 > room; lines--) {
        setEllipsized(sub, body, lines);
      }
      const h = 50 + name.height + 8 + sub.height + 50;
      const y = by - 32 - 22 - h;
      head.y = y + 29;
      tag.y = y + 29;
      name.y = y + 48;
      sub.y = name.y + name.height + 8;
      st.y = y + h - 26;
      if (bestT) bestT.y = st.y;
      g.clear();
      g.fillStyle(THEME.panel, 0.92);
      g.fillRoundedRect(x, y, w, h, 4);
      g.lineStyle(1, THEME.panelEdge, 1);
      g.strokeRoundedRect(x + 0.5, y + 0.5, w - 1, h - 1, 4);
      g.fillStyle(THEME.accentNum, 1);
      g.fillRect(x, y + 18, 3, 22);
      g.lineStyle(1, THEME.panelEdge, 1);
      g.lineBetween(x + 16, y + h - 50.5, x + w - 16, y + h - 50.5);
    };
    layout();
    const off = onUiFonts(layout);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, off);

    const menu = new Button(this, { x: x + 70, y: by, width: 140, height: 64, label: 'MENU', hint: 'ESC', keys: ['Escape'], variant: 'ghost', fontSize: SIZE.sm, audio: this.audio, onClick: () => this.leave('Menu') });
    const deploy = new Button(this, {
      x: x + 140 + 14 + (w - 154) / 2,
      y: by,
      width: w - 154,
      height: 64,
      label: 'DEPLOY',
      hint: 'ENTER',
      keys: ['Enter', 'NumpadEnter'],
      variant: 'primary',
      fontSize: SIZE.md + 2,
      audio: this.audio,
      onClick: () => this.leave('Game'),
    });
    this.buttons.push(menu, deploy);
  }

  // ------------------------------------------------------------------ misc

  private refreshAll(): void {
    for (const c of this.cards) this.refreshCard(c);
    this.refreshAmmo();
    this.refreshSpec();
    if (this.investedText) setTextIfChanged(this.investedText, money(this.upg.invested(gameState().upgrades)));
  }

  /** The catalogue camera draws only the catalogue container. */
  private isolateCatalogue(): void {
    for (const go of this.children.list) if (go !== this.catalog) this.catCam.ignore(go);
  }

  private leave(target: 'Game' | 'Menu'): void {
    if (this.leaving) return;
    this.leaving = true;
    gameState().save();
    for (const c of this.cameras.cameras) c.fadeOut(220, 13, 15, 18);
    this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      if (target === 'Game') {
        if (this.mode === 'assault') this.scene.start('Assault', {});
        else this.scene.start('Game', { mode: 'campaign' });
      }
      else this.scene.start('Menu');
    });
  }

  private teardown(): void {
    this.offFonts();
    for (const b of this.buttons) b.destroy();
    this.buttons = [];
    this.cards = [];
    this.ammoRows = [];
    this.backdrop.destroy();
    this.input.keyboard?.removeAllListeners();
    this.input.removeAllListeners();
  }
}

/** Set wrapped text, cutting it to `maxLines` with an ellipsis. */
function setEllipsized(t: Text, text: string, maxLines: number): void {
  t.setText(text);
  const lines = t.getWrappedText(text);
  if (lines.length <= maxLines) return;
  const kept = lines.slice(0, maxLines);
  let last = kept[maxLines - 1]!.trimEnd();
  last = last.replace(/[\s,.;:]*\S{0,3}$/, '');
  kept[maxLines - 1] = `${last}…`;
  t.setText(kept.join('\n'));
}

/** Very dark ammo colours (iron) are lifted so the swatch reads on the panel. */
function swatch(c: number): number {
  const lum = 0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255);
  return lum < 90 ? 0x9aa3b0 : c;
}
