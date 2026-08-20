import type { RobotSave } from "./engine";
import { randomEnemyTeam, type StageSetup } from "./modes";
import { ROBOT_MAP, ROBOTS } from "./robots";

// ---------------------------------------------------------------- estrutura
export interface RankTier {
  id: string;
  name: string;
  color: string;
  emblem: string;
  /** tiers apex não têm divisões. */
  apex?: boolean;
  desc: string;
}

export const TIERS: RankTier[] = [
  { id: "sucata", name: "SUCATA", color: "#8a7b6b", emblem: "/ranks/sucata.png", desc: "Ferro-velho do circuito. Todo campeão começa aqui." },
  { id: "ferro", name: "FERRO", color: "#9aa4b0", emblem: "/ranks/ferro.png", desc: "Chassi remendado, mas já aguenta pancada." },
  { id: "bronze", name: "BRONZE", color: "#c9803f", emblem: "/ranks/bronze.png", desc: "Pilotos que já entendem o ritmo do turno." },
  { id: "prata", name: "PRATA", color: "#cfd8e3", emblem: "/ranks/prata.png", desc: "Loadouts afiados e leitura de energia." },
  { id: "ouro", name: "OURO", color: "#ffc43a", emblem: "/ranks/ouro.png", desc: "Circuito profissional. Erro custa a série." },
  { id: "platina", name: "PLATINA", color: "#35e2f0", emblem: "/ranks/platina.png", desc: "Elite regional, reatores calibrados." },
  { id: "diamante", name: "DIAMANTE", color: "#7ad3ff", emblem: "/ranks/diamante.png", desc: "Menos de 1% dos pilotos chega aqui." },
  { id: "mestre", name: "MESTRE", color: "#a97bff", emblem: "/ranks/mestre.png", desc: "Domínio total do kit de 4 habilidades." },
  { id: "graomestre", name: "GRAO-MESTRE", color: "#ff5ea8", emblem: "/ranks/graomestre.png", apex: true, desc: "Apex. Só se sobe destruindo outro apex." },
  { id: "lenda", name: "LENDA", color: "#ff8a3a", emblem: "/ranks/lenda.png", apex: true, desc: "Nome gravado no núcleo da arena." },
  { id: "singularidade", name: "SINGULARIDADE", color: "#ffffff", emblem: "/ranks/singularidade.png", apex: true, desc: "O topo absoluto do servidor." },
];

export const TIER_MAP: Record<string, RankTier> = Object.fromEntries(
  TIERS.map((t) => [t.id, t]),
);

export interface RankDef {
  index: number;
  tier: RankTier;
  division: number; // 0 = apex
  name: string;
  short: string;
  /** PR necessários para promover a partir deste rank. */
  prToPromote: number;
  /** ouro pago ao alcançar o rank pela primeira vez na temporada. */
  reward: number;
  /** nível relativo do adversário. */
  power: number;
}

const DIV_LABEL = ["", "I", "II", "III"];

function buildRanks(): RankDef[] {
  const out: RankDef[] = [];
  for (const tier of TIERS) {
    const divisions = tier.apex ? [0] : [3, 2, 1];
    for (const division of divisions) {
      const index = out.length;
      out.push({
        index,
        tier,
        division,
        name: tier.apex ? tier.name : `${tier.name} ${DIV_LABEL[division]}`,
        short: tier.apex ? tier.name.slice(0, 3) : `${tier.name.slice(0, 3)}${DIV_LABEL[division]}`,
        prToPromote: tier.apex ? 200 : 100,
        reward: 120 + index * 95 + (tier.apex ? 1500 : 0),
        power: index,
      });
    }
  }
  return out;
}

export const RANKS: RankDef[] = buildRanks();
export const TOP_RANK = RANKS.length - 1;
export const PLACEMENT_MATCHES = 5;

export function rankAt(index: number): RankDef {
  return RANKS[Math.max(0, Math.min(TOP_RANK, index))] as RankDef;
}

// ------------------------------------------------------------------- estado
export interface RankedMatchLog {
  win: boolean;
  delta: number;
  opponent: string;
  rankName: string;
}

export interface RankedState {
  season: number;
  placementsDone: number;
  placementWins: number;
  rankIndex: number;
  pr: number;
  /** escudo de rebaixamento: partidas de proteção restantes no piso do rank. */
  shield: number;
  wins: number;
  losses: number;
  streak: number;
  bestStreak: number;
  bestRankIndex: number;
  claimed: number[];
  history: RankedMatchLog[];
}

export function initialRanked(): RankedState {
  return {
    season: 1,
    placementsDone: 0,
    placementWins: 0,
    rankIndex: 0,
    pr: 0,
    shield: 0,
    wins: 0,
    losses: 0,
    streak: 0,
    bestStreak: 0,
    bestRankIndex: 0,
    claimed: [],
    history: [],
  };
}

export function isPlacing(r: RankedState): boolean {
  return r.placementsDone < PLACEMENT_MATCHES;
}

/** PR absoluto usado como MMR interno. */
export function ratingOf(r: RankedState): number {
  return r.rankIndex * 100 + r.pr;
}

// ------------------------------------------------------------ matchmaking
const ADJ = [
  "VOLT", "NOVA", "OMEGA", "KRON", "ZENIT", "HELIO", "ORBE", "DRAKO", "AXION", "VERTEX",
  "PYRA", "NIMBO", "SOLDA", "TITAN", "ECLIP", "RUNIK", "ZERO", "FUROR", "PRISMA", "MAGNO",
];
const SUF = ["X", "-7", " PRIME", " MK2", "OR", "ON", " ZR", "ATOR", " NEO", "IX"];

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

export function pilotName(seed: string): string {
  const h = hash(seed);
  return `${ADJ[h % ADJ.length]}${SUF[(h >> 5) % SUF.length]}`;
}

export interface RankedOpponent {
  pilot: string;
  rank: RankDef;
  /** diferença de rating (positivo = adversário mais forte). */
  spread: number;
  stage: StageSetup;
}

const RANKED_ARENAS = ["dojo", "orbital", "sky", "frozen", "volcano"];

function rarityFor(index: number): "gold" | "silver" | undefined {
  if (index >= 21) return "gold";
  if (index >= 12) return "silver";
  return undefined;
}

/** Sorteia um oponente próximo do rank atual (±2 divisões). */
export function matchmake(r: RankedState, teamLevel: number): RankedOpponent {
  const placing = isPlacing(r);
  const base = placing ? 4 + r.placementsDone * 2 : r.rankIndex;
  const spreadRoll = Math.round((Math.random() - 0.45) * 4);
  const index = Math.max(0, Math.min(TOP_RANK, base + spreadRoll));
  const rank = rankAt(index);
  const diff = index - (placing ? base : r.rankIndex);

  const count = index >= 18 ? 4 : index >= 9 ? 3 : index >= 3 ? 2 : 1;
  const level = Math.max(1, teamLevel + Math.round(index * 0.35) + diff);
  const enemies = randomEnemyTeam({
    level,
    count,
    trained: Math.floor(index / 3),
    ...(rarityFor(index) ? { rarity: rarityFor(index) as "gold" | "silver" } : {}),
  });

  return {
    pilot: pilotName(`${index}-${Date.now()}-${Math.random()}`),
    rank,
    spread: diff,
    stage: {
      label: placing ? `CLASSIFICATORIA ${r.placementsDone + 1}/${PLACEMENT_MATCHES}` : rank.name,
      arena: RANKED_ARENAS[index % RANKED_ARENAS.length] as string,
      enemies,
      reward: 1.3 + index * 0.09,
    },
  };
}

export function opponentPreview(opp: RankedOpponent): string[] {
  return opp.stage.enemies.map((e: RobotSave) => ROBOT_MAP[e.id]?.name ?? e.id);
}

// ------------------------------------------------------------------- pontos
export interface RankedOutcome {
  state: RankedState;
  delta: number;
  promoted: boolean;
  demoted: boolean;
  shieldUsed: boolean;
  placementDone: boolean;
  newRank: RankDef;
  gold: number;
}

function prGain(spread: number, streak: number): number {
  const base = 20 + spread * 6;
  const bonus = Math.min(12, Math.max(0, streak) * 3);
  return Math.max(8, Math.min(46, Math.round(base + bonus)));
}

function prLoss(spread: number, streak: number): number {
  const base = 18 - spread * 5;
  const punish = Math.min(10, Math.max(0, -streak) * 2);
  return Math.max(6, Math.min(38, Math.round(base + punish)));
}

export function applyMatch(
  r: RankedState,
  win: boolean,
  opp: RankedOpponent,
): RankedOutcome {
  const next: RankedState = { ...r, history: [...r.history] };

  // ---------------- classificatórias
  if (isPlacing(r)) {
    next.placementsDone = r.placementsDone + 1;
    next.placementWins = r.placementWins + (win ? 1 : 0);
    next.wins = r.wins + (win ? 1 : 0);
    next.losses = r.losses + (win ? 0 : 1);
    const done = next.placementsDone >= PLACEMENT_MATCHES;
    if (done) {
      next.rankIndex = Math.max(0, Math.min(TOP_RANK, 1 + next.placementWins * 2));
      next.pr = 40;
      next.shield = 2;
      next.bestRankIndex = Math.max(next.bestRankIndex, next.rankIndex);
    }
    next.history.unshift({
      win,
      delta: 0,
      opponent: opp.pilot,
      rankName: opp.rank.name,
    });
    next.history = next.history.slice(0, 12);
    return {
      state: next,
      delta: 0,
      promoted: false,
      demoted: false,
      shieldUsed: false,
      placementDone: done,
      newRank: rankAt(next.rankIndex),
      gold: win ? 90 : 30,
    };
  }

  // ---------------- partidas ranqueadas
  const streak = r.streak;
  const delta = win ? prGain(opp.spread, streak) : -prLoss(opp.spread, streak);
  let rankIndex = r.rankIndex;
  let pr = r.pr + delta;
  let promoted = false;
  let demoted = false;
  let shieldUsed = false;
  let shield = r.shield;

  if (win) {
    next.wins = r.wins + 1;
    next.streak = streak >= 0 ? streak + 1 : 1;
    while (pr >= rankAt(rankIndex).prToPromote && rankIndex < TOP_RANK) {
      pr -= rankAt(rankIndex).prToPromote;
      rankIndex += 1;
      promoted = true;
      shield = 3;
    }
    if (rankIndex >= TOP_RANK) pr = Math.min(pr, 999);
  } else {
    next.losses = r.losses + 1;
    next.streak = streak <= 0 ? streak - 1 : -1;
    if (pr < 0) {
      if (shield > 0) {
        shield -= 1;
        shieldUsed = true;
        pr = 0;
      } else if (rankIndex > 0) {
        rankIndex -= 1;
        pr = rankAt(rankIndex).prToPromote - 25;
        demoted = true;
        shield = 1;
      } else {
        pr = 0;
      }
    }
  }

  next.rankIndex = rankIndex;
  next.pr = Math.max(0, pr);
  next.shield = shield;
  next.bestRankIndex = Math.max(r.bestRankIndex, rankIndex);
  next.bestStreak = Math.max(r.bestStreak, next.streak);
  next.history.unshift({ win, delta, opponent: opp.pilot, rankName: opp.rank.name });
  next.history = next.history.slice(0, 12);

  return {
    state: next,
    delta,
    promoted,
    demoted,
    shieldUsed,
    placementDone: false,
    newRank: rankAt(rankIndex),
    gold: Math.round((win ? 110 : 35) * (1 + rankIndex * 0.12)),
  };
}

// -------------------------------------------------------------- recompensas
export function pendingRewards(r: RankedState): RankDef[] {
  if (isPlacing(r)) return [];
  return RANKS.filter((rk) => rk.index <= r.bestRankIndex && !r.claimed.includes(rk.index));
}

// -------------------------------------------------------------- leaderboard
export interface LadderRow {
  pilot: string;
  rating: number;
  rank: RankDef;
  robot: string;
  you?: boolean;
}

export function leaderboard(r: RankedState, size = 12): LadderRow[] {
  const rows: LadderRow[] = [];
  const top = TOP_RANK * 100 + 180;
  for (let i = 0; i < size; i += 1) {
    const seed = `s${r.season}-${i}`;
    const h = hash(seed);
    const rating = Math.max(200, top - i * (70 + (h % 40)));
    rows.push({
      pilot: pilotName(seed),
      rating,
      rank: rankAt(Math.floor(rating / 100)),
      robot: (ROBOTS[h % ROBOTS.length] as { id: string }).id,
    });
  }
  const mine = ratingOf(r);
  rows.push({
    pilot: "VOCE",
    rating: mine,
    rank: rankAt(r.rankIndex),
    robot: "aurorion",
    you: true,
  });
  return rows.sort((a, b) => b.rating - a.rating);
}

export function seasonProgressPct(r: RankedState): number {
  return Math.round((ratingOf(r) / (TOP_RANK * 100 + 200)) * 100);
}