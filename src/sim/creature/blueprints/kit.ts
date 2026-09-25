/**
 * Shared building blocks for creature blueprints. Definition space: y up,
 * facing LEFT (toward the turret). Positive muscle angles swing a limb
 * forward (toward the turret).
 */
import type { MuscleGait } from '../CreatureTypes';
import type { StructureDraft } from '../../generator/StructureDraft';
import type { MaterialId } from '../../Materials';

export const G = 12;

export interface LegBuild {
  hip: string;
  knee: string;
  thigh: string;
  shin: string;
  foot: string;
}

/** Thigh + shin + foot hanging from a hip point; returns part/joint ids. */
export function buildLeg(
  d: StructureDraft,
  side: string,
  hipX: number,
  hipY: number,
  o: { thigh: number; shin: number; w: number; mat: MaterialId; density: number; hipTorque: number; kneeTorque: number; hp?: number; footW?: number; omega?: number },
  body: string,
): LegBuild {
  const footH = 0.12;
  const kneeY = footH + o.shin;
  const ids = { thigh: `thigh${side}`, shin: `shin${side}`, foot: `foot${side}`, hip: `hip${side}`, knee: `knee${side}` };
  // Far-side limbs (names ending in R) are drawn darker in the side view.
  const far = side.endsWith('R') ? ['back'] : [];
  d.box(hipX, kneeY + (hipY - kneeY) / 2, o.w, hipY - kneeY + 0.08, o.mat, { id: ids.thigh, densityScale: o.density, tags: ['limb', ...far], hpScale: o.hp });
  d.box(hipX, footH + o.shin / 2, o.w * 0.88, o.shin + 0.06, o.mat, { id: ids.shin, densityScale: o.density, tags: ['limb', ...far], hpScale: o.hp });
  d.box(hipX - 0.1, footH / 2, o.footW ?? 0.46, footH, o.mat, { id: ids.foot, densityScale: o.density, friction: 1.2, tags: ['limb', 'foot', ...far] });
  d.joints.push({ kind: 'muscle', id: ids.hip, a: body, b: ids.thigh, at: [hipX, hipY], seam: o.w, strength: 2.5, muscle: { torque: o.hipTorque, min: -65, max: 80, omega: o.omega ?? 42 } });
  d.joints.push({ kind: 'muscle', id: ids.knee, a: ids.thigh, b: ids.shin, at: [hipX, kneeY], seam: o.w, strength: 2.5, muscle: { torque: o.kneeTorque, min: -140, max: 6, omega: o.omega ?? 42 } });
  d.weld(ids.foot, ids.shin, { at: [hipX, footH], seam: o.w * 0.8, strength: 3 });
  return ids;
}

export function walkerGait(amp: number): Record<string, MuscleGait> {
  return {
    hipL: { shape: 'sin', amp, bias: 0.04, phase: 0 },
    hipR: { shape: 'sin', amp, bias: 0.04, phase: 0.5 },
    kneeL: { shape: 'swing', amp: -0.95, bias: -0.06, phase: 0.25 },
    kneeR: { shape: 'swing', amp: -0.95, bias: -0.06, phase: 0.75 },
    shoulderL: { shape: 'sin', amp: 0.35, bias: 0, phase: 0.5 },
    shoulderR: { shape: 'sin', amp: 0.35, bias: 0, phase: 0 },
  };
}

/** Approximate mass of everything drafted so far (kg) — used to size muscles. */
export function draftMass(d: StructureDraft): number {
  let m = 0;
  for (const p of d.parts) {
    const s = p.shape;
    const area = s.kind === 'box' ? s.w * s.h : s.kind === 'circle' ? Math.PI * s.r * s.r : 0.1;
    const dens = { wood: 520, steel: 7000, armor: 5200, rubber: 1100, core: 1500, iron: 7800, concrete: 2100, glass: 2400, stone: 2500, explosive: 700, cable: 3000, ground: 0 }[p.material] ?? 1000;
    m += area * dens * (p.densityScale ?? 1);
  }
  return m;
}
