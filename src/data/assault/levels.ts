/**
 * Creature campaign (assault levels). Pure data: which creatures come, when.
 * The roster grows more complex (armour, engines, abilities, odd gaits) as
 * the campaign goes on.
 */
import type { AssaultLevelDef } from '../../game/AssaultLevel';

export const ASSAULT_LEVELS: AssaultLevelDef[] = [
  {
    id: 'a01',
    name: 'First Contact',
    subtitle: 'A wooden stick figure is walking toward your line.',
    lesson: 'Legs carry the weight. Weaken a knee and the whole thing comes down.',
    hint: 'Hold the trigger on one leg. Let the barrel cool when it glows.',
    seed: 101,
    reward: 80,
    waves: [{ creature: 'stickman', at: 1, params: { speed: 0.7 } }],
  },
  {
    id: 'a02',
    name: 'Pair',
    subtitle: 'Two walkers, a few seconds apart.',
    lesson: 'Stop the closest one first. Overheating at the wrong moment costs you distance.',
    hint: 'Short bursts keep the barrel cool.',
    seed: 102,
    reward: 110,
    waves: [
      { creature: 'stickman', at: 1, params: { speed: 0.75 } },
      { creature: 'stickman', at: 14, params: { speed: 0.85 } },
    ],
  },
  {
    id: 'a03',
    name: 'The Thrower',
    subtitle: 'It hurls rubber blocks into its own path. Bullets bounce off rubber.',
    lesson: 'Find the part doing the work: sever the sling arm and the shields stop.',
    hint: 'Aim above the rubber: the long arm with the metal scoop is the thrower.',
    seed: 103,
    reward: 150,
    waves: [{ creature: 'thrower', at: 1 }],
  },
];
