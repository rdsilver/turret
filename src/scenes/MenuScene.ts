/**
 * Main menu. OWNER: UI agent.
 * Title, short tagline, buttons: PLAY (continue campaign at gameState().levelIndex),
 * NEW GAME (resetGameState()), SANDBOX (debug testbed), SEED (enter a seed ->
 * procedural structure; use window.prompt or an in-canvas input), plus a
 * small controls legend. A live physics vignette in the background is welcome.
 * Start the game with: this.scene.start('Game', { mode: 'campaign' | 'sandbox' | 'seed', seed? }).
 */
import * as Phaser from 'phaser';

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create(): void {
    // IMPLEMENT (placeholder so the game is playable before the UI agent runs)
    const { width, height } = this.scale;
    this.add.text(width / 2, height / 2, 'TURRET — click to play', { fontSize: '48px', color: '#ffffff' }).setOrigin(0.5);
    this.input.once('pointerdown', () => this.scene.start('Game', { mode: 'campaign' }));
  }
}
