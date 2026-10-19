import type { Position } from "./types.ts";

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
  team_regular_winrate: Record<string, number>; // 팀 약칭 → 정규시즌 세트 승률
}

// 해외 리그와 국제전 기준값 (data/world.json, scripts/build_world.py)
export interface WorldTargets {
  teamWinrate: Record<string, Record<string, number>>; // 리그 → 팀 → 최근 정규 스플릿 2개 세트 승률
  teamGames: Record<string, Record<string, number>>;
  international: {
    strength: Record<string, number>; // 브래들리-테리 리그 강도 (로짓, LCK = 0)
    pairs: Array<[string, string, number, number, number | null]>; // [리그 a, 리그 b, 가중 경기 수, 모델 승률, 실제 승률]
  };
}
