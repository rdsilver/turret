/**
 * Developer overlay (DOM, top-right): FPS, physics step time (avg/max), post-step
 * time, total/active/sleeping bodies, joints, projectiles, debris, time scale.
 * Updates text a few times per second (not every frame). Toggle with F3. OWNER: debug agent.
 *
 * Per frame `update()` only copies a handful of numbers and occasionally writes
 * one sample into a ring buffer (no allocations, no DOM access). Four times a
 * second it rewrites the text cells that changed and redraws a small step-time
 * sparkline (green < 4 ms, amber < 8 ms, red above).
 */
import { DBG, h, layoutDock, mountInDock, readPref, unmountFromDock, writePref } from './dom';

export interface DevStats {
  fps: number;
  stepMs: number;
  stepMsMax: number;
  postMs: number;
  stepsPerFrame: number;
  bodies: number;
  dynamicBodies: number;
  active: number;
  sleeping: number;
  joints: number;
  projectiles: number;
  debris: number;
  timeScale: number;
  paused: boolean;
}

/** Text refresh period (s). */
const TEXT_PERIOD = 0.25;
/** Sparkline sample period (s) and length: ~6 s of history. */
const SAMPLE_PERIOD = 0.05;
const SAMPLES = 120;
const WARN_MS = 4;
const BAD_MS = 8;
const PREF_KEY = 'turret.dev.overlay';

function msColor(ms: number): string {
  return ms < WARN_MS ? DBG.good : ms < BAD_MS ? DBG.warn : DBG.bad;
}

function fpsColor(fps: number): string {
  return fps >= 55 ? DBG.good : fps >= 40 ? DBG.warn : DBG.bad;
}

interface Cell {
  el: HTMLElement;
  text: string;
  color: string;
}

export class DevOverlay {
  /** Off by default (F3 toggles it; the choice is saved in the 'turret.dev.overlay' pref). */
  visible = false;

  private readonly root: HTMLDivElement | null = null;
  private readonly cells: Record<string, Cell> = {};
  private readonly badge: HTMLElement | null = null;
  private readonly canvas: HTMLCanvasElement | null = null;
  private readonly ctx: CanvasRenderingContext2D | null = null;
  private readonly legend: HTMLElement | null = null;

  // Accumulated between text refreshes.
  private timer = 0;
  private sampleTimer = 0;
  private frames = 0;
  private stepsSum = 0;
  private stepMaxWindow = 0;
  private readonly last: DevStats = {
    fps: 0,
    stepMs: 0,
    stepMsMax: 0,
    postMs: 0,
    stepsPerFrame: 0,
    bodies: 0,
    dynamicBodies: 0,
    active: 0,
    sleeping: 0,
    joints: 0,
    projectiles: 0,
    debris: 0,
    timeScale: 1,
    paused: false,
  };
  private readonly ring = new Float32Array(SAMPLES);
  private ringHead = 0;
  private ringCount = 0;
  private wasPaused = false;
  private destroyed = false;

  constructor() {
    const pref = readPref(PREF_KEY);
    if (pref !== null) this.visible = pref !== '0';
    if (typeof document === 'undefined') return;

    const root = h('div', 'tdbg-panel tdbg-ov');
    const head = h('div', 'tdbg-ov-head', root);
    h('span', '', head, 'PHYSICS');
    h('span', 'tdbg-grow', head);
    this.badge = h('span', 'tdbg-badge', head, 'PAUSED');
    h('span', '', head, 'F3');

    const grid = h('div', 'tdbg-grid', root);
    const cell = (key: string, label: string): void => {
      h('span', 'tdbg-k', grid, label);
      this.cells[key] = { el: h('span', 'tdbg-v', grid, '–'), text: '', color: '' };
    };
    cell('fps', 'FPS');
    cell('step', 'STEP');
    cell('max', 'MAX');
    cell('post', 'POST');
    cell('spf', 'STEP/FR');
    cell('time', 'TIME');
    cell('bodies', 'BODIES');
    cell('active', 'ACTIVE');
    cell('sleeping', 'SLEEP');
    cell('joints', 'JOINTS');
    cell('proj', 'PROJ');
    cell('debris', 'DEBRIS');

    this.canvas = h('canvas', 'tdbg-spark', root);
    this.ctx = this.canvas.getContext('2d');
    this.legend = h('div', 'tdbg-spark-legend', root);
    h('span', '', this.legend, 'step ms · 6 s');
    h('span', '', this.legend, `${WARN_MS} / ${BAD_MS} ms`);

    this.root = root;
    mountInDock(root, 'overlay');
    root.classList.toggle('tdbg-hidden', !this.visible);
  }

  update(stats: DevStats, realDt: number): void {
    if (!this.visible || !this.root || this.destroyed) return;
    const l = this.last;
    l.fps = stats.fps;
    l.stepMs = stats.stepMs;
    l.stepMsMax = stats.stepMsMax;
    l.postMs = stats.postMs;
    l.bodies = stats.bodies;
    l.dynamicBodies = stats.dynamicBodies;
    l.active = stats.active;
    l.sleeping = stats.sleeping;
    l.joints = stats.joints;
    l.projectiles = stats.projectiles;
    l.debris = stats.debris;
    l.timeScale = stats.timeScale;
    l.paused = stats.paused;
    this.frames++;
    this.stepsSum += stats.stepsPerFrame;
    if (stats.stepMs > this.stepMaxWindow) this.stepMaxWindow = stats.stepMs;

    this.sampleTimer += realDt;
    if (this.sampleTimer >= SAMPLE_PERIOD) {
      this.sampleTimer %= SAMPLE_PERIOD;
      // Paused: freeze the graph instead of filling it with idle zeros.
      if (!stats.paused || stats.stepsPerFrame > 0) {
        this.ring[this.ringHead] = stats.stepMs;
        this.ringHead = (this.ringHead + 1) % SAMPLES;
        if (this.ringCount < SAMPLES) this.ringCount++;
      }
    }

    this.timer += realDt;
    if (this.timer >= TEXT_PERIOD || l.paused !== this.wasPaused) {
      this.timer = 0;
      this.render();
    }
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.root?.classList.toggle('tdbg-hidden', !v);
    writePref(PREF_KEY, v ? '1' : '0');
    if (v) {
      this.timer = TEXT_PERIOD; // refresh on the next update
      layoutDock(true);
    }
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.root) unmountFromDock(this.root);
  }

  // ---------------------------------------------------------------- render

  private set(key: string, text: string, color: string = DBG.text): void {
    const c = this.cells[key];
    if (!c) return;
    if (c.text !== text) {
      c.text = text;
      c.el.innerHTML = text;
    }
    if (c.color !== color) {
      c.color = color;
      c.el.style.color = color;
    }
  }

  private render(): void {
    const l = this.last;
    const spf = this.frames > 0 ? this.stepsSum / this.frames : 0;
    const maxMs = Math.max(l.stepMsMax, this.stepMaxWindow);
    this.frames = 0;
    this.stepsSum = 0;
    this.stepMaxWindow = 0;

    this.set('fps', l.fps.toFixed(0), fpsColor(l.fps));
    this.set('step', `${l.stepMs.toFixed(2)}<small>ms</small>`, msColor(l.stepMs));
    this.set('max', `${maxMs.toFixed(2)}<small>ms</small>`, msColor(maxMs));
    this.set('post', `${l.postMs.toFixed(2)}<small>ms</small>`, msColor(l.postMs));
    this.set('spf', spf.toFixed(1), spf > 2.5 ? DBG.warn : DBG.text);
    this.set('time', `${l.timeScale.toFixed(2)}×`, l.paused ? DBG.faint : Math.abs(l.timeScale - 1) > 0.01 ? DBG.info : DBG.text);
    this.set('bodies', `${l.bodies}<small>/${l.dynamicBodies}</small>`);
    this.set('active', String(l.active), l.active > 400 ? DBG.warn : DBG.text);
    this.set('sleeping', String(l.sleeping), DBG.dim);
    this.set('joints', String(l.joints));
    this.set('proj', String(l.projectiles));
    this.set('debris', String(l.debris));
    if (this.badge && l.paused !== this.wasPaused) this.badge.classList.toggle('tdbg-on', l.paused);
    this.wasPaused = l.paused;
    this.drawSpark();
    layoutDock();
  }

  private drawSpark(): void {
    const cv = this.canvas;
    const g = this.ctx;
    if (!cv || !g) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = cv.clientWidth || 226;
    const cssH = cv.clientHeight || 30;
    const W = Math.round(cssW * dpr);
    const H = Math.round(cssH * dpr);
    if (cv.width !== W || cv.height !== H) {
      cv.width = W;
      cv.height = H;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, cssW, cssH);
    const n = this.ringCount;
    let peak = 0;
    for (let i = 0; i < n; i++) peak = Math.max(peak, this.ring[i]!);
    // Scale: always show the 8 ms line; grow for spikes (cap so one hitch doesn't flatten everything).
    const top = Math.min(24, Math.max(BAD_MS * 1.25, peak * 1.1));
    const y = (ms: number): number => cssH - 1 - (Math.min(ms, top) / top) * (cssH - 2);

    // Budget guides.
    g.lineWidth = 1;
    g.setLineDash([2, 3]);
    g.strokeStyle = 'rgba(255,181,71,0.35)';
    g.beginPath();
    g.moveTo(0, Math.round(y(WARN_MS)) + 0.5);
    g.lineTo(cssW, Math.round(y(WARN_MS)) + 0.5);
    g.stroke();
    g.strokeStyle = 'rgba(255,107,94,0.45)';
    g.beginPath();
    g.moveTo(0, Math.round(y(BAD_MS)) + 0.5);
    g.lineTo(cssW, Math.round(y(BAD_MS)) + 0.5);
    g.stroke();
    g.setLineDash([]);
    if (n < 2) return;

    // Bars coloured by budget, newest on the right.
    const bw = cssW / SAMPLES;
    const start = (this.ringHead - n + SAMPLES) % SAMPLES;
    const x0 = cssW - n * bw;
    for (let i = 0; i < n; i++) {
      const v = this.ring[(start + i) % SAMPLES]!;
      g.fillStyle = v < WARN_MS ? 'rgba(111,227,161,0.55)' : v < BAD_MS ? 'rgba(255,181,71,0.75)' : 'rgba(255,107,94,0.9)';
      const yy = Math.min(cssH - 2, y(v)); // at least 1 px so idle samples stay visible
      g.fillRect(x0 + i * bw, yy, Math.max(1, bw - 0.4), cssH - 1 - yy);
    }
    // Baseline.
    g.fillStyle = 'rgba(139,149,165,0.35)';
    g.fillRect(0, cssH - 1, cssW, 1);
  }
}
