/**
 * Between-level workshop. OWNER: UI agent.
 * Shows money, the upgrade catalogue grouped by branch (only branches with
 * defs), each card with name, description, level pips, "from -> to" preview
 * (UpgradeSystem.preview), cost and BUY button (disabled if unaffordable /
 * maxed / locked). Ammo selector for unlocked ammo (sets gameState().selectedAmmo).
 * A "NEXT: <level name>" panel with the next level's subtitle, and a DEPLOY
 * button -> this.scene.start('Game', { mode: 'campaign' }). Save on every purchase.
 * If the campaign is complete (levelIndex >= levelManager.count) say so and
 * deploy into procedural levels.
 */
import * as Phaser from 'phaser';

export class UpgradeScene extends Phaser.Scene {
  constructor() {
    super('Upgrade');
  }

  create(): void {
    // IMPLEMENT (placeholder)
    const { width, height } = this.scale;
    this.add.text(width / 2, height / 2, 'Workshop — click to continue', { fontSize: '40px', color: '#ffffff' }).setOrigin(0.5);
    this.input.once('pointerdown', () => this.scene.start('Game', { mode: 'campaign' }));
  }
}
