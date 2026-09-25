/**
 * Scoring & payouts. REWARD EFFICIENT DEMOLITION: fewer shots, bigger chain
 * reactions and cleaner collapses pay much more than brute force. OWNER: meta agent.
 *
 * Every line scales with the level's `reward` (R) so the balance holds from
 * level 1 to endless mode; only ammunition is an absolute cost.
 *
 *   Demolition      R x destroyed fraction (floor 60%: the objective was met)
 *   Efficiency      0.9R at/under par (+0.15R per shot under par), halving
 *                   for every over-par shot (relative to par)
 *   One-shot        +0.4R when the first shot did it
 *   Chain reaction  up to 0.4R: share of the mass that fell in ONE cascade
 *   Salvage         fallen material value (kg x material.salvage), capped
 *   Speed           up to 0.08R for a quick demolition
 *   Ammunition      - money spent on shells
 *
 * Tuned so a clean one-shot collapse pays ~2.5–3.5x a 6+ shot brute force
 * (see tools/economy-check.ts). The total never drops below a small
 * consolation amount (a line makes up the difference so lines sum to total).
 */
import type { LevelDef } from './LevelDefinition';

export interface LevelOutcome {
  level: LevelDef;
  /** Shots fired (player shots, not sub-munitions). */
  shots: number;
  /** Money spent on ammunition. */
  ammoCost: number;
  /** Sim seconds from level start to objective met. */
  time: number;
  /** 0..1 of structure mass that fell. */
  destroyedFraction: number;
  /** Largest chain reaction. */
  chainJoints: number;
  chainParts: number;
  chainMass: number;
  jointsBroken: number;
  partsFallen: number;
  /** Shot number that completed the objective. */
  winningShot: number;
  /** Salvage value of fallen material (kg * material.salvage). */
  salvage: number;
  /** Structure total mass (kg). */
  totalMass: number;
}

export type ScoreLineKind = 'base' | 'bonus' | 'cost';

export interface ScoreLine {
  label: string;
  detail?: string;
  amount: number;
  kind: ScoreLineKind;
}

export interface LevelResult {
  lines: ScoreLine[];
  total: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  /** Named style achievements, e.g. "ONE SHOT", "DOMINO EFFECT". */
  titles: string[];
}

export type Grade = LevelResult['grade'];

/** Tunables (fractions of the level reward unless noted). */
export const ECONOMY = {
  demolitionFloor: 0.6,
  efficiencyAtPar: 0.9,
  efficiencyPerShotUnder: 0.15,
  oneShot: 0.4,
  chainShare: 0.32,
  chainCount: 0.08,
  /** Joints + parts in one cascade for the full count bonus. */
  chainCountFull: 40,
  /** Minimum cascade size (joints + parts) that counts as a chain at all. */
  chainMin: 3,
  /** Multiplier on raw salvage value (kg * material.salvage). */
  salvageScale: 0.09,
  salvageCap: 0.25,
  speed: 0.08,
  /** Seconds (level start -> objective met) for the full speed bonus... */
  speedFull: 8,
  /** ...and when it reaches zero (+ speedPerPar per par shot above 1). */
  speedZero: 30,
  speedPerPar: 6,
  /** Minimum payout: fraction of R, and absolute. */
  consolation: 0.2,
  consolationMin: 10,
  /** Destroyed fraction for TOTAL DEMOLITION. */
  totalDemolition: 0.95,
  /** DOMINO EFFECT: cascade size and share of the structure's mass. */
  dominoCount: 12,
  dominoShare: 0.4,
} as const;

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Shots at or beyond which a clear counts as brute force (>= 3x par, at least par + 3). */
export function bruteForceShots(par: number): number {
  const p = Math.max(1, Math.round(par));
  return Math.max(3 * p, p + 3);
}

/** Efficiency multiplier 0..~1 for `shots` vs `par` (1 at par, halves per over-par step). */
export function efficiencyFactor(shots: number, par: number): number {
  const p = Math.max(1, par);
  const s = Math.max(1, shots);
  if (s <= p) return 1 + ((p - s) * ECONOMY.efficiencyPerShotUnder) / ECONOMY.efficiencyAtPar;
  // For larger pars one extra shot matters less: decay per max(1, par/2) shots.
  return Math.pow(0.5, (s - p) / Math.max(1, p / 2));
}

/** Grade from shots vs par, adjusted by how much of the structure came down. */
export function gradeFor(shots: number, par: number, destroyedFraction: number): Grade {
  const p = Math.max(1, Math.round(par));
  const s = Math.max(1, shots);
  let pts: number;
  if (s <= p) pts = 4;
  else if (s <= p + 1) pts = 3;
  else if (s <= p + Math.max(2, Math.ceil(p * 0.67))) pts = 2;
  else if (s <= Math.max(p + 4, 3 * p - 1)) pts = 1;
  else pts = 0;
  const f = destroyedFraction;
  // S needs a substantial collapse, not a lucky topple of the objective.
  if (pts === 4 && f < 0.75) pts = 3;
  // A thorough (if slow) demolition lifts C to B — but not brute force; a scrappy partial one drops a grade.
  if (pts === 1 && f >= ECONOMY.totalDemolition && s < bruteForceShots(p)) pts = 2;
  if (f < 0.5 && pts > 0) pts--;
  return (['D', 'C', 'B', 'A', 'S'] as const)[pts]!;
}

export function scoreLevel(o: LevelOutcome): LevelResult {
  const E = ECONOMY;
  const R = Math.max(1, o.level.reward);
  const par = Math.max(1, Math.round(o.level.par));
  const shots = Math.max(0, o.shots);
  const f = clamp01(o.destroyedFraction);
  const lines: ScoreLine[] = [];
  const titles: string[] = [];
  const add = (label: string, amount: number, kind: ScoreLineKind, detail?: string): void => {
    lines.push({ label, amount: Math.round(amount), kind, detail });
  };

  // 1. Demolition: what came down.
  add('Demolition', R * Math.max(E.demolitionFloor, f), 'base', `${pct(f)} of the structure down`);

  // 2. Efficiency: shots vs par (always listed, so a brute-force run sees what it missed).
  // No shots (the structure failed on its own): nothing to be efficient about.
  const eff = shots > 0 ? efficiencyFactor(shots, par) : 0;
  const under = par - Math.max(1, shots);
  const shotsText = shots > 0 ? `${shots} shot${shots === 1 ? '' : 's'} · par ${par}` : 'no shots fired';
  add('Efficiency', R * E.efficiencyAtPar * eff, 'bonus', under > 0 ? `${shotsText} · ${under} under par` : shotsText);

  // 3. One shot.
  const oneShot = shots === 1;
  if (oneShot) add('One-shot bonus', R * E.oneShot, 'bonus', 'first shot brought it down');

  // 4. Chain reaction: how much fell in a single cascade.
  const chainCount = Math.max(0, o.chainJoints) + Math.max(0, o.chainParts);
  const share = o.totalMass > 0 ? clamp01(o.chainMass / o.totalMass) : 0;
  if (chainCount >= E.chainMin) {
    const amount = R * (E.chainShare * share + E.chainCount * clamp01(chainCount / E.chainCountFull));
    if (amount >= 1) add('Chain reaction', amount, 'bonus', `${o.chainJoints} joints · ${o.chainParts} parts · ${pct(share)} of mass`);
  }

  // 5. Salvage: fallen material value.
  const salvage = Math.min(Math.max(0, o.salvage) * E.salvageScale, R * E.salvageCap);
  if (salvage >= 1) add('Salvage', salvage, 'bonus', `${tonnes(f * o.totalMass)} of material recovered`);

  // 6. Speed.
  const zero = E.speedZero + E.speedPerPar * (par - 1);
  const speedK = clamp01((zero - o.time) / (zero - E.speedFull));
  if (R * E.speed * speedK >= 1) add('Speed', R * E.speed * speedK, 'bonus', `down in ${o.time.toFixed(1)} s`);

  // 7. Ammunition.
  if (o.ammoCost > 0) add('Ammunition', -o.ammoCost, 'cost', `${shots} shell${shots === 1 ? '' : 's'}`);

  // Floor: never negative, always a small consolation.
  let total = 0;
  for (const l of lines) total += l.amount;
  const floor = Math.max(E.consolationMin, Math.round(R * E.consolation));
  if (total < floor) {
    add('Minimum payout', floor - total, 'bonus', 'contract minimum');
    total = floor;
  }

  // Titles.
  const brute = shots >= bruteForceShots(par);
  if (oneShot) titles.push('ONE SHOT');
  if (chainCount >= E.dominoCount && share >= E.dominoShare) titles.push('DOMINO EFFECT');
  if (f >= E.totalDemolition) titles.push('TOTAL DEMOLITION');
  if (!oneShot && shots > 0 && shots <= par) titles.push('SURGICAL');
  if (brute) titles.push(f >= E.totalDemolition ? 'OVERKILL' : 'BRUTE FORCE');

  // A structure that failed without a shot earns a neutral grade.
  return { lines, total, grade: shots > 0 ? gradeFor(shots, par, f) : 'C', titles };
}

function tonnes(kg: number): string {
  return kg >= 1000 ? `${(kg / 1000).toFixed(kg >= 10000 ? 0 : 1)} t` : `${Math.round(kg)} kg`;
}

function pct(v: number): string {
  return `${Math.round(clamp01(v) * 100)}%`;
}
