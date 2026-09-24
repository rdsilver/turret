/**
 * Procedurally synthesized sound effects (no audio files). OWNER: audio agent.
 * registerSynthSounds(scene) renders AudioBuffers (a few variants each) and
 * adds them to scene.cache.audio so Phaser's WebAudio sound manager can play
 * them by key. Must no-op gracefully if WebAudio is unavailable.
 */
import type * as Phaser from 'phaser';

export type SoundId =
  | 'cannon'
  | 'reload'
  | 'impact_wood'
  | 'impact_stone'
  | 'impact_metal'
  | 'impact_glass'
  | 'impact_rubber'
  | 'impact_ground'
  | 'snap_wood'
  | 'snap_stone'
  | 'snap_metal'
  | 'creak_wood'
  | 'groan_metal'
  | 'shatter'
  | 'explosion'
  | 'rumble'
  | 'debris'
  | 'whoosh'
  | 'ui_click'
  | 'ui_buy'
  | 'ui_deny'
  | 'cash'
  | 'collapse_sting';

/** Number of variants generated per sound; keys are `${id}_${n}`. */
export const SOUND_VARIANTS = 3;

export function registerSynthSounds(scene: Phaser.Scene): void {
  void scene; // IMPLEMENT
}
