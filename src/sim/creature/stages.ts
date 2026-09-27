/**
 * Legs giving out (ability 'legsGiveOut'): a boss stage. Once its organ (a
 * reactor core) has been worn down to `at` of its integrity, the joints
 * named in `joints` (its hips) let go and the legs fall away. A crawler
 * (CreatureSpec.crawl) then drops onto its arms and drags itself on.
 *
 * Params: joints (comma-separated joint ids), at (integrity share, 0..1).
 */
import { registerAbility } from './abilities';
import type { Creature } from './Creature';

const done = new WeakSet<Creature>();

registerAbility('legsGiveOut', {
  step(c, spec, ctx, _dt, organ) {
    if (done.has(c)) return;
    const at = typeof spec.at === 'number' ? spec.at : 0.5;
    if (organ.integrity > at) return;
    done.add(c);
    for (const id of String(spec.joints ?? '').split(',')) {
      const j = c.muscles.get(id.trim());
      if (j && !j.broken) ctx.physics.breakJoint(j, 'damage');
    }
  },
});
