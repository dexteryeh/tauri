import type { BabylonApp } from "../app/BabylonApp";
import {
  ArcRotateCamera,
  Color3,
  Color4,
  CreateCylinder,
  CreateGround,
  CreateSphere,
  HemisphericLight,
  Mesh,
  PointLight,
  Scene,
  StandardMaterial,
  Vector3
} from "../app/babylon";
import {
  createGameState,
  fight,
  getCurrentSite,
  mine,
  repair,
  rest,
  scout,
  travelTo,
  type ActionResult,
  type GameState,
  type MoonSite
} from "./state";
import { InputState } from "./input";

const siteColors: Record<MoonSite["kind"], Color3> = {
  base: new Color3(0.45, 0.78, 1),
  mine: new Color3(0.95, 0.72, 0.32),
  ruin: new Color3(0.76, 0.62, 1),
  crater: new Color3(0.54, 0.9, 0.72),
  spire: new Color3(1, 0.92, 0.64)
};

const npcNames: Record<MoonSite["kind"], string> = {
  base: "Quartermaster Imani",
  mine: "Miner Vale",
  ruin: "Archivist Sato",
  crater: "Signal Warden",
  spire: "Spire Herald"
};

export async function createScene(app: BabylonApp): Promise<Scene> {
  const scene = new Scene(app.engine);
  scene.clearColor = new Color4(0.015, 0.017, 0.024, 1);

  const camera = new ArcRotateCamera(
    "camera",
    -Math.PI / 2.8,
    Math.PI / 3.2,
    12.5,
    new Vector3(0.4, 0, 0.5),
    scene
  );
  camera.attachControl(app.canvas, true);
  camera.lowerRadiusLimit = 8;
  camera.upperRadiusLimit = 17;
  camera.wheelPrecision = 35;

  const hemi = new HemisphericLight("earth-glow", new Vector3(-0.35, 1, 0.25), scene);
  hemi.intensity = 0.45;
  hemi.diffuse = new Color3(0.54, 0.66, 0.82);

  const beaconLight = new PointLight("beacon-light", new Vector3(0, 3, 0), scene);
  beaconLight.intensity = 0.6;
  beaconLight.diffuse = new Color3(0.95, 0.75, 0.42);

  const materials = createMaterials(scene);
  buildSky(scene);
  buildMoonSurface(scene, materials.regolith);

  const stateRef = { value: createGameState() };
  const nodeMeshes = new Map<string, Mesh>();
  const pulseMeshes = new Map<string, Mesh>();
  const player = createAstronaut("player", scene, materials.playerSuit, materials.playerVisor);
  const rover = createRover(scene, materials.rover);
  const npcs: Mesh[] = [];
  const input = new InputState();
  input.attach(app.canvas);
  const playerControl = {
    target: undefined as Vector3 | undefined,
    nearbySiteId: "base",
    interactionWasDown: false
  };

  stateRef.value.sites.forEach((site) => {
    const node = createSiteNode(site, scene, materials);
    nodeMeshes.set(site.id, node);

    const pulse = CreateCylinder(`pulse-${site.id}`, { height: 0.02, diameter: 0.9, tessellation: 48 }, scene);
    pulse.position = new Vector3(site.x, 0.04, site.z);
    pulse.material = materials.pulse;
    pulseMeshes.set(site.id, pulse);

    if (site.id !== "spire") {
      const npc = createNpc(site, scene, materials);
      npcs.push(npc);
    }
  });

  const hud = createHud(document.getElementById("hud") ?? document.body);

  const applyAction = (action: ActionResult): void => {
    stateRef.value = action.state;
    renderHud(hud, stateRef.value, action.title, action.message, applyAction);
    updateSceneState(stateRef.value, nodeMeshes, pulseMeshes, rover, player, npcs, beaconLight, true);
    playerControl.target = undefined;
  };

  renderHud(
    hud,
    stateRef.value,
    "Moonfall RPG",
    "Chart the sector, recover relics, and survive the Tycho Spire.",
    applyAction
  );
  updateSceneState(stateRef.value, nodeMeshes, pulseMeshes, rover, player, npcs, beaconLight, true);

  app.canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) => mesh.name === "moon-field");
    if (!pick?.hit || !pick.pickedPoint) return;
    playerControl.target = clampToField(pick.pickedPoint);
  });

  let elapsed = 0;
  scene.onBeforeRenderObservable.add(() => {
    const delta = scene.getEngine().getDeltaTime() / 1000;
    elapsed += delta;

    pulseMeshes.forEach((pulse, siteId) => {
      const site = stateRef.value.sites.find((candidate) => candidate.id === siteId);
      if (!site) return;
      const visible = site.discovered && !site.secured;
      pulse.setEnabled(visible);
      if (!visible) return;

      const scale = 1 + Math.sin(elapsed * 2.4 + site.threat) * 0.12;
      pulse.scaling.x = scale;
      pulse.scaling.z = scale;
      pulse.rotation.y += delta * 0.18;
    });

    rover.rotation.y += Math.sin(elapsed * 1.8) * 0.0015;
    movePlayer(player, input, playerControl, delta);
    playerControl.nearbySiteId = getNearbySiteId(stateRef.value, player.position) ?? "";
    const interactionDown = input.isDown("KeyE") || input.isDown("Space");
    if (interactionDown && !playerControl.interactionWasDown && playerControl.nearbySiteId) {
      applyAction(travelTo(stateRef.value, playerControl.nearbySiteId));
    }
    playerControl.interactionWasDown = interactionDown;

    camera.target.x += (player.position.x - camera.target.x) * 0.035;
    camera.target.z += (player.position.z - camera.target.z) * 0.035;
    beaconLight.position.x = player.position.x;
    beaconLight.position.z = player.position.z;

    player.position.y = 0.48 + Math.sin(elapsed * 2.1) * 0.025;
    npcs.forEach((npc, index) => {
      npc.rotation.y += delta * (0.12 + index * 0.02);
    });
  });

  scene.onDisposeObservable.add(() => {
    input.detach(app.canvas);
    hud.root.remove();
  });

  return scene;
}

function createMaterials(scene: Scene) {
  const regolith = new StandardMaterial("regolith", scene);
  regolith.diffuseColor = new Color3(0.17, 0.18, 0.19);
  regolith.specularColor = new Color3(0.05, 0.05, 0.06);

  const ridge = new StandardMaterial("ridge", scene);
  ridge.diffuseColor = new Color3(0.24, 0.25, 0.26);
  ridge.specularColor = new Color3(0.04, 0.04, 0.05);

  const rover = new StandardMaterial("rover", scene);
  rover.diffuseColor = new Color3(0.92, 0.84, 0.58);
  rover.emissiveColor = new Color3(0.16, 0.09, 0.02);

  const playerSuit = new StandardMaterial("player-suit", scene);
  playerSuit.diffuseColor = new Color3(0.92, 0.94, 0.92);
  playerSuit.emissiveColor = new Color3(0.08, 0.1, 0.12);
  playerSuit.specularColor = new Color3(0.6, 0.64, 0.7);

  const playerVisor = new StandardMaterial("player-visor", scene);
  playerVisor.diffuseColor = new Color3(0.12, 0.34, 0.54);
  playerVisor.emissiveColor = new Color3(0.04, 0.2, 0.33);
  playerVisor.specularColor = new Color3(0.95, 0.82, 0.48);

  const npcSuit = new StandardMaterial("npc-suit", scene);
  npcSuit.diffuseColor = new Color3(0.56, 0.82, 0.76);
  npcSuit.emissiveColor = new Color3(0.04, 0.18, 0.15);

  const pulse = new StandardMaterial("pulse", scene);
  pulse.diffuseColor = new Color3(0.94, 0.7, 0.28);
  pulse.emissiveColor = new Color3(0.6, 0.32, 0.08);
  pulse.alpha = 0.42;

  return { regolith, ridge, rover, playerSuit, playerVisor, npcSuit, pulse };
}

function buildSky(scene: Scene): void {
  const moon = CreateSphere("visible-moon-body", { diameter: 3.4, segments: 48 }, scene);
  moon.position = new Vector3(-1.6, 3.55, 5.1);
  const moonMat = new StandardMaterial("visible-moon-material", scene);
  moonMat.diffuseColor = new Color3(0.73, 0.76, 0.78);
  moonMat.emissiveColor = new Color3(0.11, 0.12, 0.14);
  moonMat.specularColor = new Color3(0.03, 0.03, 0.035);
  moon.material = moonMat;

  for (let i = 0; i < 13; i += 1) {
    const mark = CreateCylinder(`moon-crater-mark-${i}`, {
      height: 0.01,
      diameter: 0.22 + (i % 3) * 0.08,
      tessellation: 24
    }, scene);
    mark.position = new Vector3(
      moon.position.x - 0.7 + (i % 5) * 0.34,
      moon.position.y + 0.25 - Math.floor(i / 5) * 0.36,
      moon.position.z - 1.66
    );
    mark.rotation.x = Math.PI / 2;
    const markMat = new StandardMaterial(`moon-crater-mark-mat-${i}`, scene);
    markMat.diffuseColor = new Color3(0.36, 0.38, 0.39);
    markMat.emissiveColor = new Color3(0.04, 0.045, 0.05);
    mark.material = markMat;
  }

  const earth = CreateSphere("earthrise", { diameter: 1.05, segments: 32 }, scene);
  earth.position = new Vector3(3.05, 3.12, 4.8);
  const earthMat = new StandardMaterial("earthrise-material", scene);
  earthMat.diffuseColor = new Color3(0.24, 0.48, 0.96);
  earthMat.emissiveColor = new Color3(0.05, 0.18, 0.42);
  earthMat.specularColor = new Color3(0.4, 0.58, 0.78);
  earth.material = earthMat;
}

function buildMoonSurface(scene: Scene, groundMaterial: StandardMaterial): void {
  const ground = CreateGround("moon-field", { width: 13.5, height: 9.2, subdivisions: 24 }, scene);
  ground.material = groundMaterial;

  for (let i = 0; i < 46; i += 1) {
    const crater = CreateCylinder(`crater-${i}`, {
      height: 0.025,
      diameterTop: 0.4 + (i % 5) * 0.16,
      diameterBottom: 0.56 + (i % 5) * 0.18,
      tessellation: 32
    }, scene);
    crater.position = new Vector3(
      ((i * 2.73) % 12.4) - 6.2,
      0.025,
      ((i * 4.19) % 8.2) - 4.1
    );
    crater.rotation.y = i * 0.37;
    const material = new StandardMaterial(`crater-mat-${i}`, scene);
    const shade = 0.1 + (i % 4) * 0.025;
    material.diffuseColor = new Color3(shade, shade + 0.006, shade + 0.014);
    material.specularColor = new Color3(0.02, 0.02, 0.025);
    crater.material = material;
  }
}

function createSiteNode(site: MoonSite, scene: Scene, materials: ReturnType<typeof createMaterials>): Mesh {
  const height = site.kind === "spire" ? 1.4 : site.kind === "base" ? 0.58 : 0.42;
  const diameter = site.kind === "spire" ? 0.34 : site.kind === "base" ? 0.66 : 0.48;
  const node = CreateCylinder(`node-${site.id}`, { height, diameter, tessellation: 6 }, scene);
  node.position = new Vector3(site.x, height / 2, site.z);
  node.rotation.y = site.x * 0.4;

  const material = new StandardMaterial(`site-mat-${site.id}`, scene);
  material.diffuseColor = siteColors[site.kind];
  material.emissiveColor = siteColors[site.kind].scale(0.22);
  material.specularColor = new Color3(0.16, 0.16, 0.18);
  node.material = material;

  const cap = CreateSphere(`cap-${site.id}`, { diameter: diameter * 0.72, segments: 16 }, scene);
  cap.position = new Vector3(site.x, height + diameter * 0.2, site.z);
  cap.material = material;
  cap.parent = node;

  if (site.kind === "mine" || site.kind === "crater") {
    const drill = CreateCylinder(`drill-${site.id}`, { height: 0.72, diameter: 0.12, tessellation: 8 }, scene);
    drill.position = new Vector3(site.x + 0.32, 0.36, site.z - 0.14);
    drill.rotation.z = Math.PI / 9;
    drill.material = materials.ridge;
  }

  return node;
}

function createRover(scene: Scene, material: StandardMaterial): Mesh {
  const rover = CreateCylinder("crew-rover", { height: 0.28, diameter: 0.56, tessellation: 8 }, scene);
  rover.position.y = 0.27;
  rover.material = material;

  const mast = CreateCylinder("crew-mast", { height: 0.7, diameter: 0.06, tessellation: 8 }, scene);
  mast.position = new Vector3(0, 0.62, 0);
  mast.material = material;
  mast.parent = rover;

  return rover;
}

function createAstronaut(
  name: string,
  scene: Scene,
  suitMaterial: StandardMaterial,
  visorMaterial: StandardMaterial
): Mesh {
  const root = CreateCylinder(`${name}-astronaut-root`, { height: 0.08, diameter: 0.08 }, scene);
  root.isVisible = false;

  const body = CreateCylinder(`${name}-body`, { height: 0.62, diameter: 0.32, tessellation: 16 }, scene);
  body.position = new Vector3(0, 0.38, 0);
  body.material = suitMaterial;
  body.parent = root;

  const helmet = CreateSphere(`${name}-helmet`, { diameter: 0.38, segments: 24 }, scene);
  helmet.position = new Vector3(0, 0.82, 0);
  helmet.material = suitMaterial;
  helmet.parent = root;

  const visor = CreateSphere(`${name}-visor`, { diameter: 0.22, segments: 16 }, scene);
  visor.position = new Vector3(0, 0.84, -0.16);
  visor.scaling = new Vector3(1.25, 0.55, 0.22);
  visor.material = visorMaterial;
  visor.parent = root;

  [-0.18, 0.18].forEach((x) => {
    const leg = CreateCylinder(`${name}-leg-${x}`, { height: 0.36, diameter: 0.09, tessellation: 12 }, scene);
    leg.position = new Vector3(x, 0.05, 0);
    leg.material = suitMaterial;
    leg.parent = root;

    const arm = CreateCylinder(`${name}-arm-${x}`, { height: 0.42, diameter: 0.075, tessellation: 12 }, scene);
    arm.position = new Vector3(x * 1.32, 0.42, -0.02);
    arm.rotation.z = x > 0 ? -0.32 : 0.32;
    arm.material = suitMaterial;
    arm.parent = root;
  });

  return root;
}

function createNpc(site: MoonSite, scene: Scene, materials: ReturnType<typeof createMaterials>): Mesh {
  const npc = createAstronaut(`npc-${site.id}`, scene, materials.npcSuit, materials.playerVisor);
  npc.name = npcNames[site.kind];
  npc.metadata = { siteId: site.id };
  npc.position = new Vector3(site.x - 0.62, 0.42, site.z - 0.5);
  npc.scaling.setAll(0.72);

  const beacon = CreateSphere(`npc-beacon-${site.id}`, { diameter: 0.13, segments: 12 }, scene);
  beacon.position = new Vector3(0, 1.12, 0);
  beacon.material = materials.pulse;
  beacon.parent = npc;

  return npc;
}

function updateSceneState(
  state: GameState,
  nodes: Map<string, Mesh>,
  pulses: Map<string, Mesh>,
  rover: Mesh,
  player: Mesh,
  npcs: Mesh[],
  beaconLight: PointLight,
  snapPlayer: boolean
): void {
  const current = getCurrentSite(state);
  rover.position.x = current.x - 0.42;
  rover.position.z = current.z + 0.34;
  if (snapPlayer) {
    player.position.x = current.x + 0.38;
    player.position.z = current.z - 0.26;
  }
  player.scaling.setAll(1.22);
  beaconLight.position.x = player.position.x;
  beaconLight.position.z = player.position.z;

  state.sites.forEach((site) => {
    const node = nodes.get(site.id);
    const pulse = pulses.get(site.id);
    const visible = site.discovered || site.id === "base";
    node?.setEnabled(visible);
    pulse?.setEnabled(visible && !site.secured);

    if (node?.material instanceof StandardMaterial) {
      node.material.alpha = site.secured ? 0.62 : 1;
      node.scaling.setAll(site.id === state.currentSiteId ? 1.18 : 1);
    }
  });

  npcs.forEach((npc) => {
    const site = state.sites.find((candidate) => candidate.id === npc.metadata?.siteId);
    if (!site) return;
    npc.setEnabled(site.discovered);
  });
}

interface PlayerControl {
  target: Vector3 | undefined;
  nearbySiteId: string;
  interactionWasDown: boolean;
}

function movePlayer(player: Mesh, input: InputState, control: PlayerControl, delta: number): void {
  const direction = new Vector3(0, 0, 0);
  if (input.isDown("KeyW") || input.isDown("ArrowUp")) direction.z += 1;
  if (input.isDown("KeyS") || input.isDown("ArrowDown")) direction.z -= 1;
  if (input.isDown("KeyA") || input.isDown("ArrowLeft")) direction.x -= 1;
  if (input.isDown("KeyD") || input.isDown("ArrowRight")) direction.x += 1;

  const hasKeyboardMovement = direction.lengthSquared() > 0;
  const speed = hasKeyboardMovement ? 2.45 : 2.2;
  const previousX = player.position.x;
  const previousZ = player.position.z;

  if (hasKeyboardMovement) {
    control.target = undefined;
    direction.normalize();
    player.position.x += direction.x * speed * delta;
    player.position.z += direction.z * speed * delta;
  } else if (control.target) {
    const toTarget = control.target.subtract(player.position);
    toTarget.y = 0;
    const distance = toTarget.length();
    if (distance < 0.08) {
      control.target = undefined;
    } else {
      toTarget.normalize();
      player.position.x += toTarget.x * Math.min(distance, speed * delta);
      player.position.z += toTarget.z * Math.min(distance, speed * delta);
    }
  }

  const clamped = clampToField(player.position);
  player.position.x = clamped.x;
  player.position.z = clamped.z;

  const movedX = player.position.x - previousX;
  const movedZ = player.position.z - previousZ;
  if (Math.abs(movedX) + Math.abs(movedZ) > 0.001) {
    player.rotation.y = Math.atan2(movedX, movedZ);
  }
}

function clampToField(point: Vector3): Vector3 {
  return new Vector3(
    Math.max(-6.25, Math.min(6.25, point.x)),
    0.48,
    Math.max(-4.15, Math.min(4.15, point.z))
  );
}

function getNearbySiteId(state: GameState, position: Vector3): string | undefined {
  let nearest: MoonSite | undefined;
  let nearestDistance = Number.POSITIVE_INFINITY;

  state.sites
    .filter((site) => site.discovered)
    .forEach((site) => {
      const distance = Math.hypot(site.x - position.x, site.z - position.z);
      if (distance < nearestDistance) {
        nearest = site;
        nearestDistance = distance;
      }
    });

  return nearestDistance <= 0.95 ? nearest?.id : undefined;
}

interface HudElements {
  root: HTMLDivElement;
  title: HTMLHeadingElement;
  message: HTMLParagraphElement;
  stats: HTMLDivElement;
  site: HTMLDivElement;
  map: HTMLDivElement;
  actions: HTMLDivElement;
  log: HTMLDivElement;
}

function createHud(parent: HTMLElement): HudElements {
  const root = document.createElement("div");
  root.className = "rpg-hud";
  root.innerHTML = `
    <section class="mission-panel">
      <div class="hud-kicker">Lunar RPG</div>
      <h1></h1>
      <p class="hud-message"></p>
      <div class="control-hint">Move: WASD / arrows / click ground. Enter site: E or Space.</div>
      <div class="stats-grid"></div>
    </section>
    <section class="site-panel"></section>
    <section class="map-panel"></section>
    <section class="action-panel"></section>
    <section class="log-panel"></section>
  `;
  parent.appendChild(root);

  return {
    root,
    title: root.querySelector("h1") as HTMLHeadingElement,
    message: root.querySelector(".hud-message") as HTMLParagraphElement,
    stats: root.querySelector(".stats-grid") as HTMLDivElement,
    site: root.querySelector(".site-panel") as HTMLDivElement,
    map: root.querySelector(".map-panel") as HTMLDivElement,
    actions: root.querySelector(".action-panel") as HTMLDivElement,
    log: root.querySelector(".log-panel") as HTMLDivElement
  };
}

function renderHud(
  hud: HudElements,
  state: GameState,
  title: string,
  message: string,
  applyAction: (action: ActionResult) => void
): void {
  const current = getCurrentSite(state);
  const crew = state.crew;

  hud.title.textContent = title;
  hud.message.textContent = message;

  hud.stats.innerHTML = [
    stat("Day", state.day.toString()),
    stat("Level", crew.level.toString()),
    stat("HP", `${crew.hp}/${crew.maxHp}`),
    stat("O2", `${crew.oxygen}/${crew.maxOxygen}`),
    stat("Relics", `${crew.relics}/3`),
    stat("Ore", crew.ore.toString())
  ].join("");

  hud.site.innerHTML = `
    <div class="panel-label">Current Site</div>
    <h2>${current.name}</h2>
    <p>${current.description}</p>
    <div class="site-meta">
      <span>${current.kind.toUpperCase()}</span>
      <span>NPC ${npcNames[current.kind]}</span>
      <span>Threat ${current.threat}</span>
      <span>${current.secured ? "Secured" : "Unsecured"}</span>
    </div>
    <div class="quest">${state.quest}</div>
  `;

  hud.map.innerHTML = `<div class="panel-label">Routes</div>`;
  state.sites
    .filter((site) => site.discovered)
    .forEach((site) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `route-button ${site.id === state.currentSiteId ? "is-current" : ""}`;
      button.innerHTML = `<span>${site.name}</span><small>${site.secured ? "stable" : `threat ${site.threat}`}</small>`;
      button.addEventListener("click", () => applyAction(travelTo(state, site.id)));
      hud.map.appendChild(button);
    });

  hud.actions.innerHTML = `<div class="panel-label">Actions</div>`;
  [
    ["Scout", () => scout(state)],
    ["Mine", () => mine(state)],
    ["Fight", () => fight(state)],
    ["Rest", () => rest(state)],
    ["Upgrade", () => repair(state)]
  ].forEach(([label, action]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "action-button";
    button.textContent = label as string;
    button.addEventListener("click", () => applyAction((action as () => ActionResult)()));
    hud.actions.appendChild(button);
  });

  hud.log.innerHTML = `<div class="panel-label">Mission Log</div>${state.log
    .map((entry) => `<p>${entry}</p>`)
    .join("")}`;
}

function stat(label: string, value: string): string {
  return `<div class="stat"><span>${label}</span><strong>${value}</strong></div>`;
}
