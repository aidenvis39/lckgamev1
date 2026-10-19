// data/*.json 로더 (Node 전용). 엔진 코어(draft, match, series, season)는 fs에 의존하지 않는다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_PARAMS, type Params } from "./params.ts";
import type { Champion, Player, Position, TeamInfo, Universe } from "./types.ts";

const DATA_DIR = new URL("../data/", import.meta.url);
const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, DATA_DIR), "utf8")) as T;

export function loadUniverse(): Universe {
  const players = read<Player[]>("players.json");
  const champions = read<Champion[]>("champions.json");
  const teams = read<TeamInfo[]>("teams.json");
  const m = read<{ lanes: Array<[Position, string, string, number, number]>; duos: Array<[string, string, number, number]> }>(
    "matchups.json",
  );
  return {
    players: new Map(players.map((p) => [p.id, p])),
    champions: new Map(champions.map((c) => [c.id, c])),
    teams: new Map(teams.map((t) => [t.id, t])),
    matchups: {
      lane: new Map(m.lanes.map(([pos, a, b, n, gd15]) => [`${pos}|${a}|${b}`, { n, gd15 }])),
      duo: new Map(m.duos.map(([bot, sup, n, winrate]) => [`${bot}|${sup}`, { n, winrate }])),
    },
  };
}

const PARAMS_FILE = new URL("params.json", DATA_DIR);

export function loadParams(): Params {
  if (!existsSync(PARAMS_FILE)) return DEFAULT_PARAMS;
  return { ...DEFAULT_PARAMS, ...(JSON.parse(readFileSync(PARAMS_FILE, "utf8")) as Partial<Params>) };
}

export function saveParams(p: Params): void {
  writeFileSync(PARAMS_FILE, JSON.stringify(p, null, 2) + "\n");
}

// 실제 LCK 통계 (데이터 파이프라인 targets.json)
export interface Targets {
  games: number;
  gamelength_min: { mean: number; std: number; p10: number; p90: number };
  kills: { mean: number; std: number };
  dragons: { mean: number };
  barons: { mean: number };
  towers: { mean: number };
  blue_winrate: number;
  gd15_logit_coef_per_1k: number;
  comeback_rate_behind_3k_at15: number;
  gd15_curve: Array<[number, number, number]>;
  objective_winrate: Record<"firstblood" | "firstdragon" | "firsttower" | "firstbaron", number>;
  lane_relative_weight: Record<Position, number>;
  bo3: { p_series_win_if_won_game1: number; score_distribution: Record<string, number> } | null;
  upset_game_level: Array<[string, number, number]>;
  team_gd15_std: number;
  regular_season_team_winrate_std: number;
}

export function loadTargets(year: string): Targets {
  const all = read<Record<string, Targets>>("targets.json");
  if (!all[year]) throw new Error(`targets.json 에 ${year} 시즌이 없음`);
  return all[year];
}
