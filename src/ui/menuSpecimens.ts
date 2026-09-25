/**
 * Hand-built specimens for the main-menu vignette (pure data + StructureDraft
 * calls, no Phaser: they can be validated headlessly). Definition space:
 * meters, y up, x relative to the structure origin.
 */
import type { StructureDraft } from '../sim/generator/StructureDraft';

export interface Specimen {
  name: string;
  build: (d: StructureDraft) => void;
  /** Aim point per shot (definition space, relative to origin, y up); the last one repeats. */
  aims: Array<[number, number]>;
  arc?: 0 | 1;
}

export const SPECIMENS: Specimen[] = [
  {
    name: 'PORTAL FRAME',
    aims: [[-2.2, 1.2], [-1.6, 4.4], [-1.8, 2.2]],
    build: (d) => {
      d.boxOn(-2.2, 0, 0.5, 3, 'concrete');
      d.boxOn(2.2, 0, 0.5, 3, 'concrete');
      d.boxOn(0, 3, 5.4, 0.4, 'wood');
      d.boxOn(-1.8, 3.4, 0.4, 2.4, 'wood');
      d.boxOn(1.8, 3.4, 0.4, 2.4, 'wood');
      d.boxOn(0, 3.4, 1.2, 1.2, 'glass');
      d.boxOn(0, 5.8, 4.4, 0.4, 'wood');
      d.boxOn(-1, 6.2, 1, 1, 'concrete');
      d.boxOn(1, 6.2, 1, 1, 'wood');
      d.boxOn(0, 7.2, 3, 0.3, 'steel');
    },
  },
  {
    name: 'STACKED COLUMN',
    aims: [[0, 2.2], [0, 1.4], [0, 3]],
    build: (d) => {
      const mats = ['concrete', 'wood', 'wood', 'concrete', 'wood', 'glass', 'wood'] as const;
      let y = 0;
      for (let i = 0; i < mats.length; i++) {
        const h = i === 0 ? 1.2 : 1;
        d.boxOn(0, y, i === 0 ? 1.8 : 1.3, h, mats[i]!);
        y += h;
      }
      d.boxOn(0, y, 2.4, 0.3, 'steel');
      d.boxOn(-0.7, y + 0.3, 0.8, 0.8, 'wood');
      d.boxOn(0.7, y + 0.3, 0.8, 0.8, 'wood');
    },
  },
  {
    name: 'MASONRY WALL',
    aims: [[-1.8, 0.3], [-1.8, 0.8], [-1.4, 1.4]],
    build: (d) => {
      const bw = 0.9;
      const bh = 0.5;
      for (let r = 0; r < 9; r++) {
        const n = r % 2 ? 4 : 5;
        for (let c = 0; c < n; c++) {
          const x = (c - (n - 1) / 2) * bw;
          d.boxOn(x, r * bh, bw, bh, r === 8 ? 'concrete' : 'stone');
        }
      }
      d.boxOn(0, 9 * bh, 1.2, 1.2, 'glass');
    },
  },
  {
    name: 'STEPPED PYRAMID',
    aims: [[-1.8, 0.5], [-1.2, 1.3], [-2.2, 2.1]],
    build: (d) => {
      const s = 1;
      for (let r = 0; r < 5; r++) {
        const n = 5 - r;
        for (let c = 0; c < n; c++) {
          const x = (c - (n - 1) / 2) * s;
          d.boxOn(x, r * s, s, s, r % 2 ? 'concrete' : 'wood');
        }
      }
      d.boxOn(0, 5 * s, 0.6, 0.6, 'glass');
    },
  },
  {
    name: 'PIER AND DECK',
    aims: [[-1.6, 2.8], [-1.6, 3.4], [-1.9, 1.2]],
    build: (d) => {
      d.boxOn(-1.8, 0, 0.6, 2.6, 'wood');
      d.boxOn(1.8, 0, 0.6, 2.6, 'wood');
      d.boxOn(0, 2.6, 4.6, 0.4, 'wood');
      d.boxOn(-1.6, 3, 0.9, 0.9, 'wood');
      d.boxOn(1.6, 3, 0.9, 0.9, 'wood');
      d.boxOn(0, 3, 0.9, 0.9, 'glass');
      d.boxOn(0, 3.9, 4.2, 0.3, 'wood');
      d.boxOn(0, 4.2, 1, 1, 'wood');
    },
  },
];
