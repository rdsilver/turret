/** Allocation-free math helpers shared by sim and view. */

export interface Vec2 {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Wrap an angle into (-PI, PI]. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Interpolate angles along the shortest arc. */
export function lerpAngle(a: number, b: number, t: number): number {
  return a + wrapAngle(b - a) * t;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

/** Frame-rate independent exponential approach. */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/** Rotate local point (lx, ly) by angle and translate; writes into out. */
export function localToWorld(x: number, y: number, angle: number, lx: number, ly: number, out: Vec2): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  out.x = x + c * lx - s * ly;
  out.y = y + s * lx + c * ly;
  return out;
}

/** Inverse of localToWorld. */
export function worldToLocal(x: number, y: number, angle: number, wx: number, wy: number, out: Vec2): Vec2 {
  const c = Math.cos(-angle);
  const s = Math.sin(-angle);
  const dx = wx - x;
  const dy = wy - y;
  out.x = c * dx - s * dy;
  out.y = s * dx + c * dy;
  return out;
}

export function len(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}
