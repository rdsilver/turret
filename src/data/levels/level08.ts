/**
 * Level 8 — "Keystone".
 *
 * A dry-stone arch bridge: no mortar anywhere, only geometry. Every voussoir is a wedge squeezed
 * between its neighbours by the weight above, so hits from the side just wedge the ring tighter
 * and bounce off. The heavy towers and pylons shrug off everything too.
 *
 * The flaw, visible to anyone who looks: the KEYSTONE was cut upside down. It is wider at the
 * bottom than at the top, so nothing wedges it in place: friction alone holds it. A ball dropped
 * on it from above (a lob) punches it downward; once it slips it loses contact and falls out, the
 * two half-rings have nothing left to push against, the crown folds into a V and the road deck
 * slides into the gap. Knock anything else and the arch just rings.
 */
import type { LevelDef } from '../../game/LevelDefinition';
import { registerModule } from '../../sim/generator/StructureGenerator';
import { polyAt } from '../../sim/generator/modules/util';
import type { MaterialId } from '../../sim/Materials';

const n = (v: unknown, d: number): number => (typeof v === 'number' ? v : d);
type Pt = [number, number];

/**
 * Single-span dry masonry arch bridge (every part rests by gravity and friction: no welds).
 *
 *  - abutments `abutW` wide with a skewback at the springing height `abutH`;
 *  - a segmental voussoir ring: clear `span`, `rise`, thickness `t`, `voussoirs` stones;
 *  - the keystone, `keyW` wide at mid-ring, is `keyTaper` m NARROWER at the top than at the
 *    bottom (the neighbouring stones match it). It rises through the deck to the road surface;
 *  - a tower on each abutment up to the deck, kept `towerGap` m clear of the springer so a
 *    collapsing ring cannot pry itself between tower and skewback;
 *  - two deck halves resting on the stones beside the key and `bearing` m onto each tower;
 *  - a pylon (`pylonH` tall) on the outer part of each tower.
 */
registerModule('level08-bridge', (ctx) => {
  const d = ctx.draft;
  const s = ctx.spec;
  const span = n(s.span, 10);
  const r0 = span / 2;
  const rise = Math.min(n(s.rise, 2.5), r0);
  const t = n(s.t, 0.6);
  let nv = Math.max(5, Math.round(n(s.voussoirs, 11)));
  if (nv % 2 === 0) nv++;
  const abutW = n(s.abutW, 3);
  const abutH = n(s.abutH, 4);
  const keyW = n(s.keyW, 1.4);
  const tap = n(s.keyTaper, 0.42);
  const deckT = n(s.deckT, 0.45);
  const towerGap = n(s.towerGap, 0.4);
  const bearing = n(s.bearing, 0.6);
  const pylonH = n(s.pylonH, 1.2);
  const mat = (s.material as MaterialId) ?? 'stone';
  const b = ctx.baseY;
  const cx = ctx.x;

  // Circle through both springing points with the requested rise.
  const rho = (r0 * r0 + rise * rise) / (2 * rise);
  const R = rho + t;
  const th0 = Math.asin(Math.max(0, Math.min(1, (rho - rise) / rho)));
  const c0 = Math.cos(th0);
  const s0 = Math.sin(th0);
  const yc = b + abutH + rise - rho;
  const yExt = yc + R * s0; // extrados height at the springing
  const yIn = (x: number) => yc + Math.sqrt(rho * rho - x * x);
  const yOut = (x: number) => yc + Math.sqrt(R * R - x * x);
  const xOut = r0 + abutW; // outer faces, from the center
  const parts: number[] = [];

  // Abutments: the skewback follows the radial springing joint.
  for (const sx of [-1, 1]) {
    const pts: Pt[] = [
      [sx * r0, 0],
      [sx * xOut, 0],
      [sx * xOut, yExt - b],
      [sx * R * c0, yExt - b],
      [sx * rho * c0, abutH],
    ];
    parts.push(polyAt(d, cx, b, pts, mat, { id: sx < 0 ? 'abutL' : 'abutR' }));
  }

  // Ring. The key's joints are straight lines from (±wIn, intrados) to (±wOut, extrados) and on
  // up to the road surface (±wTop).
  const a0 = th0;
  const a1 = Math.PI - th0;
  const kIdx = (nv - 1) / 2;
  const wIn = keyW / 2 + tap / 2;
  const wOut = keyW / 2 - tap / 2;
  const deckBase = yOut(wOut);
  const keyTop = deckBase + deckT;
  const wTop = wOut - ((wIn - wOut) * (keyTop - deckBase)) / (deckBase - yIn(wIn));
  for (let v = 0; v < nv; v++) {
    const ta = a0 + ((a1 - a0) * v) / nv;
    const tb = a0 + ((a1 - a0) * (v + 1)) / nv;
    let pts: Pt[] = [
      [rho * Math.cos(ta), yc + rho * Math.sin(ta)],
      [R * Math.cos(ta), yc + R * Math.sin(ta)],
      [R * Math.cos(tb), yc + R * Math.sin(tb)],
      [rho * Math.cos(tb), yc + rho * Math.sin(tb)],
    ];
    const isKey = v === kIdx;
    if (isKey) pts = [[wIn, yIn(wIn)], [wTop, keyTop], [-wTop, keyTop], [-wIn, yIn(-wIn)]];
    else if (v === kIdx - 1) pts = [pts[0]!, pts[1]!, [wOut, deckBase], [wIn, yIn(wIn)]];
    else if (v === kIdx + 1) pts = [[-wIn, yIn(-wIn)], [-wOut, deckBase], pts[2]!, pts[3]!];
    const rel = pts.map(([x, y]) => [x, y - b] as Pt);
    parts.push(polyAt(d, cx, b, rel, mat, isKey ? { id: 'key', tags: ['keystone', 'weakpoint'] } : {}));
  }

  // Towers, deck halves, pylons.
  const towerInner = R * c0 + towerGap;
  for (const sx of [-1, 1]) {
    const side = sx < 0 ? 'L' : 'R';
    parts.push(d.boxOn(cx + (sx * (towerInner + xOut)) / 2, yExt, xOut - towerInner, deckBase - yExt, mat, { id: `tower${side}` }));
    const inner = wOut + 0.01;
    const outer = towerInner + bearing;
    parts.push(d.box(cx + (sx * (inner + outer)) / 2, deckBase + deckT / 2, outer - inner, deckT, mat, { id: `deck${side}` }));
    const pw = xOut - outer - 0.02;
    if (pylonH > 0 && pw > 0.2) parts.push(d.boxOn(cx + sx * (xOut - pw / 2), deckBase, pw, pylonH, mat, { id: `pylon${side}`, tags: ['decor'] }));
  }

  // Dry masonry throughout: no automatic welds (not even to the ground).
  d.markLoose(parts);
  return { parts, top: keyTop + pylonH, width: 2 * xOut, x: cx };
});

export const level08: LevelDef = {
  id: 'level08',
  name: 'Keystone',
  subtitle: 'Dry stone, no mortar, held up by pure geometry. One stone was cut upside down.',
  lesson:
    'An arch carries its load purely in compression: every wedge-shaped stone is squeezed between its neighbours, so hits from the side only jam it tighter. The keystone locks the ring. Take it out and the two halves have nothing left to lean on.',
  hint: 'The arch just shrugs off hits from the side. Look at the keystone: it is upside down and only friction holds it. Lob a shot straight down onto it.',
  seed: 8,
  originX: 42,
  blueprint: {
    modules: [
      {
        type: 'level08-bridge',
        span: 10,
        rise: 2.5,
        t: 0.6,
        voussoirs: 11,
        abutW: 3,
        abutH: 4,
        keyW: 1.4,
        // Friction threshold, tuned (mid stats): 0.36-0.43 = only a lob on / right beside the key
        // releases it; 0.44 = almost any hit on the arch does; >= 0.45 slips during the pre-settle.
        keyTaper: 0.42,
        deckT: 0.45,
        towerGap: 0.4,
        bearing: 0.6,
        pylonH: 1.2,
      },
    ],
  },
  // The line runs just under the road: the deck and the crown have to come down.
  objective: { kind: 'massBelowLine', fraction: 0.6, lineHeight: 6 },
  par: 2,
  reward: 520,
};
