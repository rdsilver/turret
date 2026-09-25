/**
 * GameScene: the arena. Thin orchestration layer that wires the simulation
 * (pure TS) to the view systems, input, HUD, economy and debug tools. Game
 * rules live in the sim / game modules; visuals live in view/ modules.
 */
import * as Phaser from 'phaser';
import { Simulation } from '../sim/Simulation';
import { createPrediction, type TrajectoryPrediction } from '../sim/weapons/Weapon';
import { spawnPart } from '../sim/StructureBuilder';
import type { StructureDef } from '../sim/StructureDefinition';
import type { MaterialId } from '../sim/Materials';
import { StructurePart } from '../sim/StructurePart';
import { AMMO, ammo as ammoById } from '../data/ammo';
import { levelManager } from '../game/LevelManager';
import type { LevelDef } from '../game/LevelDefinition';
import { LevelSession } from '../game/LevelSession';
import { scoreLevel, type LevelResult } from '../game/Economy';
import { gameState } from '../game/GameState';
import { UpgradeSystem } from '../game/UpgradeSystem';
import { TextureFactory } from '../view/TextureFactory';
import { WorldRenderer } from '../view/WorldRenderer';
import { BackgroundRenderer } from '../view/BackgroundRenderer';
import { TurretView } from '../view/TurretView';
import { CameraDirector, type SimRect } from '../view/CameraDirector';
import { EffectsManager } from '../view/EffectsManager';
import { AudioManager } from '../audio/AudioManager';
import { Hud } from '../ui/Hud';
import { ResultsPanel } from '../ui/ResultsPanel';
import { DevOverlay } from '../debug/DevOverlay';
import { DebugMenu, type DebugApi, type DebugTool } from '../debug/DebugMenu';
import { MouseGrabber } from '../debug/MouseGrabber';
import { GrabberView } from '../debug/GrabberView';
import type { DevStats } from '../debug/DevOverlay';
import { pad2 } from '../ui/format';
import { DEFAULT_GRAVITY, TURRET } from '../config/constants';
import { hashString } from '../core/Random';
import { StructureDraft } from '../sim/generator/StructureDraft';
import { sizeJoints, DEFAULT_SIZING } from '../sim/generator/modules/sizing';
import { solveAim } from '../sim/ballistics';
import { onceEach } from '../ui/keys';
import { dailySeed } from './MenuScene';

export type GameMode = 'campaign' | 'sandbox' | 'seed';

export interface GameSceneData {
  mode?: GameMode;
  seed?: number;
  levelIndex?: number;
}

type Flow = 'aiming' | 'collapsing' | 'results';

/** Wall-clock cap on a level's synchronous pre-settle (real levels need < 100 ms). */
const SETTLE_BUDGET_MS = 1500;

export class GameScene extends Phaser.Scene implements DebugApi {
  private mode: GameMode = 'campaign';
  private sim!: Simulation;
  private level!: LevelDef;
  private levelIndex = 0;
  private structureSeed = 0;
  /** Debug Randomize in the campaign: this procedural level replaces the campaign one (R retries it). */
  private levelOverride: LevelDef | null = null;
  /** Today's daily seed, fixed when the run starts (the only seed-mode structure that pays). */
  private dailySeedValue = 0;
  private session!: LevelSession;
  private flow: Flow = 'aiming';
  private upgrades = new UpgradeSystem();

  private textureFactory!: TextureFactory;
  private world!: WorldRenderer;
  private background!: BackgroundRenderer;
  private turret!: TurretView;
  private cam!: CameraDirector;
  private effects!: EffectsManager;
  private audio!: AudioManager;
  private hud: Hud | null = null;
  private results: ResultsPanel | null = null;
  private devOverlay!: DevOverlay;
  private debugMenu!: DebugMenu;
  private grabber!: MouseGrabber;
  private grabView!: GrabberView;
  private readonly devStats: DevStats = {
    fps: 0, stepMs: 0, stepMsMax: 0, postMs: 0, stepsPerFrame: 0, bodies: 0, dynamicBodies: 0,
    active: 0, sleeping: 0, joints: 0, projectiles: 0, debris: 0, timeScale: 1, paused: false,
  };
  private prediction: TrajectoryPrediction = createPrediction();

  private pointerSim = { x: 30, y: -5 };
  private tool: DebugTool = 'fire';
  private spawnMaterial: MaterialId = 'wood';
  private debugSlowMo = false;
  private stressDebug = false;
  private massScale = 1;
  private unlockedAmmo: string[] = ['standard'];
  private resultsDelay = -1;
  private lastChainFlash = 0;
  private offs: Array<() => void> = [];

  constructor() {
    super('Game');
  }

  init(data: GameSceneData): void {
    this.mode = data.mode ?? 'campaign';
    const gs = gameState();
    const idx = data.levelIndex ?? gs.levelIndex;
    this.levelIndex = Number.isFinite(idx) ? Math.max(0, Math.floor(idx)) : 0;
    this.structureSeed = data.seed ?? 0;
    this.levelOverride = null;
    this.dailySeedValue = dailySeed();
    this.flow = 'aiming';
    this.resultsDelay = -1;
    this.tool = 'fire';
    this.offs = [];
    // Debug time/view state belongs to one run (like gravity and colliders, which are rebuilt).
    this.debugSlowMo = false;
    this.stressDebug = false;
    this.massScale = 1;
  }

  create(): void {
    const gs = gameState();
    const stats = this.upgrades.weaponStats(gs.upgrades);
    this.unlockedAmmo = this.upgrades.unlockedAmmo(gs.upgrades);
    const ammo = this.unlockedAmmo.includes(gs.selectedAmmo) ? ammoById(gs.selectedAmmo) : AMMO.standard!;

    this.sim = new Simulation({ seed: 1234 + this.levelIndex, weaponStats: stats, ammo });
    this.sim.settleBudgetMs = SETTLE_BUDGET_MS;
    // The sandbox has no win: never fade out the blocks the player spawns after a collapse.
    this.sim.autoCleanup = this.mode !== 'sandbox';
    this.textureFactory = new TextureFactory(this);
    this.cam = new CameraDirector(this);
    this.background = new BackgroundRenderer(this);
    this.world = new WorldRenderer(this, this.sim, this.textureFactory);
    this.turret = new TurretView(this, this.sim.weapon);
    this.effects = new EffectsManager(this, this.sim, this.cam);
    this.audio = new AudioManager(this);
    this.audio.bind(this.sim);
    this.grabber = new MouseGrabber(this.sim);
    this.grabView = new GrabberView(this, this.grabber);
    this.devOverlay = new DevOverlay();
    this.debugMenu = new DebugMenu(this);
    // Re-frame so the right-docked debug panel never hides the structure.
    this.debugMenu.onVisibilityChange = () => {
      if (!this.sim.structure) return;
      const b = this.frameBounds();
      this.cam.frame(b, false);
      this.background.layout(b);
    };

    this.bindSimEvents();
    this.bindInput();
    this.loadCurrentLevel();

    // Screen-space UI lives in a parallel scene so camera zoom/shake don't affect it.
    this.scene.launch('UI');
    const ui = this.scene.get('UI');
    ui.events.once('ui-ready', (scene: Phaser.Scene) => {
      this.hud = new Hud(scene);
      this.results = new ResultsPanel(scene);
      this.pushHudLevel();
    });

    if (this.mode === 'sandbox') {
      this.sim.weapon.unlimited = true;
      if (!this.debugMenu.visible) this.debugMenu.toggle();
    }

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    // Automation hook for smoke tests / console experiments.
    (window as unknown as { __turret?: GameScene }).__turret = this;
  }

  /** Aim at a sim-space point (low arc 0 / lob 1) and fire. Used by automated tests. */
  debugFireAt(x: number, y: number, arc: 0 | 1 = 0): boolean {
    const w = this.sim.weapon;
    let angle = w.angle;
    for (let k = 0; k < 4; k++) {
      w.setAngle(angle);
      const m = w.muzzle();
      const sol = solveAim(m.x, m.y, x, y, w.speed, this.sim.physics.gravity);
      if (!sol.length) return false;
      angle = sol[arc]!;
    }
    w.setAngle(angle);
    this.pointerSim.x = w.pivotX + Math.cos(angle) * 20;
    this.pointerSim.y = w.pivotY + Math.sin(angle) * 20;
    w.reload = 0;
    this.tryFire();
    return true;
  }

  /** Expose the simulation for automated tests / console. */
  get simulation(): Simulation {
    return this.sim;
  }

  // ------------------------------------------------------------------ levels

  private currentLevelDef(): LevelDef {
    if (this.levelOverride) return this.levelOverride;
    if (this.mode === 'sandbox') return levelManager.procedural(this.structureSeed || hashString('sandbox'), 0.4);
    if (this.mode === 'seed') return levelManager.procedural(this.structureSeed, 0.6);
    if (this.levelIndex >= levelManager.count) {
      // Post-campaign: endless procedural levels of rising difficulty.
      const k = this.levelIndex - levelManager.count;
      return levelManager.procedural(hashString(`endless-${k}`), Math.min(1, 0.55 + k * 0.05));
    }
    return levelManager.get(this.levelIndex);
  }

  private loadCurrentLevel(structureOverride?: StructureDef): void {
    // Every load (Retry, seed Continue, debug Load / Randomize / Benchmark) starts on a clean screen.
    this.results?.hide();
    this.level = this.currentLevelDef();
    this.effects.clear();
    this.world.clear();
    const def = structureOverride ?? levelManager.build(this.level, this.structureSeed || undefined);
    this.sim.loadStructure(def, this.level.objective);
    this.session?.dispose();
    this.session = new LevelSession(this.sim, this.level);
    this.flow = 'aiming';
    this.resultsDelay = -1;
    this.world.setStressView(this.stressDebug);
    // Debug time controls never outlive a reload unless the debug tools are in use.
    if (!this.debugMenu.visible && this.mode !== 'sandbox') {
      this.sim.physics.paused = false;
      this.debugSlowMo = false;
    }

    const s = this.sim.structure!;
    const bounds = this.frameBounds();
    this.cam.frame(bounds, true);
    this.background.layout(bounds);
    const det = this.sim.detector;
    this.background.setDestructionLine(det?.lineHeight ?? null, s.minX0 - 2, s.maxX0 + 2);
    this.pushHudLevel();
  }

  private frameBounds(): SimRect {
    const s = this.sim.structure;
    let right = Math.max(this.level.camera?.right ?? 0, (s ? s.maxX0 : 40) + 7);
    const left = TURRET.x - 5;
    const cover = this.debugMenu?.coverFraction() ?? 0;
    if (cover > 0) right += ((right - left) * cover) / (1 - cover);
    const top = -Math.max(this.level.camera?.top ?? 0, (s ? s.height0 : 10) + 5, 12);
    return { left, right, top, bottom: 3.5 };
  }

  private pushHudLevel(): void {
    if (!this.hud || !this.level) return;
    const campaign = this.mode === 'campaign' && this.levelIndex < levelManager.count && !this.levelOverride;
    this.hud.setLevel({
      mode: this.levelOverride ? 'seed' : this.mode === 'campaign' && !campaign ? 'endless' : this.mode,
      index: campaign ? this.levelIndex + 1 : 0,
      total: campaign ? levelManager.count : 0,
      name: this.mode === 'sandbox' ? 'Sandbox' : this.level.name,
      subtitle: this.level.subtitle,
      objective: this.sim.detector?.describe() ?? '',
      par: this.level.par,
    });
  }

  // ------------------------------------------------------------------ events

  private bindSimEvents(): void {
    const ev = this.sim.events;
    this.offs.push(
      ev.on('objectiveComplete', () => {
        if (this.flow !== 'aiming' || this.mode === 'sandbox') return;
        this.flow = 'collapsing';
        this.session.winningShot = this.session.shots;
        this.session.metAt = this.sim.physics.simTime;
        this.hud?.banner('STRUCTURE COLLAPSED', this.session.shots === 1 ? 'ONE SHOT' : `${this.session.shots} shots`);
      }),
      ev.on('collapseSettled', () => {
        if (this.flow === 'collapsing') this.resultsDelay = 1.8;
      }),
      ev.on('chainUpdated', (c) => {
        const n = c.joints + c.parts;
        const now = this.time.now;
        if (n >= 4 && now - this.lastChainFlash > 250) {
          this.lastChainFlash = now;
          this.hud?.flash(`CHAIN ×${n}`);
        }
      }),
    );
  }

  private bindInput(): void {
    const input = this.input;
    // (The context menu is disabled once in the game config; calling disableContextMenu()
    // here would add another canvas listener on every scene start.)

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
        if (this.debugMenu.visible || this.mode === 'sandbox' || this.tool === 'grab') this.grabber.grab(x, y);
        return;
      }
      switch (this.tool) {
        case 'fire':
          // Touch taps have no pointermove before pointerdown: aim at the tap before firing.
          this.sim.weapon.aimAt(x, y);
          this.tryFire();
          break;
        case 'block':
          this.spawnDebugBlock(x, y);
          break;
        case 'ball':
          this.spawnDebugBall(x, y);
          break;
        case 'explode':
          this.sim.explosions.explode(x, y, 4, 1, 'debug');
          break;
      }
    });

    const release = () => {
      if (this.grabber.active) this.grabber.release();
    };
    input.on('pointerup', release);
    input.on('pointerupoutside', release);

    input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.sim.weapon.setPower(this.sim.weapon.power - dy * 0.0006);
    });

    const kb = input.keyboard;
    if (!kb) return;
    // Phaser can deliver the same keydown more than once per frame (see ui/keys.ts).
    kb.on('keydown', onceEach((e: KeyboardEvent) => {
      const debugKeys = this.debugMenu.visible || this.mode === 'sandbox';
      switch (e.code) {
        case 'Backquote':
          this.debugMenu.toggle();
          break;
        case 'F3':
          e.preventDefault();
          this.devOverlay.toggle();
          break;
        case 'KeyR':
          this.reloadLevel();
          break;
        case 'Escape':
          this.scene.start('Menu');
          break;
        case 'Space':
          this.tryFire();
          break;
        // Debug time keys: only with the debug tools open (like C / V).
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
          if (this.debugMenu.visible) this.setColliderDebug(!this.world.colliderDebug);
          break;
        case 'KeyV':
          if (this.debugMenu.visible) this.setStressView(!this.stressDebug);
          break;
        case 'KeyQ':
          this.cycleAmmo(-1);
          break;
        case 'KeyE':
          this.cycleAmmo(1);
          break;
        case 'KeyW':
        case 'ArrowUp':
          this.sim.weapon.setPower(this.sim.weapon.power + 0.05);
          break;
        case 'ArrowDown':
          this.sim.weapon.setPower(this.sim.weapon.power - 0.05);
          break;
        case 'Digit1':
        case 'Digit2':
        case 'Digit3':
        case 'Digit4': {
          const id = this.unlockedAmmo[Number(e.code.slice(5)) - 1];
          if (id) this.selectAmmo(id);
          break;
        }
      }
    }));
  }

  private tryFire(): void {
    if (this.flow !== 'aiming' && this.mode !== 'sandbox') return;
    const w = this.sim.weapon;
    if (!w.ready) return;
    const saved = w.stats.projectileMass;
    w.stats.projectileMass = saved * this.massScale;
    const p = this.sim.fire();
    w.stats.projectileMass = saved;
    if (!p) return;
    this.session.onShot(w.ammo.id, w.ammo.cost);
    gameState().totalShots++;
    if (this.mode === 'campaign' && this.session.shots === this.level.par + 2 && this.level.hint) this.hud?.hint(this.level.hint);
  }

  private cycleAmmo(dir: number): void {
    const list = this.unlockedAmmo;
    if (list.length < 2) return;
    const i = list.indexOf(this.sim.weapon.ammo.id);
    this.selectAmmo(list[(i + dir + list.length) % list.length]!);
  }

  private selectAmmo(id: string): void {
    if (!this.unlockedAmmo.includes(id)) return;
    this.sim.weapon.ammo = ammoById(id);
    gameState().selectedAmmo = id;
    this.hud?.flash(this.sim.weapon.ammo.name.toUpperCase(), '#9fd3ff');
  }

  // ------------------------------------------------------------------ frame

  update(_time: number, _deltaMs: number): void {
    // Real frame time, not Phaser's smoothed delta: the smoother clamps to 1/60 s
    // whenever the page is unfocused, which would put the whole game in slow motion.
    const dt = Math.min(0.1, Math.max(0, this.game.loop.rawDelta) / 1000);
    const physics = this.sim.physics;

    if (!this.grabber.active && this.tool === 'fire' && !this.results?.visible) this.sim.weapon.aimAt(this.pointerSim.x, this.pointerSim.y);

    this.effects.update(dt);
    physics.timeScale = this.effects.timeScale * (this.debugSlowMo ? 0.2 : 1);
    this.sim.update(dt);

    this.sim.weapon.predict(this.prediction);
    this.turret.showPreview = this.flow === 'aiming' || this.mode === 'sandbox';
    this.turret.update(dt, this.prediction);
    this.world.update(physics.alpha, dt);
    this.grabView.update();
    this.background.setProgress(this.sim.progress);
    this.background.update(dt);
    this.cam.update(dt);
    // Debug slow-mo shouldn't muffle audio; only gameplay slow-mo does.
    this.audio.update(dt, this.effects.timeScale);

    if (this.resultsDelay > 0) {
      this.resultsDelay -= dt;
      if (this.resultsDelay <= 0) this.showResults();
    }

    this.hud?.update(
      {
        shots: this.session.shots,
        par: this.level.par,
        money: gameState().money,
        progress: this.sim.progress,
        reload: this.sim.weapon.reloadProgress,
        power: this.sim.weapon.power,
        ammoName: this.sim.weapon.ammo.name,
        ammoId: this.sim.weapon.ammo.id,
        ammoCost: this.sim.weapon.ammo.cost,
        phase: this.sim.phase,
        sandbox: this.mode === 'sandbox',
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
    const result: LevelResult = scoreLevel(this.session.outcome());
    gs.totalJointsBroken += this.sim.structure?.jointsBroken ?? 0;
    // Seed mode shares the campaign wallet: only today's daily seed pays (once, via its record).
    // Other seeds (and debug-randomized structures) are unpaid practice: an endless seed+1
    // chain would otherwise bypass the campaign economy. Practice leaves no record either.
    const daily = this.mode === 'seed' && !this.levelOverride && this.structureSeed === this.dailySeedValue;
    const practice = !!this.levelOverride || (this.mode === 'seed' && !daily);
    let credited = 0;
    if (!practice) {
      const rec = gs.records[this.level.id];
      // Replays only pay the improvement over the best previous payout (no farming).
      credited = rec?.completed ? Math.max(0, result.total - rec.bestPayout) : result.total;
      gs.money += credited;
      gs.totalEarned += credited;
      gs.records[this.level.id] = {
        completed: true,
        bestGrade: rec && gradeRank(rec.bestGrade) >= gradeRank(result.grade) ? rec.bestGrade : result.grade,
        bestShots: rec ? Math.min(rec.bestShots, this.session.shots) : this.session.shots,
        bestPayout: Math.max(rec?.bestPayout ?? 0, result.total),
      };
      if (this.mode === 'campaign' && this.levelIndex >= gs.levelIndex) gs.levelIndex = this.levelIndex + 1;
    }
    gs.save();
    const inCampaign = this.mode === 'campaign' && this.levelIndex < levelManager.count && !practice;
    this.results?.show(result, this.level, {
      onContinue: () => {
        if (this.mode === 'campaign') this.scene.start('Upgrade');
        else this.loadSeed((this.structureSeed + 1) >>> 0);
      },
      onRetry: () => this.reloadLevel(),
    }, {
      credited: practice ? undefined : credited,
      levelLabel: inCampaign
        ? `LEVEL ${pad2(this.levelIndex + 1)} / ${pad2(levelManager.count)}`
        : practice
          ? 'PRACTICE · NO PAYOUT'
          : daily
            ? 'DAILY SEED'
            : undefined,
    });
  }

  // ------------------------------------------------------------------ debug helpers

  private spawnDebugBlock(x: number, y: number): void {
    const size = this.spawnMaterial === 'steel' ? 0.6 : 1;
    // Loose parts are picked up by the debris manager (entityAdded) automatically.
    spawnPart(this.sim.physics, { shape: { kind: 'box', w: size, h: size }, x: 0, y: 0, material: this.spawnMaterial }, { x, y, angle: 0 });
  }

  private spawnDebugBall(x: number, y: number): void {
    const w = this.sim.weapon;
    this.sim.projectiles.spawn({
      ammo: w.ammo,
      x,
      y,
      vx: 0,
      vy: 0,
      radius: w.stats.projectileRadius,
      mass: w.stats.projectileMass * this.massScale,
      shot: 0,
    });
  }

  // ------------------------------------------------------------------ DebugApi

  reloadLevel(): void {
    this.loadCurrentLevel();
  }

  randomizeStructure(): void {
    this.structureSeed = (Math.random() * 0xffffffff) >>> 0;
    if (this.mode === 'campaign') {
      // Kept as an override so R / Retry replay this structure (not the campaign blueprint
      // with a random seed); it is unpaid practice and never advances the campaign.
      const difficulty = Math.min(1, 0.15 + this.levelIndex * 0.09);
      this.levelOverride = levelManager.procedural(this.structureSeed, difficulty);
    }
    this.loadCurrentLevel();
  }

  setPaused(p: boolean): void {
    this.sim.physics.paused = p;
  }
  isPaused(): boolean {
    return this.sim.physics.paused;
  }
  stepOnce(): void {
    if (!this.sim.physics.paused) this.sim.physics.paused = true;
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
    // Wide rather than tall (max 24 courses) and load-sized welds: a tall wall with default
    // welds yields under its own weight, never sleeps and stalls the synchronous pre-settle.
    let cols = Math.max(4, Math.round(Math.sqrt(n / 1.6)));
    let rows = Math.max(4, Math.round(n / cols));
    if (rows > 24) {
      rows = 24;
      cols = Math.max(4, Math.round(n / rows));
    }
    const parts: StructureDef['parts'] = [];
    const bw = 0.8;
    const bh = 0.5;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        parts.push({ shape: { kind: 'box', w: bw, h: bh }, x: (c - cols / 2) * bw + (r % 2 ? bw / 2 : 0), y: bh / 2 + r * bh, material: r % 6 === 5 ? 'concrete' : 'wood' });
    // Weld the brick wall using the draft's seam detection.
    const d = new StructureDraft(this.sim.rng);
    for (const p of parts) d.add(p);
    d.autoWeld();
    sizeJoints(d, DEFAULT_SIZING);
    this.loadCurrentLevel(d.toDef(42, `Benchmark ${parts.length}`));
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
    if (this.mode !== 'campaign') return;
    const gs = gameState();
    gs.levelIndex = this.levelIndex + 1;
    gs.save();
    this.scene.start('Upgrade');
  }
  getSeed(): number {
    return this.structureSeed || this.level.seed;
  }
  loadSeed(seed: number): void {
    this.mode = this.mode === 'campaign' ? 'seed' : this.mode;
    this.levelOverride = null;
    this.structureSeed = seed >>> 0;
    this.loadCurrentLevel();
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

// Keep DEFAULT_GRAVITY referenced for debug UIs that want to reset gravity.
export const GAME_DEFAULT_GRAVITY = DEFAULT_GRAVITY;
