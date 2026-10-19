// data/*.json 로더 (Node 전용). 엔진 코어(draft, match, series, season)는 fs에 의존하지 않는다.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { DEFAULT_PARAMS, type Params } from "./params.ts";
import type { Targets, WorldTargets } from "./targets.ts";
import type { Champion, Player, TeamInfo, Universe } from "./types.ts";
import { createUniverse, type RawData } from "./universe.ts";

export type { Targets, WorldTargets } from "./targets.ts";

const DATA_DIR = new URL("../data/", import.meta.url);
const read = <T>(name: string): T => JSON.parse(readFileSync(new URL(name, DATA_DIR), "utf8")) as T;

export function loadUniverse(): Universe {
  return createUniverse({
    players: read<RawData["players"]>("players.json"),
    champions: read<RawData["champions"]>("champions.json"),
    teams: read<RawData["teams"]>("teams.json"),
    matchups: read<RawData["matchups"]>("matchups.json"),
  });
}

const PARAMS_FILE = new URL("params.json", DATA_DIR);

export function loadParams(): Params {
  if (!existsSync(PARAMS_FILE)) return DEFAULT_PARAMS;
  return { ...DEFAULT_PARAMS, ...(JSON.parse(readFileSync(PARAMS_FILE, "utf8")) as Partial<Params>) };
}

export function saveParams(p: Params): void {
  writeFileSync(PARAMS_FILE, JSON.stringify(p, null, 2) + "\n");
}

export function loadTargets(year: string): Targets {
  const all = read<Record<string, Targets>>("targets.json");
  if (!all[year]) throw new Error(`targets.json 에 ${year} 시즌이 없음`);
  return all[year];
}

export function loadWorldTargets(): WorldTargets {
  return read<WorldTargets>("world.json");
}

// LCK 팀별 2군(LCK CL) 선수. team = 1군 팀 약칭, 능력치는 LCK CL 안 백분위
export function loadAcademy(): Player[] {
  return read<Player[]>("academy.json");
}

// 다년 커리어 시작용 원본 (세계 상태를 만들 때 씀)
export function loadRaw(): { players: Player[]; teams: TeamInfo[]; champions: Champion[] } {
  return { players: read<Player[]>("players.json"), teams: read<TeamInfo[]>("teams.json"), champions: read<Champion[]>("champions.json") };
}
