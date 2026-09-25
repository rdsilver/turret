/**
 * Creature abilities: behaviour attached to an ORGAN part. Destroy or sever
 * the organ and the ability stops — so the counter-play is always "find the
 * part that's doing it and shoot that".
 *
 *  throwRubber – lobs bouncy rubber blocks into the creature's path; bullets
 *                glance off them. (interval, size, ahead, maxLive, lifetime, muscle)
 */
import type { SimContext } from '../SimContext';
import type { Creature } from './Creature';
import type { AbilitySpec } from './CreatureTypes';
import type { StructurePart } from '../StructurePart';
import { spawnPart } from '../StructureBuilder';
import { GROUP, interactionGroups } from '../../config/constants';

export interface CreatureAbility {
  init?(c: Creature, spec: AbilitySpec, ctx: SimContext): void;
  /** Each physics step while the creature is active and the organ is attached. */
  step?(c: Creature, spec: AbilitySpec, ctx: SimContext, dt: number, organ: StructurePart): void;
}

const registry = new Map<string, CreatureAbility>();

export function registerAbility(id: string, a: CreatureAbility): void {
  registry.set(id, a);
}

export function getAbility(id: string): CreatureAbility | undefined {
  return registry.get(id);
}

function num(spec: AbilitySpec, k: string, d: number): number {
  const v = spec[k];
  return typeof v === 'number' ? v : d;
}

interface ThrowState {
  timer: number;
  windup: number;
  live: StructurePart[];
}

const throwState = new WeakMap<Creature, Map<string, ThrowState>>();

registerAbility('throwRubber', {
  init(c, spec) {
    let m = throwState.get(c);
    if (!m) throwState.set(c, (m = new Map()));
    m.set(spec.part, { timer: num(spec, 'delay', 2.5), windup: 0, live: [] });
  },
  step(c, spec, ctx, dt, organ) {
    const st = throwState.get(c)?.get(spec.part);
    if (!st || c.state === 'spawning' || c.power < 0.2) return;
    const muscleName = typeof spec.muscle === 'string' ? spec.muscle : null;
    const arm = muscleName ? c.muscles.get(muscleName) : undefined;
    for (let i = st.live.length - 1; i >= 0; i--) if (st.live[i]!.removed) st.live.splice(i, 1);
    st.timer -= dt;
    // Wind-up animation for the last 0.45 s before a throw.
    if (arm && !arm.broken && st.timer < 0.45 && st.timer > 0) arm.setDrive(ctx.physics.world, num(spec, 'windup', 1.4));
    if (st.timer > 0) return;
    st.timer = num(spec, 'interval', 3.2);
    if (st.live.length >= num(spec, 'maxLive', 4)) return;
    const size = num(spec, 'size', 0.7);
    // Launch from the organ toward the turret so it lands `ahead` metres in front.
    const ahead = num(spec, 'ahead', 5) * (0.8 + ctx.rng.next() * 0.4);
    const T = 0.85;
    const x0 = organ.x - 0.3;
    const y0 = organ.y - 0.2;
    const tx = c.core.x - ahead;
    const ty = -size / 2;
    const g = ctx.physics.gravity;
    const vx = (tx - x0) / T;
    const vy = (ty - y0 - 0.5 * g * T * T) / T;
    const block = spawnPart(
      ctx.physics,
      { shape: { kind: 'box', w: size, h: size * 0.8 }, x: 0, y: 0, material: 'rubber', tags: ['shield'] },
      { x: x0, y: y0, angle: ctx.rng.next() * 0.6, vx, vy, av: (ctx.rng.next() - 0.5) * 6 },
    );
    // Shields block bullets and other rubble but never trip creatures.
    block.collider.setCollisionGroups(interactionGroups(GROUP.STRUCTURE, 0xffff & ~GROUP.CREATURE));
    st.live.push(block);
    if (arm && !arm.broken) arm.setDrive(ctx.physics.world, num(spec, 'release', -1.2));
    ctx.events.emit('creatureAbility', { creature: c, ability: spec.id, x: x0, y: y0 });
    // Shields don't last forever.
    const lifetime = num(spec, 'lifetime', 14);
    const born = ctx.physics.simTime;
    const off = ctx.physics.addStepHook(() => {
      if (block.removed) return off();
      if (ctx.physics.simTime - born > lifetime) {
        ctx.debris.fade(block, 0.8);
        off();
      }
    });
  },
});
