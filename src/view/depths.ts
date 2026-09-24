/** Render depth (z-order) bands shared by all view modules. */
export const DEPTH = {
  background: 0,
  grid: 1,
  ruler: 2,
  destructionLine: 5,
  ground: 6,
  debris: 9,
  structure: 10,
  joints: 12,
  cables: 13,
  stress: 14,
  projectiles: 15,
  turret: 20,
  trajectory: 25,
  particles: 30,
  flash: 40,
  debug: 50,
} as const;
