/**
 * Developer overlay (DOM, top-right): FPS, physics step time (avg/max), post-step
 * time, total/active/sleeping bodies, joints, projectiles, debris, time scale.
 * Updates text a few times per second (not every frame). Toggle with F3. OWNER: debug agent.
 */
export interface DevStats {
  fps: number;
  stepMs: number;
  stepMsMax: number;
  postMs: number;
  stepsPerFrame: number;
  bodies: number;
  dynamicBodies: number;
  active: number;
  sleeping: number;
  joints: number;
  projectiles: number;
  debris: number;
  timeScale: number;
  paused: boolean;
}

export class DevOverlay {
  visible = true;

  update(stats: DevStats, realDt: number): void {
    void stats;
    void realDt; // IMPLEMENT
  }

  setVisible(v: boolean): void {
    this.visible = v;
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  destroy(): void {}
}
