"""선수별 '보이지 않는 기여'(운영·콜) 추정.

2020~2026 LCK 모든 경기를 한 줄씩 놓고 로지스틱 릿지 회귀를 한다.
  logit P(블루 승) = 진영 + β · (개인 기록 능력치 팀 평균 차)
                   + Σ θ(블루 선수) - Σ θ(레드 선수)
                   + τ(블루 팀-시즌) - τ(레드 팀-시즌)
- θ: 선수를 따라다니는 기여. 팀을 옮겨도 같은 값이라, 85명의 이적 기록이 θ와 τ를 구분하는 근거가 된다.
- τ: 그 시즌 그 팀에 남는 기여 (코칭, 팀 시스템, 그 해의 합)
- 개인 기록 능력치는 같은 시즌·포지션 안에서 표준화한 라인전/한타/시야/생존 (엔진 rating과 같은 재료)
- 최근 시즌일수록 가중치를 크게 준다 (연 0.8배 감쇠). 릿지 강도는 5겹 교차검증으로 고른다.

출력: output/players/player_intangibles.csv, output/teams/team_season_effects.csv, output/players/intangibles_summary.json
사용법: python3 -I scripts/player_intangibles.py .
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(sys.argv[1])
RAW = ROOT / "raw/oe_drive"
OUT = ROOT / "output"
YEARS = range(2020, 2027)
LAST = max(YEARS)
DECAY = 0.8
POSITIONS = ["top", "jng", "mid", "bot", "sup"]
RATING_STATS = {
    "laning": ["csdiffat15", "golddiffat15", "xpdiffat15"],
    "teamfight": ["dpm", "damageshare", "kp"],
    "vision": ["vspm", "wcpm"],
    "survival": ["neg_deaths"],
}
COLS = ["gameid", "league", "year", "side", "position", "playerid", "playername", "teamname", "result", "kills",
        "deaths", "assists", "teamkills", "csdiffat15", "golddiffat15", "xpdiffat15", "dpm", "damageshare", "vspm",
        "wcpm"]


def load():
    frames = []
    for y in YEARS:
        df = pd.read_csv(RAW / f"{y}_LoL_esports_match_data_from_OraclesElixir.csv", low_memory=False, usecols=COLS)
        frames.append(df[df["league"] == "LCK"].assign(year=y))
    return pd.concat(frames, ignore_index=True)


def season_ratings(p):
    """선수-시즌별 능력치 z: 같은 시즌·포지션 안에서 표준화, 경기 수가 적으면 0 쪽으로 당긴다."""
    p = p.assign(kp=(p["kills"] + p["assists"]) / p["teamkills"].replace(0, np.nan), neg_deaths=-p["deaths"])
    stats = sorted({s for v in RATING_STATS.values() for s in v})
    agg = p.groupby(["year", "position", "playerid"]).agg(games=("result", "size"), **{s: (s, "mean") for s in stats})
    out = agg[["games"]].copy()
    for rating, cols in RATING_STATS.items():
        zs = []
        for c in cols:
            g = agg.groupby(level=["year", "position"])[c]
            zs.append((agg[c] - g.transform("mean")) / g.transform("std"))
        out[rating] = pd.concat(zs, axis=1).mean(axis=1).fillna(0) * out["games"] / (out["games"] + 10)
    return out.reset_index()


def build_design(p, ratings):
    p = p.merge(ratings[["year", "position", "playerid", *RATING_STATS]], on=["year", "position", "playerid"])
    blue = p[p["side"] == "Blue"]
    games = blue.groupby("gameid").agg(year=("year", "first"), y=("result", "first"), blue_team=("teamname", "first"))
    games = games.join(p[p["side"] == "Red"].groupby("gameid")["teamname"].first().rename("red_team"))
    games = games[(p.groupby("gameid").size() == 10).reindex(games.index, fill_value=False)]
    box = p.groupby(["gameid", "side"])[list(RATING_STATS)].mean().unstack("side")
    games = games.join(pd.DataFrame({r: box[(r, "Blue")] - box[(r, "Red")] for r in RATING_STATS}))

    players = sorted(p["playerid"].unique())
    team_seasons = sorted({f"{t}|{y}" for t, y in zip(p["teamname"], p["year"])})
    pi = {k: i for i, k in enumerate(players)}
    ti = {k: i for i, k in enumerate(team_seasons)}
    n = len(games)
    gidx = {g: i for i, g in enumerate(games.index)}
    P = np.zeros((n, len(players)))
    for g, side, pid in p[["gameid", "side", "playerid"]].itertuples(index=False):
        if g in gidx:
            P[gidx[g], pi[pid]] += 1 if side == "Blue" else -1
    T = np.zeros((n, len(team_seasons)))
    for i, (bt, rt, y) in enumerate(zip(games["blue_team"], games["red_team"], games["year"])):
        T[i, ti[f"{bt}|{y}"]] += 1
        T[i, ti[f"{rt}|{y}"]] -= 1
    X = np.column_stack([np.ones(n), games[list(RATING_STATS)].to_numpy(), P, T])
    w = DECAY ** (LAST - games["year"].to_numpy())
    return games, X, games["y"].to_numpy().astype(float), w, players, team_seasons


def fit(X, y, w, penalty, iters=40):
    """가중 로지스틱 릿지 (Newton). penalty: 열마다의 릿지 강도 벡터."""
    beta = np.zeros(X.shape[1])
    for _ in range(iters):
        p = 1 / (1 + np.exp(-X @ beta))
        grad = X.T @ (w * (y - p)) - penalty * beta
        H = (X * (w * p * (1 - p))[:, None]).T @ X + np.diag(penalty) + 1e-9 * np.eye(len(beta))
        step = np.linalg.solve(H, grad)
        beta += step
        if np.abs(step).max() < 1e-7:
            break
    return beta, H


def penalty_vector(n_box, n_players, n_teams, lp, lt):
    return np.concatenate([[0.0], np.full(n_box, 0.01), np.full(n_players, lp), np.full(n_teams, lt)])


def cross_validate(X, y, w, n_box, n_players, n_teams, grid, folds=5, seed=0):
    rng = np.random.default_rng(seed)
    fold = rng.integers(0, folds, len(y))
    best = None
    for lp, lt in grid:
        pen = penalty_vector(n_box, n_players, n_teams, lp, lt)
        ll = 0.0
        for k in range(folds):
            tr, te = fold != k, fold == k
            beta, _ = fit(X[tr], y[tr], w[tr], pen)
            p = np.clip(1 / (1 + np.exp(-X[te] @ beta)), 1e-6, 1 - 1e-6)
            ll += -np.sum(w[te] * (y[te] * np.log(p) + (1 - y[te]) * np.log(1 - p)))
        ll /= w.sum()
        print(f"  λ선수={lp:<5} λ팀시즌={lt:<5} 교차검증 로그손실 {ll:.4f}")
        if best is None or ll < best[0]:
            best = (ll, lp, lt)
    return best


def main():
    raw = load()
    players_rows = raw[raw["position"].isin(POSITIONS)]
    ratings = season_ratings(players_rows)
    games, X, y, w, players, team_seasons = build_design(players_rows, ratings)
    nb, npl, nt = len(RATING_STATS), len(players), len(team_seasons)
    print(f"경기 {len(y)}, 선수 {npl}, 팀-시즌 {nt}")

    grid = [(lp, lt) for lp in (5, 10, 20, 40) for lt in (20, 40, 80, 160, 1e4)]
    cv_ll, lp, lt = cross_validate(X, y, w, nb, npl, nt, grid)
    base_pen = penalty_vector(nb, 0, 0, 0, 0)
    base_ll = cross_validate(X[:, : 1 + nb], y, w, nb, 0, 0, [(0, 0)])[0]
    print(f"선택: λ선수={lp}, λ팀시즌={lt} (개인 기록만: {base_ll:.4f} → 선수·팀 효과 추가: {cv_ll:.4f})")

    beta, H = fit(X, y, w, penalty_vector(nb, npl, nt, lp, lt))
    se = np.sqrt(np.diag(np.linalg.inv(H)))
    o = 1 + nb
    theta, theta_se = beta[o:o + npl], se[o:o + npl]
    tau = beta[o + npl:]

    info = players_rows.groupby("playerid").agg(
        player=("playername", "last"), position=("position", lambda s: s.mode()[0]), games=("result", "size"),
        teams=("teamname", lambda s: " / ".join(dict.fromkeys(s))), last_year=("year", "max"))
    pl = pd.DataFrame({"playerid": players, "intangible": theta, "intangible_se": theta_se}).set_index("playerid").join(info)
    pl = pl.reset_index().sort_values("intangible", ascending=False)
    pl[["intangible", "intangible_se"]] = pl[["intangible", "intangible_se"]].round(3)
    (OUT / "players").mkdir(parents=True, exist_ok=True)
    pl.to_csv(OUT / "players/player_intangibles.csv", index=False, encoding="utf-8-sig")

    ts = pd.DataFrame({"team_season": team_seasons, "effect": tau.round(3)})
    ts[["team", "year"]] = ts["team_season"].str.split("|", expand=True)
    ts[["team", "year", "effect"]].sort_values(["year", "effect"], ascending=[True, False]).to_csv(
        OUT / "teams/team_season_effects.csv", index=False, encoding="utf-8-sig")

    summary = {
        "games": int(len(y)), "players": npl, "team_seasons": nt,
        "lambda_player": lp, "lambda_team_season": lt,
        "cv_logloss_box_only": round(base_ll, 4), "cv_logloss_with_effects": round(cv_ll, 4),
        "box_coef": dict(zip(RATING_STATS, beta[1:o].round(3).tolist())), "side_intercept": round(beta[0], 3),
        "players_moved_teams": int((players_rows.groupby("playerid")["teamname"].nunique() >= 2).sum()),
    }
    (OUT / "players/intangibles_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2))
    print(json.dumps(summary, ensure_ascii=False))
    cur = pl[pl["last_year"] == LAST]
    print("\n2026 출전 선수 상위 10 / 하위 5")
    print(cur.head(10)[["player", "position", "intangible", "intangible_se", "games", "teams"]].to_string(index=False))
    print(cur.tail(5)[["player", "position", "intangible", "intangible_se", "games", "teams"]].to_string(index=False))
    print("\n2026 팀-시즌 효과")
    print(ts[ts["year"] == str(LAST)].sort_values("effect", ascending=False)[["team", "effect"]].to_string(index=False))


if __name__ == "__main__":
    main()
