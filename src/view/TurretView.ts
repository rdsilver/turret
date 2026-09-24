/**
 * The player's cannon + trajectory preview. OWNER: render agent.
 *
 * - Large, readable geometric cannon at weapon.pivotX/pivotY (sim meters) on
 *   a platform; barrel rotates to weapon.angle; barrel recoils by weapon.kick;
 *   reload indicator ring/bar around the breech driven by weapon.reloadProgress;
 *   power shown on the barrel (weapon.power).
 * - Trajectory preview: dotted arc from prediction.points (sim meters, flat
 *   array, `count` points); dots fade out after `weapon.stats.previewTime`
 *   seconds of flight; an impact marker at (hitX, hitY) when prediction.hit
 *   and within preview time; widen to a subtle cone for spread
 *   (weapon.stats.spread). Hidden when `showPreview` is false.
 */
import type * as Phaser from 'phaser';
import type { Weapon, TrajectoryPrediction } from '../sim/weapons/Weapon';

export class TurretView {
  showPreview = true;

  constructor(
    readonly scene: Phaser.Scene,
    readonly weapon: Weapon,
  ) {}

  update(realDt: number, prediction: TrajectoryPrediction): void {
    void realDt;
    void prediction; // IMPLEMENT
  }

  destroy(): void {}
}
