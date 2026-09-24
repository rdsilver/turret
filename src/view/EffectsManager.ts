/**
 * Game feel: particles, dust, splinters, sparks, shockwaves, flashes, camera
 * trauma, hit-stop and slow motion. OWNER: effects agent.
 *
 * Listens to sim.events (impact, projectileFired, projectileImpact,
 * jointStressed, jointBroken, partShattered, explosion, bigCollapse,
 * objectiveComplete, entityFading) and reacts proportionally to physical
 * magnitude (energy, impulse, joint rating). Keep effects SUBTLE by default.
 *
 * Time control: `timeScale` is the value GameScene applies to
 * sim.physics.timeScale each frame (unless debug overrides it):
 *  - hit-stop: ~50-90 ms freeze (timeScale 0) on heavy projectile impacts;
 *  - slow motion: on bigCollapse, ease to ~0.35 for ~0.7 s real time and back.
 * Use pooled Phaser particle emitters (emitParticleAt); never create objects per event.
 */
import type * as Phaser from 'phaser';
import type { Simulation } from '../sim/Simulation';
import type { CameraDirector } from './CameraDirector';

export class EffectsManager {
  /** Desired simulation time scale (1 = normal). */
  timeScale = 1;
  /** Allow slow-motion moments (settings/debug). */
  slowMoEnabled = true;

  constructor(
    readonly scene: Phaser.Scene,
    readonly sim: Simulation,
    readonly camera: CameraDirector,
  ) {}

  update(realDt: number): void {
    void realDt; // IMPLEMENT
  }

  /** Remove transient visuals (level change). */
  clear(): void {}

  destroy(): void {}
}
