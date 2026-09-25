/**
 * Level 6 — "Braced Frame".
 *
 * A pin-jointed timber frame, three storeys high. The two upper storeys are four bays of
 * steel X-bracing: every rectangle is split into triangles, so the block above the ground
 * floor is rigid and shrugs off hits. The ground floor is two wide open bays for a shop
 * front, built a few degrees out of plumb, and the only thing keeping it square is a
 * single timber diagonal in the left bay.
 *
 * Knock out the left ground-floor column (the diagonal is fixed to it) and the ground
 * floor becomes what it always was: a rectangle on pins. It racks sideways and folds flat,
 * and the braced block above drops a whole storey in one piece, still perfectly square.
 * Hits anywhere on the braced storeys only rattle it.
 *
 * Why pins: welded moment joints would turn every rectangle into a stiff portal frame. Here
 * the columns bear on the beams (contact carries the compression) and are held at their end
 * centers by hinges, so a column can only rock on its corner. The ground floor leans 5 deg,
 * more than a 0.22 m column can resist by rocking (about 3.7 deg over 3.4 m), so without its
 * diagonal it keeps going on its own.
 *
 * Tuning (npx tsx tools/level-lab.ts level06 --sweep full --brute 6 --stats mid|base):
 *  - gap 0.001: columns must touch the beams. With a real gap the hinges (zero-length
 *    springs) are the only thing holding a column and it buzzes forever, so the frame never
 *    falls asleep and falls apart after the pre-settle. With a 5 mm gap the pins are
 *    pre-tensioned as the columns settle onto the beams, and the upper storeys chatter.
 *  - weakStrength 4.5: the diagonal carries the lean at rest (about a fifth of its
 *    strength). At 3 or below, hits on the braced storeys fold the frame too; 3.5 to 6
 *    behaves the same, because a ground-floor hit knocks the whole triangle out.
 *  - pinFactors [1, 3, 3]: the ground-floor pins are weak (easy to rack); the upper ones are
 *    well above their loads.
 *  - Autosize is off: every joint here is sized by hand.
 */
import type { LevelDef } from '../../game/LevelDefinition';
import { DEFAULT_GRAVITY } from '../../config/constants';
import { registerModule } from '../../sim/generator/StructureGenerator';
import { braceBay, type BracePattern } from '../../sim/generator/modules/bracing';
import { partMass } from '../../sim/generator/modules/sizing';
import { MATERIALS, type MaterialId } from '../../sim/Materials';
import type { PartTag } from '../../sim/StructureDefinition';

const n = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
const DEG = Math.PI / 180;

/**
 * Pin-jointed timber frame. Every column bears on the beam below it (contact carries the
 * compression) and is held at both end centers by a PIN (hinge: no bending strength), so a
 * rectangle of columns and beams can rack freely: only diagonals make a storey rigid.
 *
 * The frame is `bays` x `bayW` wide. Per storey (0 = ground): `heights[s]`, `baysPer[s]`
 * (bays in that storey across the same width), `lean[s]` (deg; columns built leaning
 * right, the storeys above shifted to match), `pinFactors[s]` and `bracing[s][bay]`:
 * 'X' steel X, '/' steel single rising right, '\' rising left, 'w/' / 'w\' timber single
 * diagonal (weak, `weakStrength`, tagged weakpoint), '.' none.
 */
registerModule('level06-frame', (ctx) => {
  const d = ctx.draft;
  const s = ctx.spec;
  const bays = Math.max(1, Math.round(n(s.bays, 3)));
  const storeys = Math.max(1, Math.round(n(s.storeys, 3)));
  const bayW = n(s.bayW, 3);
  const hs = (s.heights as number[]) ?? [];
  const leans = (s.lean as number[]) ?? [];
  const pinFactors = (s.pinFactors as number[]) ?? [];
  const h0 = n(s.h, 2.8);
  const colW = n(s.colW, 0.3);
  const beamH = n(s.beamH, 0.3);
  const gap = n(s.gap, 0.001);
  const mat = (s.material as MaterialId) ?? 'wood';
  const pinFactor = n(s.pinFactor, 1);
  const braceT = n(s.braceT, 0.16);
  const braceStrength = n(s.braceStrength, 6);
  const braceDensity = n(s.braceDensity, 0.1);
  const weakT = n(s.weakT, 0.14);
  const weakStrength = n(s.weakStrength, 1);
  const weakMat = (s.weakMaterial as MaterialId) ?? 'wood';
  const footH = n(s.footH, 0.4);
  const frameDensity = n(s.frameDensity, 1);
  const bracing = (s.bracing as string[][]) ?? [];
  const baysPer = (s.baysPer as number[]) ?? [];
  const W = bays * bayW + colW;
  const colXFor = (nb: number) => Array.from({ length: nb + 1 }, (_, k) => ctx.x - W / 2 + colW / 2 + (k * (W - colW)) / nb);

  const parts: number[] = [];
  const foot = d.boxOn(ctx.x, ctx.baseY, W + 1.2, footH, 'concrete', { id: 'footing', tags: ['foundation'], fixed: true });
  parts.push(foot);
  let ys = ctx.baseY + footH;
  let shift = 0;
  let below = foot;
  const pins: { col: number; beam: number; at: [number, number]; storey: number; ncol: number }[] = [];
  for (let st = 0; st < storeys; st++) {
    const h = hs[st] ?? h0;
    const nb = Math.max(1, Math.round(baysPer[st] ?? bays));
    const colX = colXFor(nb);
    const a = (leans[st] ?? 0) * DEG;
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    // Column axis from B (bottom center) to T (top center); the lowest / highest corners
    // stay `gap` clear of the beams.
    const L = (h - 2 * gap - colW * Math.abs(sa)) / ca;
    const by = ys + gap + (colW / 2) * Math.abs(sa);
    const row: number[] = [];
    const B: [number, number][] = [];
    const T: [number, number][] = [];
    for (let k = 0; k <= nb; k++) {
      const bx = colX[k]! + shift;
      const b: [number, number] = [bx, by];
      const t: [number, number] = [bx + L * sa, by + L * ca];
      const c = d.box((b[0] + t[0]) / 2, (b[1] + t[1]) / 2, colW, L, mat, { id: `col.${st}.${k}`, angle: -(leans[st] ?? 0), densityScale: frameDensity });
      row.push(c);
      B.push(b);
      T.push(t);
      pins.push({ col: c, beam: below, at: b, storey: st, ncol: nb + 1 });
    }
    const nextShift = shift + L * sa;
    const beam = d.boxOn(ctx.x + nextShift, ys + h, W, beamH, mat, { id: `beam.${st}`, densityScale: frameDensity });
    for (let k = 0; k <= nb; k++) pins.push({ col: row[k]!, beam, at: T[k]!, storey: st, ncol: nb + 1 });
    // Diagonals.
    for (let bay = 0; bay < nb; bay++) {
      const tok = bracing[st]?.[bay] ?? '.';
      if (tok === '.' || tok === '') continue;
      const weak = tok.startsWith('w');
      const core = weak ? tok.slice(1) : tok;
      const bm: MaterialId = weak ? weakMat : 'steel';
      const t = weak ? weakT : braceT;
      const strength = weak ? weakStrength : braceStrength;
      const densityScale = bm === 'steel' ? braceDensity : 1;
      const tags: PartTag[] | undefined = weak ? ['weakpoint'] : undefined;
      if (a === 0) {
        const pattern: BracePattern = core === 'X' || core === 'x' ? 'x' : 'single';
        parts.push(
          ...braceBay(d, {
            x0: colX[bay]! + shift,
            x1: colX[bay + 1]! + shift,
            y0: ys,
            y1: ys + h,
            pattern,
            dir: core === '\\' ? -1 : 1,
            t,
            material: bm,
            strength,
            densityScale,
            beamPen: 0,
            floorPen: 0,
            tags,
          }),
        );
        continue;
      }
      // Leaning storey: struts along the column centerlines, inset from the ends.
      const e = 0.28;
      const at = (k: number, f: number): [number, number] => [B[k]![0] + f * sa, B[k]![1] + f * ca];
      const list: [number, number, number, number][] = [];
      if (core === '/' || core === 'X' || core === 'x') list.push([...at(bay, e), ...at(bay + 1, L - e)]);
      if (core === '\\' || core === 'X' || core === 'x') list.push([...at(bay + 1, e), ...at(bay, L - e)]);
      const struts = list.map(([x1, y1, x2, y2]) => d.strut(x1, y1, x2, y2, t, bm, { tags, densityScale }));
      for (const sI of struts) d.weldOverlaps(sI, { among: [row[bay]!, row[bay + 1]!, ...struts], strength, seam: t * 1.5, tags: ['brace'] });
      parts.push(...struts);
    }
    parts.push(...row, beam);
    below = beam;
    ys += h + beamH;
    shift = nextShift;
  }
  // Pins hold the columns in place; compression goes through contact. Their tension strength
  // (per storey: pinFactor x the static load the column carries) is what a column must pull
  // against to rock on its corner, so weak pins = an easily racked storey.
  const g = DEFAULT_GRAVITY;
  const massAbove = (y: number) => {
    let m = 0;
    for (let i = 0; i < d.parts.length; i++) {
      const p = d.parts[i]!;
      if (!p.fixed && d.bounds(i).minY >= y - 0.02) m += partMass(p);
    }
    return m;
  };
  const tension = MATERIALS[mat].bond.tension;
  for (const p of pins) {
    const Bc = d.bounds(p.col);
    const top = p.at[1] > (Bc.minY + Bc.maxY) / 2;
    const load = massAbove(top ? Bc.maxY : Bc.minY - gap) / p.ncol;
    const f = pinFactors[p.storey] ?? pinFactor;
    const strength = Math.max(0.2, (f * load * g) / (tension * colW));
    d.hinge(p.col, p.beam, p.at, { seam: colW, strength: +strength.toFixed(3) });
  }
  return { parts, top: ys, width: W, x: ctx.x + shift };
});

export const level06: LevelDef = {
  id: 'level06',
  name: 'Braced Frame',
  subtitle: 'Two floors of steel triangles on a leaning ground floor and one plank.',
  lesson: 'A triangle cannot change shape without breaking a member, but a pinned rectangle folds at a push: a frame is only as rigid as its least-braced storey.',
  hint: 'The braced floors are solid. The ground floor leans, held square by one timber diagonal: knock out the left column it is fixed to.',
  seed: 6,
  originX: 40,
  blueprint: {
    autoSize: false,
    modules: [
      {
        type: 'level06-frame',
        bays: 4,
        bayW: 2.2,
        storeys: 3,
        baysPer: [2, 4, 4],
        heights: [3.4, 2.6, 2.6],
        lean: [5, 0, 0],
        colW: 0.22,
        gap: 0.001,
        pinFactors: [1, 3, 3],
        braceT: 0.12,
        braceDensity: 0.06,
        braceStrength: 12,
        weakStrength: 4.5,
        bracing: [
          ['w/', '.'],
          ['X', 'X', 'X', 'X'],
          ['X', 'X', 'X', 'X'],
        ],
      },
    ],
  },
  // Explicit line (just under the first floor beam): Structure.height0 uses bounding radii,
  // which the 9 m beams inflate. The braced block has to come down a whole storey; anything
  // from 5.2 to 6.2 m gives the same winners.
  objective: { kind: 'massBelowLine', fraction: 0.6, lineHeight: 5.8 },
  par: 2,
  reward: 400,
};
