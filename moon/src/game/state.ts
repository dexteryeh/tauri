export type SiteKind = "base" | "mine" | "ruin" | "crater" | "spire";

export interface MoonSite {
  id: string;
  name: string;
  kind: SiteKind;
  x: number;
  z: number;
  threat: number;
  reward: number;
  discovered: boolean;
  secured: boolean;
  description: string;
}

export interface CrewStats {
  level: number;
  xp: number;
  hp: number;
  maxHp: number;
  oxygen: number;
  maxOxygen: number;
  resolve: number;
  relics: number;
  ore: number;
  medkits: number;
}

export interface GameState {
  currentSiteId: string;
  day: number;
  log: string[];
  quest: string;
  crew: CrewStats;
  sites: MoonSite[];
}

export interface ActionResult {
  state: GameState;
  title: string;
  message: string;
}

export function createGameState(): GameState {
  return {
    currentSiteId: "base",
    day: 1,
    quest: "Recover three lunar relics and unlock the Tycho Spire.",
    log: [
      "Mare Tranquility base is online.",
      "Long-range scans show relic signatures under the southern ridge."
    ],
    crew: {
      level: 1,
      xp: 0,
      hp: 34,
      maxHp: 34,
      oxygen: 18,
      maxOxygen: 18,
      resolve: 8,
      relics: 0,
      ore: 0,
      medkits: 1
    },
    sites: [
      {
        id: "base",
        name: "Tranquility Gate",
        kind: "base",
        x: 0,
        z: 0,
        threat: 0,
        reward: 0,
        discovered: true,
        secured: true,
        description: "A pressure-lit rover bay dug into a basalt shelf."
      },
      {
        id: "mine-a",
        name: "Helium-3 Cut",
        kind: "mine",
        x: -4.2,
        z: -2.1,
        threat: 2,
        reward: 3,
        discovered: true,
        secured: false,
        description: "A collapsed strip mine with exposed power cells."
      },
      {
        id: "ruin-a",
        name: "Glass Reliquary",
        kind: "ruin",
        x: 3.9,
        z: -2.7,
        threat: 4,
        reward: 1,
        discovered: true,
        secured: false,
        description: "A buried pre-human shrine reflecting Earthlight."
      },
      {
        id: "crater-b",
        name: "Kepler Shadow",
        kind: "crater",
        x: -5.2,
        z: 2.7,
        threat: 5,
        reward: 4,
        discovered: false,
        secured: false,
        description: "A cold crater where static keeps repeating your callsign."
      },
      {
        id: "ruin-c",
        name: "Artemis Vault",
        kind: "ruin",
        x: 1.6,
        z: 4.5,
        threat: 6,
        reward: 1,
        discovered: false,
        secured: false,
        description: "A sealed vault beneath a field of black glass."
      },
      {
        id: "spire",
        name: "Tycho Spire",
        kind: "spire",
        x: 5.7,
        z: 2.1,
        threat: 8,
        reward: 0,
        discovered: false,
        secured: false,
        description: "A silver tower that moves a few meters when nobody watches."
      }
    ]
  };
}

export function getCurrentSite(state: GameState): MoonSite {
  return state.sites.find((site) => site.id === state.currentSiteId) ?? state.sites[0];
}

export function travelTo(state: GameState, siteId: string): ActionResult {
  const site = state.sites.find((candidate) => candidate.id === siteId);
  if (!site || !site.discovered) {
    return result(state, "Signal lost", "That route is not charted yet.");
  }

  const distance = distanceBetween(getCurrentSite(state), site);
  const oxygenCost = Math.max(1, Math.ceil(distance / 2));
  if (state.crew.oxygen < oxygenCost) {
    return result(state, "Low oxygen", "Return to base or use a medkit before crossing that ridge.");
  }

  const next = cloneState(state);
  next.currentSiteId = site.id;
  next.crew.oxygen -= oxygenCost;
  next.day += site.id === state.currentSiteId ? 0 : 1;
  pushLog(next, `Rover reached ${site.name}. Oxygen -${oxygenCost}.`);
  return result(next, site.name, site.description);
}

export function scout(state: GameState): ActionResult {
  const next = cloneState(state);
  const hidden = next.sites.find((site) => !site.discovered);

  next.crew.oxygen = Math.max(0, next.crew.oxygen - 2);
  next.day += 1;

  if (!hidden) {
    pushLog(next, "No new signals. The whole sector is mapped.");
    return result(next, "Sector mapped", "Every major site is now marked on the lunar grid.");
  }

  if (next.crew.oxygen <= 0) {
    next.crew.hp = Math.max(1, next.crew.hp - 6);
    pushLog(next, "Suit reserves ran dry during the scan. HP -6.");
  }

  hidden.discovered = true;
  pushLog(next, `Scout drones revealed ${hidden.name}.`);
  return result(next, "New route", `${hidden.name} has been added to the mission map.`);
}

export function mine(state: GameState): ActionResult {
  const site = getCurrentSite(state);
  if (site.kind !== "mine" && site.kind !== "crater") {
    return result(state, "No vein", "This site has no exposed ice or helium seam to harvest.");
  }

  const next = cloneState(state);
  const nextSite = next.sites.find((candidate) => candidate.id === site.id);
  const haul = Math.max(1, site.reward + next.crew.level);
  next.crew.ore += haul;
  next.crew.oxygen = Math.max(0, next.crew.oxygen - 3);
  next.crew.xp += 2;
  next.day += 1;

  if (nextSite) nextSite.secured = true;
  maybeLevelUp(next);
  pushLog(next, `Extracted ${haul} ore from ${site.name}.`);
  return result(next, "Ore recovered", `The crew loaded ${haul} ore and stabilized the site.`);
}

export function fight(state: GameState): ActionResult {
  const site = getCurrentSite(state);
  if (site.secured || site.kind === "base") {
    return result(state, "No hostile contact", "The local perimeter is already secure.");
  }

  const next = cloneState(state);
  const nextSite = next.sites.find((candidate) => candidate.id === site.id);
  const crewPower = next.crew.level * 3 + next.crew.resolve + next.crew.medkits;
  const damage = Math.max(2, site.threat * 3 - next.crew.level * 2);

  next.crew.hp = Math.max(1, next.crew.hp - damage);
  next.crew.oxygen = Math.max(0, next.crew.oxygen - 2);
  next.crew.xp += site.threat + 2;
  next.day += 1;

  const secured = crewPower + next.crew.hp / 3 >= site.threat * 4;
  if (secured && nextSite) {
    nextSite.secured = true;
    if (site.kind === "ruin") next.crew.relics += 1;
    if (site.kind === "spire" && next.crew.relics >= 3) next.quest = "The Tycho Spire is awake. The moon has answered.";
    pushLog(next, `Secured ${site.name}. HP -${damage}.`);
  } else {
    pushLog(next, `Repelled at ${site.name}. HP -${damage}.`);
  }

  maybeLevelUp(next);
  if (next.crew.relics >= 3) {
    const spire = next.sites.find((candidate) => candidate.id === "spire");
    if (spire) spire.discovered = true;
  }

  return result(
    next,
    secured ? "Victory" : "Fallback",
    secured ? `${site.name} is secure.` : "The crew survived, but the site still resists."
  );
}

export function rest(state: GameState): ActionResult {
  const site = getCurrentSite(state);
  if (site.kind !== "base") {
    return result(state, "No shelter", "Rest requires the pressure locks at Tranquility Gate.");
  }

  const next = cloneState(state);
  next.crew.hp = next.crew.maxHp;
  next.crew.oxygen = next.crew.maxOxygen;
  next.crew.resolve = Math.min(12, next.crew.resolve + 1);
  next.day += 1;
  pushLog(next, "Crew rested, tanks refilled, resolve improved.");
  return result(next, "Recovered", "The crew is ready for another sortie.");
}

export function repair(state: GameState): ActionResult {
  if (state.crew.ore < 4) {
    return result(state, "Need ore", "Four ore are required to reinforce suits and rover seals.");
  }

  const next = cloneState(state);
  next.crew.ore -= 4;
  next.crew.maxHp += 4;
  next.crew.maxOxygen += 2;
  next.crew.hp = next.crew.maxHp;
  next.crew.oxygen = next.crew.maxOxygen;
  next.day += 1;
  pushLog(next, "Upgraded suit plating and oxygen scrubbers.");
  return result(next, "Systems upgraded", "Max HP +4 and max oxygen +2.");
}

function cloneState(state: GameState): GameState {
  return {
    ...state,
    crew: { ...state.crew },
    sites: state.sites.map((site) => ({ ...site })),
    log: [...state.log]
  };
}

function result(state: GameState, title: string, message: string): ActionResult {
  return { state, title, message };
}

function pushLog(state: GameState, entry: string): void {
  state.log = [entry, ...state.log].slice(0, 7);
}

function maybeLevelUp(state: GameState): void {
  const needed = state.crew.level * 8;
  if (state.crew.xp < needed) return;

  state.crew.xp -= needed;
  state.crew.level += 1;
  state.crew.maxHp += 5;
  state.crew.hp = state.crew.maxHp;
  state.crew.resolve += 2;
  pushLog(state, `Crew reached level ${state.crew.level}.`);
}

function distanceBetween(a: MoonSite, b: MoonSite): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
