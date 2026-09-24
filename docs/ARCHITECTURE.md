# TURRET — Architecture

A 2D physics demolition game about structural engineering and emergent collapse.
Browser-first: TypeScript + Vite + Phaser 4 (rendering, input, UI, sound) +
Rapier 2D (physics, WASM). Fixed 60 Hz physics.

## Layers

```
src/
  config/constants.ts   Engine-agnostic constants (PPM, arena, physics Hz, turret)
  core/                 EventBus, seeded Random, Pool, math (no engine deps)
  sim/                  PURE simulation (Rapier, no Phaser). Runs in Node too.
    PhysicsWorld.ts       fixed-step Rapier wrapper, entity registry, active pass
    BreakableJoint.ts     measurable welds / hinges / cables with plasticity
    Materials.ts          material table (wood, concrete, steel, glass, ...)
    StructurePart.ts      one rigid component (Entity subclass)
    Structure.ts          parts + joints + incremental collapse metrics
    StructureBuilder.ts   StructureDef (data) -> bodies + joints
    StructureDefinition.ts serialisable part/joint/structure types
    CollapseDetector.ts   physical objectives (no HP bars)
    ChainReactionTracker.ts, DebrisManager.ts, Explosions.ts, Fracture.ts, StatusEffects.ts
    weapons/              Weapon (aim/reload/spread/prediction), ProjectileSystem, Ammo behaviours
    generator/            StructureDraft (builder), StructureGenerator (blueprints -> defs), modules/, ProceduralGenerator
    Simulation.ts         facade used by GameScene AND headless tools
  game/                 meta-game (pure TS): LevelDefinition, LevelManager, LevelSession, Economy, UpgradeSystem, GameState
  data/                 levels/, upgrades.ts, ammo.ts (pure data)
  view/                 Phaser renderers: TextureFactory, WorldRenderer, BackgroundRenderer, TurretView, CameraDirector, EffectsManager
  audio/                SoundSynth (procedural buffers), AudioManager
  ui/                   Hud, ResultsPanel, theme
  debug/                DevOverlay, DebugMenu, MouseGrabber (DOM overlays + testbed tools)
  scenes/               Boot, Menu, Game (orchestrator), UI (screen-space overlay), Upgrade
tools/                  headless Node tools: level-lab (validation), bench (performance)
```

Rules: `sim/`, `core/`, `game/`, `data/` never import Phaser. The view reads sim
state and subscribes to `sim.events`; the sim never references the view
(`entity.view` is an opaque slot the view may use).

## Coordinates

* **Simulation space**: meters, +x right, **+y down**, ground surface at y = 0
  (heights are negative y). Radians, positive = clockwise on screen.
* **World pixels** (Phaser camera space): `px = meters * PPM` (PPM = 30), same
  orientation. `view/coords.ts` has `toPx/toM`.
* **Definition space** (level data, StructureDraft, modules): meters, +x right
  from the structure origin, **+y up** (height above ground), degrees CCW.
  Only `StructureBuilder` converts.

Turret pivot: sim (2.5, -2.6). Structures typically centered at x ≈ 30–60 m.

## Physics model (the heart of the game)

Rapier's JS API cannot report joint forces, so every structural joint is a
Rapier **spring joint with zero rest length** (isotropic linear spring between
two anchor points) plus a **force-based angular position motor** (bending
spring). Load is read back from body transforms every step:
`force = kLin * separation`, `moment = kAng * rotation error`.

Both motors are clamped at the joint's yield load, so an overloaded joint
**yields** instead of holding: plastic rotation becomes permanent (the motor
target follows) and accumulates toward `bendLimit`; linear separation beyond
yield accumulates toward `stretchLimit`. Result:
overload → visible sag / lean + creak (`jointStressed`) → SNAP (`jointBroken`)
→ load redistributes → next joint overloads → cascade.

Contacts stay enabled between welded neighbours: compression goes through
rigid contact, tension/shear/bending through the measured joint.
Stiffness is derived from reduced mass/inertia so every joint rings at
~15 Hz (`JOINT_OMEGA`); strength comes from the bond material × seam length
(tension ∝ seam, bending ∝ seam²) × per-joint `strength` multiplier.

* WELD = linear + angular spring. HINGE = linear only (free rotation).
  CABLE = spring with rest length, disabled while slack (tension only).
* Sleeping: only awake bodies are visited each step (`forEachActiveRigidBody`);
  loose rubble is put to sleep aggressively; everything is pre-settled at load.
* CCD only on projectiles. Impacts are detected from per-body velocity change
  (no scanning of the world); top-N per step are published with contact points.

## Events (`sim/SimEvents.ts`)

`entityAdded/Removed/Fading`, `projectileFired/Impact/Expired`, `impact`,
`jointStressed` (creak), `jointBroken`, `partDetached`, `partFallen`,
`partShattered`, `explosion`, `chainStarted/Updated/Ended`, `bigCollapse`,
`structureLoaded`, `objectiveComplete`, `collapseSettled`.
While `sim.settling` is true (level pre-settle) views should ignore noise.

## Game flow

Boot → Menu → Game(level) → [objectiveComplete → banner → collapseSettled →
results] → Upgrade (workshop) → Game(next) … After level 10: endless seeded
procedural levels. Sandbox mode = GameScene with the debug menu open.

## Data-driven levels & structures

`LevelDef` (game/LevelDefinition.ts) = blueprint (list of module specs) + seed +
objective + par + reward. `StructureGenerator.generateStructure(blueprint, seed,
originX)` stacks registered modules bottom-to-top and auto-welds touching parts
across modules. Modules are functions registered by name in
`sim/generator/modules/*` using the `StructureDraft` API (box/boxOn/strut/
circle/poly, weld/hinge/cable, autoWeld with seam detection, tags).
Same blueprint + seed ⇒ same structure (daily challenges).

Objectives (`sim/CollapseDetector.ts`): `massBelowLine`, `massFallen`,
`comDrop`, `coreDown`, `disconnect`, `all`, `any`.

## Headless tools

* `npx tsx tools/level-lab.ts level03 [--stats base|mid|high] [--sweep quick|full|none] [--brute N] [--png path]`
  validates stability (no breaks while settling/idle, no drift), measures
  one-shot success rate over aims at every part, brute-force shots needed,
  and renders a filmstrip PNG (+ stress heat map PNG) into `tools/out/`.
* `npx tsx tools/bench.ts` — scaling benchmark (100 → 2000 bodies).
