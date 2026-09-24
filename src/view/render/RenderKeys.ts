/**
 * Texture keys private to the render modules (generated alongside the shared
 * TEX keys by TextureFactory.generateCommon). Drawn at TEXTURE_RES texels per
 * world pixel unless noted.
 */
export const RK = {
  /** Dark weld bolt (joint marker), 14x14. */
  weld: 'rk_weld',
  /** White node with dark rim for the stress view (tinted), 16x16. */
  node: 'rk_node',
  /** Hinge: light ring with a dark pin, 26x26. */
  hinge: 'rk_hinge',
  /** Impact reticle for the trajectory preview, 64x64 (world 32 px). */
  reticle: 'rk_reticle',
  /** Soft trajectory dot, 12x12. */
  pdot: 'rk_pdot',
  /** Ground hatch tile (1x), 24x24. */
  hatch: 'rk_hatch',
  /** Turret pedestal / mount (static art). */
  turretBase: 'rk_turret_base',
  /** Turret barrel, pointing +x, origin at the pivot. */
  turretBarrel: 'rk_turret_barrel',
  /** Turret breech hub (sits over the barrel pivot). */
  turretHub: 'rk_turret_hub',
} as const;
