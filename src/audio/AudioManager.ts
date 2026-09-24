/**
 * Plays synthesized sounds in response to sim events. OWNER: audio agent.
 * - bind(sim): subscribe to impact, jointBroken, jointStressed (creaks),
 *   partShattered, explosion, projectileFired, projectileImpact, bigCollapse,
 *   objectiveComplete. Volume/pitch scale with physical magnitude; material
 *   selects the family; stereo pan from x position relative to the camera.
 * - Voice limiting: per-category max concurrent voices + min interval; a
 *   global cap so collapses never turn into noise. Random variant + rate jitter.
 * - Plays through Phaser's sound manager (scene.sound.play(key, config)).
 * - Rates follow sim time scale (slow-mo lowers pitch slightly).
 */
import type * as Phaser from 'phaser';
import type { Simulation } from '../sim/Simulation';
import type { SoundId } from './SoundSynth';

export class AudioManager {
  muted = false;
  volume = 0.8;

  constructor(readonly scene: Phaser.Scene) {}

  bind(sim: Simulation): void {
    void sim; // IMPLEMENT
  }

  unbind(): void {}

  play(id: SoundId, opts: { volume?: number; rate?: number; pan?: number } = {}): void {
    void id;
    void opts; // IMPLEMENT
  }

  /** Called every frame with the current sim time scale. */
  update(realDt: number, timeScale: number): void {
    void realDt;
    void timeScale;
  }

  setMuted(m: boolean): void {
    this.muted = m;
  }
}
