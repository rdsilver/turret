/**
 * End-of-level results: animated count-up of each ScoreLine, grade, titles,
 * lesson learned, buttons: Continue (to upgrades) / Retry. OWNER: UI agent.
 */
import type * as Phaser from 'phaser';
import type { LevelResult } from '../game/Economy';
import type { LevelDef } from '../game/LevelDefinition';

export interface ResultsCallbacks {
  onContinue: () => void;
  onRetry: () => void;
}

export class ResultsPanel {
  visible = false;

  constructor(readonly scene: Phaser.Scene) {}

  show(result: LevelResult, level: LevelDef, cb: ResultsCallbacks): void {
    void result;
    void level;
    void cb; // IMPLEMENT
  }

  hide(): void {
    this.visible = false;
  }

  destroy(): void {}
}
