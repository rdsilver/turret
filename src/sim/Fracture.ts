/**
 * Brittle fracture: parts whose material has a `shatter` block break into
 * fragments when they experience a hard enough velocity change (a direct
 * cannon hit, a fall, a blast). Fragments are loose debris.
 */
import type { SimContext } from './SimContext';
import { StructurePart } from './StructurePart';
import { spawnPart } from './StructureBuilder';
import type { PartDef } from './StructureDefinition';

const MAX_SHATTERS_PER_STEP = 4;
const MIN_FRAGMENT = 0.12;

export class FractureSystem {
  private queue: { part: StructurePart; dv: number }[] = [];
  /** Global cap on live fragments (oldest are faded by the debris manager). */
  fragmentCount = 0;

  constructor(private readonly ctx: SimContext) {
    ctx.physics.addStepHook(() => this.step());
    ctx.events.on('entityRemoved', ({ entity }) => {
      if (entity instanceof StructurePart && entity.isFragment) this.fragmentCount--;
    });
  }

  private step(): void {
    const physics = this.ctx.physics;
    const n = physics.hardImpactsThisStep;
    for (let i = 0; i < n; i++) {
      const h = physics.hardImpacts[i]!;
      const e = h.entity;
      if (e instanceof StructurePart && !e.isFragment && !e.destroyed && e.material.shatter && h.dv > e.material.shatter.dv) {
        if (!this.queue.some((q) => q.part === e)) this.queue.push({ part: e, dv: h.dv });
      }
    }
    let done = 0;
    while (this.queue.length && done < MAX_SHATTERS_PER_STEP) {
      const q = this.queue.shift()!;
      if (!q.part.removed) {
        this.shatter(q.part, q.dv);
        done++;
      }
    }
  }

  /** Break a part into fragments now. */
  shatter(part: StructurePart, dv = 4): StructurePart[] {
    const physics = this.ctx.physics;
    const rng = this.ctx.rng;
    if (part.removed || part.destroyed) return [];
    const x = part.x;
    const y = part.y;
    const angle = part.angle;
    const vx = part.vx;
    const vy = part.vy;
    const av = part.av;
    const mat = part.material;
    const pieces = mat.shatter?.pieces ?? 4;

    for (let i = part.joints.length - 1; i >= 0; i--) physics.breakJoint(part.joints[i]!, 'shatter');
    if (part.structure) part.structure.onPartDestroyed(part);
    part.destroyed = true;
    physics.removeEntity(part);

    const frags: StructurePart[] = [];
    const shape = part.shape;
    if (shape.kind === 'box') {
      const w = shape.hw * 2;
      const h = shape.hh * 2;
      const aspect = w / h;
      let cols = Math.max(1, Math.round(Math.sqrt(pieces * aspect)));
      let rows = Math.max(1, Math.round(pieces / cols));
      cols = Math.max(1, Math.min(cols, Math.floor(w / MIN_FRAGMENT)));
      rows = Math.max(1, Math.min(rows, Math.floor(h / MIN_FRAGMENT)));
      const cw = w / cols;
      const ch = h / rows;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      for (let cx = 0; cx < cols; cx++) {
        for (let cy = 0; cy < rows; cy++) {
          const lx = -shape.hw + cw * (cx + 0.5);
          const ly = -shape.hh + ch * (cy + 0.5);
          // Split each cell into two triangles along a random diagonal (glassy look).
          const flip = rng.chance(0.5);
          for (let t = 0; t < 2; t++) {
            const hw = cw / 2;
            const hh = ch / 2;
            // Definition-space local points (y up) for a triangle in the cell.
            const tri: [number, number][] = flip
              ? t === 0
                ? [[-hw, -hh], [hw, -hh], [-hw, hh]]
                : [[hw, -hh], [hw, hh], [-hw, hh]]
              : t === 0
                ? [[-hw, -hh], [hw, -hh], [hw, hh]]
                : [[-hw, -hh], [hw, hh], [-hw, hh]];
            const cxm = (tri[0]![0] + tri[1]![0] + tri[2]![0]) / 3;
            const cym = (tri[0]![1] + tri[1]![1] + tri[2]![1]) / 3;
            const pts = tri.map(([px, py]) => [px - cxm, py - cym] as [number, number]);
            // Cell center in sim space (y down): definition y flips sign.
            const clx = lx + cxm;
            const cly = ly - cym;
            const wx = x + c * clx - s * cly;
            const wy = y + s * clx + c * cly;
            const def: PartDef = { shape: { kind: 'poly', points: pts }, x: 0, y: 0, material: mat.id, tags: ['fragment'] };
            const burst = dv * 0.25;
            const f = spawnPart(physics, def, {
              x: wx,
              y: wy,
              angle,
              vx: vx + (rng.next() - 0.5) * burst + (wx - x) * 2,
              vy: vy + (rng.next() - 0.5) * burst + (wy - y) * 2,
              av: av + (rng.next() - 0.5) * 6,
              fragment: true,
            });
            frags.push(f);
          }
        }
      }
    } else {
      // Non-box shapes: fall back to a few chunky squares.
      const size = Math.max(MIN_FRAGMENT, part.extent * 0.6);
      for (let i = 0; i < Math.min(pieces, 4); i++) {
        const def: PartDef = { shape: { kind: 'box', w: size, h: size }, x: 0, y: 0, material: mat.id, tags: ['fragment'] };
        frags.push(
          spawnPart(physics, def, {
            x: x + (rng.next() - 0.5) * part.extent,
            y: y + (rng.next() - 0.5) * part.extent,
            angle: rng.next() * 3,
            vx: vx + (rng.next() - 0.5) * dv * 0.3,
            vy: vy + (rng.next() - 0.5) * dv * 0.3,
            fragment: true,
          }),
        );
      }
    }
    this.fragmentCount += frags.length;
    this.ctx.events.emit('partShattered', { part, fragments: frags, x, y });
    return frags;
  }
}
