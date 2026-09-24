/**
 * Draws the simulation: structure parts, fragments, projectiles (+ trails),
 * joints (welds/hinges/cables), the stress heat map and collider debug view.
 * OWNER: render agent.
 *
 * Contract
 *  - Subscribe to sim.events: entityAdded / entityRemoved / entityFading /
 *    jointBroken to create/destroy/fade display objects. Store the display
 *    object in `entity.view` (sim never reads it).
 *  - update(alpha): ONLY iterate `sim.physics.active` (entities awake last
 *    step) plus entities that just went to sleep (final sync) — never all
 *    entities every frame. Interpolate: pos = prev + (cur - prev) * alpha
 *    (angles via lerpAngle). Pixels = meters * PPM (see coords.ts).
 *  - Parts: Image with TextureFactory.partKey(part); alpha from material;
 *    subtle darkening by part.wear. Fading entities: alpha = fading/fadeDuration.
 *  - Joints: small markers at weld anchors; cables as lines (Graphics) between
 *    joint.ax/ay and bx/by, drawn slack (sagging) when joint.slack.
 *    Only redraw joints whose parts are awake.
 *  - Stress view (setStressView): tint parts by max joint.stressVis of their
 *    joints (green -> yellow -> red, pulsing red when yielding) and draw joint
 *    markers colored by stress; show "damage" (joint.damage) as marker size.
 *  - Collider debug (setColliderDebug): draw sim.physics.world.debugRender()
 *    vertices as lines each frame.
 */
import type * as Phaser from 'phaser';
import type { Simulation } from '../sim/Simulation';
import type { TextureFactory } from './TextureFactory';

export class WorldRenderer {
  stressView = false;
  colliderDebug = false;

  constructor(
    readonly scene: Phaser.Scene,
    readonly sim: Simulation,
    readonly textures: TextureFactory,
  ) {}

  update(alpha: number, realDt: number): void {
    void alpha;
    void realDt; // IMPLEMENT
  }

  setStressView(on: boolean): void {
    this.stressView = on;
  }

  setColliderDebug(on: boolean): void {
    this.colliderDebug = on;
  }

  /** Remove all display objects (level change). */
  clear(): void {}

  destroy(): void {}
}
