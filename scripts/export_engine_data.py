"""output/ 과 raw/ 에서 시뮬 엔진이 읽을 JSON(engine/data/)을 만든다.

- players.json     LCK + 해외 5개 리그 2026 로스터: 닉네임, 팀, 포지션, 나이(정수, LCK만), 능력치(리그 안 백분위),
                   챔피언 숙련(출전 경기 수), 운영 기여(intangible, LCK만 추정. scripts/player_intangibles.py 결과)
- teams.json       팀 이름·약칭·리그·주전/후보 (LCK 10팀 + 해외 46팀, 해외는 마지막 정규 스플릿 기준)
- world.json       해외 리그 팀별 실제 승률, 국제전 리그 쌍 승률, LCK CL → LCK 능력치 보정 (scripts/build_world.py 결과)
- academy.json     LCK 팀별 2군(LCK CL 2026) 선수. 능력치는 LCK CL 안 백분위 (다년 커리어에서 보정해 씀)

선수의 생년월일·국적·계약 만료는 Leaguepedia (LCK·CL: participation.json, 해외: overseas_participation_2026.json).
계약 만료는 '그 시즌이 끝나면 풀리는 해'로 바꾼다 (2026-11-16 → 2026). 실제 연봉은 넣지 않는다.
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
TEAM_SHORT_ALIASES = {**TEAM_SHORT, "DRX": "DRX"}  # 2025엔 Kiwoom 없이 DRX
OVERSEAS = ["LPL", "LEC", "LCS", "LCP", "CBLOL"]
OVERSEAS_SHORT = {
    "Ninjas in Pyjamas": "NIP", "Bilibili Gaming": "BLG", "Anyone's Legend": "AL", "Invictus Gaming": "IG",
    "Top Esports": "TES", "JD Gaming": "JDG", "Team WE": "WE", "LGD Gaming": "LGD", "Weibo Gaming": "WBG",
    "ThunderTalk Gaming": "TT", "EDward Gaming": "EDG", "LNG Esports": "LNG",
    "Karmine Corp": "KC", "G2 Esports": "G2", "Team Vitality": "VIT", "GiantX": "GX", "Natus Vincere": "NAVI",
    "Fnatic": "FNC", "Movistar KOI": "MKOI", "SK Gaming": "SK", "Shifters": "SHFT", "Team Heretics": "TH",
    "LYON": "LYON", "Team Liquid": "TL", "Cloud9": "C9", "Sentinels": "SEN", "Shopify Rebellion": "SR",
    "FlyQuest": "FLY", "Disguised": "DSG", "Dignitas": "DIG",
    "Team Secret Whales": "TSW", "CTBC Flying Oyster": "CFO", "Ground Zero Gaming": "GZ", "GAM Esports": "GAM",
    "MVK Esports": "MVK", "Deep Cross Gaming": "DCG", "DetonatioN FocusMe": "DFM",
    "Fukuoka SoftBank HAWKS gaming": "SHG",
    "LOUD": "LOUD", "LØS": "LOS", "FURIA": "FUR", "Vivo Keyd Stars": "VKS", "RED Canids": "RED",
    "paiN Gaming": "PNG", "Fluxo W7M": "FXW7", "Leviatan": "LEV",
}
RATING_COLS = {  # build_all.RATING_GROUPS 와 같은 지표
    "rating_laning": ["csdiffat15", "golddiffat15", "xpdiffat15"],
    "rating_teamfight": ["dpm", "damageshare", "kp"],
    "rating_vision": ["vspm", "wcpm"],
    "rating_survival": ["neg_deaths_pg"],
    "rating_champ_pool": ["unique_champs"],
}
ACADEMY_PARENT = {  # LCK CL 팀 → 1군 팀
    "BNK FEARX Youth": "BFX", "DN SOOPers Challengers": "DNS", "Dplus Kia Challengers": "DK",
    "Gen.G Global Academy": "GEN", "HANJIN BRION Challengers": "BRO", "Hanwha Life Esports Challengers": "HLE",
    "KT Rolster Challengers": "KT", "Kiwoom DRX Challengers": "DRX", "Nongshim Esports Academy": "NS",
    "T1 Esports Academy": "T1",
}
MIN_GAMES = 15
MEDIAN_RATING = 69.5  # 백분위 50% → 40 + 59 × 0.5


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


def fill_low_sample(p):
    """15경기 미만 선수: 가진 경기로 같은 리그·포지션 백분위를 내고, 표본이 적은 만큼 중앙값(69.5) 쪽으로 당긴다.
    예전엔 50으로 고정해서 '확실히 못하는 선수'처럼 다뤘다. 경기 기록이 아예 없으면 중앙값."""
    p = p.copy()
    p["neg_deaths_pg"] = -p["deaths"] / p["games"].clip(lower=1)
    p["low_sample"] = p["games"] < MIN_GAMES
    ok = p[~p["low_sample"]]
    for rating, cols in RATING_COLS.items():
        for i in p.index[p["low_sample"]]:
            ref = ok[ok["position"] == p.at[i, "position"]]
            pcts = [(ref[c] <= p.at[i, c]).mean() for c in cols if pd.notna(p.at[i, c]) and len(ref)]
            raw = 40 + 59 * float(np.mean(pcts)) if pcts else MEDIAN_RATING
            w = p.at[i, "games"] / (p.at[i, "games"] + MIN_GAMES)
            p.at[i, rating] = round(MEDIAN_RATING + (raw - MEDIAN_RATING) * w)
    return p


def champion_pools(by_name):
    """챔피언 숙련: 2026 출전 1경기 = 1, 2025 = 0.5 (모든 리그·국제대회).
    이름이 아니라 OE playerid로 묶는다. 다른 지역의 동명이인 기록이 섞이지 않게."""
    pools = {}
    for year, weight in ((SEASON, 1.0), (SEASON - 1, 0.5)):
        df = pd.read_csv(RAW / f"{year}_LoL_esports_match_data_from_OraclesElixir.csv", low_memory=False,
                         usecols=["playerid", "position", "champion"])
        df = df[df["position"].isin(POSITIONS)].dropna(subset=["playerid", "champion"])
        for (player, champ), n in df.groupby(["playerid", "champion"]).size().items():
            if champ in by_name:
                d = pools.setdefault(player, {})
                d[by_name[champ]] = d.get(by_name[champ], 0) + n * weight
    return pools


def last_league():
    """선수별 2026 마지막 출전 리그 (LCK, LCK CL, 해외 5개). 시즌 중 옮긴 선수는 마지막 리그 팀에만 둔다."""
    df = pd.read_csv(RAW / f"{SEASON}_LoL_esports_match_data_from_OraclesElixir.csv", low_memory=False,
                     usecols=["playerid", "league", "date", "position"])
    df = df[df["position"].isin(POSITIONS) & df["league"].isin(["LCK", "LCKC", *OVERSEAS])]
    return df.sort_values("date").groupby("playerid")["league"].last()


def contract_season(value):
    """계약 만료일 → 그 시즌이 끝나면 풀리는 해. 9월 이후 만료면 그해, 그 전이면 전해 시즌 끝."""
    d = pd.to_datetime(value, errors="coerce")
    if pd.isna(d):
        return None
    return int(d.year if d.month >= 9 else d.year - 1)


def age_of(birth):
    d = pd.to_datetime(birth, errors="coerce")
    return None if pd.isna(d) else int((AS_OF - d).days // 365.25)


def leaguepedia_bio():
    """Leaguepedia 선수 정보: LCK·CL은 페이지 이름으로, 해외는 소환사명(소문자)으로 찾는다."""
    lck = pd.DataFrame(json.loads((ROOT / "raw/leaguepedia/participation.json").read_text()))
    lck = lck.sort_values("Games", ascending=False).drop_duplicates("Page").set_index("Page")
    ov_path = ROOT / "raw/leaguepedia/overseas_participation_2026.json"
    ov = pd.DataFrame(json.loads(ov_path.read_text())) if ov_path.exists() else pd.DataFrame(columns=["ID", "Page", "Games"])
    ov = ov.sort_values("Games", ascending=False).drop_duplicates("Page")
    ov = ov.assign(key=ov["ID"].str.lower()).drop_duplicates("key").set_index("key")
    return lck, ov


def export_players(by_name):
    pools = champion_pools(by_name)
    league_now = last_league()
    intang = pd.read_csv(OUT / "players/player_intangibles.csv")
    intang = intang.drop_duplicates("playerid").set_index("playerid")
    bio_lck, bio_ov = leaguepedia_bio()
    players, teams, used_ids = [], [], set()

    def bio(r, overseas):
        """(생년월일, 국적, 계약 만료 시즌)"""
        if overseas:
            b = bio_ov.loc[r["player"].lower()] if r["player"].lower() in bio_ov.index else None
            if b is None:
                return None, None, None
            return b.get("Birthdate"), b.get("Country") or None, contract_season(b.get("ContractEnd"))
        b = bio_lck.loc[r["Page"]] if isinstance(r.get("Page"), str) and r["Page"] in bio_lck.index else None
        birth = r.get("birth_date") if pd.notna(r.get("birth_date")) else (b.get("Birthdate") if b is not None else None)
        return birth, (b.get("Country") or None) if b is not None else None, contract_season(r.get("ContractEnd"))

    def add_player(r, team, league, starter, overseas=False, out=None):
        pid = r["player"].lower()
        if pid in used_ids:
            pid = f"{pid}-{team.lower()}"
        used_ids.add(pid)
        known = r["playerid"] in intang.index
        birth, country, contract = bio(r, overseas)
        (players if out is None else out).append({
            "id": pid, "name": r["player"], "team": team, "position": r["position"],
            "age": age_of(birth), "birthDate": str(birth)[:10] if birth else None, "nationality": country,
            "contractEnd": contract, "games2026": int(r["games"]), "starter": starter,
            "ratingLeague": league, "lowSample": bool(r["low_sample"]),
            "ratings": {v: float(r[k]) for k, v in RATINGS.items()},
            "intangible": float(intang["intangible"].get(r["playerid"], 0.0)),
            "intangibleSe": float(intang["intangible_se"].get(r["playerid"], 0.0)),
            "intangibleKnown": bool(known),
            "champions": dict(sorted(pools.get(r["playerid"], {}).items(), key=lambda kv: -kv[1])),
        })
        return pid

    def add_team(short, name, league, roster):
        teams.append({"id": short, "name": name, "league": league,
                      "starters": {pos: next(x["id"] for x in roster if x["starter"] and x["position"] == pos)
                                   for pos in POSITIONS},
                      "bench": [x["id"] for x in roster if not x["starter"]]})

    # LCK: 2026 LCK 전체 출전 수가 가장 많은 선수가 주전 (기존 방식 그대로)
    # 해외로 옮긴 선수만 뺀다 (시즌 중 2군에 내려가 뛴 선수도 1군 소속으로 둠: 2026 캘리브레이션 로스터 유지)
    p = fill_low_sample(pd.read_csv(OUT / f"players/players_lck{SEASON}.csv"))
    p = p[p["playerid"].map(league_now).fillna("LCK").isin(["LCK", "LCKC"])]
    main_ids = set(p["playerid"])
    starters = p.sort_values("games", ascending=False).drop_duplicates(["team", "position"])
    for _, r in p.iterrows():
        add_player(r, TEAM_SHORT[r["team"]], "LCK",
                   bool(((starters["player"] == r["player"]) & (starters["team"] == r["team"])).any()))
    for name, short in TEAM_SHORT.items():
        add_team(short, name, "LCK", [x for x in players if x["team"] == short])

    # 해외: 마지막 정규 스플릿에 그 팀으로 가장 많이 나온 선수가 주전. 능력치는 그 리그 안 백분위
    for league in OVERSEAS:
        p = fill_low_sample(pd.read_csv(OUT / f"players/players_{league.lower()}{SEASON}.csv"))
        p = p[p["playerid"].map(league_now) == league]
        starters = p.sort_values("games_last_split", ascending=False).drop_duplicates(["team_last_split", "position"])
        start_ids = set(starters["playerid"])
        for _, r in p.sort_values(["team_last_split", "games_last_split"], ascending=[True, False]).iterrows():
            add_player(r, OVERSEAS_SHORT[r["team_last_split"]], league, r["playerid"] in start_ids, overseas=True)
        for name in sorted(p["team_last_split"].unique()):
            short = OVERSEAS_SHORT[name]
            add_team(short, name, league, [x for x in players if x["team"] == short])

    # 2군: LCK CL 2026에서 마지막으로 뛴 선수. 1군 팀 약칭을 team으로, 능력치는 LCK CL 안 백분위
    academy = []
    c = fill_low_sample(pd.read_csv(OUT / f"players/players_lckcl{SEASON}.csv"))
    c = c[(c["playerid"].map(league_now).fillna("LCKC") == "LCKC") & ~c["playerid"].isin(main_ids)]
    for _, r in c.sort_values(["team", "games"], ascending=[True, False]).iterrows():
        add_player(r, ACADEMY_PARENT[r["team"]], "LCKCL", False, out=academy)
    return players, teams, academy


def export_world():
    teams = pd.read_csv(OUT / f"teams/overseas_teams{SEASON}.csv")
    intl = json.loads((OUT / "calibration/international_strength.json").read_text())
    return {
        "teamWinrate": {lg: {OVERSEAS_SHORT[r.team]: r.regular_winrate for r in g.itertuples()}
                        for lg, g in teams.groupby("league")},
        "teamGames": {lg: {OVERSEAS_SHORT[r.team]: int(r.games) for r in g.itertuples()}
                      for lg, g in teams.groupby("league")},
        "academyOffset": intl["academy"]["offset"],  # LCK CL 능력치 → LCK 기준
        "international": {
            "strength": intl["strength_logit"],
            # [리그 a, 리그 b, 가중 경기 수, 모델 승률(a 기준), 실제 승률]
            "pairs": [[x["a"], x["b"], x["weighted_games"], x["model_winrate"], x["raw_winrate"]]
                      for x in intl["pairs"]],
        },
    }


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
        "team_regular_winrate": {TEAM_SHORT_ALIASES[k]: v for k, v in reg.groupby("teamname")["result"].mean().items()},
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
    players, teams, academy = export_players(by_name)
    dump(clean(champions), "champions.json")
    dump(clean(players), "players.json")
    dump(clean(academy), "academy.json")
    dump(clean(teams), "teams.json")
    dump(clean(export_matchups(by_name)), "matchups.json")
    dump(clean(export_targets()), "targets.json")
    dump(clean(export_world()), "world.json")
    print(f"champions={len(champions)} players={len(players)} teams={len(teams)} academy={len(academy)}")


if __name__ == "__main__":
    main()
