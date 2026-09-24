/**
 * Shared helpers for headless Node tools: Rapier init, level loading,
 * scripted shots, and snapshot capture for filmstrip rendering.
 */
import RAPIER from '@dimforge/rapier2d-compat';
import { setRapier, type Rapier } from '../../src/sim/RapierModule';
import { Simulation } from '../../src/sim/Simulation';
import { BASE_WEAPON_STATS, type WeaponStats } from '../../src/sim/weapons/Weapon';
import { solveAim } from '../../src/sim/ballistics';
import type { StructureDef } from '../../src/sim/StructureDefinition';
import type { ObjectiveDef } from '../../src/sim/CollapseDetector';
import { StructurePart } from '../../src/sim/StructurePart';
import { Projectile } from '../../src/sim/weapons/Projectile';
import { PHYSICS_DT } from '../../src/config/constants';

let ready = false;
export async function initRapier(): Promise<void> {
  if (ready) return;
  await RAPIER.init();
  setRapier(RAPIER as unknown as Rapier);
  ready = true;
}

/** Weapon presets approximating campaign progression. */
export const STAT_PRESETS: Record<string, WeaponStats> = {
  base: { ...BASE_WEAPON_STATS },
  mid: { ...BASE_WEAPON_STATS, muzzleVelocity: BASE_WEAPON_STATS.muzzleVelocity * 1.15, projectileMass: BASE_WEAPON_STATS.projectileMass * 1.45 },
  high: { ...BASE_WEAPON_STATS, muzzleVelocity: BASE_WEAPON_STATS.muzzleVelocity * 1.3, projectileMass: BASE_WEAPON_STATS.projectileMass * 2.1 },
};

export function makeSim(def: StructureDef, objective: ObjectiveDef, stats: WeaponStats, seed = 7): Simulation {
  const sim = new Simulation({ seed, weaponStats: { ...stats, spread: 0 } });
  sim.loadStructure(def, objective);
  return sim;
}

export function run(sim: Simulation, seconds: number, onStep?: (t: number) => void): void {
  const n = Math.round(seconds / PHYSICS_DT);
  for (let i = 0; i < n; i++) {
    sim.physics.step();
    onStep?.(sim.physics.simTime);
  }
}

/**
 * Aim at a sim-space point and fire. arc 0 = low (direct), 1 = high (lob).
 * Returns false if unreachable at this power.
 */
export function fireAt(sim: Simulation, x: number, y: number, arc: 0 | 1 = 0, power = 1): boolean {
  const w = sim.weapon;
  w.setPower(power);
  // Iterate because the muzzle position depends on the angle.
  let angle = w.angle;
  for (let k = 0; k < 4; k++) {
    w.setAngle(angle);
    const m = w.muzzle();
    const sol = solveAim(m.x, m.y, x, y, w.speed, sim.physics.gravity);
    if (sol.length === 0) return false;
    angle = sol[arc]!;
  }
  w.setAngle(angle);
  w.reload = 0;
  return w.fire() !== null;
}

// ---------------------------------------------------------------- snapshots

export interface ShapeSnap {
  kind: 'box' | 'circle' | 'poly';
  x: number;
  y: number;
  angle: number;
  hw?: number;
  hh?: number;
  r?: number;
  pts?: number[];
  color: number;
  alpha: number;
  stress: number;
}

export interface FrameSnap {
  t: number;
  shapes: ShapeSnap[];
  joints: { x: number; y: number; stress: number }[];
  line: number | null;
  label: string;
}

export function snapshot(sim: Simulation, label = ''): FrameSnap {
  const shapes: ShapeSnap[] = [];
  for (const e of sim.physics.entities.values()) {
    if (e instanceof StructurePart) {
      let stress = 0;
      for (const j of e.joints) stress = Math.max(stress, j.stressVis);
      const s = e.shape;
      const base = { x: e.x, y: e.y, angle: e.angle, color: e.material.color, alpha: e.material.alpha, stress };
      if (s.kind === 'box') shapes.push({ kind: 'box', hw: s.hw, hh: s.hh, ...base });
      else if (s.kind === 'circle') shapes.push({ kind: 'circle', r: s.r, ...base });
      else shapes.push({ kind: 'poly', pts: s.points, ...base });
    } else if (e instanceof Projectile) {
      shapes.push({ kind: 'circle', r: e.radius, x: e.x, y: e.y, angle: 0, color: 0x111111, alpha: 1, stress: 0 });
    }
  }
  const joints = [...sim.physics.joints].map((j) => ({ x: j.wx, y: j.wy, stress: j.stressVis }));
  return { t: sim.physics.simTime, shapes, joints, line: sim.detector?.lineHeight ?? null, label };
}

function hex(c: number): string {
  return '#' + c.toString(16).padStart(6, '0');
}

function stressColor(s: number): string {
  const t = Math.max(0, Math.min(1, s));
  const r = Math.round(t < 0.5 ? 80 + t * 2 * 175 : 255);
  const g = Math.round(t < 0.5 ? 220 : 220 - (t - 0.5) * 2 * 200);
  return `rgb(${r},${g},60)`;
}

/** Render frames side by side into a PNG using headless Chromium. */
export async function renderFilmstrip(
  frames: FrameSnap[],
  outPath: string,
  view: { left: number; right: number; top: number; bottom: number },
  opts: { stress?: boolean; cols?: number } = {},
): Promise<void> {
  const { chromium } = await import('playwright');
  const W = 480;
  const scale = W / (view.right - view.left);
  const H = Math.round((view.bottom - view.top) * scale);
  const cols = opts.cols ?? Math.min(frames.length, 4);
  const svgs = frames.map((f) => {
    const g: string[] = [];
    g.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#15181d"/>`);
    const gy = (0 - view.top) * scale;
    g.push(`<rect x="0" y="${gy}" width="${W}" height="${H - gy}" fill="#2a2e36"/>`);
    if (f.line !== null) {
      const ly = (-f.line - view.top) * scale;
      g.push(`<line x1="0" x2="${W}" y1="${ly}" y2="${ly}" stroke="#ff5a4e" stroke-dasharray="6 5" stroke-width="1.5"/>`);
    }
    for (const s of f.shapes) {
      const cx = (s.x - view.left) * scale;
      const cy = (s.y - view.top) * scale;
      const fill = opts.stress && s.stress > 0 ? stressColor(s.stress) : hex(s.color);
      const tr = `translate(${cx.toFixed(1)},${cy.toFixed(1)}) rotate(${((s.angle * 180) / Math.PI).toFixed(2)})`;
      if (s.kind === 'box')
        g.push(
          `<rect transform="${tr}" x="${(-s.hw! * scale).toFixed(1)}" y="${(-s.hh! * scale).toFixed(1)}" width="${(s.hw! * 2 * scale).toFixed(1)}" height="${(s.hh! * 2 * scale).toFixed(1)}" fill="${fill}" fill-opacity="${s.alpha}" stroke="#000" stroke-opacity="0.6" stroke-width="0.8"/>`,
        );
      else if (s.kind === 'circle') g.push(`<circle transform="${tr}" r="${(s.r! * scale).toFixed(1)}" fill="${fill}" stroke="#000" stroke-width="0.8"/>`);
      else {
        const pts: string[] = [];
        for (let i = 0; i < s.pts!.length; i += 2) pts.push(`${(s.pts![i]! * scale).toFixed(1)},${(s.pts![i + 1]! * scale).toFixed(1)}`);
        g.push(`<polygon transform="${tr}" points="${pts.join(' ')}" fill="${fill}" fill-opacity="${s.alpha}" stroke="#000" stroke-width="0.6"/>`);
      }
    }
    for (const j of f.joints) {
      const x = (j.x - view.left) * scale;
      const y = (j.y - view.top) * scale;
      g.push(`<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1.8" fill="${opts.stress ? stressColor(j.stress) : '#fff'}" fill-opacity="0.8"/>`);
    }
    g.push(`<text x="6" y="16" fill="#cfd6e0" font-family="monospace" font-size="12">${f.label || 't=' + f.t.toFixed(2) + 's'}</text>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${g.join('')}</svg>`;
  });
  const html = `<html><body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${W}px);gap:4px">${svgs.join('')}</body></html>`;
  const browser = await chromium.launch();
  const rows = Math.ceil(frames.length / cols);
  const page = await browser.newPage({ viewport: { width: cols * (W + 4), height: rows * (H + 4) } });
  await page.setContent(html);
  await page.screenshot({ path: outPath, fullPage: true });
  await browser.close();
}

/** Sim-space view rectangle around a structure. */
export function viewAround(def: StructureDef, pad = 3): { left: number; right: number; top: number; bottom: number } {
  let minX = Infinity,
    maxX = -Infinity,
    maxY = 0;
  for (const p of def.parts) {
    const r = p.shape.kind === 'box' ? Math.max(p.shape.w, p.shape.h) / 2 : p.shape.kind === 'circle' ? p.shape.r : 2;
    minX = Math.min(minX, def.originX + p.x - r);
    maxX = Math.max(maxX, def.originX + p.x + r);
    maxY = Math.max(maxY, p.y + r);
  }
  const w = Math.max(maxX - minX + pad * 2, (maxY + pad) * 1.2);
  const cx = (minX + maxX) / 2;
  return { left: cx - w / 2, right: cx + w / 2, top: -(maxY + pad), bottom: 1.5 };
}
