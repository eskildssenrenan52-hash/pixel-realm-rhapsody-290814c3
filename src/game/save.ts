import { useSyncExternalStore } from "react";
import { GENERAL } from "./config";
import { playerMaxXP, type RobotSave } from "./engine";
import { ROBOT_MAP, ROBOTS, STARTER_ROBOTS } from "./robots";
import { defaultLoadout, MAX_LOADOUT } from "./skills";

export interface GameState {
  version: number;
  gold: number;
  playerLevel: number;
  playerXP: number;
  robots: RobotSave[];
  team: string[];
  items: Record<string, number>;
  wonTournaments: string[];
  battlesWon: number;
  /** 4 habilidades escolhidas por robô. */
  loadouts: Record<string, string[]>;
  /** progresso dos modos de jogo. */
  modes: {
    babelFloor: number;
    babelBest: number;
    survivalBest: number;
    quickWins: number;
    bossRushBest: number;
    chaosWins: number;
  };
}

const KEY = "campeoes-mecha-save-v1";

function initialState(): GameState {
  return {
    version: 1,
    gold: 500,
    playerLevel: 1,
    playerXP: 0,
    robots: STARTER_ROBOTS.map((id) => ({
      id,
      level: 1,
      xp: 0,
      trained: { str: 0, def: 0, agl: 0 },
    })),
    team: [...STARTER_ROBOTS],
    items: { repair_kit: 2, energy_cell: 1 },
    wonTournaments: [],
    battlesWon: 0,
    loadouts: {},
    modes: {
      babelFloor: 1,
      babelBest: 0,
      survivalBest: 0,
      quickWins: 0,
      bossRushBest: 0,
      chaosWins: 0,
    },
  };
}

function read(): GameState {
  if (typeof localStorage === "undefined") return initialState();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initialState();
    const parsed = JSON.parse(raw) as GameState;
    if (!parsed.robots?.length) return initialState();
    const base = initialState();
    return {
      ...base,
      ...parsed,
      loadouts: parsed.loadouts ?? {},
      modes: { ...base.modes, ...(parsed.modes ?? {}) },
    };
  } catch {
    return initialState();
  }
}

let state: GameState = read();
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* modo privado — segue só em memória */
  }
}

export function getState(): GameState {
  return state;
}

export function setState(updater: (s: GameState) => GameState) {
  state = updater(state);
  persist();
  emit();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function useGame(): GameState {
  return useSyncExternalStore(subscribe, getState, getState);
}

// ------------------------------------------------------------------ ações
export function resetGame() {
  state = initialState();
  persist();
  emit();
}

export function addGold(amount: number) {
  setState((s) => ({ ...s, gold: Math.max(0, s.gold + amount) }));
}

export function addPlayerXP(amount: number) {
  setState((s) => {
    let level = s.playerLevel;
    let xp = s.playerXP + amount;
    while (level < GENERAL.max_level && xp >= playerMaxXP(level)) {
      xp -= playerMaxXP(level);
      level += 1;
    }
    return { ...s, playerLevel: level, playerXP: xp };
  });
}

export function unlockRobot(id: string): boolean {
  if (state.robots.some((r) => r.id === id)) return false;
  const avgLevel = Math.max(
    1,
    Math.round(state.robots.reduce((a, r) => a + r.level, 0) / state.robots.length) - 1,
  );
  setState((s) => ({
    ...s,
    robots: [...s.robots, { id, level: avgLevel, xp: 0, trained: { str: 0, def: 0, agl: 0 } }],
  }));
  return true;
}

export function lockedRobotIds(): string[] {
  const owned = new Set(state.robots.map((r) => r.id));
  return ROBOTS.filter((r) => !owned.has(r.id)).map((r) => r.id);
}

export function addItem(id: string, qty: number) {
  setState((s) => ({ ...s, items: { ...s.items, [id]: (s.items[id] ?? 0) + qty } }));
}

export function spendItem(id: string, qty = 1) {
  setState((s) => ({
    ...s,
    items: { ...s.items, [id]: Math.max(0, (s.items[id] ?? 0) - qty) },
  }));
}

export function setTeam(team: string[]) {
  setState((s) => ({ ...s, team: team.slice(0, 4) }));
}

export function updateRobots(robots: RobotSave[]) {
  setState((s) => ({ ...s, robots }));
}

export function markTournamentWon(id: string) {
  setState((s) => ({
    ...s,
    wonTournaments: s.wonTournaments.includes(id) ? s.wonTournaments : [...s.wonTournaments, id],
  }));
}

export function incBattlesWon() {
  setState((s) => ({ ...s, battlesWon: s.battlesWon + 1 }));
}

export function teamSaves(s: GameState): RobotSave[] {
  return s.team
    .map((id) => s.robots.find((r) => r.id === id))
    .filter((r): r is RobotSave => Boolean(r))
    .map((r) => ({ ...r, loadout: loadoutOf(s, r.id) }));
}

// ------------------------------------------------------------- loadouts
export function loadoutOf(s: GameState, robotId: string): string[] {
  const def = ROBOT_MAP[robotId];
  if (!def) return [];
  const valid = new Set(def.skills.map((k) => k.id));
  const saved = (s.loadouts[robotId] ?? []).filter((id) => valid.has(id));
  return saved.length === MAX_LOADOUT ? saved : defaultLoadout(def.skills);
}

export function setLoadout(robotId: string, skillIds: string[]) {
  setState((st) => ({
    ...st,
    loadouts: { ...st.loadouts, [robotId]: skillIds.slice(0, MAX_LOADOUT) },
  }));
}

export function setModeProgress(patch: Partial<GameState["modes"]>) {
  setState((st) => ({ ...st, modes: { ...st.modes, ...patch } }));
}
