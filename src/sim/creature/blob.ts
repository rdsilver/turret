/**
 * Blob splitting (ability 'blobSplit'): a blob soaks up damage anywhere on
 * its body into one pool of `hp`; when the pool runs dry it bursts, and if it
 * was big enough (`gen` > 0) two blobs one size smaller (gen - 1) spring out
 * of the splat, one lurching toward the turret and one thrown back, and roll
 * on at the line. The smallest ones (gen 0) just burst. Like the rocks in
 * the arcade game Asteroids: every hit that finishes a blob makes more
 * targets, smaller and faster, until they are all gone.
 *
 * Its parts are too tough to break on their own (the pool always goes first).
 * The new blobs are creatures of their own (creatureSplit, so the game
 * counts them as more to stop); blobSplit tells the view and the sound.
 *
 * Params: hp (the pool: damage points), gen, kid (blueprint of the smaller
 * ones; default: the same), kick (m/s the halves fly apart at).
 */
import { registerAbility } from './abilities';
import type { Creature } from './Creature';
import type { AbilitySpec } from './CreatureTypes';

interface BlobState {
  pool: number;
  burst: boolean;
  off: () => void;
}

const blobs = new WeakMap<Creature, BlobState>();

function num(spec: AbilitySpec, k: string, d: number): number {
  const v = spec[k];
  return typeof v === 'number' ? v : d;
}

registerAbility('blobSplit', {
  init(c, spec, ctx) {
    const st: BlobState = { pool: num(spec, 'hp', 40), burst: false, off: () => {} };
    // (Counted as it lands; the burst itself waits for the next controller step.)
    st.off = ctx.events.on('partDamaged', ({ part, amount }) => {
      if (st.burst || !c.active || !c.owns(part)) return;
      st.pool -= amount;
      if (st.pool <= 0) st.burst = true;
    });
    blobs.set(c, st);
  },
  step(c, spec, ctx) {
    const st = blobs.get(c);
    if (!st?.burst) return;
    st.off();
    blobs.delete(c);
    const w = c.wheel;
    const x = w ? w.hubX : c.core.x;
    const y = w ? w.hubY : c.core.y;
    const gen = num(spec, 'gen', 0);
    const r = w ? w.outer : c.core.extent;
    c.neutralize('killed');
    // The splat: what is left of it goes in a moment.
    for (const p of c.structure.parts) if (!p.removed) ctx.debris.fade(p, 0.35);
    ctx.events.emit('blobSplit', { creature: c, x, y, r, gen });
    if (gen <= 0) return;
    const kick = num(spec, 'kick', 3);
    for (const dir of [-1, 1]) {
      const kid = ctx.creatures.spawn(typeof spec.kid === 'string' ? spec.kid : c.kind, x + dir * r * 0.45, { gen: gen - 1 }, Math.floor(ctx.rng.next() * 0x7fffffff));
      for (const p of kid.structure.parts) p.body.setLinvel({ x: dir * kick, y: -kick * 1.2 }, true);
      ctx.events.emit('creatureSplit', { creature: kid, parent: c });
    }
  },
});
