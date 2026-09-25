/**
 * Debug menu (DOM panel, toggle with backquote `). OWNER: debug agent.
 * Buttons/sliders call into DebugApi (implemented by GameScene).
 *
 * Input hygiene
 *  - Pointer-down / wheel / touch events never reach the game: the panel stops
 *    their propagation (Phaser listens on the canvas and on window).
 *  - The panel never keeps keyboard focus: buttons don't take focus on mousedown,
 *    sliders / checkboxes blur after a change, the seed field blurs on Enter /
 *    Escape. While the seed field IS focused its keystrokes are kept from the
 *    game (so typing "R" doesn't reload the level).
 *  - `refresh()` may be called every frame; it re-reads the API ~5x per second
 *    and only touches DOM nodes whose value changed.
 */
import type { MaterialId } from '../sim/Materials';
import { MATERIALS } from '../sim/Materials';
import { DEFAULT_GRAVITY } from '../config/constants';
import { parseSeed, seedToString } from '../core/Random';
import { dockCoverFraction, h, layoutDock, mountInDock, readPref, unmountFromDock, writePref } from './dom';

export type DebugTool = 'fire' | 'grab' | 'block' | 'ball' | 'explode';

export interface DebugApi {
  reloadLevel(): void;
  randomizeStructure(): void;
  setPaused(p: boolean): void;
  isPaused(): boolean;
  stepOnce(): void;
  setSlowMo(on: boolean): void;
  isSlowMo(): boolean;
  setGravity(g: number): void;
  getGravity(): number;
  setProjectileMassScale(s: number): void;
  getProjectileMassScale(): number;
  setColliderDebug(on: boolean): void;
  isColliderDebug(): boolean;
  setStressView(on: boolean): void;
  isStressView(): boolean;
  setTool(t: DebugTool): void;
  getTool(): DebugTool;
  setSpawnMaterial(m: MaterialId): void;
  getSpawnMaterial(): MaterialId;
  setUnlimitedFire(on: boolean): void;
  isUnlimitedFire(): boolean;
  /** Spawn a benchmark structure with ~n parts. */
  benchmark(n: number): void;
  clearDebris(): void;
  addMoney(n: number): void;
  skipLevel(): void;
  getSeed(): number;
  loadSeed(seed: number): void;
}

const TOOLS: { id: DebugTool; label: string; tip: string }[] = [
  { id: 'fire', label: 'Fire', tip: 'Click fires the cannon (default)' },
  { id: 'grab', label: 'Grab', tip: 'Drag bodies with a spring; release to throw' },
  { id: 'block', label: 'Block', tip: 'Click spawns a loose block of the selected material' },
  { id: 'ball', label: 'Ball', tip: 'Click drops a shell of the current ammo' },
  { id: 'explode', label: 'Blast', tip: 'Click detonates a debug explosion' },
];

const SPAWN_MATERIALS: MaterialId[] = ['wood', 'concrete', 'steel', 'glass', 'rubber', 'stone', 'explosive', 'core'];
const SHORT_NAME: Partial<Record<MaterialId, string>> = { explosive: 'TNT' };
const BENCH_SIZES = [100, 300, 1000, 2000];
const GRAVITY_MIN = -5;
const GRAVITY_MAX = 30;
const REFRESH_MS = 200;
const PREF_SECTIONS = 'turret.dev.menuSections';

/** Remember visibility across GameScene restarts (level transitions) within a session. */
let rememberedVisible = false;

const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

type Toggle = { el: HTMLElement; get: () => boolean; state: boolean | null };

export class DebugMenu {
  visible = false;
  /**
   * Called after the menu is shown / hidden (e.g. GameScene re-frames the
   * camera so the structure isn't hidden under the panel; see coverFraction()).
   */
  onVisibilityChange: ((visible: boolean) => void) | null = null;

  private root: HTMLDivElement | null = null;
  private readonly toggles: Toggle[] = [];
  private readonly toolBtns = new Map<DebugTool, HTMLButtonElement>();
  private readonly chipBtns = new Map<MaterialId, HTMLButtonElement>();
  private gravityRange!: HTMLInputElement;
  private gravityVal!: HTMLElement;
  private massRange!: HTMLInputElement;
  private massVal!: HTMLElement;
  private seedInput!: HTMLInputElement;
  private headInfo!: HTMLElement;
  private lastRefresh = -1e9;
  private shown = { tool: '' as string, mat: '' as string, gravity: NaN, mass: NaN, seed: NaN };
  private closedSections = new Set<string>();
  private destroyed = false;

  constructor(readonly api: DebugApi) {
    if (typeof document === 'undefined') return;
    try {
      const s = readPref(PREF_SECTIONS);
      if (s) for (const id of JSON.parse(s) as string[]) this.closedSections.add(id);
    } catch {
      /* ignore bad pref */
    }
    this.build();
    if (rememberedVisible) this.setVisible(true);
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  setVisible(v: boolean): void {
    const changed = v !== this.visible;
    this.visible = v;
    rememberedVisible = v;
    if (!this.root) return;
    this.root.classList.toggle('tdbg-hidden', !v);
    if (v) {
      this.lastRefresh = -1e9;
      this.refresh();
      layoutDock(true);
    } else if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) {
      document.activeElement.blur();
    }
    if (changed) this.onVisibilityChange?.(v);
  }

  /**
   * Fraction (0..1) of the canvas width, from the right edge, hidden behind the
   * debug panels (0 when the menu is closed). For camera framing:
   * `right += (right - left) * f / (1 - f)`.
   */
  coverFraction(): number {
    return this.visible && this.root ? dockCoverFraction() : 0;
  }

  /** Refresh displayed values (called a few times per second while visible). */
  refresh(): void {
    if (!this.visible || !this.root || this.destroyed) return;
    const now = performance.now();
    if (now - this.lastRefresh < REFRESH_MS) return;
    this.lastRefresh = now;
    const api = this.api;

    for (const t of this.toggles) {
      const on = t.get();
      if (on !== t.state) {
        t.state = on;
        if (t.el instanceof HTMLInputElement) t.el.checked = on;
        else t.el.classList.toggle('tdbg-on', on);
      }
    }

    const tool = api.getTool();
    if (tool !== this.shown.tool) {
      this.shown.tool = tool;
      for (const [id, b] of this.toolBtns) b.classList.toggle('tdbg-on', id === tool);
    }
    const mat = api.getSpawnMaterial();
    if (mat !== this.shown.mat) {
      this.shown.mat = mat;
      for (const [id, b] of this.chipBtns) b.classList.toggle('tdbg-on', id === mat);
    }

    const g = api.getGravity();
    if (g !== this.shown.gravity && document.activeElement !== this.gravityRange) {
      this.shown.gravity = g;
      this.gravityRange.value = String(g);
      this.gravityVal.textContent = g.toFixed(1);
    }
    const m = api.getProjectileMassScale();
    if (m !== this.shown.mass && document.activeElement !== this.massRange) {
      this.shown.mass = m;
      this.massRange.value = String(Math.log10(m));
      this.massVal.textContent = `×${m < 1 ? m.toFixed(2) : m.toFixed(1)}`;
    }
    const seed = api.getSeed();
    if (seed !== this.shown.seed && document.activeElement !== this.seedInput) {
      this.shown.seed = seed;
      this.seedInput.value = seedToString(seed);
      this.headInfo.textContent = `seed ${seedToString(seed)}`;
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.root) {
      if (document.activeElement instanceof HTMLElement && this.root.contains(document.activeElement)) document.activeElement.blur();
      unmountFromDock(this.root);
      this.root = null;
    }
  }

  // ------------------------------------------------------------------ build

  private build(): void {
    const api = this.api;
    const root = h('div', 'tdbg-panel tdbg-menu tdbg-hidden');
    this.root = root;
    this.isolate(root);

    // Header.
    const head = h('div', 'tdbg-menu-head', root);
    h('b', '', head, 'DEBUG');
    this.headInfo = h('span', 'tdbg-grow', head, '');
    this.button(head, '✕', () => this.setVisible(false), 'tdbg-mini').title = 'Close (`)';

    // ---- Level
    let b = this.section(root, 'level', 'LEVEL');
    let row = h('div', 'tdbg-row', b);
    this.button(row, 'Reload', () => api.reloadLevel(), 'tdbg-flex', 'R');
    this.button(row, 'Randomize', () => api.randomizeStructure(), 'tdbg-flex');
    row = h('div', 'tdbg-row', b);
    this.seedInput = h('input', 'tdbg-input', row);
    this.seedInput.type = 'text';
    this.seedInput.spellcheck = false;
    this.seedInput.maxLength = 24;
    this.seedInput.placeholder = 'seed / text';
    this.seedInput.title = 'Base-36 seed (as shown in the level subtitle) or any text';
    this.button(row, 'Load', () => this.loadSeedFromInput());
    row = h('div', 'tdbg-row', b);
    this.button(row, 'Skip level ›', () => api.skipLevel(), 'tdbg-flex');
    this.button(row, '+$1000', () => api.addMoney(1000), 'tdbg-flex');

    // ---- Time
    b = this.section(root, 'time', 'TIME');
    row = h('div', 'tdbg-row', b);
    this.toggleButton(row, 'Pause', 'P', () => api.isPaused(), (on) => api.setPaused(on));
    this.button(row, 'Step', () => api.stepOnce(), 'tdbg-flex', 'N');
    this.toggleButton(row, 'Slow-mo', 'T', () => api.isSlowMo(), (on) => api.setSlowMo(on));

    // ---- Physics
    b = this.section(root, 'physics', 'PHYSICS');
    row = h('div', 'tdbg-row', b);
    h('span', 'tdbg-lbl', row, 'Gravity');
    this.gravityRange = this.range(row, GRAVITY_MIN, GRAVITY_MAX, 0.5, (v) => {
      api.setGravity(v);
      this.gravityVal.textContent = v.toFixed(1);
      this.shown.gravity = v;
    });
    this.gravityVal = h('span', 'tdbg-val', row, '');
    this.button(row, '↺', () => api.setGravity(DEFAULT_GRAVITY), 'tdbg-mini').title = `Reset to ${DEFAULT_GRAVITY} m/s²`;
    row = h('div', 'tdbg-row', b);
    h('span', 'tdbg-lbl', row, 'Shell ×m');
    this.massRange = this.range(row, -1, 1, 0.01, (v) => {
      const s = Math.pow(10, v);
      const snapped = Math.abs(v) < 0.03 ? 1 : s; // detent at 1x
      api.setProjectileMassScale(snapped);
      this.massVal.textContent = `×${snapped < 1 ? snapped.toFixed(2) : snapped.toFixed(1)}`;
      this.shown.mass = snapped;
    });
    this.massVal = h('span', 'tdbg-val', row, '');
    this.button(row, '↺', () => api.setProjectileMassScale(1), 'tdbg-mini').title = 'Reset to 1×';
    this.checkbox(b, 'Unlimited fire (no reload)', '', () => api.isUnlimitedFire(), (on) => api.setUnlimitedFire(on));

    // ---- View
    b = this.section(root, 'view', 'VIEW');
    this.checkbox(b, 'Colliders', 'C', () => api.isColliderDebug(), (on) => api.setColliderDebug(on));
    this.checkbox(b, 'Stress heat map', 'V', () => api.isStressView(), (on) => api.setStressView(on));

    // ---- Tools
    b = this.section(root, 'tools', 'TOOLS');
    const seg = h('div', 'tdbg-seg', b);
    for (const t of TOOLS) {
      const btn = this.button(seg, t.label, () => {
        api.setTool(t.id);
        this.shown.tool = '';
        this.lastRefresh = -1e9;
        this.refresh();
      });
      btn.title = t.tip;
      this.toolBtns.set(t.id, btn);
    }
    const chips = h('div', 'tdbg-chips', b);
    for (const id of SPAWN_MATERIALS) {
      const m = MATERIALS[id];
      if (!m) continue;
      const chip = h('button', 'tdbg-chip', chips);
      chip.type = 'button';
      chip.title = `Spawn material: ${m.name}`;
      const sw = h('span', 'sw', chip);
      sw.style.background = hex(m.color);
      sw.style.opacity = String(Math.max(0.6, m.alpha));
      h('span', '', chip, SHORT_NAME[id] ?? m.name);
      this.press(chip, () => {
        api.setSpawnMaterial(id);
        this.shown.mat = '';
        this.lastRefresh = -1e9;
        this.refresh();
      });
      this.chipBtns.set(id, chip);
    }

    // ---- Benchmark
    b = this.section(root, 'bench', 'BENCHMARK');
    row = h('div', 'tdbg-row', b);
    for (const n of BENCH_SIZES) this.button(row, String(n), () => api.benchmark(n), 'tdbg-flex').title = `Load a welded wall of ~${n} parts`;
    row = h('div', 'tdbg-row', b);
    this.button(row, 'Clear debris', () => api.clearDebris(), 'tdbg-flex');

    const foot = h('div', 'tdbg-foot', root);
    foot.innerHTML = '<kbd>`</kbd> close · <kbd>F3</kbd> perf · <kbd>RMB</kbd>-drag grab';

    mountInDock(root, 'menu');
  }

  private section(parent: HTMLElement, id: string, title: string): HTMLDivElement {
    const sec = h('div', 'tdbg-sec', parent);
    const head = h('div', 'tdbg-sec-h', sec);
    const caret = h('i', '', head, '▾');
    h('span', '', head, title);
    const body = h('div', 'tdbg-sec-b', sec);
    const apply = (): void => {
      const closed = this.closedSections.has(id);
      sec.classList.toggle('tdbg-closed', closed);
      caret.textContent = closed ? '▸' : '▾';
    };
    apply();
    head.addEventListener('mousedown', (e) => e.preventDefault());
    head.addEventListener('click', () => {
      if (this.closedSections.has(id)) this.closedSections.delete(id);
      else this.closedSections.add(id);
      apply();
      writePref(PREF_SECTIONS, JSON.stringify([...this.closedSections]));
    });
    return body;
  }

  private button(parent: HTMLElement, label: string, onClick: () => void, cls = '', key = ''): HTMLButtonElement {
    const b = h('button', `tdbg-btn ${cls}`.trim(), parent);
    b.type = 'button';
    b.textContent = label;
    if (key) h('kbd', '', b, key);
    this.press(b, onClick);
    return b;
  }

  private toggleButton(parent: HTMLElement, label: string, key: string, get: () => boolean, set: (on: boolean) => void): HTMLButtonElement {
    const b = this.button(
      parent,
      label,
      () => {
        set(!get());
        t.state = null; // force redraw
        this.lastRefresh = -1e9;
        this.refresh();
      },
      'tdbg-flex',
      key,
    );
    const t: Toggle = { el: b, get, state: null };
    this.toggles.push(t);
    return b;
  }

  private checkbox(parent: HTMLElement, label: string, key: string, get: () => boolean, set: (on: boolean) => void): HTMLInputElement {
    const lab = h('label', 'tdbg-check', parent);
    const input = h('input', '', lab);
    input.type = 'checkbox';
    h('span', '', lab, label);
    if (key) h('kbd', '', lab, key);
    input.addEventListener('change', () => {
      set(input.checked);
      t.state = input.checked;
      input.blur();
    });
    const t: Toggle = { el: input, get, state: null };
    this.toggles.push(t);
    return input;
  }

  private range(parent: HTMLElement, min: number, max: number, step: number, onInput: (v: number) => void): HTMLInputElement {
    const r = h('input', 'tdbg-range', parent);
    r.type = 'range';
    r.min = String(min);
    r.max = String(max);
    r.step = String(step);
    r.addEventListener('input', () => onInput(Number(r.value)));
    r.addEventListener('change', () => {
      onInput(Number(r.value));
      r.blur();
    });
    return r;
  }

  /** Click handler that never leaves the element focused (Space must keep firing the cannon). */
  private press(el: HTMLElement, fn: () => void): void {
    el.addEventListener('mousedown', (e) => e.preventDefault());
    el.addEventListener('click', (e) => {
      e.preventDefault();
      fn();
      el.blur();
    });
  }

  private loadSeedFromInput(): void {
    const text = this.seedInput.value.trim();
    this.seedInput.blur();
    if (!text) return;
    const seed = parseSeed(text);
    this.shown.seed = NaN;
    this.api.loadSeed(seed);
  }

  /** Keep panel input away from the game. */
  private isolate(root: HTMLElement): void {
    const stop = (e: Event): void => e.stopPropagation();
    // Down / wheel / click never reach the game. Up events are allowed through on
    // purpose: Phaser tracks button state on window, and a drag that started on the
    // canvas and ends over the panel must still release (as 'pointerupoutside').
    for (const type of ['pointerdown', 'mousedown', 'click', 'dblclick', 'wheel', 'touchstart', 'touchmove', 'contextmenu']) {
      root.addEventListener(type, stop);
    }
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement) || t.type !== 'text') return;
      // Typing in the seed field: keep keys from the game.
      e.stopPropagation();
      if (e.type !== 'keydown') return;
      if (e.key === 'Enter') {
        e.preventDefault();
        this.loadSeedFromInput();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.shown.seed = NaN;
        t.blur();
      } else if (e.code === 'Backquote') {
        e.preventDefault();
        t.blur();
        this.toggle();
      }
    };
    root.addEventListener('keydown', onKey);
    root.addEventListener('keyup', onKey);
  }
}
