import * as Phaser from 'phaser';

/**
 * Screen-space overlay scene launched on top of GameScene so HUD/results are
 * unaffected by the world camera's zoom/shake. GameScene builds the HUD into it.
 */
export class UIScene extends Phaser.Scene {
  constructor() {
    super('UI');
  }

  create(): void {
    this.events.emit('ui-ready', this);
  }
}
