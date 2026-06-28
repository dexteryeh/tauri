import type { BabylonApp } from "../app/BabylonApp";
import {
  ArcRotateCamera,
  Color3,
  Color4,
  CreateBox,
  CreateCylinder,
  CreateGround,
  CreateSphere,
  CreateTorus,
  DirectionalLight,
  HemisphericLight,
  Mesh,
  Scene,
  StandardMaterial,
  Vector3
} from "../app/babylon";

type DebrisKind = "plank" | "plastic" | "leaf" | "barrel";

interface Debris {
  mesh: Mesh;
  kind: DebrisKind;
  speed: number;
}

interface Game {
  health: number;
  hunger: number;
  thirst: number;
  hull: number;
  wood: number;
  scrap: number;
  fiber: number;
  day: number;
  message: string;
  raftSize: number;
  hookCooldown: number;
  sharkTimer: number;
}

const worldLimit = 5.3;

export async function createScene(app: BabylonApp): Promise<Scene> {
  const scene = new Scene(app.engine);
  scene.clearColor = new Color4(0.035, 0.105, 0.16, 1);

  const camera = new ArcRotateCamera(
    "camera",
    -Math.PI / 2,
    Math.PI / 3.05,
    13,
    new Vector3(0, 0, 0),
    scene
  );
  camera.attachControl(app.canvas, true);
  camera.lowerRadiusLimit = 9;
  camera.upperRadiusLimit = 16;
  camera.wheelPrecision = 40;

  const sky = new HemisphericLight("soft-sky", new Vector3(0.2, 1, 0.15), scene);
  sky.intensity = 0.75;
  const sun = new DirectionalLight("late-sun", new Vector3(-0.5, -1, 0.35), scene);
  sun.intensity = 1.2;

  const materials = createMaterials(scene);
  const ocean = CreateGround("rolling-ocean", { width: 34, height: 34, subdivisions: 16 }, scene);
  ocean.material = materials.ocean;

  const raftRoot = new Mesh("raft-root", scene);
  const player = createSurvivor(scene, materials);
  const shark = createShark(scene, materials);
  const hook = createHook(scene, materials);
  hook.setEnabled(false);

  const game: Game = {
    health: 100,
    hunger: 100,
    thirst: 100,
    hull: 100,
    wood: 4,
    scrap: 1,
    fiber: 2,
    day: 1,
    message: "Collect drifting salvage. Build before the next bite.",
    raftSize: 3,
    hookCooldown: 0,
    sharkTimer: 11
  };

  const keys = new Set<string>();
  const debris: Debris[] = [];
  const raftTiles: Mesh[] = [];
  const hud = createHud(document.getElementById("hud") ?? document.body);

  rebuildRaft(scene, materials, raftRoot, raftTiles, game.raftSize);
  for (let index = 0; index < 16; index += 1) {
    debris.push(spawnDebris(scene, materials, Math.random() * 5));
  }

  window.addEventListener("keydown", (event) => keys.add(event.code));
  window.addEventListener("keyup", (event) => keys.delete(event.code));

  const buildButton = hud.querySelector<HTMLButtonElement>("[data-action='build']");
  const repairButton = hud.querySelector<HTMLButtonElement>("[data-action='repair']");
  const waterButton = hud.querySelector<HTMLButtonElement>("[data-action='water']");
  buildButton?.addEventListener("click", () => buildRaft(game, scene, materials, raftRoot, raftTiles));
  repairButton?.addEventListener("click", () => repairHull(game));
  waterButton?.addEventListener("click", () => drinkWater(game));

  let elapsed = 0;
  scene.onBeforeRenderObservable.add(() => {
    const delta = Math.min(0.04, scene.getEngine().getDeltaTime() / 1000);
    elapsed += delta;

    updateOcean(ocean, elapsed);
    movePlayer(player, keys, delta);
    updateHook(scene, player, hook, keys, debris, game, delta);
    updateDebris(scene, materials, debris, game, delta);
    updateShark(shark, game, delta, elapsed);
    updateSurvival(game, delta);
    updateHud(hud, game);

    camera.target.x += (player.position.x - camera.target.x) * 0.04;
    camera.target.z += (player.position.z - camera.target.z) * 0.04;
  });

  scene.onDisposeObservable.add(() => {
    hud.remove();
    window.onkeydown = null;
    window.onkeyup = null;
  });

  return scene;
}

function createMaterials(scene: Scene) {
  const ocean = new StandardMaterial("ocean", scene);
  ocean.diffuseColor = new Color3(0.025, 0.38, 0.5);
  ocean.emissiveColor = new Color3(0.01, 0.08, 0.1);
  ocean.specularColor = new Color3(0.35, 0.56, 0.62);

  const plank = new StandardMaterial("sun-worn-plank", scene);
  plank.diffuseColor = new Color3(0.62, 0.42, 0.22);
  plank.specularColor = new Color3(0.08, 0.06, 0.03);

  const rope = new StandardMaterial("fiber-rope", scene);
  rope.diffuseColor = new Color3(0.76, 0.66, 0.42);

  const player = new StandardMaterial("sailor-shirt", scene);
  player.diffuseColor = new Color3(0.92, 0.78, 0.48);

  const skin = new StandardMaterial("skin", scene);
  skin.diffuseColor = new Color3(0.72, 0.5, 0.36);

  const plastic = new StandardMaterial("blue-plastic", scene);
  plastic.diffuseColor = new Color3(0.16, 0.5, 0.9);
  plastic.emissiveColor = new Color3(0.02, 0.08, 0.13);

  const leaf = new StandardMaterial("palm-fiber", scene);
  leaf.diffuseColor = new Color3(0.25, 0.62, 0.32);

  const shark = new StandardMaterial("reef-hunter", scene);
  shark.diffuseColor = new Color3(0.22, 0.27, 0.31);
  shark.specularColor = new Color3(0.2, 0.24, 0.26);

  const hook = new StandardMaterial("hook", scene);
  hook.diffuseColor = new Color3(0.86, 0.86, 0.78);
  hook.emissiveColor = new Color3(0.12, 0.1, 0.05);

  return { ocean, plank, rope, player, skin, plastic, leaf, shark, hook };
}

function rebuildRaft(
  scene: Scene,
  materials: ReturnType<typeof createMaterials>,
  root: Mesh,
  tiles: Mesh[],
  size: number
): void {
  tiles.splice(0).forEach((tile) => tile.dispose());
  const half = Math.floor(size / 2);

  for (let x = -half; x <= half; x += 1) {
    for (let z = -half; z <= half; z += 1) {
      const tile = CreateBox(`raft-tile-${x}-${z}`, { width: 0.92, height: 0.16, depth: 0.92 }, scene);
      tile.position = new Vector3(x * 0.96, 0.08, z * 0.96);
      tile.material = materials.plank;
      tile.parent = root;
      tiles.push(tile);
    }
  }
}

function createSurvivor(scene: Scene, materials: ReturnType<typeof createMaterials>): Mesh {
  const root = new Mesh("player-survivor", scene);
  root.position.y = 0.28;

  const body = CreateCylinder("player-body", { height: 0.56, diameter: 0.28, tessellation: 14 }, scene);
  body.position.y = 0.42;
  body.material = materials.player;
  body.parent = root;

  const head = CreateSphere("player-head", { diameter: 0.24, segments: 16 }, scene);
  head.position.y = 0.82;
  head.material = materials.skin;
  head.parent = root;

  const pole = CreateCylinder("hook-pole", { height: 0.78, diameter: 0.035, tessellation: 8 }, scene);
  pole.position = new Vector3(0.24, 0.45, -0.1);
  pole.rotation.z = -0.45;
  pole.material = materials.hook;
  pole.parent = root;

  return root;
}

function createShark(scene: Scene, materials: ReturnType<typeof createMaterials>): Mesh {
  const root = new Mesh("shark", scene);
  const body = CreateSphere("shark-body", { diameter: 0.75, segments: 24 }, scene);
  body.scaling = new Vector3(1.5, 0.28, 0.42);
  body.material = materials.shark;
  body.parent = root;

  const fin = CreateCylinder("shark-fin", { height: 0.44, diameter: 0.12, tessellation: 3 }, scene);
  fin.position.y = 0.24;
  fin.rotation.z = Math.PI / 2;
  fin.material = materials.shark;
  fin.parent = root;

  root.position = new Vector3(4.6, 0.12, 2.9);
  return root;
}

function createHook(scene: Scene, materials: ReturnType<typeof createMaterials>): Mesh {
  const hook = CreateTorus("cast-hook", { diameter: 0.28, thickness: 0.035, tessellation: 18 }, scene);
  hook.rotation.x = Math.PI / 2;
  hook.material = materials.hook;
  return hook;
}

function spawnDebris(scene: Scene, materials: ReturnType<typeof createMaterials>, offset = 0): Debris {
  const kinds: DebrisKind[] = ["plank", "plastic", "leaf", "barrel"];
  const kind = kinds[Math.floor(Math.random() * kinds.length)];
  const mesh =
    kind === "barrel"
      ? CreateCylinder(`debris-${kind}`, { height: 0.36, diameter: 0.32, tessellation: 14 }, scene)
      : CreateBox(`debris-${kind}`, { width: 0.5, height: 0.16, depth: 0.24 }, scene);

  mesh.position = new Vector3((Math.random() - 0.5) * 9.8, 0.16, -4 - offset);
  mesh.rotation.y = Math.random() * Math.PI;
  mesh.material =
    kind === "plank"
      ? materials.plank
      : kind === "plastic"
        ? materials.plastic
        : kind === "leaf"
          ? materials.leaf
          : materials.rope;

  return { mesh, kind, speed: 1.1 + Math.random() * 0.75 };
}

function updateOcean(ocean: Mesh, elapsed: number): void {
  ocean.position.z = Math.sin(elapsed * 0.25) * 0.15;
  ocean.position.x = Math.cos(elapsed * 0.19) * 0.09;
}

function movePlayer(player: Mesh, keys: Set<string>, delta: number): void {
  const direction = new Vector3(0, 0, 0);
  if (keys.has("KeyW") || keys.has("ArrowUp")) direction.z += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) direction.z -= 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) direction.x -= 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) direction.x += 1;

  if (direction.lengthSquared() > 0) {
    direction.normalize();
    player.position.x += direction.x * 2.25 * delta;
    player.position.z += direction.z * 2.25 * delta;
    player.rotation.y = Math.atan2(direction.x, direction.z);
  }

  player.position.x = Math.max(-worldLimit, Math.min(worldLimit, player.position.x));
  player.position.z = Math.max(-worldLimit, Math.min(worldLimit, player.position.z));
}

function updateHook(
  scene: Scene,
  player: Mesh,
  hook: Mesh,
  keys: Set<string>,
  debris: Debris[],
  game: Game,
  delta: number
): void {
  game.hookCooldown = Math.max(0, game.hookCooldown - delta);
  const casting = keys.has("Space") || keys.has("KeyF");

  if (casting && game.hookCooldown <= 0) {
    hook.setEnabled(true);
    hook.position = player.position.add(new Vector3(Math.sin(player.rotation.y) * 2.7, -0.05, Math.cos(player.rotation.y) * 2.7));
    game.hookCooldown = 0.45;
  }

  if (!hook.isEnabled()) return;
  hook.rotation.y += delta * 8;
  hook.position.y = 0.18 + Math.sin(scene.getEngine().getDeltaTime() * 0.005) * 0.025;

  debris.forEach((item) => {
    const distance = Vector3.Distance(item.mesh.position, hook.position);
    if (distance < 0.8) {
      collect(item.kind, game);
      item.mesh.position = new Vector3((Math.random() - 0.5) * 9.8, 0.16, -7 - Math.random() * 7);
    }
  });

  setTimeout(() => hook.setEnabled(false), 210);
}

function updateDebris(
  scene: Scene,
  materials: ReturnType<typeof createMaterials>,
  debris: Debris[],
  game: Game,
  delta: number
): void {
  debris.forEach((item, index) => {
    item.mesh.position.z += item.speed * delta;
    item.mesh.position.x += Math.sin(performance.now() * 0.001 + index) * delta * 0.18;
    item.mesh.rotation.y += delta * 0.55;

    if (Vector3.Distance(item.mesh.position, Vector3.Zero()) < 0.72) {
      collect(item.kind, game);
      item.mesh.dispose();
      debris[index] = spawnDebris(scene, materials, Math.random() * 7);
    } else if (item.mesh.position.z > 9) {
      item.mesh.dispose();
      debris[index] = spawnDebris(scene, materials, Math.random() * 7);
    }
  });
}

function collect(kind: DebrisKind, game: Game): void {
  if (kind === "plank") game.wood += 1;
  if (kind === "plastic") game.scrap += 1;
  if (kind === "leaf") game.fiber += 1;
  if (kind === "barrel") {
    game.wood += 2;
    game.scrap += 1;
    game.fiber += 1;
  }
  game.message = `Collected ${kind}.`;
}

function updateShark(shark: Mesh, game: Game, delta: number, elapsed: number): void {
  shark.position.x = Math.cos(elapsed * 0.55) * 4.9;
  shark.position.z = Math.sin(elapsed * 0.55) * 3.4;
  shark.rotation.y = -elapsed * 0.55 + Math.PI / 2;
  game.sharkTimer -= delta;

  if (game.sharkTimer <= 0) {
    game.hull = Math.max(0, game.hull - 12);
    game.health = Math.max(0, game.health - (game.hull <= 0 ? 10 : 0));
    game.message = "A reef hunter bit the raft. Repair the hull.";
    game.sharkTimer = 13 + Math.random() * 8;
  }
}

function updateSurvival(game: Game, delta: number): void {
  game.hunger = Math.max(0, game.hunger - delta * 0.75);
  game.thirst = Math.max(0, game.thirst - delta * 1.05);
  if (game.hunger <= 0 || game.thirst <= 0) game.health = Math.max(0, game.health - delta * 3.2);
  game.day += delta * 0.018;
}

function buildRaft(
  game: Game,
  scene: Scene,
  materials: ReturnType<typeof createMaterials>,
  root: Mesh,
  tiles: Mesh[]
): void {
  if (game.wood < 4 || game.fiber < 2) {
    game.message = "Need 4 wood and 2 fiber to expand.";
    return;
  }
  game.wood -= 4;
  game.fiber -= 2;
  game.raftSize = Math.min(7, game.raftSize + 2);
  rebuildRaft(scene, materials, root, tiles, game.raftSize);
  game.message = "Raft expanded.";
}

function repairHull(game: Game): void {
  if (game.wood < 2 || game.scrap < 1) {
    game.message = "Need 2 wood and 1 scrap to repair.";
    return;
  }
  game.wood -= 2;
  game.scrap -= 1;
  game.hull = Math.min(100, game.hull + 28);
  game.message = "Hull patched.";
}

function drinkWater(game: Game): void {
  if (game.scrap < 1) {
    game.message = "Need 1 scrap to distill emergency water.";
    return;
  }
  game.scrap -= 1;
  game.thirst = Math.min(100, game.thirst + 38);
  game.hunger = Math.min(100, game.hunger + 8);
  game.message = "Water distilled.";
}

function createHud(parent: HTMLElement): HTMLDivElement {
  const hud = document.createElement("div");
  hud.className = "survival-hud";
  hud.innerHTML = `
    <div class="topbar">
      <strong>Driftline</strong>
      <span>Move WASD / arrows</span>
      <span>Cast hook Space or F</span>
    </div>
    <div class="status"></div>
    <div class="inventory"></div>
    <div class="actions">
      <button data-action="build">Build raft</button>
      <button data-action="repair">Repair hull</button>
      <button data-action="water">Distill water</button>
    </div>
    <div class="message"></div>
  `;
  parent.appendChild(hud);
  return hud;
}

function updateHud(hud: HTMLDivElement, game: Game): void {
  const status = hud.querySelector<HTMLDivElement>(".status");
  const inventory = hud.querySelector<HTMLDivElement>(".inventory");
  const message = hud.querySelector<HTMLDivElement>(".message");
  if (!status || !inventory || !message) return;

  status.innerHTML = [
    meter("Health", game.health),
    meter("Hunger", game.hunger),
    meter("Thirst", game.thirst),
    meter("Hull", game.hull)
  ].join("");

  inventory.innerHTML = `
    <span>Day ${Math.floor(game.day)}</span>
    <span>Wood ${game.wood}</span>
    <span>Scrap ${game.scrap}</span>
    <span>Fiber ${game.fiber}</span>
    <span>Next bite ${Math.ceil(game.sharkTimer)}s</span>
  `;
  message.textContent = game.health <= 0 ? "You are adrift. Refresh to try again." : game.message;
}

function meter(label: string, value: number): string {
  const clamped = Math.max(0, Math.min(100, value));
  return `<div class="meter"><span>${label}</span><b>${Math.round(clamped)}</b><i style="width:${clamped}%"></i></div>`;
}
