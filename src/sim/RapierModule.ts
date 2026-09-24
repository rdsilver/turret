/**
 * Rapier is injected at boot so the simulation layer is runtime-agnostic:
 *  - Browser (Vite): `import * as RAPIER from '@dimforge/rapier2d'` (WASM ESM)
 *  - Node tools:     `@dimforge/rapier2d-compat` after `await init()`
 * Both expose the identical API; we only import *types* here.
 */
import type * as RapierNS from '@dimforge/rapier2d';

export type Rapier = typeof RapierNS;
export type { RapierNS };

let rapier: Rapier | null = null;

export function setRapier(module: Rapier): void {
  rapier = module;
}

export function R(): Rapier {
  if (!rapier) throw new Error('Rapier not initialised: call setRapier() at boot');
  return rapier;
}

export function hasRapier(): boolean {
  return rapier !== null;
}
