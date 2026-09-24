/**
 * Closed-form ballistic helpers (no drag), sim space (y down, gravity +y).
 */

/**
 * Launch angles (sim space, radians; negative = up) that pass through the
 * target from the origin at the given speed. Returns [low, high] arcs, or []
 * if the target is out of range.
 */
export function solveAim(ox: number, oy: number, tx: number, ty: number, speed: number, g: number): number[] {
  const dx = tx - ox;
  const dy = -(ty - oy); // convert to y-up
  const v2 = speed * speed;
  const disc = v2 * v2 - g * (g * dx * dx + 2 * dy * v2);
  if (disc < 0 || Math.abs(dx) < 1e-6) return [];
  const root = Math.sqrt(disc);
  const low = Math.atan2(v2 - root, g * dx);
  const high = Math.atan2(v2 + root, g * dx);
  // back to sim-space angles (y down => negate)
  return [-low, -high];
}

/** Position along a ballistic path after t seconds. */
export function ballisticPoint(ox: number, oy: number, angle: number, speed: number, g: number, t: number, out: { x: number; y: number }) {
  out.x = ox + Math.cos(angle) * speed * t;
  out.y = oy + Math.sin(angle) * speed * t + 0.5 * g * t * t;
  return out;
}
