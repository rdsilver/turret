/**
 * Ammunition catalogue (pure data). Behaviours are referenced by id; see
 * src/sim/weapons/behaviors.ts. Unlocks are granted by upgrades.
 */
import type { AmmoDef } from '../sim/weapons/Ammo';
import '../sim/weapons/behaviors';

export const AMMO: Record<string, AmmoDef> = {
  standard: {
    id: 'standard',
    name: 'Iron Shot',
    description: 'A solid iron ball. Pure momentum: what you hit gets pushed.',
    radiusScale: 1,
    massScale: 1,
    speedScale: 1,
    restitution: 0.12,
    friction: 0.4,
    color: 0x23272e,
    trailColor: 0xf2f5f8,
    cost: 10,
    lifetime: 3.5,
    behaviors: [],
  },
  explosive: {
    id: 'explosive',
    name: 'HE Shell',
    description: 'Detonates on contact. Snaps nearby joints and sets off explosives.',
    radiusScale: 0.9,
    massScale: 0.6,
    speedScale: 1,
    restitution: 0.1,
    friction: 0.4,
    color: 0xff6a3d,
    trailColor: 0xffb070,
    cost: 45,
    lifetime: 0.1,
    behaviors: [{ id: 'explode', radius: 3.6, power: 0.8 }],
  },
  cluster: {
    id: 'cluster',
    name: 'Cluster Shell',
    description: 'Splits into five bomblets at the top of its arc.',
    radiusScale: 1.1,
    massScale: 0.8,
    speedScale: 1,
    restitution: 0.1,
    friction: 0.4,
    color: 0xffb347,
    trailColor: 0xffd08a,
    cost: 60,
    lifetime: 0.1,
    behaviors: [{ id: 'cluster', count: 5, spread: 0.4, delay: 0.5 }],
  },
  freeze: {
    id: 'freeze',
    name: 'Cryo Round',
    description: 'Changes the physics: joints near impact turn brittle for 6 seconds.',
    radiusScale: 0.9,
    massScale: 0.7,
    speedScale: 1.05,
    restitution: 0.1,
    friction: 0.3,
    color: 0x7fe3ff,
    trailColor: 0xbff3ff,
    cost: 35,
    lifetime: 2,
    behaviors: [{ id: 'embrittle', radius: 4.5, scale: 0.3, seconds: 6 }],
  },
};

export const DEFAULT_AMMO = AMMO.standard!;

export function ammo(id: string): AmmoDef {
  return AMMO[id] ?? DEFAULT_AMMO;
}
