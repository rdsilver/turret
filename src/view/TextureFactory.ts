/**
 * Procedural textures (no art assets). OWNER: render agent.
 *
 * - generateCommon(): particle/UI textures listed in TextureKeys (called once in BootScene).
 * - partKey(part): returns (generating on first use, then caching) a texture for a
 *   structure part: material fill + outline + material pattern, sized to the part
 *   in pixels (PPM). Must handle box, circle and poly shapes.
 * - projectileKey(radiusPx, color): cached round-shot texture.
 */
import type * as Phaser from 'phaser';
import type { StructurePart } from '../sim/StructurePart';

export class TextureFactory {
  constructor(readonly scene: Phaser.Scene) {}

  static generateCommon(scene: Phaser.Scene): void {
    void scene; // IMPLEMENT
  }

  partKey(part: StructurePart): string {
    void part;
    return '__DEFAULT'; // IMPLEMENT
  }

  projectileKey(radiusPx: number, color: number): string {
    void radiusPx;
    void color;
    return '__DEFAULT'; // IMPLEMENT
  }
}
