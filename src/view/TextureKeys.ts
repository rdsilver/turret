/**
 * Shared procedural texture keys, generated once in BootScene by
 * TextureFactory.generateCommon(). Effects/UI may rely on these existing.
 */
export const TEX = {
  /** 8x8 white square (tint it). */
  pixel: 'tex_pixel',
  /** 32x32 soft round blob, white, alpha falloff (dust, smoke). */
  soft: 'tex_soft',
  /** 16x16 hard white circle. */
  dot: 'tex_dot',
  /** 12x4 white sliver (splinters, sparks streaks). */
  sliver: 'tex_sliver',
  /** 10x10 white triangle (glass shards, debris chips). */
  shard: 'tex_shard',
  /** 64x64 white ring (shockwaves, impact rings). */
  ring: 'tex_ring',
  /** 64x64 radial glow (flashes, explosions, core glow). */
  glow: 'tex_glow',
  /** Joint marker (bolt), 10x10 white with dark outline. */
  bolt: 'tex_bolt',
} as const;
