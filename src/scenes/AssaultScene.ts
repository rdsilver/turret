/**
 * AssaultScene: the creature campaign. Creatures walk in from the right; hold
 * the trigger to hose them down with the machine gun and stop every one
 * before it crosses the defense line. Reuses the same simulation, renderers,
 * effects, audio, HUD and debug tools as the demolition GameScene; only the
 * rules (waves, breach, scoring) differ.
 */
import * as Phaser from 'phaser';
import { Simulation } from '../sim/Simulation';
import { createPrediction, type TrajectoryPrediction } from '../sim/weapons/Weapon';
import { spawnPart } from '../sim/StructureBuilder';
import type { MaterialId } from '../sim/Materials';
import { StructurePart } from '../sim/StructurePart';
import { AMMO } from '../data/ammo';
import { ASSAULT_LEVELS } from '../data/assault/levels';
import { creatureIds } from '../sim/creature/CreatureTypes';
import { AssaultSession } from '../game/AssaultSession';
import { scoreAssault } from '../game/AssaultScoring';
import { DEFENSE_LINE_X, SPAWN_X, type AssaultLevelDef } from '../game/AssaultLevel';
import { gameState } from '../game/GameState';
import { UpgradeSystem } from '../game/UpgradeSystem';
import { TextureFactory } from '../view/TextureFactory';
import { WorldRenderer } from '../view/WorldRenderer';
import { BackgroundRenderer } from '../view/BackgroundRenderer';
import { TurretView } from '../view/TurretView';
import { CameraDirector, type SimRect } from '../view/CameraDirector';
import { EffectsManager } from '../view/EffectsManager';
import { DefenseLineView } from '../view/DefenseLineView';
import { AudioManager } from '../audio/AudioManager';
import { Hud } from '../ui/Hud';
import { ResultsPanel } from '../ui/ResultsPanel';
import { DevOverlay, type DevStats } from '../debug/DevOverlay';
import { DebugMenu, type DebugApi, type DebugTool } from '../debug/DebugMenu';
import { MouseGrabber } from '../debug/MouseGrabber';
import { GrabberView } from '../debug/GrabberView';
import { onceEach } from '../ui/keys';
import { pad2 } from '../ui/format';
import { TURRET } from '../config/constants';
import { hashString } from '../core/Random';

export interface AssaultSceneData {
  levelIndex?: number;
}

type Flow = 'playing' | 'ending' | 'results';

/** Base walking speed (m/s) of each creature in endless waves. */
const ENDLESS_ROSTER: Array<[string, number]> = [
  ['stickman', 1.0],
  ['hound', 1.5],
  ['thrower', 0.8],
  ['engine', 0.8],
  ['beetle', 0.55],
  ['shield', 0.75],
  ['hound', 1.5],
  ['centipede', 0.9],
];

/** Endless waves after the campaign: more, faster, mixed creatures (the strider every fifth wave). */
export function endlessAssault(k: number): AssaultLevelDef {
  const n = 3 + Math.floor(k * 0.8);
  const faster = 1 + Math.min(0.5, k * 0.05);
  const waves: AssaultLevelDef['waves'] = [];
  for (let i = 0; i < n; i++) {
    const [creature, speed] = ENDLESS_ROSTER[(i * 3 + k) % ENDLESS_ROSTER.length]!;
    waves.push({ creature, at: 1 + i * Math.max(4, 9 - k * 0.3), params: { speed: speed * faster } });
  }
  if (k % 5 === 4) waves.push({ creature: 'strider', at: 2, params: { speed: 0.45 * faster } });
  return {
    id: `assault-endless-${k}`,
    name: `Endless Wave ${pad2(k + 1)}`,
    subtitle: `${waves.length} creatures. They keep coming.`,
    lesson: 'Prioritise: the fastest threat first, then whatever is closest to the line.',
    hint: 'Short bursts. Cool the barrel between targets.',
    seed: hashString(`assault-endless-${k}`),
    reward: 300 + k * 60,
    waves,
  };
}

export class AssaultScene extends Phaser.Scene implements DebugApi {
  private sim!: Simulation;
  private level!: AssaultLevelDef;
  private levelIndex = 0;
  private session!: AssaultSession;
  private flow: Flow = 'playing';
  private upgrades = new UpgradeSystem();

  private textureFactory!: TextureFactory;
  private world!: WorldRenderer;
  private background!: BackgroundRenderer;
  private turret!: TurretView;
  private cam!: CameraDirector;
  private effects!: EffectsManager;
  private defense!: DefenseLineView;
  private audio!: AudioManager;
  private hud: Hud | null = null;
  private results: ResultsPanel | null = null;
  private devOverlay!: DevOverlay;
  private debugMenu!: DebugMenu;
  private grabber!: MouseGrabber;
  private grabView!: GrabberView;
  private prediction: TrajectoryPrediction = createPrediction();
  private readonly devStats: DevStats = {
    fps: 0, stepMs: 0, stepMsMax: 0, postMs: 0, stepsPerFrame: 0, bodies: 0, dynamicBodies: 0,
    active: 0, sleeping: 0, joints: 0, projectiles: 0, debris: 0, timeScale: 1, paused: false,
  };

  private pointerSim = { x: 30, y: -3 };
  private mouseHeld = false;
  private spaceHeld = false;
  private tool: DebugTool = 'fire';
  private spawnMaterial: MaterialId = 'wood';
  private debugSlowMo = false;
  private stressDebug = false;
  private massScale = 1;
  private endTimer = -1;
  private hinted = false;
  private offs: Array<() => void> = [];

  constructor() {
    super('Assault');
  }

  init(data: AssaultSceneData): void {
    const gs = gameState();
    const idx = data?.levelIndex ?? Math.min(gs.assaultIndex, ASSAULT_LEVELS.length);
    this.levelIndex = Number.isFinite(idx) ? Math.max(0, Math.floor(idx)) : 0;
    this.flow = 'playing';
    this.endTimer = -1;
    this.tool = 'fire';
    this.offs = [];
    this.mouseHeld = false;
    this.spaceHeld = false;
    this.debugSlowMo = false;
    this.stressDebug = false;
    this.massScale = 1;
  }

  create(): void {
    const gs = gameState();
    this.sim = new Simulation({ seed: 4321 + this.levelIndex, weaponStats: this.upgrades.weaponStats(gs.upgrades), ammo: AMMO.bullet });
    this.sim.autoCleanup = false;
    // Creatures have no structure objective: only joint bursts should trigger slow motion.
    this.sim.chains.setTrackedMass(1e9);
    this.textureFactory = new TextureFactory(this);
    this.cam = new CameraDirector(this);
    this.background = new BackgroundRenderer(this);
    this.world = new WorldRenderer(this, this.sim, this.textureFactory);
    this.turret = new TurretView(this, this.sim.weapon);
    this.effects = new EffectsManager(this, this.sim, this.cam);
    this.defense = new DefenseLineView(this, DEFENSE_LINE_X);
    this.audio = new AudioManager(this);
    this.audio.bind(this.sim);
    this.grabber = new MouseGrabber(this.sim);
    this.grabView = new GrabberView(this, this.grabber);
    this.devOverlay = new DevOverlay();
    this.debugMenu = new DebugMenu(this);
    this.debugMenu.onVisibilityChange = () => {
      const b = this.frameBounds();
      this.cam.frame(b, false);
      this.background.layout(b);
    };

    this.bindSimEvents();
    this.bindInput();
    this.startLevel();

    this.scene.launch('UI');
    const ui = this.scene.get('UI');
    ui.events.once('ui-ready', (scene: Phaser.Scene) => {
      this.hud = new Hud(scene);
      this.results = new ResultsPanel(scene);
      this.pushHudLevel();
    });

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    (window as unknown as { __assault?: AssaultScene }).__assault = this;
  }

  /** Simulation access for automated tests / console. */
  get simulation(): Simulation {
    return this.sim;
  }

  get assault(): AssaultSession {
    return this.session;
  }

  // ------------------------------------------------------------------ level flow

  private currentLevelDef(): AssaultLevelDef {
    if (this.levelIndex < ASSAULT_LEVELS.length) return ASSAULT_LEVELS[this.levelIndex]!;
    return endlessAssault(this.levelIndex - ASSAULT_LEVELS.length);
  }

  private startLevel(): void {
    this.results?.hide();
    this.level = this.currentLevelDef();
    this.effects.clear();
    this.world.clear();
    this.session?.dispose();
    this.sim.creatures.clear();
    this.sim.projectiles.clear();
    for (const e of [...this.sim.physics.entities.values()]) if (e instanceof StructurePart) this.sim.physics.removeEntity(e);
    this.session = new AssaultSession(this.sim, this.level);
    this.flow = 'playing';
    this.endTimer = -1;
    this.hinted = false;
    this.sim.weapon.heat = 0;
    this.sim.weapon.overheated = false;
    this.world.setStressView(this.stressDebug);
    if (!this.debugMenu.visible) {
      this.sim.physics.paused = false;
      this.debugSlowMo = false;
    }
    const bounds = this.frameBounds();
    this.cam.frame(bounds, true);
    this.background.layout(bounds);
    this.background.setDestructionLine(null);
    this.pushHudLevel();
  }

  private frameBounds(): SimRect {
    const left = TURRET.x - 5;
    let right = SPAWN_X + 6;
    const cover = this.debugMenu?.coverFraction() ?? 0;
    if (cover > 0) right += ((right - left) * cover) / (1 - cover);
    return { left, right, top: -17, bottom: 3.5 };
  }

  private pushHudLevel(): void {
    if (!this.hud || !this.level) return;
    const campaign = this.levelIndex < ASSAULT_LEVELS.length;
    this.hud.setLevel({
      mode: campaign ? 'campaign' : 'endless',
      index: campaign ? this.levelIndex + 1 : 0,
      total: campaign ? ASSAULT_LEVELS.length : 0,
      name: this.level.name,
      subtitle: this.level.subtitle,
      objective: 'Stop every creature before it reaches the defense line',
      par: 0,
    });
  }

  private bindSimEvents(): void {
    const ev = this.sim.events;
    this.offs.push(
      ev.on('creatureNeutralized', ({ creature }) => {
        if (this.flow !== 'playing') return;
        const d = Math.max(0, Math.round(creature.x - DEFENSE_LINE_X));
        this.hud?.flash(`${creature.spec.name.toUpperCase()} STOPPED · ${d} m`, '#6fe3a1');
      }),
      ev.on('partWrecked', ({ part }) => {
        if (this.flow === 'playing' && part.hasTag('limb')) this.hud?.flash('LIMB SEVERED', '#ffb547');
      }),
      ev.on('creatureOverheated', () => this.hud?.flash('ENGINE OVERHEATED', '#ffb547')),
    );
  }

  // ------------------------------------------------------------------ input

  private bindInput(): void {
    const input = this.input;
    input.on('pointermove', (p: Phaser.Input.Pointer) => {
      this.cam.toSim(p.x, p.y, this.pointerSim);
      if (this.grabber.active) this.grabber.move(this.pointerSim.x, this.pointerSim.y);
    });
    input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      this.cam.toSim(p.x, p.y, this.pointerSim);
      if (this.results?.visible) return;
      const x = this.pointerSim.x;
      const y = this.pointerSim.y;
      if (p.rightButtonDown() || this.tool === 'grab' || (p.event as MouseEvent | undefined)?.shiftKey) {
        if (this.debugMenu.visible || this.tool === 'grab') this.grabber.grab(x, y);
        return;
      }
      switch (this.tool) {
        case 'fire':
          this.sim.weapon.aimAt(x, y);
          this.mouseHeld = true;
          break;
        case 'block':
          spawnPart(this.sim.physics, { shape: { kind: 'box', w: 1, h: 1 }, x: 0, y: 0, material: this.spawnMaterial }, { x, y, angle: 0 });
          break;
        case 'ball':
          this.sim.projectiles.spawn({ ammo: AMMO.standard!, x, y, vx: 0, vy: 0, radius: 0.3, mass: 110 * this.massScale, shot: 0 });
          break;
        case 'explode':
          this.sim.explosions.explode(x, y, 4, 1, 'debug');
          break;
      }
    });
    const release = () => {
      this.mouseHeld = false;
      if (this.grabber.active) this.grabber.release();
    };
    input.on('pointerup', release);
    input.on('pointerupoutside', release);
    input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.sim.weapon.setPower(this.sim.weapon.power - dy * 0.0006);
    });
    const kb = input.keyboard;
    if (!kb) return;
    kb.on('keyup', (e: KeyboardEvent) => {
      if (e.code === 'Space') this.spaceHeld = false;
    });
    kb.on(
      'keydown',
      onceEach((e: KeyboardEvent) => {
        const debugKeys = this.debugMenu.visible;
        switch (e.code) {
          case 'Backquote':
            this.debugMenu.toggle();
            break;
          case 'F3':
            e.preventDefault();
            this.devOverlay.toggle();
            break;
          case 'KeyR':
            if (!this.results?.visible) this.startLevel();
            break;
          case 'Escape':
            this.scene.start('Menu');
            break;
          case 'Space':
            this.spaceHeld = true;
            break;
          case 'KeyP':
            if (debugKeys) this.setPaused(!this.isPaused());
            break;
          case 'Period':
          case 'KeyN':
            if (debugKeys) this.stepOnce();
            break;
          case 'KeyT':
            if (debugKeys) this.setSlowMo(!this.debugSlowMo);
            break;
          case 'KeyC':
            if (debugKeys) this.setColliderDebug(!this.world.colliderDebug);
            break;
          case 'KeyV':
            if (debugKeys) this.setStressView(!this.stressDebug);
            break;
          case 'KeyW':
          case 'ArrowUp':
            this.sim.weapon.setPower(this.sim.weapon.power + 0.05);
            break;
          case 'ArrowDown':
            this.sim.weapon.setPower(this.sim.weapon.power - 0.05);
            break;
        }
      }),
    );
  }

  // ------------------------------------------------------------------ frame

  update(): void {
    // Real frame time (Phaser's smoothed delta clamps to 1/60 s when the page is unfocused).
    const dt = Math.min(0.1, Math.max(0, this.game.loop.rawDelta) / 1000);
    const physics = this.sim.physics;
    const w = this.sim.weapon;

    if (!this.grabber.active && this.tool === 'fire' && !this.results?.visible) w.aimAt(this.pointerSim.x, this.pointerSim.y);
    w.triggerHeld = this.flow === 'playing' && this.tool === 'fire' && !this.results?.visible && (this.mouseHeld || this.spaceHeld);
    if (this.massScale !== 1) w.stats.projectileMass = this.upgrades.weaponStats(gameState().upgrades).projectileMass * this.massScale;

    this.effects.update(dt);
    physics.timeScale = this.effects.timeScale * (this.debugSlowMo ? 0.2 : 1);
    this.sim.update(dt);
    this.session.update();

    w.predict(this.prediction);
    this.turret.showPreview = this.flow === 'playing';
    this.turret.update(dt, this.prediction);
    this.world.update(physics.alpha, dt);
    this.grabView.update();
    const front = this.sim.creatures.frontX();
    this.defense.update(dt, front);
    this.background.update(dt);
    this.cam.update(dt);
    this.audio.update(dt, this.effects.slowMotion);

    // Level end: let the moment play out, then show results.
    if (this.flow === 'playing' && this.session.state !== 'running') {
      this.flow = 'ending';
      w.triggerHeld = false;
      if (this.session.state === 'won') {
        this.hud?.banner('LINE HELD', `${this.session.stopped} / ${this.session.total} STOPPED`);
        this.effects.slowMo(0.8);
        this.audio.play('collapse_sting');
        this.endTimer = 3.2;
      } else {
        this.hud?.banner('BREACH', 'A creature crossed the line');
        this.endTimer = 2.4;
      }
    }
    if (this.flow === 'ending') {
      this.endTimer -= dt;
      if (this.endTimer <= 0) this.showResults();
    }
    if (!this.hinted && this.flow === 'playing' && this.session.closest < 15 && this.level.hint) {
      this.hinted = true;
      this.hud?.hint(this.level.hint);
    }

    this.hud?.update(
      {
        shots: this.session.shots,
        par: 0,
        money: gameState().money,
        progress: 0,
        reload: w.reloadProgress,
        power: w.power,
        ammoName: w.ammo.name,
        ammoCost: 0,
        ammoId: w.ammo.id,
        phase: 'standing',
        sandbox: false,
        heat: w.heat,
        overheated: w.overheated,
        assault: { stopped: this.session.stopped, total: this.session.total, closest: front - DEFENSE_LINE_X, field: SPAWN_X - DEFENSE_LINE_X },
      },
      dt,
    );

    if (this.devOverlay.visible) {
      const st = physics.stats;
      const d = this.devStats;
      d.fps = this.game.loop.actualFps;
      d.stepMs = st.stepMs;
      d.stepMsMax = st.stepMsMax;
      d.postMs = st.postMs;
      d.stepsPerFrame = st.stepsLastFrame;
      d.bodies = st.bodies;
      d.dynamicBodies = st.dynamicBodies;
      d.active = st.active;
      d.sleeping = st.sleeping;
      d.joints = st.joints;
      d.projectiles = this.sim.projectiles.count;
      d.debris = this.sim.debris.candidateCount;
      d.timeScale = physics.timeScale;
      d.paused = physics.paused;
      this.devOverlay.update(d, dt);
    }
    if (this.debugMenu.visible) this.debugMenu.refresh();
  }

  private showResults(): void {
    if (this.flow === 'results') return;
    this.flow = 'results';
    const gs = gameState();
    const outcome = this.session.outcome();
    const result = scoreAssault(outcome);
    const rec = gs.records[this.level.id];
    let credited: number;
    if (outcome.won) {
      credited = rec?.completed ? Math.max(0, result.total - rec.bestPayout) : result.total;
      gs.records[this.level.id] = {
        completed: true,
        bestGrade: rec && gradeRank(rec.bestGrade) >= gradeRank(result.grade) ? rec.bestGrade : result.grade,
        bestShots: rec ? Math.min(rec.bestShots, outcome.shots) : outcome.shots,
        bestPayout: Math.max(rec?.bestPayout ?? 0, result.total),
      };
      if (this.levelIndex >= gs.assaultIndex) gs.assaultIndex = this.levelIndex + 1;
    } else {
      // A breach keeps a little salvage so failed attempts still help buy upgrades.
      credited = result.total;
    }
    gs.money += credited;
    gs.totalEarned += credited;
    gs.totalShots += outcome.shots;
    gs.save();
    const campaign = this.levelIndex < ASSAULT_LEVELS.length;
    this.results?.show(
      result,
      this.level,
      {
        onContinue: () => this.scene.start('Upgrade', { mode: 'assault' }),
        onRetry: () => this.startLevel(),
      },
      {
        credited,
        report: outcome.won ? 'FIELD REPORT' : 'BREACH REPORT',
        levelLabel: campaign ? `LEVEL ${pad2(this.levelIndex + 1)} / ${pad2(ASSAULT_LEVELS.length)}` : 'ENDLESS',
        continueLabel: 'WORKSHOP',
      },
    );
  }

  // ------------------------------------------------------------------ DebugApi

  reloadLevel(): void {
    this.startLevel();
  }
  randomizeStructure(): void {
    // Spawn an extra random creature at the entry point.
    const kinds = creatureIds();
    this.sim.creatures.spawn(kinds[Math.floor(Math.random() * kinds.length)]!, SPAWN_X, {}, (Math.random() * 1e9) | 0);
  }
  setPaused(p: boolean): void {
    this.sim.physics.paused = p;
  }
  isPaused(): boolean {
    return this.sim.physics.paused;
  }
  stepOnce(): void {
    this.sim.physics.paused = true;
    this.sim.physics.requestStep(1);
  }
  setSlowMo(on: boolean): void {
    this.debugSlowMo = on;
  }
  isSlowMo(): boolean {
    return this.debugSlowMo;
  }
  setGravity(g: number): void {
    this.sim.physics.setGravity(g);
  }
  getGravity(): number {
    return this.sim.physics.gravity;
  }
  setProjectileMassScale(s: number): void {
    this.massScale = Math.max(0.05, s);
  }
  getProjectileMassScale(): number {
    return this.massScale;
  }
  setColliderDebug(on: boolean): void {
    this.world.setColliderDebug(on);
  }
  isColliderDebug(): boolean {
    return this.world.colliderDebug;
  }
  setStressView(on: boolean): void {
    this.stressDebug = on;
    this.world.setStressView(on);
  }
  isStressView(): boolean {
    return this.stressDebug;
  }
  setTool(t: DebugTool): void {
    this.tool = t;
  }
  getTool(): DebugTool {
    return this.tool;
  }
  setSpawnMaterial(m: MaterialId): void {
    this.spawnMaterial = m;
  }
  getSpawnMaterial(): MaterialId {
    return this.spawnMaterial;
  }
  setUnlimitedFire(on: boolean): void {
    this.sim.weapon.unlimited = on;
  }
  isUnlimitedFire(): boolean {
    return this.sim.weapon.unlimited;
  }
  benchmark(n: number): void {
    // A crowd of walkers.
    const count = Math.max(1, Math.min(40, Math.round(n / 12)));
    for (let i = 0; i < count; i++) this.sim.creatures.spawn('stickman', SPAWN_X - (i % 10) * 1.2, {}, i + 7);
  }
  clearDebris(): void {
    for (const e of [...this.sim.physics.entities.values()]) {
      if (e instanceof StructurePart && (e.isFragment || e.joints.length === 0) && !e.fixed) this.sim.debris.fade(e, 0.4);
    }
  }
  addMoney(n: number): void {
    const gs = gameState();
    gs.money += n;
    gs.save();
  }
  skipLevel(): void {
    const gs = gameState();
    gs.assaultIndex = Math.max(gs.assaultIndex, this.levelIndex + 1);
    gs.save();
    this.scene.start('Upgrade', { mode: 'assault' });
  }
  getSeed(): number {
    return this.level.seed;
  }
  loadSeed(_seed: number): void {
    this.startLevel();
  }

  // ------------------------------------------------------------------ teardown

  private teardown(): void {
    for (const off of this.offs) off();
    this.offs = [];
    this.session?.dispose();
    this.audio.unbind();
    this.effects.destroy();
    this.world.destroy();
    this.turret.destroy();
    this.background.destroy();
    this.defense.destroy();
    this.grabView.destroy();
    this.grabber.destroy();
    this.devOverlay.destroy();
    this.debugMenu.destroy();
    this.hud?.destroy();
    this.results?.destroy();
    this.hud = null;
    this.results = null;
    this.scene.stop('UI');
    this.sim.destroy();
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
  }
}

function gradeRank(g: string): number {
  return ['D', 'C', 'B', 'A', 'S'].indexOf(g);
}
