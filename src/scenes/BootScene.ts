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
    // Dev convenience: ?assault=1[&level=N] creature campaign, ?play=1[&level=N] demolition
    // campaign, ?sandbox=1 physics sandbox. level=N is 1-based.
    const n = Number(params.get('level') ?? '');
    const levelIndex = params.get('level') && Number.isFinite(n) && n >= 1 ? Math.floor(n) - 1 : undefined;
    if (params.has('sandbox')) this.scene.start('Game', { mode: 'sandbox' });
    else if (params.has('assault')) this.scene.start('Assault', { levelIndex });
    else if (params.has('play')) this.scene.start('Game', { mode: 'campaign', levelIndex });
    else this.scene.start('Menu');
  }
}
