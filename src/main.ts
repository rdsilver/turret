import * as Phaser from 'phaser';
import * as RAPIER from '@dimforge/rapier2d';
import { setRapier } from './sim/RapierModule';
import { VIEW_HEIGHT, VIEW_WIDTH } from './config/constants';
import { BootScene } from './scenes/BootScene';
import { MenuScene } from './scenes/MenuScene';
import { GameScene } from './scenes/GameScene';
import { UIScene } from './scenes/UIScene';
import { UpgradeScene } from './scenes/UpgradeScene';

setRapier(RAPIER);

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  width: VIEW_WIDTH,
  height: VIEW_HEIGHT,
  backgroundColor: '#121418',
  antialias: true,
  disableContextMenu: true,
  // index.html's #game flexbox centres the canvas; CENTER_BOTH would add its margins on top.
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.NO_CENTER },
  scene: [BootScene, MenuScene, GameScene, UIScene, UpgradeScene],
});

// Handy for debugging from the console / automated smoke tests.
(window as unknown as { game: Phaser.Game }).game = game;
