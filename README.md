# TURRET

A 2D physics prototype with two modes:

- **Play (creature campaign)** — mechanical creatures walk at your turret. Hold
  the trigger on a machine gun and take them apart before any of them reaches
  the defence line. Every creature has a physical weak point: knees that
  buckle, an engine that overheats, an arm holding a shield, a body that
  comes apart in pieces.
- **Demolition** — structural engineering, emergent chain reactions and one
  very large cannon. (Hidden from the main menu for now, along with the daily
  seed and seed codes; `/?play=1` still opens it.)

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
| 3 | The Thrower | walker with a sling arm that throws rubber shields; first Sapper | the sling arm (bullets bounce off rubber); shoot the Sapper's blinking bombs |
| 4 | The Hound | fast quadruped: one of the four parts of its front legs (a thigh or a shin, at random) is steel; first Shifter | the wooden parts of the front legs, or both back legs; chase the Shifter's glow |
| 5 | Shell Game | armoured beetle, six steel legs | legs under the shell; armour-piercing rounds |
| 6 | Geometry | solid shapes tumbling in one after another: a wooden triangle, square, pentagon, hexagon, heptagon, then a stone octagon | any one wedge breaks a shape apart; on the octagon, only the glowing wedge |
| 7 | Flock | flapping birds; first Roller | a wing: lose one and it can't stay up (the top turret helps); the Roller's wooden plank |
| 8 | Overheat | engine walker | the engine: it stalls when hot, explodes when destroyed |
| 9 | Shield Wall | shield-bearers | the arm holding the plate, the head above, the shins below |
| 10 | Centipede | segmented centipede: two wooden segments, then steel, then an armoured tail | chew through from the front; every cut makes two, and pieces of one segment are harmless |
| 11 | Stampede | everything | triage |
| 12 | Horns | triceratops: steel skull, horns and an armour frill facing you | under it (the front shins) or over it (the hump behind the frill, open from above) |
| 13 | The Strider | walking fortress | slings, the engine behind the shell, or a leg pair |
| 14 | Thread the Needle | the Orrery: solid nested walls of armour (square → octagon) turning around a floating triangle | one round on the triangle — but first wear a way through: plates break away and the holes turn with their ring |
| 15 | Tyrant | all-metal T-rex whose stubby arms throw rubber blocks | cut the arms so rounds stop bouncing, then either leg |

**Geometry** (level 6): each shape is cut into wedges from its centre, one
per side, and rolls by tipping over its leading corner; the fewer the sides,
the harder it lurches. Rounds land on whichever wedges face you, so the wear
is shared out and more sides last longer; break any one wedge and the shape
bursts apart. The octagon at the end is stone and, like the Shifter, can only
be hurt in the one wedge that glows. The glow jumps at random between the
wedges turned toward you every few seconds (sooner once a visit has worn
half off it, or the roll carries it out of sight), and a wedge breaks on its
second good visit.

**Steel swaps**: from Shield Wall (level 9) on, the easier walkers (stick
walkers, throwers, hounds, shield-bearers, sappers) come with some of their
wooden parts swapped for steel of the same weight: 15% of them in Shield
Wall, rising to 35% in Tyrant. Which parts is random for each creature, and
changes on every attempt; look for the wood.

From level 3 on, three more creatures join the existing levels:

- **Sapper** lobs big shield bombs ahead of itself. A bomb's light blinks faster
  and faster; hit it 15 times before it runs out (any round counts), or it
  springs up into a tall steel wall that
  stops your rounds and hides whatever walks behind it until it crumbles. Shoot
  off the throwing arm and the bombs stop.
- **Shifter**, a stone golem: only one block can be hurt at a time, and it
  glows. Everything else shrugs rounds off. The glow jumps to another block
  every few seconds (or sooner once a visit has worn about a third off that
  block), and the damage stays: a block goes on its third visit (a leg gives
  way a little before that), and the head or body kills it.
- **Roller**, a big wheel of seven rubber segments and one wooden plank. Rounds
  glance off the rubber; only the plank can be hurt, and it rolls round with
  the wheel, so time your shots for when it faces you. Break the plank and the
  whole ring bursts apart.

Every creature is 30% faster than its level's base speed; birds are twice as
fast.

After level 15 the game continues with endless mixed waves (the strider and
the tyrant take turns as the boss every fifth wave; from wave 8 a triceratops
joins every fifth wave too, with shifters, sappers and rollers mixed in, and
the easier walkers carry steel swaps: a third of their wood, up to half).
Between levels the
workshop sells machine-gun upgrades (fire rate, accuracy, damage, cooling,
armour-piercing rounds) and, once level 5 is cleared, the **top turret**: an
automatic gun on a tall mast that picks the creature closest to the line and
goes for its weak points. It never overheats and keeps firing whatever your
own gun is doing, until something breaches the line (then it stands down until
the level restarts). Creatures pick up speed as they near the line; stopped
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
#   walk test: speed, stability, filmstrip PNG (--seed N: another random
#   build; --params steel=0.3 tries a steel swap)
npx tsx tools/creature-lab.ts beetle --shoot shinFL,shinFR --tier 5
#   hold fire on parts in turn with the level-5 upgrade build
npx tsx tools/assault-lab.ts a07 --tier 7 --aimError 0.3
#   bot plays a whole level (aims at each creature's weak points, leads
#   moving targets, human-ish aim error) and prints result + payout
#   (--seed N varies the run and the creatures' random builds; --top N
#    overrides the top turret; --add shifter@12:hp=0.8 tries an extra wave
#    entry; --bombs 0 and --react 0.35 change how the bot treats shield bombs
#    and roaming weak spots)
npx tsx tools/leg-trace.ts hound FL 3 4.2 2   # gait tuning trace for one leg
npx tsx tools/fly-trace.ts bird --cut wingL1   # flight steadiness + glide after losing a wing
```

Upgrade builds per level (`--tier 1..14`) are defined in `tools/lib/loadouts.ts`.

## Project layout

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design:
simulation vs. gameplay vs. rendering layers, the joint model, events and the
data-driven level and module format.
