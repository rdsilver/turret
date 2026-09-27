/**
 * Fun stuff for the turret: purely visual extras the workshop sells once
 * every real upgrade is maxed out (nothing changes how the gun shoots).
 * Bought once, then worn or taken off at will. Hats are worn one at a time;
 * everything else goes together. Drawn by view/TurretCosmetics.ts.
 */
export type CosmeticSlot = 'hat' | 'face' | 'paint' | 'fx';

export interface CosmeticDef {
  id: string;
  name: string;
  description: string;
  cost: number;
  slot: CosmeticSlot;
}

export const COSMETICS: CosmeticDef[] = [
  { id: 'sombrero', name: 'Sombrero', description: 'A wide straw sombrero with a red band, perched on the breech.', cost: 400, slot: 'hat' },
  { id: 'tophat', name: 'Top Hat', description: 'Tall, black and very distinguished.', cost: 400, slot: 'hat' },
  { id: 'partyhat', name: 'Party Hat', description: 'A striped paper cone with a pompom. Every level is a party.', cost: 300, slot: 'hat' },
  { id: 'crown', name: 'Crown', description: 'Gold, jewelled, earned.', cost: 900, slot: 'hat' },
  { id: 'googly', name: 'Googly Eyes', description: 'Two big eyes on the pedestal that follow your aim (and wobble when it fires).', cost: 250, slot: 'face' },
  { id: 'mustache', name: 'Mustache', description: 'A magnificent curled mustache under them.', cost: 250, slot: 'face' },
  { id: 'gold', name: 'Gold Plating', description: 'The barrel and breech in polished gold.', cost: 1200, slot: 'paint' },
  { id: 'rainbow', name: 'Rainbow Tracers', description: 'Every round trails a different colour.', cost: 600, slot: 'fx' },
  { id: 'confetti', name: 'Confetti', description: 'A burst of confetti every time a creature is stopped.', cost: 500, slot: 'fx' },
];

/** Hats are worn one at a time. */
export function exclusiveSlot(slot: CosmeticSlot): boolean {
  return slot === 'hat';
}
