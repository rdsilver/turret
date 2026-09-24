/**
 * Physics-testbed style mouse dragging: grab a dynamic body at a point with a
 * spring joint to a kinematic "hand" body that follows the cursor; release to
 * throw (the body keeps its velocity). OWNER: debug agent.
 */
import type { Simulation } from '../sim/Simulation';

export class MouseGrabber {
  active = false;

  constructor(readonly sim: Simulation) {}

  /** Try to grab whatever dynamic entity is under (x, y) sim meters. */
  grab(x: number, y: number): boolean {
    void x;
    void y;
    return false; // IMPLEMENT
  }

  move(x: number, y: number): void {
    void x;
    void y;
  }

  release(): void {}

  destroy(): void {}
}
