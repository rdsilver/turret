# TURRET

A 2D physics prototype with two modes:

- **Play (creature campaign)** — mechanical creatures walk at your turret. Hold
  the trigger on a machine gun and take them apart before any of them reaches
  the defence line. Every creature has a physical weak point: knees that
  buckle, an engine that overheats, an arm holding a shield, a body that
  comes apart in pieces.
- **Demolition** — structural engineering, emergent chain reactions and one
  very large cannon. (Hidden from the main menu for now; `/?play=1` still
  opens it.)

> *"I understand why this thing is standing. Now I'm going to figure out the
> funniest way to make it stop standing."*

Every structure is made of real Rapier rigid bodies joined by **breakable,
load-measuring joints**. There are no hit points: supports bend, creak and
snap when the load through them exceeds their strength, the load moves to the
next joint, and structures fail progressively. You win when the structure has
physically collapsed (for example, most of its mass has fallen below the
destruction line, or its protected core has hit the ground). Efficient
demolition pays: one well-placed shot that sets off a big chain reaction earns
far more than thirty shells.

## Quick start

Requirements: **Node.js 20+** (tested with Node 22) and npm.

```bash
npm install
npm run dev          # http://localhost:5173
```

Production build and local preview:

```bash
npm run build        # typecheck + vite build -> dist/
npm run preview      # serves dist/ at http://localhost:4173
```

Useful URLs while developing:

| URL | What it opens |
| --- | --- |
| `/` | main menu |
| `/?play=1` | continue the campaign |
| `/?play=1&level=7` | jump straight to campaign level 7 |
| `/?sandbox=1` | physics sandbox with the debug menu open |
| `/?assault=1&level=4` | jump straight to creature level 4 |

## Creature campaign

Creatures (big ones: a stick walker stands about 13 m tall) enter from the
right and walk toward the red defence line in front of the turret. If any
creature's front crosses it while it is still on the move, the level is lost
(retry with R). Nothing has a health bar: bullets wear a part down (it turns
redder as it weakens) and weaken the joints around it until the physics does
the rest — a weak knee buckles under the creature's own weight, a severed
limb stops obeying it. Every hit also leaves an impact crater in the part
itself: wood splinters into dark gouges, steel dents, armour only scuffs, and
hits near an edge chip pieces out of the silhouette.

| Input | Action |
| --- | --- |
| Mouse | aim (tracer line shows the flight path) |
| Hold left mouse / Space | fire; the barrel heats up and locks when it overheats |
| R | restart level |
| Esc | main menu |

| # | Level | Creature | Weak point |
| --- | --- | --- | --- |
| 1 | First Contact | Stick walker | knees |
| 2 | Pair | two walkers | stop the closest first |
| 3 | The Thrower | walker with a sling arm that throws rubber shields | the sling arm (bullets bounce off rubber) |
| 4 | The Hound | fast quadruped | both front (or both back) legs |
| 5 | Shell Game | armoured beetle, six steel legs | legs under the shell; armour-piercing rounds |
| 6 | Flock | flapping birds | a wing: lose one and it can't stay up (the top turret helps) |
| 7 | Overheat | engine walker | the engine: it stalls when hot, explodes when destroyed |
| 8 | Shield Wall | shield-bearers | the arm holding the plate, the head above, the shins below |
| 9 | Centipede | segmented centipede: two wooden segments, then steel, then an armoured tail | chew through from the front; every cut makes two, and pieces of one segment are harmless |
| 10 | Stampede | everything | triage |
| 11 | Horns | triceratops: steel skull, horns and an armour frill facing you | under it (the front shins) or over it (the hump behind the frill, open from above) |
| 12 | The Strider | walking fortress | slings, the engine behind the shell, or a leg pair |
| 13 | Thread the Needle | the Orrery: solid nested walls of armour (square → octagon) turning around a floating triangle | one round on the triangle — but first wear a way through: plates break away and the holes turn with their ring |
| 14 | Tyrant | all-metal T-rex whose stubby arms throw rubber blocks | cut the arms so rounds stop bouncing, then either leg |

After level 14 the game continues with endless mixed waves (the strider and
the tyrant take turns as the boss every fifth wave). Between levels the
workshop sells machine-gun upgrades (fire rate, accuracy, damage, cooling,
armour-piercing rounds) and, once level 5 is cleared, the **top turret**: an
automatic gun on a tall mast that picks the creature closest to the line and
goes for its weak points. It never overheats and keeps firing whatever your
own gun is doing. Creatures pick up speed as they near the line; stopped
ones fade away after a few seconds.

## Demolition controls

| Input | Action |
| --- | --- |
| Mouse | aim the cannon (trajectory preview) |
| Left click / Space | fire |
| Mouse wheel, W / S, Up / Down | muzzle power |
| Q / E, 1–4 | switch ammunition (once unlocked) |
| R | restart level |
| Esc | main menu |
| `` ` `` (backquote) | debug menu |
| F3 | developer overlay (FPS, step time, bodies, joints, ...) |
| P / N / T | pause, step one frame, slow motion |
| Right-drag or Shift-drag | grab and throw bodies (sandbox / debug menu open) |

## Headless tools

The simulation (`src/sim`) has no Phaser dependency, so it runs in Node:

```bash
npx tsx tools/level-lab.ts level05 --sweep full --brute 6 --stats base
#   checks stability (no joints break while settling or standing idle),
#   measures which single shots demolish the level, how many random shots it
#   takes, and renders a filmstrip + stress heat map PNG into tools/out/
npx tsx tools/bench.ts   # scaling benchmark: 100 -> 2000 welded bodies

# Creatures
npx tsx tools/creature-lab.ts hound --seconds 20
#   walk test: speed, stability, filmstrip PNG
npx tsx tools/creature-lab.ts beetle --shoot shinFL,shinFR --tier 5
#   hold fire on parts in turn with the level-5 upgrade build
npx tsx tools/assault-lab.ts a07 --tier 7 --aimError 0.3
#   bot plays a whole level (aims at each creature's weak points, leads
#   moving targets, human-ish aim error) and prints result + payout
#   (--seed N varies the run; --top N overrides the top turret)
npx tsx tools/leg-trace.ts hound FL 3 4.2 2   # gait tuning trace for one leg
npx tsx tools/fly-trace.ts bird --cut wingL1   # flight steadiness + glide after losing a wing
```

Upgrade builds per level (`--tier 1..14`) are defined in `tools/lib/loadouts.ts`.

## Project layout

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design:
simulation vs. gameplay vs. rendering layers, the joint model, events and the
data-driven level and module format.
