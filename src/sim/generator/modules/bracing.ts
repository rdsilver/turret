/**
 * Diagonal bracing inside a rectangular bay (shared by `brace`, `frame`,
 * `tower`). Struts run between the column CENTERLINES so their ends sink
 * into the columns; every strut is welded explicitly to everything it
 * overlaps (columns, beams, the crossing strut). The builder disables
 * contacts between welded overlapping parts, so the overlap does not fight.
 */
import type { MaterialId } from '../../Materials';
import type { PartTag } from '../../StructureDefinition';
import type { StructureDraft } from '../StructureDraft';

export type BracePattern = 'x' | 'single' | 'chevron' | 'v' | 'none';

export interface BayBraceOpts {
  /** Left / right column centerlines (strut ends). */
  x0: number;
  x1: number;
  /** Bay floor (top of whatever it stands on) and ceiling (underside of the beam). */
  y0: number;
  y1: number;
  pattern: BracePattern;
  /** single: +1 rises to the right, -1 rises to the left. */
  dir?: 1 | -1;
  /** Strut thickness (m). */
  t: number;
  material: MaterialId;
  /** Weld strength multiplier. */
  strength?: number;
  /** Seam length for the end welds (default 1.5 t). */
  seam?: number;
  densityScale?: number;
  /** How far chevron / V tips sink into the beam / floor member (m). 0 = no member there. */
  beamPen?: number;
  floorPen?: number;
  tags?: PartTag[];
  /** Candidate parts to weld to (default: all). */
  among?: number[];
}

/** Clearance between strut corners and unwelded members / the ground (> the 0.03 m auto-weld tolerance). */
const MARGIN = 0.07;

/**
 * A strut between two points, inset vertically so its rotated corners stay
 * inside [yLo, yHi] (keeps it off the ground and out of unwelded members).
 */
function insetStrut(xa: number, xb: number, yLo: number, yHi: number, t: number): { y0: number; y1: number } {
  let theta = Math.atan2(yHi - yLo, Math.abs(xb - xa));
  let y0 = yLo;
  let y1 = yHi;
  for (let k = 0; k < 3; k++) {
    const e = MARGIN + (t / 2) * Math.cos(theta);
    y0 = yLo + e;
    y1 = yHi - e;
    theta = Math.atan2(y1 - y0, Math.abs(xb - xa));
  }
  return { y0, y1 };
}

/** Build the braces of one bay; returns the strut part indices. */
export function braceBay(d: StructureDraft, o: BayBraceOpts): number[] {
  if (o.pattern === 'none') return [];
  const struts: number[] = [];
  const po = { tags: o.tags, densityScale: o.densityScale };
  const { x0, x1, t } = o;
  const add = (ax: number, ay: number, bx: number, by: number) => struts.push(d.strut(ax, ay, bx, by, t, o.material, po));
  const h = o.y1 - o.y0;
  if (h < t * 3 || x1 - x0 < t * 3) return [];
  switch (o.pattern) {
    case 'single': {
      const { y0, y1 } = insetStrut(x0, x1, o.y0, o.y1, t);
      if ((o.dir ?? 1) > 0) add(x0, y0, x1, y1);
      else add(x1, y0, x0, y1);
      break;
    }
    case 'x': {
      const { y0, y1 } = insetStrut(x0, x1, o.y0, o.y1, t);
      add(x0, y0, x1, y1);
      add(x1, y0, x0, y1);
      break;
    }
    case 'chevron': {
      // Inverted V: floor corners up to the beam midpoint (tips sink into the beam).
      const pen = o.beamPen ?? 0;
      const xm = (x0 + x1) / 2;
      if (pen <= 0.02) {
        // No beam to land on: fall back to X.
        return braceBay(d, { ...o, pattern: 'x' });
      }
      const { y0 } = insetStrut(x0, xm, o.y0, o.y1, t);
      const yt = o.y1 + Math.min(pen, 0.14);
      add(x0, y0, xm + t * 0.4, yt);
      add(x1, y0, xm - t * 0.4, yt);
      break;
    }
    case 'v': {
      const pen = o.floorPen ?? 0;
      if (pen <= 0.02) return braceBay(d, { ...o, pattern: 'chevron' });
      const xm = (x0 + x1) / 2;
      const { y1 } = insetStrut(x0, xm, o.y0, o.y1, t);
      const yb = o.y0 - Math.min(pen, 0.14);
      add(xm + t * 0.4, yb, x0, y1);
      add(xm - t * 0.4, yb, x1, y1);
      break;
    }
  }
  for (const s of struts) {
    d.weldOverlaps(s, { among: o.among, strength: o.strength, seam: o.seam ?? t * 1.5, tags: ['brace'] });
  }
  return struts;
}
