"""LCK 구단 운영 시뮬 - 엔진 튜닝용 데이터 가공 스크립트.

입력: Oracle's Elixir 2020~2026 경기 CSV, Riot Data Dragon 16.20.1,
      Leaguepedia 선수 정보·팀 이력, 나무위키 생년월일
출력: output/ 아래 calibration, champions, players, teams

사용법: python3 -I scripts/build_all.py .
"""
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(sys.argv[1])
OE_DIR = ROOT / "raw/oe_drive"  # Oracle's Elixir 공식 구글 드라이브 파일
DD = ROOT / "raw/ddragon/latest/data"
NAMU = ROOT / "raw/namuwiki/player_birthdates.csv"  # 나무위키 검색으로 수집한 생년월일
LP = ROOT / "raw/leaguepedia"  # Leaguepedia CargoExport 결과 (participation.json, tenures.json)
OUT = ROOT / "output"

YEARS = range(2020, 2027)  # 성장·노쇠 곡선용
CALIB_YEARS = (2025, 2026)  # 튜닝 기준값·메타·선수 표를 만드는 시즌
TIER1 = ["LCK", "LPL", "LEC", "LTA N", "LTA S", "LTA", "LCP", "FST", "MSI", "EWC", "WLDs"]
INTL = ["FST", "MSI", "EWC", "WLDs"]
POSITIONS = ["top", "jng", "mid", "bot", "sup"]
PLAYER_COLS = ["date", "league", "playerid", "playername", "teamname", "position", "result", "kills", "deaths",
               "assists", "teamkills", "csdiffat15", "golddiffat15", "xpdiffat15", "dpm", "damageshare",
               "earnedgoldshare", "cspm", "wpm", "wcpm", "vspm", "champion", "firstbloodkill", "firstbloodassist"]


def load(year, usecols=None):
    path = OE_DIR / f"{year}_LoL_esports_match_data_from_OraclesElixir.csv"
    df = pd.read_csv(path, low_memory=False, dtype={"patch": str}, usecols=usecols)
    df["date"] = pd.to_datetime(df["date"])
    return df


def regular_season(df):
    """플레이오프를 뺀 정규시즌. 2025년부터는 'Rounds ...' 스플릿, 그 전은 Spring/Summer."""
    split = df["split"].fillna("")
    return df[(split.str.startswith("Rounds") | split.isin(["Spring", "Summer"])) & (df["playoffs"] == 0)]


def _clean(o):
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, list):
        return [_clean(v) for v in o]
    if isinstance(o, (float, np.floating)):
        return None if np.isnan(o) else float(o)
    if isinstance(o, np.integer):
        return int(o)
    return o


def dump_json(obj, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(_clean(obj), ensure_ascii=False, indent=2))


def dump_csv(df, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    df.to_csv(path, index=False, encoding="utf-8-sig")


def describe(s):
    s = s.dropna()
    q = s.quantile([0.1, 0.25, 0.5, 0.75, 0.9])
    return {"n": int(len(s)), "mean": round(s.mean(), 2), "std": round(s.std(), 2),
            "p10": round(q[0.1], 2), "p25": round(q[0.25], 2), "median": round(q[0.5], 2),
            "p75": round(q[0.75], 2), "p90": round(q[0.9], 2)}


def logit_fit(X, y, iters=50):
    """절편 포함 로지스틱 회귀 (IRLS). scipy 없이 numpy만 사용."""
    X = np.column_stack([np.ones(len(X)), np.asarray(X, dtype=float)])
    y = np.asarray(y, dtype=float)
    w = np.zeros(X.shape[1])
    for _ in range(iters):
        p = 1 / (1 + np.exp(-X @ w))
        H = X.T @ (X * (p * (1 - p))[:, None]) + 1e-9 * np.eye(X.shape[1])
        w += np.linalg.solve(H, X.T @ (y - p))
    return w


def teams_of(df):
    return df[df["position"] == "team"]


def players_of(df):
    return df[df["position"].isin(POSITIONS)]


def complete(df):
    return df[df["datacompleteness"] == "complete"]


# ---------------------------------------------------------------- 시리즈 복원

def build_games(team_rows):
    """팀 행 2개짜리 경기만 남겨서 경기당 1행(블루/레드)으로 만든다."""
    t = team_rows[team_rows.groupby("gameid")["gameid"].transform("size") == 2]
    t = t.sort_values(["gameid", "side"])  # Blue < Red
    g = t.groupby("gameid").agg(
        league=("league", "first"), date=("date", "first"), game=("game", "first"),
        split=("split", "first"), playoffs=("playoffs", "first"), patch=("patch", "first"),
        blue=("teamname", "first"), red=("teamname", "last"), blue_win=("result", "first"),
        gamelength=("gamelength", "first"),
    ).reset_index()
    g["winner"] = np.where(g["blue_win"] == 1, g["blue"], g["red"])
    g["pair"] = [tuple(sorted(p)) for p in zip(g["blue"], g["red"])]
    return g


def build_series(games):
    g = games.sort_values(["league", "pair", "date"]).reset_index(drop=True)
    ids, sid, prev = [], 0, None
    for r in g.itertuples():
        key = (r.league, r.pair)
        if prev is None or key != prev[0] or r.game == 1 or (r.date - prev[1]).total_seconds() > 12 * 3600:
            sid += 1
        ids.append(sid)
        prev = (key, r.date)
    g["series"] = ids
    rows = []
    for sid, s in g.groupby("series"):
        s = s.sort_values("date")
        a, b = s["pair"].iloc[0]
        winners = list(s["winner"])
        wa, wb = winners.count(a), winners.count(b)
        rows.append({
            "series": sid, "league": s["league"].iloc[0], "split": s["split"].iloc[0],
            "playoffs": s["playoffs"].iloc[0], "date": s["date"].iloc[0].date().isoformat(),
            "team_a": a, "team_b": b, "wins_a": wa, "wins_b": wb,
            "best_of": 2 * max(wa, wb) - 1, "winner": a if wa > wb else b,
            "game_winners": winners,
        })
    return g, pd.DataFrame(rows)


def series_stats(series):
    out = {}
    for bo in (3, 5):
        s = series[series["best_of"] == bo]
        if s.empty:
            continue
        g1_conv = np.mean([w[0] == sw for w, sw in zip(s["game_winners"], s["winner"])])
        same_next, total_next = 0, 0
        for w in s["game_winners"]:
            for i in range(len(w) - 1):
                total_next += 1
                same_next += w[i] == w[i + 1]
        scores = (s[["wins_a", "wins_b"]].max(axis=1).astype(str) + "-" +
                  s[["wins_a", "wins_b"]].min(axis=1).astype(str)).value_counts(normalize=True)
        rev = 0
        if bo == 5:
            rev = sum(1 for w, sw in zip(s["game_winners"], s["winner"])
                      if len(w) == 5 and w[0] == w[1] != sw)
        out[f"BO{bo}"] = {
            "series": int(len(s)),
            "p_series_win_if_won_game1": round(g1_conv, 3),
            "p_same_team_wins_next_game": round(same_next / total_next, 3) if total_next else None,
            "score_distribution": {k: round(v, 3) for k, v in scores.items()},
            **({"reverse_sweeps_0_2_to_3_2": rev} if bo == 5 else {}),
        }
    return out


# ---------------------------------------------------------------- A. 튜닝 기준값

def per_game_totals(team_rows):
    cols = ["kills", "dragons", "elementaldrakes", "elders", "barons", "heralds", "void_grubs",
            "atakhans", "towers", "inhibitors", "turretplates"]
    agg = team_rows.groupby("gameid")[cols].sum()
    agg["gamelength_min"] = team_rows.groupby("gameid")["gamelength"].first() / 60
    agg["kills_per_min"] = agg["kills"] / agg["gamelength_min"]
    return agg


def objective_winrates(team_rows):
    rows = []
    t = team_rows
    for col, label in [("firstblood", "퍼스트 블러드"), ("firstdragon", "첫 용"), ("firstherald", "첫 전령"),
                       ("firsttower", "첫 포탑"), ("firstmidtower", "첫 미드 포탑"),
                       ("firsttothreetowers", "포탑 3개 선점"), ("firstbaron", "첫 바론")]:
        took = t[t[col] == 1]
        occurred = took["gameid"].nunique() / t["gameid"].nunique()
        rows.append({"objective": label, "column": col, "n": len(took),
                     "occurred_rate": round(occurred, 3), "winrate_when_taken": round(took["result"].mean(), 3)})
    extra = [
        ("유충 과반 확보", t["void_grubs"] > t["opp_void_grubs"]),
        ("아타칸 처치", t["atakhans"] > 0),
        ("장로 용 처치", t["elders"] > 0),
        ("용 영혼 (원소 용 4개)", t["elementaldrakes"] >= 4),
        ("용 더 많이 처치", t["dragons"] > t["opp_dragons"]),
        ("15분 포탑 방패 더 많이", t["turretplates"] > t["opp_turretplates"]),
        ("블루 진영", t["side"] == "Blue"),
        ("선픽 (firstPick)", t["firstPick"] == 1),
    ]
    for label, mask in extra:
        sub = t[mask]
        rows.append({"objective": label, "column": "", "n": len(sub),
                     "occurred_rate": round(sub["gameid"].nunique() / t["gameid"].nunique(), 3),
                     "winrate_when_taken": round(sub["result"].mean(), 3)})
    return pd.DataFrame(rows)


def gold_curves(team_rows, scope):
    rows, fits = [], {}
    for m in (10, 15, 20, 25):
        col = f"golddiffat{m}"
        t = team_rows.dropna(subset=[col])
        lim = 4000 + 1000 * (m // 5)
        b = (t[col].clip(-lim, lim) / 1000).round().astype(int) * 1000
        for bucket, s in t.groupby(b)["result"]:
            rows.append({"scope": scope, "minute": m, "gold_diff_bucket": bucket, "n": len(s),
                         "winrate": round(s.mean(), 3)})
        w = logit_fit(t[[col]].values / 1000, t["result"].values)
        fits[f"at{m}"] = {
            "logit_coef_per_1k_gold": round(w[1], 4),
            "fitted_winrate": {f"+{k}k": round(1 / (1 + np.exp(-(w[0] + w[1] * k))), 3) for k in (1, 2, 3, 5, 8)},
            "comeback_rate_behind_3k_plus": round(1 - t[t[col] >= 3000]["result"].mean(), 3),
            "comeback_rate_behind_5k_plus": round(1 - t[t[col] >= 5000]["result"].mean(), 3),
            "n": int(len(t)),
        }
    return pd.DataFrame(rows), fits


def lane_impact(df, scope):
    p = complete(players_of(df))
    piv = p.pivot_table(index=["gameid", "teamname"], columns="position",
                        values="golddiffat15", aggfunc="first").dropna()
    res = p.groupby(["gameid", "teamname"])["result"].first().loc[piv.index]
    X = piv[POSITIONS]
    Z = (X - X.mean()) / X.std()
    w = logit_fit(Z.values, res.values)[1:]
    rows = []
    for i, pos in enumerate(POSITIONS):
        lane = X[pos]
        rows.append({
            "scope": scope, "position": pos, "n_team_games": len(lane),
            "gd15_std": round(lane.std(), 0),
            "corr_gd15_with_win": round(np.corrcoef(lane, res)[0, 1], 3),
            "logit_coef_standardized": round(w[i], 3),
            "relative_weight": round(w[i] / w.sum(), 3),
            "n_lane_ahead_1k": int((lane >= 1000).sum()),
            "winrate_if_lane_ahead_1k": round(res[lane >= 1000].mean(), 3),
            "winrate_if_lane_behind_1k": round(res[lane <= -1000].mean(), 3),
        })
    return pd.DataFrame(rows)


def strength_table(games, series, team_rows):
    """정규시즌 승률 차이별 강팀 승률 (업셋 비율)."""
    wp = regular_season(team_rows).groupby("teamname")["result"].mean()
    rank = wp.rank(ascending=False, method="first").astype(int)
    g = regular_season(games).copy()
    g["diff"] = (g["blue"].map(wp) - g["red"].map(wp)).abs()
    g["stronger_won"] = np.where(g["blue"].map(wp) >= g["red"].map(wp), g["blue_win"] == 1, g["blue_win"] == 0)
    bins = [0, 0.1, 0.2, 0.3, 0.45, 1.0]
    labels = ["0~10%p", "10~20%p", "20~30%p", "30~45%p", "45%p+"]
    g["bucket"] = pd.cut(g["diff"], bins, labels=labels, include_lowest=True)
    game_rows = g.groupby("bucket", observed=True)["stronger_won"].agg(["size", "mean"]).reset_index()
    game_rows.columns = ["winpct_gap", "n_games", "stronger_team_winrate"]
    game_rows.insert(0, "level", "game")

    s = regular_season(series).copy()
    s["gap"] = (s["team_a"].map(rank) - s["team_b"].map(rank)).abs()
    s["higher_won"] = [w == (a if rank[a] < rank[b] else b) for w, a, b in zip(s["winner"], s["team_a"], s["team_b"])]
    s["bucket"] = pd.cut(s["gap"], [0, 2, 4, 6, 9], labels=["순위차 1~2", "3~4", "5~6", "7~9"])
    ser_rows = s.groupby("bucket", observed=True)["higher_won"].agg(["size", "mean"]).reset_index()
    ser_rows.columns = ["winpct_gap", "n_games", "stronger_team_winrate"]
    ser_rows.insert(0, "level", "series(BO3)")

    w = logit_fit(((g["blue"].map(wp) - g["red"].map(wp)) * 10).values[:, None], g["blue_win"].values)
    out = pd.concat([game_rows, ser_rows])
    out["stronger_team_winrate"] = out["stronger_team_winrate"].round(3)
    return out, round(w[1], 3), wp.sort_values(ascending=False)


def region_matrix(df):
    t = teams_of(df)
    dom = t[~t["league"].isin(INTL)]
    home = dom.groupby(["teamname", "league"]).size().reset_index(name="n")
    home = home.sort_values("n").drop_duplicates("teamname", keep="last").set_index("teamname")["league"]
    games = build_games(t[t["league"].isin(INTL)])
    games["blue_region"] = games["blue"].map(home)
    games["red_region"] = games["red"].map(home)
    games = games.dropna(subset=["blue_region", "red_region"])
    games = games[games["blue_region"] != games["red_region"]]
    rows = []
    for _, r in games.iterrows():
        rows.append((r["blue_region"], r["red_region"], r["blue_win"]))
        rows.append((r["red_region"], r["blue_region"], 1 - r["blue_win"]))
    m = pd.DataFrame(rows, columns=["region", "vs_region", "win"])
    out = m.groupby(["region", "vs_region"])["win"].agg(["size", "mean"]).reset_index()
    out.columns = ["region", "vs_region", "n_games", "winrate"]
    out["winrate"] = out["winrate"].round(3)
    overall = m.groupby("region")["win"].agg(["size", "mean"]).reset_index()
    overall.columns = ["region", "n_games", "winrate"]
    overall.insert(1, "vs_region", "ALL")
    overall["winrate"] = overall["winrate"].round(3)
    return pd.concat([overall.sort_values("winrate", ascending=False), out])


# ---------------------------------------------------------------- B. 챔피언 / 메타

def champion_stats(df, scope, length_cuts):
    t, p = teams_of(df), players_of(df)
    n_games = t["gameid"].nunique()
    bans = pd.concat([t[f"ban{i}"] for i in range(1, 6)]).dropna().value_counts()
    p = p.dropna(subset=["champion"]).copy()
    p["len_bucket"] = pd.cut(p["gamelength"] / 60, [0, *length_cuts, 999], labels=["short", "mid", "long"])
    base = p.groupby("champion").agg(picks=("result", "size"), winrate=("result", "mean"),
                                     avg_lane_gd15=("golddiffat15", "mean"),
                                     avg_gamelength_min=("gamelength", lambda s: s.mean() / 60))
    pos = p.groupby(["champion", "position"]).size().unstack(fill_value=0)
    pos_share = pos.div(pos.sum(axis=1), axis=0)
    base["positions"] = [", ".join(f"{k}:{v:.0%}" for k, v in row.sort_values(ascending=False).items() if v >= 0.1)
                         for _, row in pos_share.iterrows()]
    by_len = p.groupby(["champion", "len_bucket"], observed=False)["result"].agg(["size", "mean"]).unstack()
    for b in ("short", "mid", "long"):
        base[f"n_{b}"] = by_len[("size", b)]
        base[f"wr_{b}"] = by_len[("mean", b)]
    base["late_bias"] = base["wr_long"] - base["wr_short"]
    base["bans"] = bans.reindex(base.index).fillna(0).astype(int)
    extra = bans[~bans.index.isin(base.index)]
    base = pd.concat([base, pd.DataFrame({"picks": 0, "bans": extra})])
    base["presence"] = (base["picks"] + base["bans"]) / n_games
    base.insert(0, "scope", scope)
    base.insert(1, "scope_games", n_games)
    return base.reset_index(names="champion").sort_values("presence", ascending=False)


def patch_meta(df, scope):
    t, p = teams_of(df), players_of(df)
    games = t.groupby("patch")["gameid"].nunique()
    picks = p.groupby(["patch", "champion"])["result"].agg(["size", "mean"])
    picks.columns = ["picks", "winrate"]
    bl = []
    for i in range(1, 6):
        bl.append(t[["patch", f"ban{i}"]].rename(columns={f"ban{i}": "champion"}))
    bans = pd.concat(bl).dropna().groupby(["patch", "champion"]).size().rename("bans")
    m = picks.join(bans, how="outer").fillna({"picks": 0, "bans": 0}).reset_index()
    m["patch_games"] = m["patch"].map(games)
    m["presence"] = (m["picks"] + m["bans"]) / m["patch_games"]
    m.insert(0, "scope", scope)
    return m.sort_values(["patch", "presence"], ascending=[True, False])


def patch_volatility(meta, min_games=30):
    rows = []
    patches = sorted(meta.loc[meta["patch_games"] >= min_games, "patch"].unique(), key=lambda s: [int(x) for x in s.split(".")])
    for a, b in zip(patches, patches[1:]):
        pa = meta[meta["patch"] == a].set_index("champion")["presence"]
        pb = meta[meta["patch"] == b].set_index("champion")["presence"]
        u = pa.index.union(pb.index)
        ra, rb = pa.reindex(u, fill_value=0), pb.reindex(u, fill_value=0)
        top_a, top_b = set(pa.nlargest(10).index), set(pb.nlargest(10).index)
        rows.append({"from": a, "to": b, "rank_corr_presence": round(ra.rank().corr(rb.rank()), 3),
                     "top10_kept": len(top_a & top_b), "mean_abs_presence_change": round((ra - rb).abs().mean(), 4)})
    return pd.DataFrame(rows)


def lane_matchups(df, min_n=8):
    p = complete(players_of(df))[["gameid", "side", "position", "champion", "result",
                                  "golddiffat15", "csdiffat15", "xpdiffat15"]]
    m = p.merge(p[["gameid", "side", "position", "champion"]], on=["gameid", "position"], suffixes=("", "_opp"))
    m = m[m["side"] != m["side_opp"]]
    out = m.groupby(["position", "champion", "champion_opp"]).agg(
        n=("result", "size"), winrate=("result", "mean"), avg_gd15=("golddiffat15", "mean"),
        avg_csd15=("csdiffat15", "mean"), avg_xpd15=("xpdiffat15", "mean")).reset_index()
    out = out[out["n"] >= min_n].round(3)
    return out.sort_values(["position", "n"], ascending=[True, False])


def bot_duos(df, min_n=10):
    p = players_of(df)
    duo = p[p["position"].isin(["bot", "sup"])].pivot_table(
        index=["gameid", "teamname"], columns="position", values="champion", aggfunc="first").dropna()
    duo["result"] = p.groupby(["gameid", "teamname"])["result"].first().loc[duo.index]
    out = duo.groupby(["bot", "sup"])["result"].agg(["size", "mean"]).reset_index()
    out.columns = ["bot", "sup", "n", "winrate"]
    out = out[out["n"] >= min_n].round(3)
    return out.sort_values("n", ascending=False)


def build_champions_json(pro):
    """Data Dragon 정보에 프로 통계를 붙인다. pro = {json 필드명: champion_stats 결과}."""
    ko = json.loads((DD / "ko_KR/champion.json").read_text())
    en = json.loads((DD / "en_US/champion.json").read_text())
    by_en = {v["name"]: k for k, v in en["data"].items()}
    pro = {key: d.set_index("champion") for key, d in pro.items()}
    unmatched = sorted(set().union(*(set(d.index) for d in pro.values())) - set(by_en))
    out = []
    for cid, c in ko["data"].items():
        name_en = en["data"][cid]["name"]
        s = c["stats"]
        rec = {
            "id": cid, "key": int(c["key"]), "name_ko": c["name"], "name_en": name_en, "title_ko": c["title"],
            "tags": c["tags"], "resource": c["partype"], "info": c["info"],
            "stats": {k: s[k] for k in ("hp", "hpperlevel", "armor", "spellblock", "attackdamage",
                                        "attackspeed", "attackrange", "movespeed")},
        }
        for key, d in pro.items():
            if name_en not in d.index:
                continue
            a = d.loc[name_en]
            rec[key] = {
                "picks": int(a["picks"]), "bans": int(a["bans"]), "presence": round(a["presence"], 3),
                "winrate": None if pd.isna(a["winrate"]) else round(a["winrate"], 3),
                "positions": a["positions"] if isinstance(a["positions"], str) else "",
                "avg_lane_gd15": None if pd.isna(a["avg_lane_gd15"]) else round(a["avg_lane_gd15"], 0),
                "late_bias": None if pd.isna(a["late_bias"]) else round(a["late_bias"], 3),
            }
        out.append(rec)
    return {"version": ko["version"], "count": len(out), "champions": out}, unmatched


# ---------------------------------------------------------------- C. 선수 / 팀

RATING_GROUPS = {
    "rating_laning": ["csdiffat15", "golddiffat15", "xpdiffat15"],
    "rating_teamfight": ["dpm", "damageshare", "kp"],
    "rating_vision": ["vspm", "wcpm"],
    "rating_survival": ["neg_deaths_pg"],
    "rating_champ_pool": ["unique_champs"],
}


def player_table(df, scope, min_games=15):
    p = players_of(df).sort_values("date")
    g = p.groupby("playerid")
    out = g.agg(
        player=("playername", "last"), team=("teamname", "last"), position=("position", lambda s: s.mode()[0]),
        games=("result", "size"), winrate=("result", "mean"), kills=("kills", "sum"), deaths=("deaths", "sum"),
        assists=("assists", "sum"), teamkills=("teamkills", "sum"),
        csdiffat15=("csdiffat15", "mean"), golddiffat15=("golddiffat15", "mean"), xpdiffat15=("xpdiffat15", "mean"),
        dpm=("dpm", "mean"), damageshare=("damageshare", "mean"), earnedgoldshare=("earnedgoldshare", "mean"),
        cspm=("cspm", "mean"), wpm=("wpm", "mean"), wcpm=("wcpm", "mean"), vspm=("vspm", "mean"),
        unique_champs=("champion", "nunique"),
        fb_participation=("firstbloodkill", lambda s: np.nan),
    )
    fb = (p["firstbloodkill"].fillna(0) + p["firstbloodassist"].fillna(0)).clip(0, 1)
    out["fb_participation"] = fb.groupby(p["playerid"]).mean()
    out["kda"] = (out["kills"] + out["assists"]) / out["deaths"].clip(lower=1)
    out["kp"] = (out["kills"] + out["assists"]) / out["teamkills"].replace(0, np.nan)
    out["neg_deaths_pg"] = -out["deaths"] / out["games"]
    top = p.groupby(["playerid", "champion"]).size().rename("n").reset_index().sort_values("n", ascending=False)
    out["top_champions"] = top.groupby("playerid").apply(
        lambda s: ", ".join(f"{c}({n})" for c, n in zip(s["champion"].head(5), s["n"].head(5))), include_groups=False)
    out["low_sample"] = out["games"] < min_games
    # 포지션 내 백분위 → 40~99 게임 스탯으로 변환 (표본 충분한 선수끼리만 비교)
    ok = ~out["low_sample"]
    for rating, cols in RATING_GROUPS.items():
        pct = out[ok].groupby("position")[cols].rank(pct=True).mean(axis=1)
        out[rating] = (40 + 59 * pct).round(0)
    out = out.drop(columns=["teamkills", "neg_deaths_pg"]).reset_index()
    out.insert(0, "scope", scope)
    num = out.select_dtypes("number").columns
    out[num] = out[num].round(3)
    order = {pos: i for i, pos in enumerate(POSITIONS)}
    return out.sort_values(["team", "position"], key=lambda s: s.map(order) if s.name == "position" else s)


def load_leaguepedia():
    """Leaguepedia 출전 기록(선수 신상 포함)과 팀 이력. participation*.json / tenures*.json 을 모두 합친다."""
    def read_all(pattern):
        files = sorted(LP.glob(pattern))
        return pd.concat([pd.DataFrame(json.loads(f.read_text())) for f in files]) if files else None

    part, ten = read_all("participation*.json"), read_all("tenures*.json")
    if ten is not None:
        ten = ten.drop_duplicates(["Player", "Team", "DateJoin"])
    return part, ten


def player_master(part, ten):
    """LCK / LCK CL 2025~2026 출전 선수 명단: 신상 + 리그·연도별 출전 경기와 팀 + 커리어."""
    part = part[part["Page"].fillna("") != ""].copy()
    part["Games"] = part["Games"].astype(int)
    part["Nationality"] = part["Nationality"].map(
        lambda v: ", ".join(x for x in v if x) if isinstance(v, list) else v)
    part["league"] = np.where(part["Tournament"].str.startswith("LCK CL"), "lckcl", "lck")
    part["year"] = part["Tournament"].str.extract(r"/(\d{4})", expand=False)
    bio = part.drop_duplicates("Page").set_index("Page")[
        ["ID", "NativeName", "Name", "Birthdate", "Country", "Nationality", "Residency",
         "CurrentTeam", "CurrentRole", "IsRetired", "ContractEnd"]]
    g = part.groupby(["Page", "league", "year"])
    games = g["Games"].sum().unstack(["league", "year"]).fillna(0).astype(int)
    games.columns = [f"games_{lg}_{y}" for lg, y in games.columns]
    teams = g["Team"].agg(lambda s: " / ".join(sorted(set(s)))).unstack(["league", "year"])
    teams.columns = [f"teams_{lg}_{y}" for lg, y in teams.columns]
    out = bio.join(games[sorted(games.columns)]).join(teams[sorted(teams.columns)])
    birth = pd.to_datetime(out["Birthdate"], errors="coerce")
    out["age_2025"] = ((pd.Timestamp("2025-07-01") - birth).dt.days / 365.25).round(1)
    out["age_today"] = ((pd.Timestamp.today().normalize() - birth).dt.days / 365.25).round(1)
    if ten is not None and len(ten):
        # Tenures의 Player 표기는 대소문자가 페이지 이름과 다를 때가 있다 (deokdam / Deokdam)
        t = ten.dropna(subset=["Player"]).assign(DateJoin=lambda d: pd.to_datetime(d["DateJoin"], errors="coerce"),
                                                 key=lambda d: d["Player"].str.lower())
        career = t.groupby("key").agg(career_start=("DateJoin", "min"), n_teams=("Team", "nunique"))
        out = out.join(career, on=out.index.str.lower())
        out["career_years_2025"] = ((pd.Timestamp("2025-07-01") - out["career_start"]).dt.days / 365.25).round(1)
    return out.reset_index()


def attach_bio(players, master, games_col, ref_date="2025-07-01"):
    """OE 선수 표에 본명·국적·생년월일·경력 연차를 붙인다.
    생년월일은 Leaguepedia 우선, 없으면 나무위키(연도만 있으면 7/1생으로 가정)."""
    p = players.assign(key=players["player"].str.lower())
    if master is not None:
        m = master[master[games_col] > 0] if games_col in master else master
        m = m.assign(key=m["ID"].str.lower()).drop_duplicates("key")
        cols = ["key", "Page", "NativeName", "Nationality", "Birthdate", "career_years_2025", "CurrentTeam", "ContractEnd"]
        p = p.merge(m[[c for c in cols if c in m]], on="key", how="left")
    else:
        p["Birthdate"] = None
    birth = pd.to_datetime(p["Birthdate"], errors="coerce")
    src = pd.Series(np.where(birth.notna(), "leaguepedia", None), index=p.index)
    if NAMU.exists():
        n = pd.read_csv(NAMU, dtype=str)
        nb = pd.to_datetime(n["birth_date"], format="%Y-%m-%d", errors="coerce").fillna(
            pd.to_datetime(n["birth_date"] + "-07-01", format="%Y-%m-%d", errors="coerce"))
        nb = pd.Series(nb.values, index=n["player"].str.lower())
        nb = nb[~nb.index.duplicated()]
        fill = birth.isna() & p["key"].map(nb).notna()
        birth = birth.where(~fill, p["key"].map(nb))
        src[fill] = "namuwiki"
    p["birth_date"] = birth.dt.date
    p["birth_source"] = src
    p["age_2025"] = ((pd.Timestamp(ref_date) - birth).dt.days / 365.25).round(1)
    return p.drop(columns=["key", "Birthdate"])


def birthdate_crosscheck(master):
    """나무위키에서 모은 생년월일과 Leaguepedia 값을 대조한다."""
    n = pd.read_csv(NAMU, dtype=str)
    m = master[master["games_lck_2025"] > 0] if "games_lck_2025" in master else master
    m = m.assign(key=m["ID"].str.lower()).drop_duplicates("key")[["key", "Page", "NativeName", "Birthdate"]]
    x = n.assign(key=n["player"].str.lower()).merge(m, on="key", how="left")

    def status(r):
        lp, nw = r["Birthdate"], r["birth_date"]
        if not isinstance(lp, str) or not lp:
            return "leaguepedia 없음"
        if len(nw) == 4:
            return "연도 일치" if lp[:4] == nw else "연도 불일치"
        return "일치" if lp == nw else "불일치"

    x["status"] = x.apply(status, axis=1)
    return x[["player", "team", "real_name", "NativeName", "birth_date", "Birthdate", "status", "note"]].rename(
        columns={"birth_date": "namuwiki", "Birthdate": "leaguepedia"})


def age_profile(players):
    """나이대별 평균 능력치 (횡단면). 오래 살아남은 베테랑만 남는 생존 편향이 있다."""
    p = players[~players["low_sample"] & players["age_2025"].notna()].copy()
    p["age_band"] = pd.cut(p["age_2025"], [0, 20, 22, 24, 26, 99], labels=["~20", "21~22", "23~24", "25~26", "27+"])
    ratings = list(RATING_GROUPS)
    out = p.groupby("age_band", observed=True).agg(n=("player", "size"), avg_age=("age_2025", "mean"),
                                                   **{r: (r, "mean") for r in ratings},
                                                   avg_kda=("kda", "mean"), avg_gd15=("golddiffat15", "mean"))
    corr = {r: round(p["age_2025"].corr(p[r]), 3) for r in ratings}
    out = out.reset_index().round(2)
    out = pd.concat([out, pd.DataFrame([{"age_band": "corr(age, rating)", "n": len(p), **corr}])])
    return out


def birth_lookup(master):
    """선수 닉네임(소문자) → 생년월일. Leaguepedia 우선, 없으면 나무위키."""
    lut = {}
    if NAMU.exists():
        n = pd.read_csv(NAMU, dtype=str)
        nb = pd.to_datetime(n["birth_date"], format="%Y-%m-%d", errors="coerce").fillna(
            pd.to_datetime(n["birth_date"] + "-07-01", format="%Y-%m-%d", errors="coerce"))
        lut.update(zip(n["player"].str.lower(), nb))
    if master is not None:
        lp = pd.to_datetime(master["Birthdate"], errors="coerce")
        lut.update((k, v) for k, v in zip(master["ID"].str.lower(), lp) if pd.notna(v))
    return pd.Series(lut, dtype="datetime64[ns]")


def player_seasons(frames):
    """LCK / LCK CL 선수-시즌 표. 능력치는 같은 리그·시즌·포지션 안의 백분위."""
    rows = []
    for year, df in frames.items():
        for league in ("LCK", "LCKC"):
            sub = df[df["league"] == league]
            if len(sub):
                rows.append(player_table(sub, f"{league} {year}").assign(year=year, league=league))
    return pd.concat(rows, ignore_index=True)


def aging_curve(seasons, births):
    """델타 방식 성장·노쇠 곡선.
    같은 리그에서 연속 두 시즌(각 15경기 이상)을 뛴 선수의 능력치 변화를 나이별로 평균하고 누적한다."""
    s = seasons[~seasons["low_sample"]].copy()
    s["key"] = s["player"].str.lower()
    s = s.drop_duplicates(["key", "league", "year"], keep=False)
    s["age"] = (pd.to_datetime(s["year"].astype(str) + "-07-01") - s["key"].map(births)).dt.days / 365.25
    s["rating_overall"] = s[["rating_laning", "rating_teamfight", "rating_vision", "rating_survival"]].mean(axis=1)
    cols = list(RATING_GROUPS) + ["rating_overall"]
    nxt = s[["key", "league", "year"] + cols].assign(year=s["year"] - 1)
    pairs = s.dropna(subset=["age"]).merge(nxt, on=["key", "league", "year"], suffixes=("", "_next"))
    for c in cols:
        pairs[f"d_{c}"] = pairs[f"{c}_next"] - pairs[c]
    pairs["age_int"] = pairs["age"].astype(int)
    curve = pairs.groupby("age_int").agg(n_pairs=("key", "size"),
                                         **{f"delta_{c}": (f"d_{c}", "mean") for c in cols}).reset_index()
    curve = curve[curve["n_pairs"] >= 5].reset_index(drop=True)
    curve["cumulative_overall"] = curve["delta_rating_overall"].cumsum()
    coverage = s.groupby(["league", "year"])["age"].apply(lambda a: round(a.notna().mean(), 3))
    return curve.round(2), pairs, coverage


def team_table(team_rows, series, wp_rank):
    t = team_rows
    g = t.groupby("teamname")
    out = g.agg(
        games=("result", "size"), wins=("result", "sum"), winrate=("result", "mean"),
        avg_gd15=("golddiffat15", "mean"), avg_gamelength_min=("gamelength", lambda s: s.mean() / 60),
        first_blood_rate=("firstblood", "mean"), first_dragon_rate=("firstdragon", "mean"),
        first_herald_rate=("firstherald", "mean"), first_tower_rate=("firsttower", "mean"),
        avg_void_grubs=("void_grubs", "mean"), team_kpm=("team kpm", "mean"),
        dragons=("dragons", "sum"), opp_dragons=("opp_dragons", "sum"),
        barons=("barons", "sum"), opp_barons=("opp_barons", "sum"),
        blue_winrate=("result", lambda s: s[t.loc[s.index, "side"] == "Blue"].mean()),
    )
    out["dragon_control"] = out["dragons"] / (out["dragons"] + out["opp_dragons"])
    out["baron_control"] = out["barons"] / (out["barons"] + out["opp_barons"])
    sw = {}
    for _, s in series.iterrows():
        for team in (s["team_a"], s["team_b"]):
            w, l = sw.get(team, (0, 0))
            sw[team] = (w + (s["winner"] == team), l + (s["winner"] != team))
    out["series_record"] = [f"{sw.get(k, (0, 0))[0]}-{sw.get(k, (0, 0))[1]}" for k in out.index]
    out["regular_season_rank"] = wp_rank.reindex(out.index)
    out = out.drop(columns=["dragons", "opp_dragons", "barons", "opp_barons"]).round(3)
    return out.sort_values("regular_season_rank").reset_index()


# ---------------------------------------------------------------- main

def calibrate(df, year):
    """한 시즌의 튜닝 기준값. 시즌별 파일은 이름에 연도를 붙이고, 합칠 표는 scope 열로 구분해서 돌려준다."""
    lck = df[df["league"] == "LCK"]
    lck_t = teams_of(lck)
    tier1 = df[df["league"].isin(TIER1)]
    tier1_c = complete(tier1)
    t1_t = teams_of(tier1)
    s = {}

    totals = per_game_totals(lck_t)
    s["lck_games"] = int(lck_t["gameid"].nunique())
    s["per_game"] = {c: describe(totals[c]) for c in totals.columns}
    s["side"] = {"blue_winrate": round(lck_t[lck_t["side"] == "Blue"]["result"].mean(), 3),
                 "tier1_blue_winrate": round(t1_t[t1_t["side"] == "Blue"]["result"].mean(), 3)}
    hist = (totals["gamelength_min"] // 2 * 2).value_counts(normalize=True).sort_index()
    dump_csv(pd.DataFrame({"length_min_from": hist.index.astype(int), "share": hist.values.round(4)}),
             OUT / f"calibration/game_length_hist_lck{year}.csv")

    objectives = pd.concat([objective_winrates(lck_t).assign(scope=f"LCK {year}"),
                            objective_winrates(teams_of(tier1_c)).assign(scope=f"Tier1 {year}")])
    gc_lck, fit_lck = gold_curves(lck_t, f"LCK {year}")
    gc_t1, fit_t1 = gold_curves(teams_of(tier1_c), f"Tier1 {year}")
    s["gold_diff_fit"] = {"LCK": fit_lck, "Tier1": fit_t1}
    lane = pd.concat([lane_impact(lck, f"LCK {year}"), lane_impact(tier1_c, f"Tier1 {year}")])

    games_lck, series_lck = build_series(build_games(lck_t))
    _, series_t1 = build_series(build_games(t1_t))
    s["series"] = {"LCK": series_stats(series_lck), "Tier1": series_stats(series_t1)}
    dump_csv(series_lck.assign(game_winners=series_lck["game_winners"].map(" > ".join)),
             OUT / f"teams/series_lck{year}.csv")

    upset, coef, wp = strength_table(games_lck, series_lck, lck_t)
    dump_csv(upset, OUT / f"calibration/upset_by_strength_gap_lck{year}.csv")
    s["strength_logit_coef_per_10pct_winrate_gap"] = coef
    dump_csv(region_matrix(df), OUT / f"calibration/international_region_matrix_{year}.csv")

    cal = games_lck.groupby("patch")["date"].agg(["min", "max", "size"]).reset_index()
    cal.columns = ["patch", "first_game", "last_game", "games"]
    cal["days_used"] = (cal["last_game"] - cal["first_game"]).dt.days + 1
    dump_csv(cal, OUT / f"calibration/patch_calendar_lck{year}.csv")
    dump_csv(team_table(lck_t, series_lck, wp.rank(ascending=False, method="first")),
             OUT / f"teams/teams_lck{year}.csv")
    return s, objectives, pd.concat([gc_lck, gc_t1]), lane


def champions_and_meta(df, year):
    """한 시즌의 챔피언 통계, 패치 메타, 라인 상성, 바텀 조합."""
    lck, tier1 = df[df["league"] == "LCK"], df[df["league"].isin(TIER1)]
    cuts = tuple(np.quantile(teams_of(df)["gamelength"].dropna() / 60, [1 / 3, 2 / 3]).round(1))
    stats = {scope: champion_stats(d, f"{scope} {year}", cuts)
             for scope, d in (("LCK", lck), ("Tier1", tier1), ("All leagues", df))}
    meta = pd.concat([patch_meta(lck, f"LCK {year}"), patch_meta(tier1, f"Tier1 {year}")])
    vol = patch_volatility(meta[meta["scope"] == f"Tier1 {year}"]).assign(scope=f"Tier1 {year}")
    dump_csv(lane_matchups(df), OUT / f"champions/lane_matchups_{year}.csv")
    dump_csv(bot_duos(df), OUT / f"champions/bot_duos_{year}.csv")
    s = {"champion_length_buckets_min": {"short_lt": cuts[0], "long_gt": cuts[1]},
         "patch_volatility_tier1": {"mean_rank_corr": round(vol["rank_corr_presence"].mean(), 3),
                                    "mean_top10_kept": round(vol["top10_kept"].mean(), 2)},
         "unique_champions_picked_lck": int(players_of(lck)["champion"].nunique())}
    return s, stats, meta, vol


def main():
    frames = {y: load(y) if y in CALIB_YEARS else load(y, usecols=PLAYER_COLS) for y in YEARS}
    summary = {"sources": {f"oracles_elixir_{y}": {"rows": len(d), "date_range": [str(d["date"].min()),
                                                                                   str(d["date"].max())]}
                           for y, d in frames.items()}}

    # A. 튜닝 기준값 / B. 챔피언·메타 (시즌별)
    objectives, curves, lanes, metas, vols, champ_tables, pro = [], [], [], [], [], [], {}
    for y in CALIB_YEARS:
        s, obj, gc, lane = calibrate(frames[y], y)
        s2, stats, meta, vol = champions_and_meta(frames[y], y)
        summary[str(y)] = {**s, **s2}
        objectives.append(obj), curves.append(gc), lanes.append(lane), metas.append(meta), vols.append(vol)
        champ_tables += list(stats.values())
        pro[f"pro{y}_all_leagues"], pro[f"pro{y}_tier1"] = stats["All leagues"], stats["Tier1"]
    dump_csv(pd.concat(objectives), OUT / "calibration/objective_winrates.csv")
    dump_csv(pd.concat(curves), OUT / "calibration/gold_diff_winrate_curve.csv")
    dump_csv(pd.concat(lanes), OUT / "calibration/lane_impact_gd15.csv")
    dump_csv(pd.concat(champ_tables).round(3), OUT / "champions/champion_stats.csv")
    dump_csv(pd.concat(metas).round(3), OUT / "champions/champion_patch_meta.csv")
    dump_csv(pd.concat(vols), OUT / "champions/patch_volatility_tier1.csv")
    champs, unmatched = build_champions_json(dict(sorted(pro.items(), reverse=True)))
    dump_json(champs, OUT / "champions/champions.json")
    summary["champion_name_unmatched"] = unmatched

    # C. 선수
    part, ten = load_leaguepedia()
    master = player_master(part, ten) if part is not None else None
    if master is not None:
        dump_csv(master, OUT / "players/player_master_lck_lckcl.csv")
        if ten is not None:
            hist = ten.dropna(subset=["Player"])[["Player", "Team", "DateJoin", "DateLeave", "ContractEnd",
                                                  "NextTeam", "IsCurrent"]]
            dump_csv(hist.sort_values(["Player", "DateJoin"]), OUT / "players/team_history.csv")
        if NAMU.exists():
            dump_csv(birthdate_crosscheck(master), OUT / "players/birthdate_crosscheck.csv")
    for y in CALIB_YEARS:
        for league, tag in (("LCK", "lck"), ("LCKC", "lckcl")):
            table = attach_bio(player_table(frames[y][frames[y]["league"] == league], f"{league} {y}"),
                               master, f"games_{tag}_{y}")
            dump_csv(table, OUT / f"players/players_{tag}{y}.csv")
            dump_csv(age_profile(table), OUT / f"players/age_profile_{tag}{y}.csv")

    # D. 여러 시즌에 걸친 성장·노쇠 곡선
    seasons = player_seasons(frames)
    curve, pairs, coverage = aging_curve(seasons, birth_lookup(master))
    dump_csv(curve, OUT / "players/aging_curve_delta.csv")
    dump_csv(pairs[["player", "league", "year", "age", "position", "rating_overall", "rating_overall_next",
                    "d_rating_overall"]].round(2), OUT / "players/aging_pairs.csv")
    summary["aging"] = {"pairs": int(len(pairs)),
                        "age_coverage_by_league_year": {f"{lg} {y}": v for (lg, y), v in coverage.items()}}

    dump_json(summary, OUT / "calibration/summary.json")
    print("done:", sorted(str(f.relative_to(OUT)) for f in OUT.rglob("*.*")))


if __name__ == "__main__":
    main()
