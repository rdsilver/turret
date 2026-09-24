import * as Phaser from 'phaser';
import { TextureFactory } from '../view/TextureFactory';
import { registerSynthSounds } from '../audio/SoundSynth';

/** Generates procedural textures and sounds, then shows the menu. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    TextureFactory.generateCommon(this);
    try {
      registerSynthSounds(this);
    } catch (e) {
      console.warn('Sound synthesis failed; continuing without audio', e);
    }
    const params = new URLSearchParams(window.location.search);
    // ?play=1 jumps straight into the campaign, ?sandbox=1 into the sandbox (dev convenience).
    if (params.has('sandbox')) this.scene.start('Game', { mode: 'sandbox' });
    else if (params.has('play')) this.scene.start('Game', { mode: 'campaign', levelIndex: params.get('level') ? Number(params.get('level')) - 1 : undefined });
    else this.scene.start('Menu');
  }
}
