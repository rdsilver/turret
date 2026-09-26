import * as Phaser from 'phaser';
import * as RAPIER from '@dimforge/rapier2d';
import { setRapier } from './sim/RapierModule';
import { VIEW_HEIGHT, VIEW_WIDTH } from './config/constants';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { UpgradeScene } from './scenes/UpgradeScene';
import { AssaultScene } from './scenes/AssaultScene';

setRapier(RAPIER);

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
  backgroundColor: '#121418',
  antialias: true,
  // Phaser's multi-texture batch picks the sampler with an exact float compare
  // that fails for texture slots 3+ on some rasterisers (whole triangles vanish).
  render: { maxTextures: 3 },
  disableContextMenu: true,
  // index.html's #game flexbox centres the canvas; CENTER_BOTH would add its margins on top.
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER },
  scene: [BootScene, MenuScene, GameScene, AssaultScene, UIScene, UpgradeScene],
});

// Handy for debugging from the console / automated smoke tests.
(window as unknown as { game: Phaser.Game }).game = game;
