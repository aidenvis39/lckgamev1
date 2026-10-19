"""해외 5개 리그(LPL·LEC·LCS·LCP·CBLOL)와 국제전 기준값. build_all.py의 함수를 그대로 쓴다.

출력:
- output/players/players_<리그>2026.csv   리그 안 포지션 백분위 능력치 (LCK 표와 같은 방식)
                                           + 마지막 스플릿 소속·출전 수 (주전 판정용)
- output/teams/overseas_teams2026.csv      마지막 정규 스플릿 참가팀, 최근 정규 스플릿 2개 세트 승률
- output/calibration/international_pairs.csv     2024~2026 국제전(MSI·월즈·FST·EWC) 리그 쌍별 전적
- output/calibration/international_strength.json 리그 강도(브래들리-테리, LCK=0)와 리그 쌍 승리 확률,
                                                 LCK CL(2군) → LCK 능력치 보정 (두 리그를 같은 해 뛴 선수 비교)

사용법: python3 -I scripts/build_world.py .
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_all as ba  # noqa: E402  (ROOT는 sys.argv[1]에서 읽는다)

OUT = ba.OUT
SEASON = 2026
MAJOR = ["LCK", "LPL", "LEC", "LCS", "LCP", "CBLOL"]
OVERSEAS = MAJOR[1:]
# 정규 스플릿 (컵·락인·버서스 제외). 마지막 것이 현재 로스터 기준, 마지막 두 개가 팀 승률 기준
REGULAR_SPLITS = {
    "LPL": ["Split 2", "Split 3"],
    "LEC": ["Spring", "Summer"],
    "LCS": ["Spring", "Summer"],
    "LCP": ["Split 2", "Split 3"],
    "CBLOL": ["Split 1", "Split 2"],
}
# 연도마다 리그 이름이 다르다 (2025 LTA 북·남미 통합, 2024 LCP 출범 전)
LEAGUE_ALIASES = {2024: {"PCS": "LCP", "VCS": "LCP", "LJL": "LCP"}, 2025: {"LTA N": "LCS", "LTA S": "CBLOL"}, 2026: {}}
INTL_YEAR_WEIGHT = {2024: 0.35, 2025: 0.6, 2026: 1.0}


def overseas_players(df):
    tables, teams = [], []
    for league in OVERSEAS:
        lg = df[df["league"] == league]
        last_split = REGULAR_SPLITS[league][-1]
        cur = lg[(lg["split"] == last_split) & (lg["playoffs"] == 0)]
        roster = ba.players_of(cur).groupby("playerid").agg(team_last_split=("teamname", "last"),
                                                            games_last_split=("result", "size"))
        table = ba.player_table(lg, f"{league} {SEASON}")
        table = table.merge(roster, left_on="playerid", right_index=True, how="inner")
        tables.append((league, table))

        reg = ba.teams_of(lg[lg["split"].isin(REGULAR_SPLITS[league]) & (lg["playoffs"] == 0)])
        now = set(ba.teams_of(cur)["teamname"])
        wr = reg[reg["teamname"].isin(now)].groupby("teamname")["result"].agg(["size", "mean"])
        teams.append(pd.DataFrame({"league": league, "team": wr.index, "games": wr["size"].values,
                                   "regular_winrate": wr["mean"].round(4).values}))
    return tables, pd.concat(teams, ignore_index=True)


def international_games():
    rows = []
    for year in INTL_YEAR_WEIGHT:
        df = ba.load(year, usecols=["gameid", "league", "date", "teamname", "position", "result", "side"])
        t = ba.teams_of(df).copy()
        t["lg"] = t["league"].replace(LEAGUE_ALIASES[year])
        dom = t[t["lg"].isin(MAJOR)]
        home = (dom.groupby(["teamname", "lg"]).size().reset_index(name="n").sort_values("n")
                .drop_duplicates("teamname", keep="last").set_index("teamname")["lg"])
        intl = t[t["league"].isin(ba.INTL)].copy()
        intl["home"] = intl["teamname"].map(home)
        g = intl.pivot_table(index="gameid", columns="side", values=["home", "result"], aggfunc="first").dropna()
        g.columns = ["blue_home", "red_home", "blue_win", "red_win"]
        g = g[g["blue_home"] != g["red_home"]]
        rows += [(year, r.blue_home, r.red_home, int(r.blue_win)) for r in g.itertuples()]
    return pd.DataFrame(rows, columns=["year", "a", "b", "a_win"])


def bradley_terry(games, ridge=2.0, iters=60):
    """리그 강도 s (LCK=0). P(a가 b를 이김) = σ(s_a - s_b). 연도 가중치 + 0 쪽으로 당기는 ridge."""
    idx = {lg: i for i, lg in enumerate(MAJOR)}
    w = games["year"].map(INTL_YEAR_WEIGHT).to_numpy()
    X = np.zeros((len(games), len(MAJOR)))
    X[np.arange(len(games)), games["a"].map(idx)] = 1
    X[np.arange(len(games)), games["b"].map(idx)] = -1
    X = X[:, 1:]  # LCK 기준
    y = games["a_win"].to_numpy()
    beta = np.zeros(X.shape[1])
    for _ in range(iters):  # 뉴턴법
        p = 1 / (1 + np.exp(-X @ beta))
        grad = X.T @ (w * (y - p)) - ridge * beta
        hess = -(X.T * (w * p * (1 - p))) @ X - ridge * np.eye(len(beta))
        beta -= np.linalg.solve(hess, grad)
    return {"LCK": 0.0, **{lg: float(b) for lg, b in zip(MAJOR[1:], beta)}}


def pair_table(games, strength):
    both = pd.concat([games, games.rename(columns={"a": "b", "b": "a"}).assign(a_win=1 - games["a_win"])])
    both["w"] = both["year"].map(INTL_YEAR_WEIGHT)
    rows = []
    for i, a in enumerate(MAJOR):
        for b in MAJOR[i + 1:]:
            g = both[(both["a"] == a) & (both["b"] == b)]
            rows.append({"a": a, "b": b, "games": len(g), "weighted_games": round(g["w"].sum(), 2),
                         "raw_winrate": round(g["a_win"].mean(), 3) if len(g) else None,
                         "model_winrate": round(1 / (1 + np.exp(-(strength[a] - strength[b]))), 3)})
    return pd.DataFrame(rows)


def academy_offset():
    """LCK CL 백분위 능력치를 LCK 기준으로 옮기는 값: 같은 해 두 리그를 모두 15경기 이상 뛴 선수의 (LCK − CL) 평균.
    다음 해 CL → LCK로 올라온 선수의 차이도 참고로 남긴다 (그 사이 성장이 섞여서 덜 음수)."""
    rows = []
    for tag, lg in (("lck", "LCK"), ("lckcl", "LCKC")):
        for y in (2025, 2026):
            t = pd.read_csv(OUT / f"players/players_{tag}{y}.csv")
            t = t[~t["low_sample"].astype(bool)]
            t = t.assign(lg=lg, y=y, ovr=t[["rating_laning", "rating_teamfight", "rating_vision", "rating_survival"]].mean(axis=1))
            rows.append(t[["playerid", "lg", "y", "ovr"]])
    a = pd.concat(rows)
    both = a.pivot_table(index=["playerid", "y"], columns="lg", values="ovr").dropna()
    same = both["LCK"] - both["LCKC"]
    cl = a[(a["lg"] == "LCKC") & (a["y"] == 2025)].set_index("playerid")["ovr"]
    nxt = a[(a["lg"] == "LCK") & (a["y"] == 2026)].set_index("playerid")["ovr"]
    moved = (nxt - cl).dropna()
    return {"offset": round(float(same.mean()), 1), "same_year_players": int(len(same)), "same_year_median": round(float(same.median()), 1),
            "promoted_next_year_players": int(len(moved)), "promoted_next_year_mean": round(float(moved.mean()), 1)}


def main():
    df = ba.load(SEASON, usecols=ba.PLAYER_COLS + ["split", "playoffs", "gameid", "side"])
    tables, teams = overseas_players(df)
    for league, table in tables:
        ba.dump_csv(table, OUT / f"players/players_{league.lower()}{SEASON}.csv")
    ba.dump_csv(teams, OUT / f"teams/overseas_teams{SEASON}.csv")

    games = international_games()
    strength = bradley_terry(games)
    pairs = pair_table(games, strength)
    ba.dump_csv(pairs, OUT / "calibration/international_pairs.csv")
    ba.dump_json({"leagues": MAJOR, "year_weight": INTL_YEAR_WEIGHT, "games_by_year": games["year"].value_counts()
                  .sort_index().to_dict(), "strength_logit": {k: round(v, 3) for k, v in strength.items()},
                  "pairs": pairs.to_dict("records"), "academy": academy_offset()}, OUT / "calibration/international_strength.json")
    print(teams.groupby("league").size().to_dict())
    print({k: round(v, 2) for k, v in strength.items()})
    print(pairs.to_string())


if __name__ == "__main__":
    main()
