"""output/ 과 raw/ 에서 시뮬 엔진이 읽을 JSON(engine/data/)을 만든다.

- players.json     LCK 2026 로스터: 닉네임, 팀, 포지션, 나이(정수), 능력치, 챔피언 숙련(출전 경기 수)
- teams.json       팀 이름·약칭·주전/후보
- champions.json   드래프트 가능한 챔피언: 포지션 비중, 메타 점수, 초반/후반 성향, 딜 구성
- matchups.json    라인 상성(같은 라인 맞대결 15분 골드차), 바텀 조합 승률
- targets.json     엔진이 맞춰야 할 실제 LCK 통계 (2025, 2026)

실존 인물의 본명·생년월일·계약 정보는 넣지 않는다.
사용법: python3 -I scripts/export_engine_data.py .
"""
import json
import re
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(sys.argv[1])
OUT = ROOT / "output"
RAW = ROOT / "raw/oe_drive"
ENGINE = ROOT / "engine/data"
SEASON = 2026
AS_OF = pd.Timestamp("2026-10-19")
POSITIONS = ["top", "jng", "mid", "bot", "sup"]
RATINGS = {"rating_laning": "laning", "rating_teamfight": "teamfight", "rating_vision": "vision",
           "rating_survival": "survival", "rating_champ_pool": "champPool"}
TEAM_SHORT = {"Gen.G": "GEN", "Hanwha Life Esports": "HLE", "T1": "T1", "Dplus Kia": "DK", "KT Rolster": "KT",
              "HANJIN BRION": "BRO", "Nongshim RedForce": "NS", "BNK FEARX": "BFX", "Kiwoom DRX": "DRX",
              "DN SOOPers": "DNS"}


def dump(obj, name):
    ENGINE.mkdir(parents=True, exist_ok=True)
    (ENGINE / name).write_text(json.dumps(obj, ensure_ascii=False, indent=1))


def clean(o):
    if isinstance(o, dict):
        return {k: clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [clean(v) for v in o]
    if isinstance(o, (float, np.floating)):
        return None if np.isnan(o) else round(float(o), 4)
    if isinstance(o, np.integer):
        return int(o)
    return o


def shrink(value, n, k):
    """표본이 적은 통계를 0 쪽으로 당긴다 (n / (n + k))."""
    return value * n / (n + k)


def champion_ids():
    ko = json.loads((ROOT / "raw/ddragon/latest/data/ko_KR/champion.json").read_text())["data"]
    en = json.loads((ROOT / "raw/ddragon/latest/data/en_US/champion.json").read_text())["data"]
    return {en[cid]["name"]: cid for cid in en}, ko


def export_champions(by_name, ko):
    stats = pd.read_csv(OUT / "champions/champion_stats.csv")
    allg = stats[stats["scope"] == f"All leagues {SEASON}"].set_index("champion")
    tier1 = stats[stats["scope"] == f"Tier1 {SEASON}"].set_index("champion")
    presence_rank = tier1["presence"].rank(pct=True)
    out = []
    for name, row in allg.iterrows():
        if name not in by_name or not isinstance(row["positions"], str) or row["picks"] < 5:
            continue
        cid = by_name[name]
        positions = {p: int(s) / 100 for p, s in re.findall(r"(\w+):(\d+)%", row["positions"])}
        t1 = tier1.loc[name] if name in tier1.index else None
        picks_t1 = 0 if t1 is None else t1["picks"]
        wr_t1 = 0.5 if t1 is None or pd.isna(t1["winrate"]) else t1["winrate"]
        presence = 0.0 if t1 is None else t1["presence"]
        # 메타 점수 0~1: Tier1 등장률 순위 60% + (표본 보정한) 승률 40%
        wr_adj = 0.5 + shrink(wr_t1 - 0.5, picks_t1, 60)
        meta = 0.6 * (presence_rank.get(name, 0.0)) + 0.4 * float(np.clip((wr_adj - 0.5) * 10 + 0.5, 0, 1))
        early = float(np.clip(shrink(row["avg_lane_gd15"], row["picks"], 40) / 300, -1, 1)) \
            if not pd.isna(row["avg_lane_gd15"]) else 0.0
        n_sl = min(row["n_short"], row["n_long"]) if not pd.isna(row["n_short"]) else 0
        late = float(np.clip(shrink(row["late_bias"], n_sl, 40) / 0.1, -1, 1)) if not pd.isna(row["late_bias"]) else 0.0
        info = ko[cid]["info"]
        out.append({
            "id": cid, "name": name, "nameKo": ko[cid]["name"], "tags": ko[cid]["tags"], "positions": positions,
            "meta": meta, "early": early, "late": late, "presence": presence, "winrate": wr_adj,
            "damage": {"physical": info["attack"], "magic": info["magic"]}, "toughness": info["defense"],
            "proPicks": int(row["picks"]),
        })
    return out


def export_players(by_name):
    p = pd.read_csv(OUT / f"players/players_lck{SEASON}.csv")
    birth = pd.to_datetime(p["birth_date"], errors="coerce")
    p["age"] = ((AS_OF - birth).dt.days // 365.25).astype("Int64")
    for col in RATINGS:
        p[col] = p[col].fillna(50)  # 15경기 미만 후보 선수
    # 챔피언 숙련: 2026 출전 1경기 = 1, 2025 = 0.5 (모든 리그·국제대회)
    pools = {}
    for year, weight in ((SEASON, 1.0), (SEASON - 1, 0.5)):
        df = pd.read_csv(RAW / f"{year}_LoL_esports_match_data_from_OraclesElixir.csv", low_memory=False,
                         usecols=["playername", "position", "champion"])
        df = df[df["position"].isin(POSITIONS)].dropna(subset=["playername", "champion"])
        for (player, champ), n in df.groupby([df["playername"].str.lower(), "champion"]).size().items():
            if champ in by_name:
                d = pools.setdefault(player, {})
                d[by_name[champ]] = d.get(by_name[champ], 0) + n * weight
    starters = p.sort_values("games", ascending=False).drop_duplicates(["team", "position"])
    players = []
    for _, r in p.iterrows():
        players.append({
            "id": r["player"].lower(), "name": r["player"], "team": TEAM_SHORT[r["team"]], "position": r["position"],
            "age": None if pd.isna(r["age"]) else int(r["age"]), "games2026": int(r["games"]),
            "starter": bool(((starters["player"] == r["player"]) & (starters["team"] == r["team"])).any()),
            "ratings": {v: float(r[k]) for k, v in RATINGS.items()},
            "champions": dict(sorted(pools.get(r["player"].lower(), {}).items(), key=lambda kv: -kv[1])),
        })
    teams = []
    for name, short in TEAM_SHORT.items():
        roster = [x for x in players if x["team"] == short]
        teams.append({"id": short, "name": name,
                      "starters": {pos: next(x["id"] for x in roster if x["starter"] and x["position"] == pos)
                                   for pos in POSITIONS},
                      "bench": [x["id"] for x in roster if not x["starter"]]})
    return players, teams


def export_matchups(by_name):
    m = pd.read_csv(OUT / f"champions/lane_matchups_{SEASON}.csv")
    m = m[m["champion"].isin(by_name) & m["champion_opp"].isin(by_name)]
    lanes = [[r.position, by_name[r.champion], by_name[r.champion_opp], int(r.n), round(r.avg_gd15)]
             for r in m.itertuples()]
    d = pd.read_csv(OUT / f"champions/bot_duos_{SEASON}.csv")
    d = d[d["bot"].isin(by_name) & d["sup"].isin(by_name)]
    duos = [[by_name[r.bot], by_name[r.sup], int(r.n), r.winrate] for r in d.itertuples()]
    return {"lanes": lanes, "duos": duos}


def raw_targets(year):
    df = pd.read_csv(RAW / f"{year}_LoL_esports_match_data_from_OraclesElixir.csv", low_memory=False)
    t = df[(df["league"] == "LCK") & (df["position"] == "team")]
    g = t.groupby("gameid")
    split = t["split"].fillna("")
    reg = t[split.str.startswith("Rounds") & (t["playoffs"] == 0)]
    p = df[(df["league"] == "LCK") & df["position"].isin(POSITIONS)]
    return {
        "team_gd15_std": t["golddiffat15"].std(),
        "kills_at15_per_game": g["killsat15"].sum().mean(),
        "towers_per_game": g["towers"].sum().mean(),
        "inhibitors_per_game": g["inhibitors"].sum().mean(),
        "regular_season_team_winrate_std": reg.groupby("teamname")["result"].mean().std(),
        "kill_share_by_position": (p.groupby("position")["kills"].sum() / p["kills"].sum()).to_dict(),
        "loser_kill_share": t[t["result"] == 0]["kills"].sum() / t["kills"].sum(),
    }


def export_targets():
    summary = json.loads((OUT / "calibration/summary.json").read_text())
    obj = pd.read_csv(OUT / "calibration/objective_winrates.csv")
    lane = pd.read_csv(OUT / "calibration/lane_impact_gd15.csv")
    curve = pd.read_csv(OUT / "calibration/gold_diff_winrate_curve.csv")
    out = {}
    for year in (2025, 2026):
        s = summary[str(year)]
        pg = s["per_game"]
        scope = f"LCK {year}"
        o = obj[obj["scope"] == scope].set_index("column")
        lk = lane[lane["scope"] == scope].set_index("position")
        upset = pd.read_csv(OUT / f"calibration/upset_by_strength_gap_lck{year}.csv")
        out[str(year)] = {
            "games": s["lck_games"],
            "gamelength_min": pg["gamelength_min"],
            "kills": pg["kills"], "dragons": pg["dragons"], "barons": pg["barons"], "towers": pg["towers"],
            "blue_winrate": s["side"]["blue_winrate"],
            "gd15_logit_coef_per_1k": s["gold_diff_fit"]["LCK"]["at15"]["logit_coef_per_1k_gold"],
            "comeback_rate_behind_3k_at15": s["gold_diff_fit"]["LCK"]["at15"]["comeback_rate_behind_3k_plus"],
            "gd15_curve": curve[(curve["scope"] == scope) & (curve["minute"] == 15)][
                ["gold_diff_bucket", "n", "winrate"]].values.tolist(),
            "objective_winrate": {c: o.loc[c, "winrate_when_taken"] for c in
                                  ("firstblood", "firstdragon", "firsttower", "firstbaron") if c in o.index},
            "lane_gd15_std": lk["gd15_std"].to_dict(),
            "lane_relative_weight": lk["relative_weight"].to_dict(),
            "bo3": s["series"]["LCK"].get("BO3"), "bo5": s["series"]["LCK"].get("BO5"),
            "upset_game_level": upset[upset["level"] == "game"][["winpct_gap", "n_games", "stronger_team_winrate"]]
            .values.tolist(),
            **raw_targets(year),
        }
    return out


def main():
    by_name, ko = champion_ids()
    champions = export_champions(by_name, ko)
    players, teams = export_players(by_name)
    dump(clean(champions), "champions.json")
    dump(clean(players), "players.json")
    dump(clean(teams), "teams.json")
    dump(clean(export_matchups(by_name)), "matchups.json")
    dump(clean(export_targets()), "targets.json")
    print(f"champions={len(champions)} players={len(players)} teams={len(teams)}")


if __name__ == "__main__":
    main()
