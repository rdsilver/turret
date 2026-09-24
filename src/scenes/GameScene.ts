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
import { DEFAULT_GRAVITY, TURRET } from '../config/constants';
import { hashString } from '../core/Random';
import { StructureDraft } from '../sim/generator/StructureDraft';
import { solveAim } from '../sim/ballistics';

export type GameMode = 'campaign' | 'sandbox' | 'seed';

export interface GameSceneData {
  mode?: GameMode;
  seed?: number;
  levelIndex?: number;
}

type Flow = 'aiming' | 'collapsing' | 'results';

const SCAN_SECONDS = 5;

export class GameScene extends Phaser.Scene implements DebugApi {
  private mode: GameMode = 'campaign';
  private sim!: Simulation;
  private level!: LevelDef;
  private levelIndex = 0;
  private structureSeed = 0;
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
  private prediction: TrajectoryPrediction = createPrediction();

  private pointerSim = { x: 30, y: -5 };
  private tool: DebugTool = 'fire';
  private spawnMaterial: MaterialId = 'wood';
  private debugSlowMo = false;
  private stressDebug = false;
  private massScale = 1;
  private scanCharges = 0;
  private scanTimer = 0;
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
    this.levelIndex = data.levelIndex ?? gs.levelIndex;
    this.structureSeed = data.seed ?? 0;
    this.flow = 'aiming';
    this.resultsDelay = -1;
    this.tool = 'fire';
    this.offs = [];
  }

  create(): void {
    const gs = gameState();
    const stats = this.upgrades.weaponStats(gs.upgrades);
    this.unlockedAmmo = this.upgrades.unlockedAmmo(gs.upgrades);
    const ammo = this.unlockedAmmo.includes(gs.selectedAmmo) ? ammoById(gs.selectedAmmo) : AMMO.standard!;

    this.sim = new Simulation({ seed: 1234 + this.levelIndex, weaponStats: stats, ammo });
    this.textureFactory = new TextureFactory(this);
    this.cam = new CameraDirector(this);
    this.background = new BackgroundRenderer(this);
    this.world = new WorldRenderer(this, this.sim, this.textureFactory);
    this.turret = new TurretView(this, this.sim.weapon);
    this.effects = new EffectsManager(this, this.sim, this.cam);
    this.audio = new AudioManager(this);
    this.audio.bind(this.sim);
    this.grabber = new MouseGrabber(this.sim);
    this.devOverlay = new DevOverlay();
    this.debugMenu = new DebugMenu(this);

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
    this.level = this.currentLevelDef();
    this.effects.clear();
    this.world.clear();
    const def = structureOverride ?? levelManager.build(this.level, this.structureSeed || undefined);
    this.sim.loadStructure(def, this.level.objective);
    this.session?.dispose();
    this.session = new LevelSession(this.sim, this.level);
    this.flow = 'aiming';
    this.resultsDelay = -1;
    this.scanCharges = this.upgrades.scanCharges(gameState().upgrades);
    this.scanTimer = 0;
    this.world.setStressView(this.stressDebug);

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
    const right = Math.max(this.level.camera?.right ?? 0, (s ? s.maxX0 : 40) + 7);
    const top = -Math.max(this.level.camera?.top ?? 0, (s ? s.height0 : 10) + 5, 12);
    return { left: TURRET.x - 5, right, top, bottom: 3.5 };
  }

  private pushHudLevel(): void {
    if (!this.hud || !this.level) return;
    const campaign = this.mode === 'campaign' && this.levelIndex < levelManager.count;
    this.hud.setLevel({
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
        if (this.flow === 'collapsing') this.resultsDelay = 1.2;
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
    input.mouse?.disableContextMenu();

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

    input.on('pointerup', () => {
      if (this.grabber.active) this.grabber.release();
    });

    input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.sim.weapon.setPower(this.sim.weapon.power - dy * 0.0006);
    });

    const kb = input.keyboard;
    if (!kb) return;
    kb.on('keydown', (e: KeyboardEvent) => {
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
        case 'KeyS':
          this.activateScan();
          break;
        case 'Space':
          this.tryFire();
          break;
        case 'KeyP':
          this.setPaused(!this.isPaused());
          break;
        case 'Period':
        case 'KeyN':
          this.stepOnce();
          break;
        case 'KeyT':
          this.setSlowMo(!this.debugSlowMo);
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
    });
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

  private activateScan(): void {
    if (this.scanTimer > 0) return;
    if (this.scanCharges <= 0 && this.mode !== 'sandbox') {
      this.hud?.flash('NO SCANNER CHARGES', '#ff6b5e');
      return;
    }
    if (this.mode !== 'sandbox') this.scanCharges--;
    this.scanTimer = SCAN_SECONDS;
    this.world.setStressView(true);
  }

  // ------------------------------------------------------------------ frame

  update(_time: number, deltaMs: number): void {
    const dt = Math.min(0.1, deltaMs / 1000);
    const physics = this.sim.physics;

    if (!this.grabber.active && this.tool === 'fire' && !this.results?.visible) this.sim.weapon.aimAt(this.pointerSim.x, this.pointerSim.y);

    this.effects.update(dt);
    physics.timeScale = this.effects.timeScale * (this.debugSlowMo ? 0.2 : 1);
    this.sim.update(dt);

    if (this.scanTimer > 0) {
      this.scanTimer -= dt;
      if (this.scanTimer <= 0) this.world.setStressView(this.stressDebug);
    }

    this.sim.weapon.predict(this.prediction);
    this.turret.showPreview = this.flow === 'aiming' || this.mode === 'sandbox';
    this.turret.update(dt, this.prediction);
    this.world.update(physics.alpha, dt);
    this.background.setProgress(this.sim.progress);
    this.background.update(dt);
    this.cam.update(dt);
    this.audio.update(dt, physics.timeScale);

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
        ammoCost: this.sim.weapon.ammo.cost,
        scanCharges: this.scanCharges,
        scanActive: this.scanTimer > 0,
        phase: this.sim.phase,
        sandbox: this.mode === 'sandbox',
      },
      dt,
    );

    const st = physics.stats;
    this.devOverlay.update(
      {
        fps: this.game.loop.actualFps,
        stepMs: st.stepMs,
        stepMsMax: st.stepMsMax,
        postMs: st.postMs,
        stepsPerFrame: st.stepsLastFrame,
        bodies: st.bodies,
        dynamicBodies: st.dynamicBodies,
        active: st.active,
        sleeping: st.sleeping,
        joints: st.joints,
        projectiles: this.sim.projectiles.count,
        debris: this.sim.debris.candidateCount,
        timeScale: physics.timeScale,
        paused: physics.paused,
      },
      dt,
    );
    if (this.debugMenu.visible) this.debugMenu.refresh();
  }

  private showResults(): void {
    if (this.flow === 'results') return;
    this.flow = 'results';
    const gs = gameState();
    const result: LevelResult = scoreLevel(this.session.outcome());
    const rec = gs.records[this.level.id];
    // Replays only pay the improvement over the best previous payout (no farming).
    const credited = rec?.completed ? Math.max(0, result.total - rec.bestPayout) : result.total;
    gs.money += credited;
    gs.totalEarned += credited;
    gs.totalJointsBroken += this.sim.structure?.jointsBroken ?? 0;
    gs.records[this.level.id] = {
      completed: true,
      bestGrade: rec && gradeRank(rec.bestGrade) >= gradeRank(result.grade) ? rec.bestGrade : result.grade,
      bestShots: rec ? Math.min(rec.bestShots, this.session.shots) : this.session.shots,
      bestPayout: Math.max(rec?.bestPayout ?? 0, result.total),
    };
    if (this.mode === 'campaign' && this.levelIndex >= gs.levelIndex) gs.levelIndex = this.levelIndex + 1;
    gs.save();
    this.results?.show(result, this.level, {
      onContinue: () => {
        if (this.mode === 'campaign') this.scene.start('Upgrade');
        else this.loadSeed((this.structureSeed + 1) >>> 0);
      },
      onRetry: () => {
        this.results?.hide();
        this.reloadLevel();
      },
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
    this.results?.hide();
    this.loadCurrentLevel();
  }

  randomizeStructure(): void {
    this.structureSeed = (Math.random() * 0xffffffff) >>> 0;
    if (this.mode === 'campaign') {
      const difficulty = Math.min(1, 0.15 + this.levelIndex * 0.09);
      const lvl = levelManager.procedural(this.structureSeed, difficulty);
      this.level = lvl;
      this.loadCurrentLevelWith(lvl);
    } else this.loadCurrentLevel();
  }

  private loadCurrentLevelWith(lvl: LevelDef): void {
    this.effects.clear();
    this.world.clear();
    this.sim.loadStructure(levelManager.build(lvl), lvl.objective);
    this.level = lvl;
    this.session?.dispose();
    this.session = new LevelSession(this.sim, lvl);
    this.flow = 'aiming';
    const s = this.sim.structure!;
    const bounds = this.frameBounds();
    this.cam.frame(bounds, true);
    this.background.layout(bounds);
    this.background.setDestructionLine(this.sim.detector?.lineHeight ?? null, s.minX0 - 2, s.maxX0 + 2);
    this.pushHudLevel();
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
    this.world.setStressView(on || this.scanTimer > 0);
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
    const cols = Math.max(4, Math.round(Math.sqrt(n / 1.6)));
    const rows = Math.max(4, Math.round(n / cols));
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
