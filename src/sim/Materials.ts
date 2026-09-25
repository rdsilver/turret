/**
 * Material definitions: pure data.
 *
 * Units (2D world, bodies are treated as 1 m deep slabs):
 *   density            kg / m^2
 *   bond.tension       N per meter of seam      -> joint linear yield force
 *   bond.bend          N*m per m^2 of seam      -> joint bending yield moment (scales with seam^2)
 *   bond.stretchLimit  m of anchor separation before a joint snaps (tension/shear)
 *   bond.bendLimit     rad of *plastic* rotation before a joint snaps
 *   bond.stiffness     multiplier on the global joint stiffness (rubber is floppy)
 *
 * New materials are added by appending to MATERIALS; behaviour that is not
 * expressible as data (shatter, detonate) is keyed off the optional blocks.
 */

export type MaterialId =
  | 'wood'
  | 'concrete'
  | 'steel'
  | 'glass'
  | 'rubber'
  | 'stone'
  | 'explosive'
  | 'core'
  | 'cable'
  | 'ground'
  | 'iron'
  | 'armor';

export type SoundFamily = 'wood' | 'stone' | 'metal' | 'glass' | 'rubber' | 'crate';
export type SurfacePattern = 'grain' | 'speckle' | 'plate' | 'glass' | 'rubber' | 'hazard' | 'core' | 'block' | 'none';

export interface BondProps {
  tension: number;
  bend: number;
  stretchLimit: number;
  bendLimit: number;
  stiffness: number;
}

export interface MaterialDef {
  id: MaterialId;
  name: string;
  density: number;
  friction: number;
  restitution: number;
  /** Fill colour (0xRRGGBB). */
  color: number;
  /** Outline colour. */
  outline: number;
  /** Fill alpha (glass is translucent). */
  alpha: number;
  pattern: SurfacePattern;
  sound: SoundFamily;
  /** Colour of dust/splinters emitted when this breaks or impacts. */
  particleColor: number;
  bond: BondProps;
  /**
   * Brittle fracture: when the body experiences a velocity change larger than
   * `dv` (m/s) in a single step it breaks into `pieces` fragments.
   */
  shatter?: { dv: number; pieces: number };
  /** Detonates when hit hard (dv m/s), when caught in another blast, or after a hard fall. */
  explosive?: { radius: number; power: number; triggerDv: number; fuse: number };
  /** Material value (salvage) per kg, feeds the economy. */
  salvage: number;
  /**
   * Hit points per part for weapon damage (bullets), before size scaling
   * (see partMaxHp). Omitted = 10.
   */
  hp?: number;
  /** Fraction of weapon damage absorbed (0 = none, 0.9 = heavy plate). */
  armor?: number;
}

/** Hit points of a part: material hp scaled by size (bigger parts take more hits). */
export function partMaxHp(mat: MaterialDef, area: number): number {
  return (mat.hp ?? 10) * (0.35 + Math.sqrt(Math.max(0.01, area)));
}

const kN = 1000;

export const MATERIALS: Record<MaterialId, MaterialDef> = {
  wood: {
    id: 'wood',
    name: 'Wood',
    density: 520,
    friction: 0.7,
    restitution: 0.08,
    color: 0xe0a458,
    outline: 0x6e4418,
    alpha: 1,
    pattern: 'grain',
    sound: 'wood',
    particleColor: 0xd89a4a,
    // Weak-ish, ductile: sags and creaks visibly before it snaps.
    bond: { tension: 55 * kN, bend: 160 * kN, stretchLimit: 0.05, bendLimit: 0.16, stiffness: 1 },
    salvage: 0.02,
    hp: 8,
  },
  concrete: {
    id: 'concrete',
    name: 'Concrete',
    density: 2100,
    friction: 0.85,
    restitution: 0.02,
    color: 0xa9afb8,
    outline: 0x474c55,
    alpha: 1,
    pattern: 'speckle',
    sound: 'stone',
    particleColor: 0xb8bcc4,
    // Strong in compression (contacts), but joints are brittle: little plastic rotation.
    bond: { tension: 170 * kN, bend: 520 * kN, stretchLimit: 0.02, bendLimit: 0.035, stiffness: 1.4 },
    salvage: 0.012,
  },
  steel: {
    id: 'steel',
    name: 'Steel',
    density: 7000,
    friction: 0.45,
    restitution: 0.05,
    color: 0x6f9fd8,
    outline: 0x243f63,
    alpha: 1,
    pattern: 'plate',
    sound: 'metal',
    particleColor: 0xffd27a,
    // Heavy, very strong, very ductile: bends a long way before letting go.
    bond: { tension: 900 * kN, bend: 2600 * kN, stretchLimit: 0.09, bendLimit: 0.45, stiffness: 2 },
    salvage: 0.02,
    hp: 30,
    armor: 0.55,
  },
  glass: {
    id: 'glass',
    name: 'Glass',
    density: 2400,
    friction: 0.3,
    restitution: 0.05,
    color: 0x9fe8ff,
    outline: 0xe6fbff,
    alpha: 0.55,
    pattern: 'glass',
    sound: 'glass',
    particleColor: 0xc8f4ff,
    bond: { tension: 30 * kN, bend: 70 * kN, stretchLimit: 0.01, bendLimit: 0.01, stiffness: 1 },
    shatter: { dv: 2.6, pieces: 5 },
    salvage: 0.03,
    hp: 3,
  },
  rubber: {
    id: 'rubber',
    name: 'Rubber',
    density: 1100,
    friction: 1.1,
    restitution: 0.72,
    color: 0xff5d8f,
    outline: 0x6e1733,
    alpha: 1,
    pattern: 'rubber',
    sound: 'rubber',
    particleColor: 0xff8fb0,
    bond: { tension: 120 * kN, bend: 140 * kN, stretchLimit: 0.35, bendLimit: 1.2, stiffness: 0.12 },
    salvage: 0.015,
    hp: 40,
    armor: 0.8,
  },
  stone: {
    id: 'stone',
    name: 'Stone',
    density: 2500,
    friction: 0.9,
    restitution: 0.02,
    color: 0xcdbd9c,
    outline: 0x5e5038,
    alpha: 1,
    pattern: 'block',
    sound: 'stone',
    particleColor: 0xd6c8aa,
    bond: { tension: 60 * kN, bend: 150 * kN, stretchLimit: 0.015, bendLimit: 0.02, stiffness: 1.4 },
    salvage: 0.01,
  },
  explosive: {
    id: 'explosive',
    name: 'Explosive',
    density: 700,
    friction: 0.6,
    restitution: 0.05,
    color: 0xff4d2e,
    outline: 0x5c1408,
    alpha: 1,
    pattern: 'hazard',
    sound: 'crate',
    particleColor: 0xffa040,
    bond: { tension: 45 * kN, bend: 120 * kN, stretchLimit: 0.04, bendLimit: 0.12, stiffness: 1 },
    explosive: { radius: 5.5, power: 1, triggerDv: 7, fuse: 0.12 },
    salvage: 0.05,
  },
  core: {
    id: 'core',
    name: 'Core',
    density: 1500,
    friction: 0.7,
    restitution: 0.05,
    color: 0x5dffc1,
    outline: 0x0f6b48,
    alpha: 1,
    pattern: 'core',
    sound: 'metal',
    particleColor: 0x9dffd9,
    bond: { tension: 400 * kN, bend: 900 * kN, stretchLimit: 0.05, bendLimit: 0.3, stiffness: 1.5 },
    salvage: 0.1,
    hp: 14,
  },
  cable: {
    id: 'cable',
    name: 'Cable',
    density: 3000,
    friction: 0.4,
    restitution: 0.0,
    color: 0xd8dde6,
    outline: 0x5a606b,
    alpha: 1,
    pattern: 'none',
    sound: 'metal',
    particleColor: 0xe0e4ea,
    // For cables `tension` is the absolute breaking force (N), not per seam meter.
    bond: { tension: 260 * kN, bend: 0, stretchLimit: 0.12, bendLimit: 0, stiffness: 1 },
    salvage: 0.02,
  },
  iron: {
    id: 'iron',
    name: 'Iron',
    density: 7800,
    friction: 0.4,
    restitution: 0.12,
    color: 0x2b2f36,
    outline: 0x0c0d10,
    alpha: 1,
    pattern: 'none',
    sound: 'metal',
    particleColor: 0xffc36b,
    bond: { tension: 1e7, bend: 1e7, stretchLimit: 1, bendLimit: 1, stiffness: 1 },
    salvage: 0,
  },
  armor: {
    id: 'armor',
    name: 'Armor Plate',
    density: 5200,
    friction: 0.5,
    restitution: 0.15,
    color: 0x7d8794,
    outline: 0x2c323a,
    alpha: 1,
    pattern: 'plate',
    sound: 'metal',
    particleColor: 0xffe08a,
    bond: { tension: 500 * kN, bend: 1400 * kN, stretchLimit: 0.06, bendLimit: 0.3, stiffness: 1.6 },
    salvage: 0.03,
    hp: 40,
    armor: 0.85,
  },
  ground: {
    id: 'ground',
    name: 'Ground',
    density: 0,
    friction: 0.9,
    restitution: 0.02,
    color: 0x2a2e36,
    outline: 0x4a505c,
    alpha: 1,
    pattern: 'none',
    sound: 'stone',
    particleColor: 0x8a8577,
    bond: { tension: 400 * kN, bend: 1200 * kN, stretchLimit: 0.03, bendLimit: 0.05, stiffness: 2 },
    salvage: 0,
  },
};

export function material(id: MaterialId): MaterialDef {
  const m = MATERIALS[id];
  if (!m) throw new Error(`Unknown material ${id}`);
  return m;
}

/** The weaker of two bonds (joints fail at their weakest side). */
export function combineBond(a: BondProps, b: BondProps): BondProps {
  return {
    tension: Math.min(a.tension, b.tension),
    bend: Math.min(a.bend, b.bend),
    stretchLimit: Math.min(a.stretchLimit, b.stretchLimit),
    bendLimit: Math.min(a.bendLimit, b.bendLimit),
    stiffness: Math.min(a.stiffness, b.stiffness),
  };
}
