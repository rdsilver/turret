/**
 * Paints chipped geometry (IMPACT_DAMAGE 'chips'; the mesh and the choice of
 * chips live in the sim, sim/Chips.ts). The chipped triangles are cut out of
 * the part's art (destination-out), then every side where a chipped triangle
 * meets an intact one gets the fresh-edge band and the outline, drawn
 * 'source-atop' so only the surviving art takes paint (the half of each
 * stroke over the hole paints nothing). A later chip next to it cuts that
 * stroke away again with its own area.
 */
import type { ChipMesh } from '../../sim/Chips';
import type { CraterGeom, CraterStyle } from './CraterPainter';

/**
 * Cut chipped triangles out of the art (`which`: those, or null for every
 * one) and outline what they leave. The mesh is in part-local metres; (ox, oy)
 * is the body origin in the art's frame and S texels per metre.
 */
export function paintChips(ctx: CanvasRenderingContext2D, m: ChipMesh, which: readonly number[] | null, st: CraterStyle, g: CraterGeom, ox: number, oy: number, S: number): void {
  const list: number[] = [];
  if (which) list.push(...which);
  else for (let i = 0; i < m.state.length; i++) if (m.state[i] === 1) list.push(i);
  if (!list.length) return;
  const q = m.pts;
  const X = (i: number, k: number) => ox + q[i * 6 + k * 2]! * S;
  const Y = (i: number, k: number) => oy + q[i * 6 + k * 2 + 1]! * S;
  ctx.save();
  // 1. The holes (a hairline stroke too, so neighbouring chips leave no seam between them).
  ctx.globalCompositeOperation = 'destination-out';
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  for (const i of list) {
    ctx.moveTo(X(i, 0), Y(i, 0));
    ctx.lineTo(X(i, 1), Y(i, 1));
    ctx.lineTo(X(i, 2), Y(i, 2));
    ctx.closePath();
  }
  ctx.fill();
  ctx.stroke();
  // 2. Fresh edge + outline along every side a chip shares with intact art.
  ctx.globalCompositeOperation = 'source-atop';
  ctx.lineCap = 'round';
  ctx.beginPath();
  for (const i of list) {
    for (let k = 0; k < 3; k++) {
      const o = m.nb[i * 3 + k]!;
      if (o < 0 || m.state[o] !== 0) continue;
      const k2 = (k + 1) % 3;
      ctx.moveTo(X(i, k), Y(i, k));
      ctx.lineTo(X(i, k2), Y(i, k2));
    }
  }
  const hl = Math.max(0.75, g.lw * 0.45);
  ctx.strokeStyle = st.rim;
  ctx.lineWidth = (g.lw + hl) * 2;
  ctx.stroke();
  ctx.strokeStyle = st.edge;
  ctx.lineWidth = g.lw * 2;
  ctx.stroke();
  ctx.restore();
}
