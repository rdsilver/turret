/**
 * Shared DOM plumbing for the debug overlays (DevOverlay, DebugMenu).
 *
 * Both panels live in one fixed "dock" column anchored to the top-right of the
 * game canvas, just below the HUD's funds readout, so they stack instead of
 * overlapping (overlay on top, menu below it, the menu scrolls if the window
 * is short). Styles are injected once. Nothing here touches Phaser.
 */

export const DBG = {
  bg: 'rgba(15, 17, 21, 0.86)',
  edge: '#2e3440',
  rule: '#262c36',
  text: '#e8ecf1',
  dim: '#8b95a5',
  faint: '#5c6574',
  accent: '#ffb547',
  good: '#6fe3a1',
  warn: '#ffb547',
  bad: '#ff6b5e',
  info: '#9fd3ff',
  font: '"JetBrains Mono", "IBM Plex Mono", ui-monospace, Menlo, Consolas, monospace',
} as const;

/** Dock (debug menu) width and the narrower perf overlay width (px). */
export const DOCK_WIDTH = 236;
export const OVERLAY_WIDTH = 204;

const STYLE_ID = 'turret-debug-style';

const CSS = `
.tdbg-dock{position:fixed;top:96px;right:10px;z-index:40;width:${DOCK_WIDTH}px;display:flex;flex-direction:column;gap:6px;
  pointer-events:none;font:11px/1.4 ${DBG.font};color:${DBG.text};-webkit-font-smoothing:antialiased;user-select:none}
.tdbg-panel{background:${DBG.bg};border:1px solid ${DBG.edge};border-radius:4px;box-shadow:0 6px 20px rgba(0,0,0,.35);
  backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
.tdbg-hidden{display:none!important}

/* ---- dev overlay ---- */
.tdbg-ov{padding:6px 8px 7px;flex:0 0 auto;width:${OVERLAY_WIDTH}px;box-sizing:border-box;align-self:flex-end;background:rgba(15,17,21,.74)}
.tdbg-ov-head{display:flex;align-items:center;gap:6px;margin-bottom:4px;color:${DBG.faint};font-size:10px;letter-spacing:.12em}
.tdbg-ov-head .tdbg-grow{flex:1}
.tdbg-badge{display:none;padding:0 5px;border-radius:2px;font-weight:700;letter-spacing:.1em;color:#111;background:${DBG.accent}}
.tdbg-badge.tdbg-on{display:inline-block}
.tdbg-grid{display:grid;grid-template-columns:auto 1fr auto 1fr;column-gap:6px;row-gap:1px;font-variant-numeric:tabular-nums}
.tdbg-k{color:${DBG.dim};font-size:10px;letter-spacing:.04em;white-space:nowrap}
.tdbg-v{text-align:right;white-space:nowrap;color:${DBG.text}}
.tdbg-v small{color:${DBG.faint};font-size:9px}
.tdbg-spark{display:block;width:100%;height:30px;margin-top:5px;border-top:1px solid ${DBG.rule};padding-top:4px;box-sizing:content-box}
.tdbg-spark-legend{display:flex;justify-content:space-between;color:${DBG.faint};font-size:9px;margin-top:1px}

/* ---- debug menu ---- */
.tdbg-menu{pointer-events:auto;flex:0 1 auto;min-height:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:${DBG.edge} transparent}
.tdbg-menu-head{display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid ${DBG.rule};position:sticky;top:0;background:#12151a;z-index:1}
.tdbg-menu-head b{font-weight:700;letter-spacing:.14em;font-size:10px;color:${DBG.accent}}
.tdbg-menu-head .tdbg-grow{flex:1;color:${DBG.faint};font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.tdbg-sec{border-bottom:1px solid ${DBG.rule}}
.tdbg-sec:last-child{border-bottom:none}
.tdbg-sec-h{display:flex;align-items:center;gap:6px;padding:5px 8px;cursor:pointer;color:${DBG.dim};font-size:10px;letter-spacing:.12em}
.tdbg-sec-h:hover{color:${DBG.text}}
.tdbg-sec-h i{font-style:normal;color:${DBG.faint};width:8px}
.tdbg-sec-b{padding:2px 8px 8px;display:flex;flex-direction:column;gap:5px}
.tdbg-sec.tdbg-closed .tdbg-sec-b{display:none}
.tdbg-row{display:flex;align-items:center;gap:4px}
.tdbg-row > .tdbg-lbl{color:${DBG.dim};font-size:10px;min-width:54px}
.tdbg-row > .tdbg-val{min-width:40px;text-align:right;font-variant-numeric:tabular-nums}
.tdbg-btn{font:inherit;font-size:10.5px;color:${DBG.text};background:#20252e;border:1px solid #363d4a;border-radius:3px;padding:3px 6px;
  cursor:pointer;white-space:nowrap;line-height:1.25;display:inline-flex;align-items:center;gap:4px}
.tdbg-btn:hover{border-color:#566070;background:#262c36}
.tdbg-btn:active{transform:translateY(1px)}
.tdbg-btn.tdbg-on{background:rgba(255,181,71,.15);border-color:${DBG.accent};color:#ffd08a}
.tdbg-btn.tdbg-flex{flex:1;justify-content:center}
.tdbg-btn.tdbg-mini{padding:1px 5px;font-size:10px;color:${DBG.dim}}
.tdbg-btn kbd{font:inherit;font-size:9px;color:${DBG.faint};border:1px solid #3a4250;border-radius:2px;padding:0 3px;line-height:1.2}
.tdbg-btn.tdbg-on kbd{color:#ffd08a;border-color:rgba(255,181,71,.5)}
.tdbg-seg{display:flex;gap:0}
.tdbg-seg .tdbg-btn{flex:1;justify-content:center;border-radius:0;margin-left:-1px}
.tdbg-seg .tdbg-btn:first-child{border-radius:3px 0 0 3px;margin-left:0}
.tdbg-seg .tdbg-btn:last-child{border-radius:0 3px 3px 0}
.tdbg-seg .tdbg-btn.tdbg-on{position:relative;z-index:1}
.tdbg-chips{display:grid;grid-template-columns:repeat(3,1fr);gap:3px}
.tdbg-chip span:last-child{overflow:hidden;text-overflow:ellipsis}
.tdbg-chip{font:inherit;font-size:10px;color:${DBG.dim};background:#1a1e25;border:1px solid #2e3440;border-radius:3px;padding:2px 3px;cursor:pointer;
  display:flex;align-items:center;gap:4px;overflow:hidden;white-space:nowrap}
.tdbg-chip span.sw{width:8px;height:8px;border-radius:1px;flex:0 0 auto;box-shadow:0 0 0 1px rgba(0,0,0,.5)}
.tdbg-chip:hover{color:${DBG.text};border-color:#566070}
.tdbg-chip.tdbg-on{color:${DBG.text};border-color:${DBG.accent};background:rgba(255,181,71,.1)}
.tdbg-range{flex:1;min-width:0;accent-color:${DBG.accent};height:14px;margin:0;cursor:pointer}
.tdbg-check{display:flex;align-items:center;gap:6px;cursor:pointer;color:${DBG.text}}
.tdbg-check input{accent-color:${DBG.accent};margin:0;cursor:pointer}
.tdbg-check kbd{font:inherit;font-size:9px;color:${DBG.faint};border:1px solid #3a4250;border-radius:2px;padding:0 3px;margin-left:auto}
.tdbg-input{font:inherit;font-size:11px;color:${DBG.text};background:#0d0f12;border:1px solid #363d4a;border-radius:3px;padding:3px 5px;min-width:0;flex:1;
  text-transform:uppercase;letter-spacing:.06em}
.tdbg-input:focus{outline:none;border-color:${DBG.accent}}
.tdbg-note{color:${DBG.faint};font-size:9.5px;line-height:1.35}
.tdbg-foot{padding:5px 8px 6px;color:${DBG.faint};font-size:9.5px;line-height:1.5;border-top:1px solid ${DBG.rule}}
.tdbg-foot kbd{font:inherit;color:${DBG.dim}}
`;

export function ensureStyles(): void {
  if (typeof document === 'undefined' || document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = CSS;
  document.head.appendChild(style);
}

type DockSlot = 'overlay' | 'menu';

let dock: HTMLDivElement | null = null;
let dockUsers = 0;
let lastTop = -1;
let lastRight = -1;
let lastMaxH = -1;
let lastLayoutAt = -1e9;
const onResize = (): void => layoutDock(true);

/** Get (creating on first use) the shared dock and mount `el` in its slot. */
export function mountInDock(el: HTMLElement, slot: DockSlot): void {
  ensureStyles();
  if (!dock) {
    dock = document.createElement('div');
    dock.className = 'tdbg-dock';
    document.body.appendChild(dock);
    window.addEventListener('resize', onResize);
    lastTop = lastRight = lastMaxH = -1;
  }
  el.style.order = slot === 'overlay' ? '0' : '1';
  dock.appendChild(el);
  dockUsers++;
  layoutDock(true);
}

export function unmountFromDock(el: HTMLElement): void {
  el.remove();
  dockUsers = Math.max(0, dockUsers - 1);
  if (dockUsers === 0 && dock) {
    window.removeEventListener('resize', onResize);
    dock.remove();
    dock = null;
  }
}

/**
 * Anchor the dock to the canvas's top-right corner (below the HUD funds).
 * Cheap and rate-limited (the canvas can move when the window is resized
 * or Phaser's FIT scaling kicks in); writes styles only when they change.
 */
export function layoutDock(force = false): void {
  if (!dock) return;
  const now = performance.now();
  if (!force && now - lastLayoutAt < 500) return;
  lastLayoutAt = now;
  const canvas = document.querySelector<HTMLCanvasElement>('#game canvas') ?? document.querySelector<HTMLCanvasElement>('canvas');
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let top = 10;
  let right = 10;
  let bottom = vh - 8;
  if (canvas) {
    const r = canvas.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      // HUD funds block ends at ~96/1080 of the canvas height.
      top = Math.round(Math.max(8, r.top + r.height * (100 / 1080)));
      right = Math.round(Math.max(8, vw - r.right + r.width * (18 / 1920)));
      bottom = Math.min(vh - 8, r.bottom - r.height * (12 / 1080));
    }
  }
  const maxH = Math.max(120, Math.round(bottom - top));
  if (top !== lastTop) dock.style.top = `${(lastTop = top)}px`;
  if (right !== lastRight) dock.style.right = `${(lastRight = right)}px`;
  if (maxH !== lastMaxH) dock.style.maxHeight = `${(lastMaxH = maxH)}px`;
}

/**
 * Fraction (0..1) of the canvas width, measured from its right edge, that the
 * docked panels currently cover (0 when nothing visible is docked). Lets the
 * camera keep the structure out from under the debug menu.
 */
export function dockCoverFraction(): number {
  if (!dock) return 0;
  const canvas = document.querySelector<HTMLCanvasElement>('#game canvas') ?? document.querySelector<HTMLCanvasElement>('canvas');
  if (!canvas) return 0;
  const r = canvas.getBoundingClientRect();
  if (r.width <= 0) return 0;
  let left = Infinity;
  for (const child of Array.from(dock.children)) {
    const cr = (child as HTMLElement).getBoundingClientRect();
    if (cr.width > 0 && cr.height > 0) left = Math.min(left, cr.left);
  }
  if (!isFinite(left)) return 0;
  return Math.max(0, Math.min(0.9, (r.right - left) / r.width));
}

/** Tiny element helper. */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

/** localStorage get/set that never throw (private mode, sandboxed frames). */
export function readPref(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

export function writePref(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* storage unavailable: preference lives for this session only */
  }
}
