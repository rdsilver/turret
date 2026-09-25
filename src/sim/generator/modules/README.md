# Structure modules

Level blueprints are lists of **modules**. `generateStructure(blueprint, seed, originX)`
(`../StructureGenerator.ts`) runs them bottom-to-top and returns a `StructureDef`.
Importing `src/sim/generator/modules` registers every module.

Validate any blueprint with `npx tsx tools/level-lab.ts <level>`. Validate the modules and the
procedural generator with `npx tsx tools/gen-lab.ts` (add `--png` for galleries in `tools/out/`).

```ts
blueprint: {
  modules: [
    { type: 'foundation', w: 8 },
    { type: 'tower', storeys: 3, w: 5, brace: 'x', weakStorey: 0 },
    { type: 'roof', style: 'gable' },
  ],
}
```

## Conventions

* **Definition space**: meters, x to the right of the blueprint origin, **y up** (height
  above ground), angles in degrees counter-clockwise. The ground is y = 0.
* **Cursor**: each module sits on the cursor, which starts at `(x 0, y 0, width 6)`. It
  returns its `top`, `width` and center `x`, and the next module stacks on that. Stacking is
  the normal case: a foundation, then storeys, then a top.
* **Welding**: a module welds its own parts. After all modules are built, the generator welds
  touching parts that belong to *different* modules, plus anything resting on the ground.
  You never weld storeys together by hand.
* **Materials**: `wood`, `concrete`, `steel`, `stone`, `glass`, `rubber`, `explosive`,
  `core`, `iron` (see `src/sim/Materials.ts`). An unknown material falls back to the
  module's default.
* **Randomness**: modules are deterministic for a given spec. `tower.jitter` and
  `stack.jitter` add seeded variation from the blueprint seed. The same blueprint and seed
  always give the same structure.
* **Steel** members (columns, beams, trusses, decks) use `densityScale` 0.4, like hollow
  sections, and steel brace rods use 0.2. A solid 1 m deep steel slab would weigh tonnes per
  meter.

### Keys every module spec accepts

| key | meaning |
|---|---|
| `type` | module name (below) |
| `x` | center x (m). Default: the cursor x |
| `y` | base height (m). Default: the cursor (top of the previous module) |
| `detached` | `true`: do not move the cursor. Use it for side-by-side pieces, e.g. two towers at `x: -3` / `x: 3` |
| `loose` | `true`: no automatic welds to other modules or the ground; the module rests by gravity |
| `seamStrength` | strength multiplier for the automatic welds between this module and its neighbours (the lower of the two sides wins). Makes a deliberate weak storey joint |
| `id` | part id. Modules with several named parts append `.suffix` (e.g. `beam0`, `key`, `core`) |
| `tags` | extra part tags, as a comma separated string or an array (e.g. `'weakpoint'`) |

### Blueprint keys

| key | default | meaning |
|---|---|---|
| `weldBetween` | `true` | automatic welds between modules and to the ground |
| `interModuleStrength` | 1 | strength of those automatic welds |
| `autoSize` | `true` (factor 1.35) | **load-aware joint sizing**: welds that carry static load get at least 1.35 × that load as yield force, so heavy stacks don't sit at yield after settling. Joints that carry no static load are untouched, and deliberately weak joints stay proportionally weak. `false` turns it off; a number sets the factor |
| `tether` | `true` | parts with no joint at all get a slack, weak cable tagged `'tether'` to what they rest on (see *Known limits*) |

### Tags that gameplay uses

`core` (the `coreDown` objective), `foundation` (not counted as structure mass or as a target),
`keystone`, `weakpoint` (hint and validation marker), `counterweight`, `weight`, `barrel`,
`crate`, `decor`, `lintel`. Joint tags: `brace`, `mortar`, `weakpoint`, `backstay`, `tether`.

---

## Foundations and supports

### `foundation`
A wide concrete footing welded to the ground. Tagged `foundation` by default, so it does
not count toward collapse objectives and the level-lab never aims at it.

| param | default | |
|---|---|---|
| `w` | cursor width + 2 | width of the bottom step |
| `h` | 0.5 | height of each step |
| `steps` | 1 | stepped footing: each step is `2·inset` narrower |
| `inset` | 0.5 | per-side inset per step |
| `material` | `concrete` | |
| `tag` | `true` | tag the parts `foundation` |
| `fixed` | `false` | static bodies |

Returns the top step's width.

### `column` / `pillar`
A single post. `column` defaults to concrete; `pillar` defaults to stone.

| param | default | |
|---|---|---|
| `w`, `h` | 0.4, 3 | section width and total height |
| `material` | `concrete` / `stone` | |
| `segments` | 1 | stack of welded drums (stone pillars) |
| `strength` | 1 | weld strength between the drums |
| `capital` / `plinth` | `false` | wider block on top / at the base (`capW` = 2w, `capH` 0.3) |
| `dx` | 0 | offset from the cursor |

---

## Frames and storeys

### `frame` (legacy, `basic.ts`)
One post-and-beam storey. Params: `w`, `h` (3), `columns` (2), `colW` (0.35), `beamH` (0.3),
`material` (`wood`), `beamMaterial`, `strength`, `weakColumn` (index; that column's joints get
0.3 × strength and the tag `weakpoint`).
Optional bracing in every bay: `brace` (`'none'|'x'|'single'|'chevron'|'v'`), `braceDir`
(1 / -1 / `'alt'`), `braceT` (0.16), `braceMaterial`, `braceStrength`, and `skipBay` (a bay
left unbraced).

### `tower`
A stack of post-and-beam storeys. This is the main building block.

| param | default | |
|---|---|---|
| `storeys` | 3 | |
| `w` | cursor width (min 2) | outer width |
| `h` | 2.8 | column height per storey (the beam adds `beamH`) |
| `columns` | 2 | columns per storey (3+ = redundancy) |
| `colW`, `beamH` | 0.35, 0.3 | |
| `material`, `beamMaterial` | `wood`, material | |
| `strength` | 1 | column-beam weld strength |
| `taper` | 0 | width lost per storey (m) |
| `brace` | `'none'` | `'x'`, `'single'`, `'alt'` (single, alternating direction per storey), `'chevron'`, `'v'` |
| `braceFrom` | 0 | first braced storey |
| `skipBrace` | -1 | one storey left unbraced (a weakness) |
| `braceT`, `braceMaterial`, `braceStrength` | 0.16, material, strength | |
| `weakStorey`, `weakColumn` | -1, 0 | that column's joints at 0.3 × strength, tagged `weakpoint` |
| `glass` | `false` | glass panes stand loose in the unbraced bays and shatter when disturbed |
| `jitter` | 0 | seeded ± variation of storey height (fraction) |

Beams get ids `<id>.beam0..n` when an `id` is given. Returns the top storey's width.

### `brace`
Adds diagonal bracing to the **previous** module's bay(s): a frame, a tower's top storey,
or anything with columns at its edges. The strut ends sink into the column centerlines and
are welded to everything they overlap. Passive: the cursor does not move.

| param | default | |
|---|---|---|
| `pattern` | `'x'` | `'x'`, `'single'`, `'chevron'` (inverted V into the beam), `'v'` (needs a floor member; on the ground it falls back to chevron) |
| `dir` | 1 | single: 1 rises to the right, -1 to the left |
| `t` | 0.16 | strut thickness |
| `material` | `steel` | |
| `strength` | 1 | |
| `bays` | 1 | split the width into equal bays |
| `colW` | 0.35 | column width of the braced frame (the struts end at the centerlines) |
| `w`, `dx` | previous width, 0 | |
| `y0`, `y1`, `beamH` | previous base, previous top − beamH, 0.3 | bay floor and ceiling |

### `platform` / `floor`
A horizontal deck.

| param | default | |
|---|---|---|
| `w` | cursor width + 2·overhang | |
| `h` | 0.3 | |
| `overhang` | 0 | |
| `material` | `wood` | |
| `planks` | 1 | segments welded end to end. Only planks resting on something carry load, so span with 1 plank |
| `strength`, `weak` | 1, -1 | plank seam strength; `weak` = index of a seam at 0.3 × |
| `parapet`, `parapetH` | `false`, 0.8 | end posts |
| `dx` | 0 | |

### `slab` (legacy)
A single beam: `w` (cursor width), `h` (0.35), `material`, `dx`, `id`.

### `block`, `stack`, `parts` (legacy)
`block`: one box (`w`, `h`, `material`, `dx`, `angle`, `fixed`, `densityScale`).
`stack`: `count` boxes (`w`, `h`, `taper`, `jitter`, `weld`, `strength`).
`parts`: explicit parts `[{x, y, w, h, material, angle?, shape?: 'circle', r?, id?, tags?}]`
relative to the cursor, auto-welded unless `weld: false`.

---

## Spans and roofs

### `truss`
A planar truss spanning `w`. It rests on whatever is below its ends (piers, frames).

| param | default | |
|---|---|---|
| `w` | cursor width | span |
| `h` | 1.2 | depth |
| `style` | `'warren'` | `'warren'` (alternating diagonals, end posts), `'pratt'` (verticals + diagonals falling toward the center), `'howe'` (verticals + diagonals rising toward the center) |
| `panels` | ≈ w/h | even for pratt/howe |
| `material` | `steel` | wood works too (give it `webT` 0.16, `chordT` 0.22) |
| `chordT`, `webT` | 0.18, 0.12 | |
| `strength` | 1 | web weld strength |
| `verticals` | `false` | warren only |

Chords get ids `<id>.top` and `<id>.bottom`.

### `roof`
| param | default | |
|---|---|---|
| `style` | `'gable'` | `'gable'` (solid triangle), `'hip'` (trapezoid, `topW`), `'shed'` (sloped, `dir`: 1 = high side right, `t` = low-side thickness), `'slab'` (flat, `h` = thickness 0.35), `'rafters'` (tie beam + two rafters + king post, `t` 0.25, `kingPost`) |
| `w` | cursor width + 2·overhang | |
| `overhang` | 0.3 | |
| `h` | 0.3·w | rise |
| `material` | `wood` | a solid concrete gable weighs ~10 t, so use `slab` for concrete |
| `dx`, `strength` | 0, 1 | |

### `arch`
A voussoir arch between two abutments. The middle voussoir is tagged `keystone` (id
`<id>.key`).

| param | default | |
|---|---|---|
| `span` | 4 | inner clear span |
| `rise` | span/2 | semicircle; lower = segmental arch with sloped skewbacks |
| `t` | 0.6 | ring thickness |
| `voussoirs` | 9 | forced odd |
| `material` | `stone` | |
| `abutW`, `abutH`, `abutMaterial` | max(1.2, t+0.6), 1.2, material | abutment width, springing height |
| `mortar` | 0 | 0 = **dry**: stands by thrust and friction; knock the keystone and it falls. Any value > 0 welds the voussoirs; it is raised automatically to the minimum that holds the ring (about 2 for stone). Weaker mortar cracks at the haunches under self-weight |
| `deck` | `false` | spandrel posts on the abutments plus a flat deck resting on the keystone (`deckT` 0.35, `deckMaterial` wood, `postW` 0.4) |

Returns the crown top, or the deck top when `deck` is on.

### `cableStay`
A deck held by stay cables from a central mast, with end piers.

| param | default | |
|---|---|---|
| `span` | 12 | total deck length |
| `deckY`, `deckT` | 2.5, 0.35 | deck underside above base, thickness |
| `segments` | 3 | deck segments per side, one stay each |
| `material` | `wood` | deck |
| `mastH`, `mastW`, `mastMaterial` | 5 (above the deck), 0.5, `concrete` | |
| `pierW`, `pierMaterial` | 0.5, mastMaterial | |
| `style` | `'fan'` | `'fan'` (all stays near the mast top) or `'harp'` (parallel) |
| `cableStrength`, `strength` | 1, 1 | |
| `weakCable` | -1 | index of a stay at 0.35 × strength (tag `weakpoint`) |

The mast gets id `<id>.mast`.

### `suspension`
Two pylons, a sagging chain of steel links on pins, vertical hangers, a deck, and backstay
cables anchored to the ground behind each pylon.

| param | default | |
|---|---|---|
| `span` | 14 | pylon to pylon |
| `deckY`, `deckT` | 2.5, 0.3 | |
| `segments` | 6 | deck segments (one hanger per joint) |
| `material` | `wood` | deck |
| `pylonH`, `pylonW`, `pylonMaterial` | 5 (above the deck), 0.6, `concrete` | |
| `sag` | 0.8 | chain low point above the deck |
| `linkT` | 0.12 | |
| `backstay` | max(2.5, 0.7·pylonH) | anchor distance behind the pylons (0 = none, and the pylons topple) |
| `strength`, `cableStrength` | 1, 1 | |

---

## Balance and loads

### `cantilever`
A beam projecting from a support.

| param | default | |
|---|---|---|
| `w` | 5 | beam length |
| `overhang` | 3 | projection beyond the support face |
| `side` | `'right'` | or `'left'` (the turret is on the left) |
| `beamH`, `material` | 0.35, `wood` | |
| `support` | `'auto'` | `'column'` (own post), `'none'` (projects from the edge of the module below), `'auto'` (own post on the ground, otherwise none) |
| `supportW`, `supportH`, `supportMaterial` | 0.6, 3, material | |
| `tipLoad`, `tipMaterial` | 0, `concrete` | size of a block welded on the tip |
| `knee` | `false` | diagonal knee brace under the beam (own support only) |
| `strength` | 1 | |

Returns the beam top; `x` is the beam center.

### `counterweight`
A heavy block tagged `counterweight`.

| param | default | |
|---|---|---|
| `w`, `h`, `material` | 1.2, 1.0, `concrete` | |
| `dx` or `at` | 0 | `at: 'left' / 'right'` = near that end of the previous module (e.g. a cantilever tip) |
| `hang` | 0 | 0 = sits on top and moves the cursor. > 0 = hangs this far below the underside of the part under the anchor, on a pre-tensioned cable (passive) |
| `strength` | 1 | cable strength |

### `pendulum`
A bob swinging from a support.

| param | default | |
|---|---|---|
| `len`, `r` | 3, 0.5 | cable/rod length, bob radius |
| `material` | `steel` | bob |
| `mode` | `'cable'` | or `'rod'` (steel rod on a pin) |
| `support` | `'auto'` | `'gantry'` (two posts + crossbeam, moves the cursor), `'none'` (hangs from the part under the anchor; passive), `'auto'` (gantry on the ground) |
| `gantryW`, `postW`, `supportMaterial`, `clearance` | 2.6, 0.35, `wood`, 0.4 | |
| `dx` / `at` | | anchor, as for counterweight |

The bob gets id `<id>.bob` and the tag `pendulum`.

### `weight`
A big mass tagged `weight`.

| param | default | |
|---|---|---|
| `w`, `h`, `material` | 1.6, 1.2, `concrete` | `steel` = very heavy |
| `dx` | 0 | |
| `balanced` | `false` | stands **unwelded** on a narrow pedestal |
| `pedestalW`, `pedestalH`, `pedestalMaterial` | 0.35, 1.2, `wood` | (id `<id>.pedestal`) |

### `coreChamber`
A protected box around a part tagged `core`. Use it with `objective: { kind: 'coreDown' }`.

| param | default | |
|---|---|---|
| `w` | 3 | outer width |
| `h` | 2.0 | interior height |
| `wallT` | 0.35 | |
| `material` | `concrete` | floor and roof |
| `wallMaterial` | material | `glass` = windows |
| `coreSize`, `coreMaterial` | 0.9, `core` | |
| `weldCore`, `coreStrength` | `true`, 0.5 | weak weld of the core to the floor |
| `roof` | `true` | |
| `open` | `'none'` | `'left'` / `'right'`: that wall becomes a slim corner post |
| `dx` | 0 | |

The core gets id `<id>.core`, or `'core'` for the first core when no id is given. Floor and
roof get `<id>.floor` and `<id>.roof`.

### `pyramid`
A stepped pyramid of blocks.

| param | default | |
|---|---|---|
| `levels` | 5 | |
| `w` | max(3, cursor width) | base width |
| `blockW`, `blockH` | 1.0, 0.6 | target block size |
| `step` | blockW/2 | inset per side per level (running bond) |
| `material` | `stone` | |
| `mortar` | 0.6 | 0 = dry stacked |
| `minTop` | 1.0 | stop when a row gets narrower than this |

### `wall`
A brick wall in running bond.

| param | default | |
|---|---|---|
| `w`, `h` | cursor width, 2.4 | `h` is rounded to whole courses |
| `brickW`, `brickH` | 0.8, 0.4 | target brick size (the row is split evenly) |
| `material` | `stone` | |
| `mortar` | 0.5 | weld strength; 0 = dry stacked |
| `bond` | `'running'` | or `'stack'` |
| `opening`, `openingH`, `openingY` | 0, 1.6, 0 | centered doorway/window width, height, sill |
| `lintel` | `concrete` | lintel material over the opening (tag `lintel`) |
| `dx` | 0 | |

### `explosiveBarrel` / `explosiveCrate` (aliases `barrel` / `crate`)
Props made of material `explosive`. They detonate when hit hard, caught in a blast, or
dropped. Barrel is 0.7 × 1.0 (tag `barrel`); crate is 0.9 × 0.9 (tag `crate`).

| param | default | |
|---|---|---|
| `count`, `gap` | 1, 0.25 | a row of props |
| `w`, `h`, `material` | per kind, `explosive` | `material: 'wood'` gives a plain crate |
| `dx` | 0 | |
| `weld` | `false` | loose by default (resting by friction; auto-tethered) |
| `inside` | `false` | stand on the **floor** of the previous module instead of on its top. Keep clear of columns and braces: use `braceFrom: 1` on a tower |
| `stack` | `false` | move the cursor like a storey (default: passive) |

---

## Known limits (current solver) and how the generator copes

* **Soft contacts put load into welds.** A heavy part sinks a few mm into the part below, and
  the weld between them picks up a share of the compression plus locked-in lateral creep.
  `autoSize` covers this. If you turn it off, slim columns under heavy loads sit at yield.
* **Braced towers taller than 3 storeys** pre-load some brace welds (stable, but those joints
  fail first).
* **Hanging loads on stiff, X-braced towers** may never come to rest, and a structure still
  moving after the 2.5 s pre-settle falls apart (see the tools report). Hang loads from
  unbraced frames or cantilevers.
* **Loose parts**: the physics world force-sleeps joint-less parts after 40 quiet steps.
  Doing that to a part resting on a structure that is still settling makes the whole island
  fall through the ground. The generator therefore tethers every joint-less part (joint tag
  `tether`). Keep `tether` on.
* **Overlaps**: parts that overlap without a joint explode apart. The generator reports them
  in `def.meta.warnings`, and gen-lab prints them. Braces and truss webs overlap on purpose
  and are welded.
* Keep structures within about 16 m wide and 18 m tall. Procedural levels use `originX` 42.
