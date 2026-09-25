import * as Phaser from 'phaser';
import { TextureFactory } from '../view/TextureFactory';
import { registerSynthSounds } from '../audio/SoundSynth';
import { loadUiFonts } from '../ui/text';

/** Generates procedural textures and sounds, then shows the menu. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  async create(): Promise<void> {
    // The glyph atlas and UI text are drawn with the web fonts; wait for them (max ~4 s).
    await loadUiFonts();
    TextureFactory.generateCommon(this);
    try {
      registerSynthSounds(this);
    } catch (e) {
      console.warn('Sound synthesis failed; continuing without audio', e);
    }
    const params = new URLSearchParams(window.location.search);
    // ?play=1 jumps straight into the campaign, ?sandbox=1 into the sandbox (dev convenience).
    if (params.has('sandbox')) this.scene.start('Game', { mode: 'sandbox' });
    else if (params.has('play')) {
      // level=N is 1-based; anything that is not a number >= 1 falls back to the saved progress.
      const n = Number(params.get('level') ?? '');
      this.scene.start('Game', { mode: 'campaign', levelIndex: params.get('level') && Number.isFinite(n) && n >= 1 ? Math.floor(n) - 1 : undefined });
    }
    else this.scene.start('Menu');
  }
}
