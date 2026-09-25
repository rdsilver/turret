# TURRET

A 2D physics demolition prototype about structural engineering, emergent
chain reactions and one very large cannon.

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

## Controls

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
```

## Project layout

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the full design:
simulation vs. gameplay vs. rendering layers, the joint model, events and the
data-driven level and module format.
