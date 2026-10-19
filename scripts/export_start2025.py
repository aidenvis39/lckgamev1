"""커리어 시작 상태: 2025 시즌이 끝난 스토브리그 (engine/data/start2025.json).

게임은 2025 시즌이 끝나고 2026 시즌이 시작되기 전 스토브리그에서 시작한다.
능력치·챔피언 풀은 지금의 2026 값을 그대로 쓰고(첫 시즌 캘리브레이션 유지), 소속과 계약만 2025 시즌 끝으로 되돌린다.

- 2025 끝 소속: 7개 리그(LCK, LCK CL, LPL, LEC, LTA N→LCS, LTA S→CBLOL, LCP) 2025-11-10 전 경기 중 마지막 소속.
  KeSPA컵 같은 시즌 뒤 이벤트는 이미 2026 로스터로 뛰어서 뺀다. 주전 = 마지막 스플릿에 그 팀·포지션으로 가장 많이 뛴 선수.
- 실제 2026 행선지: players.json·academy.json의 팀 (2026 마지막 소속).
- 계약: 같은 구단에 남은 선수는 지금 계약 만료, 옮긴 선수는 2025에 만료(= 이번 스토브리그 FA).
  2025 기록이 없는 선수(신인·하부 리그에서 온 선수)는 처음부터 2026 팀에 있다.
- 2025에만 뛴 선수: 2025 능력치(리그 안 백분위)로 넣는다. 2026 OE 기록이 없거나 Leaguepedia 은퇴면 은퇴.
- 2020~2025 실제 우승(LCK 스플릿, MSI, 월즈)과 통산 경기 수, 팀별 2025 정규 승률, 2025 우승팀.

사용법: python3 -I scripts/export_start2025.py .
"""
import json
import sys
from collections import Counter
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
import build_all as ba  # noqa: E402  (ROOT는 sys.argv[1]에서 읽는다)
import export_engine_data as ee  # noqa: E402

ROOT = ee.ROOT
YEAR = 2025
CUTOFF = "2025-11-10"
POSITIONS = ee.POSITIONS
LEAGUE_OF = {"LCK": "LCK", "LCKC": "LCK", "LPL": "LPL", "LEC": "LEC", "LTA N": "LCS", "LTA S": "CBLOL", "LCP": "LCP"}
LAST_SPLIT = {"LCK": "Rounds 3-5", "LCKC": "Rounds 3-5", "LPL": "Split 3", "LEC": "Summer", "LTA N": "Split 3",
              "LTA S": "Split 3", "LCP": "Split 3"}
REGULAR_SPLITS = {"LPL": ["Split 2", "Split 3"], "LEC": ["Spring", "Summer"], "LTA N": ["Split 2", "Split 3"],
                  "LTA S": ["Split 2", "Split 3"], "LCP": ["Split 2", "Split 3"]}
# 2026에 이름을 바꿔 리그 자리를 이은 팀 (로스터 겹침으로 확인)
SLOT_SUCCESSOR = {"Team BDS": "SHFT", "MGN Vikings Esports": "MVK"}
# 2026 리그에 자리가 없는 2025 팀: 선수는 FA로 시작
DROPPED = {"FunPlus Phoenix", "Ultra Prime", "100 Thieves", "Isurus", "Chiefs Esports Club", "PSG Talon"}
LCK_SPLIT_KO = {"Spring": "스프링", "Summer": "서머"}


LAST_TEAMS: set = set()  # 각 리그 마지막 스플릿 참가팀 (domestic_2025에서 채움)


def team_of(name):
    """2025 팀 이름 → (엔진 팀 id, 2군 여부). 리그에서 빠진 팀(마지막 스플릿 전에 빠진 팀 포함)은 (None, False)."""
    if name in ee.TEAM_SHORT:
        return ee.TEAM_SHORT[name], False
    if name in ee.ACADEMY_PARENT:
        return ee.ACADEMY_PARENT[name], True
    if name in ee.OVERSEAS_SHORT:
        return ee.OVERSEAS_SHORT[name], False
    if name in SLOT_SUCCESSOR:
        return SLOT_SUCCESSOR[name], False
    if name in DROPPED or name not in LAST_TEAMS:
        return None, False
    raise SystemExit(f"모르는 2025 팀 이름: {name} (SLOT_SUCCESSOR 또는 DROPPED에 넣어야 함)")


def domestic_2025():
    df = ba.load(YEAR)
    df = df[df["league"].isin(LEAGUE_OF) & (df["date"] < CUTOFF)]
    for lg, split in LAST_SPLIT.items():
        LAST_TEAMS.update(df[(df["league"] == lg) & (df["split"] == split)]["teamname"].unique())
    return df


def end_positions(dom):
    """선수별 2025 끝 소속: 국내 리그 마지막 경기의 팀. 같은 구단 1군·2군을 둘 다 뛰었으면 1군."""
    p = ba.players_of(dom).sort_values("date")
    last = p.groupby("playerid").agg(teamname=("teamname", "last"), league=("league", "last"),
                                     position=("position", lambda s: s.mode()[0]), player=("playername", "last"))
    out = {}
    for pid, r in last.iterrows():
        team, academy = team_of(r["teamname"])
        if academy:  # 같은 구단 1군에서도 뛰었으면 1군 소속으로 본다
            mine = p[(p["playerid"] == pid) & (p["league"] == "LCK")]
            if len(mine) and team_of(mine["teamname"].iloc[-1])[0] == team:
                academy = False
        out[pid] = {"team": team, "academy": academy, "league": LEAGUE_OF[r["league"]], "oeLeague": r["league"],
                    "teamname": r["teamname"], "position": r["position"], "player": r["player"]}
    # 주전: 마지막 스플릿에 그 팀·포지션으로 가장 많이 뛴 선수
    last_split = p[p.apply(lambda r: r["split"] == LAST_SPLIT[r["league"]], axis=1)]
    games = last_split.groupby(["teamname", "position", "playerid"]).size().reset_index(name="n")
    top = games.sort_values("n", ascending=False).drop_duplicates(["teamname", "position"])
    starters = set(zip(top["teamname"], top["playerid"]))
    for pid, d in out.items():
        d["starter"] = (d["teamname"], pid) in starters and not d["academy"]
    return out


def ratings_2025(dom, pids):
    """2025에만 뛴 선수의 능력치: LCK·CL은 이미 만든 2025 표, 해외는 같은 방식(리그 안 포지션 백분위)으로 새로."""
    rows = {}
    for lg, path in (("LCK", "players_lck2025.csv"), ("LCKC", "players_lckcl2025.csv")):
        t = ee.fill_low_sample(pd.read_csv(ee.OUT / f"players/{path}"))
        for _, r in t.iterrows():
            if r["playerid"] in pids and r["playerid"] not in rows:
                rows[r["playerid"]] = (r, "LCKCL" if lg == "LCKC" else "LCK")
    for oe_lg in ("LPL", "LEC", "LTA N", "LTA S", "LCP"):
        t = ee.fill_low_sample(ba.player_table(dom[dom["league"] == oe_lg], f"{oe_lg} {YEAR}"))
        for _, r in t.iterrows():
            if r["playerid"] in pids and r["playerid"] not in rows:
                rows[r["playerid"]] = (r, LEAGUE_OF[oe_lg])
    return rows


def winrates_2025(dom, targets):
    """팀별 2025 정규 승률 (명성 초기값). LCK는 targets 2025, 해외는 마지막 정규 스플릿 2개."""
    out = dict(targets["2025"]["team_regular_winrate"])
    for oe_lg, splits in REGULAR_SPLITS.items():
        reg = ba.teams_of(dom[(dom["league"] == oe_lg) & dom["split"].isin(splits) & (dom["playoffs"] == 0)])
        for name, wr in reg.groupby("teamname")["result"].mean().items():
            team, _ = team_of(name)
            if team:
                out[team] = round(float(wr), 4)
    return out


def titles_2020_2025():
    """실제 우승: (playerid → ["2024 월즈", ...]), 2025 우승팀. 대회 마지막 경기 승자가 우승."""
    titles, champs = {}, {}
    for year in range(2020, YEAR + 1):
        df = ba.load(year, usecols=["gameid", "league", "split", "playoffs", "date", "teamname", "position", "playerid", "result"])
        events = []
        lck = df[(df["league"] == "LCK") & (df["playoffs"] == 1)]
        for split, g in lck.groupby("split"):
            if split in LCK_SPLIT_KO:
                events.append((f"{year} LCK {LCK_SPLIT_KO[split]}", "LCK", g))
            elif year == YEAR and split == LAST_SPLIT["LCK"]:
                events.append((f"{year} LCK", "LCK", g))
        for lg, label in (("MSI", "MSI"), ("WLDs", "월즈")):
            g = df[df["league"] == lg]
            if len(g):
                events.append((f"{year} {label}", lg, g))
        for label, kind, g in events:
            teams = ba.teams_of(g).sort_values("date")
            final = teams[teams["gameid"] == teams["gameid"].iloc[-1]]
            winner = final[final["result"] == 1]["teamname"].iloc[0]
            for pid in ba.players_of(g)[lambda x: x["teamname"] == winner]["playerid"].dropna().unique():
                titles.setdefault(pid, []).append(label)
            if year == YEAR:
                champs[{"LCK": "LCK", "MSI": "MSI", "WLDs": "WORLDS"}[kind]] = winner
    return titles, champs


def career_games():
    n = Counter()
    for year in range(2020, YEAR + 1):
        df = ba.load(year, usecols=["date", "playerid", "position"])
        n.update(df[df["position"].isin(POSITIONS)]["playerid"].dropna())
    return n


def main():
    by_name, _ = ee.champion_ids()
    players, teams, academy, oe_ids = ee.export_players(by_name)
    targets = json.loads((ee.ENGINE / "targets.json").read_text())
    dom = domestic_2025()
    end = end_positions(dom)
    seen2026 = set(ba.load(YEAR + 1, usecols=["date", "playerid"])["playerid"].dropna())
    titles, champs = titles_2020_2025()
    games = career_games()
    part = json.loads((ROOT / "raw/leaguepedia/participation.json").read_text())
    retired_lp = {r["ID"].lower() for r in part if r.get("IsRetired") in (1, "1", True) and r.get("ID")}

    team_ids = {t["id"] for t in teams}
    starter_of = {t["id"]: set(t["starters"].values()) for t in teams}
    entries, report = {}, Counter()
    for p, is_acad in [(x, False) for x in players] + [(x, True) for x in academy]:
        pid = oe_ids[p["id"]]
        dest = p["team"]
        e = end.get(pid)
        entry = {
            "dest": dest, "destAcademy": is_acad, "destStarter": (not is_acad) and p["id"] in starter_of[dest],
            "destYears": None if p["contractEnd"] is None else max(1, min(4, p["contractEnd"] - YEAR)),
            "retire": False, "titles": titles.get(pid, []), "careerGames": int(games.get(pid, 0)),
        }
        if e is None:  # 2025 국내 기록 없음: 신인·하부 리그 출신. 처음부터 2026 팀에 있다
            entry.update(team=dest, academy=is_acad, starter=entry["destStarter"], contractEnd=p["contractEnd"])
            report["debut"] += 1
        elif e["team"] == dest:  # 같은 구단 (1군 ↔ 2군 이동은 시작 상태에 바로 반영)
            entry.update(team=dest, academy=is_acad, starter=e["starter"] and not is_acad, contractEnd=p["contractEnd"])
            report["stay" if e["academy"] == is_acad else "internal"] += 1
        else:  # 옮김: 2025 팀에서 계약이 끝나 FA가 되고, 실제 2026 팀과 사전 합의
            entry.update(team=e["team"], academy=e["academy"], starter=e["starter"], contractEnd=YEAR)
            report["move" if e["team"] else "move-from-dropped"] += 1
        entries[p["id"]] = entry

    # 2025에만 뛴 선수 (2026 세계에 없음)
    used = set(entries)
    world_pids = set(oe_ids.values())
    only25 = {pid: e for pid, e in end.items() if pid not in world_pids and e["team"]}
    rated = ratings_2025(dom, set(only25))
    extra = []
    for pid, e in sorted(only25.items(), key=lambda kv: kv[1]["player"].lower()):
        if pid not in rated:
            report["only25-unrated"] += 1
            continue
        r, rating_league = rated[pid]
        eid = e["player"].lower()
        if eid in used:
            eid = f"{eid}-{e['team'].lower()}"
        used.add(eid)
        retire = pid not in seen2026 or e["player"].lower() in retired_lp
        report["only25-retire" if retire else "only25-fa"] += 1
        birth = r.get("birth_date") if isinstance(r.get("birth_date"), str) else None
        extra.append({
            "id": eid, "name": e["player"], "team": e["team"], "position": e["position"],
            "age": ee.age_of(birth), "birthDate": birth[:10] if birth else None,
            "nationality": r.get("Nationality") if isinstance(r.get("Nationality"), str) else None,
            "contractEnd": YEAR, "games2026": 0, "starter": e["starter"], "ratingLeague": rating_league,
            "lowSample": bool(r["low_sample"]),
            "ratings": {v: float(r[k]) for k, v in ee.RATINGS.items()},
            "intangible": 0.0, "intangibleSe": 0.0, "intangibleKnown": False, "champions": {},
            "academy": e["academy"], "dest": None, "destAcademy": False, "destStarter": False, "destYears": None,
            "retire": retire, "titles": titles.get(pid, []), "careerGames": int(games.get(pid, 0)),
            "oe": pid,
        })
    # 운영 기여·챔피언 풀은 2026 세계 선수와 같은 원본에서
    intang = pd.read_csv(ee.OUT / "players/player_intangibles.csv").drop_duplicates("playerid").set_index("playerid")
    pools = ee.champion_pools(by_name)
    for x in extra:
        pid = x.pop("oe")
        if pid in intang.index:
            x.update(intangible=float(intang.at[pid, "intangible"]), intangibleSe=float(intang.at[pid, "intangible_se"]),
                     intangibleKnown=True)
        x["champions"] = dict(sorted(pools.get(pid, {}).items(), key=lambda kv: -kv[1]))

    # 2025 끝 로스터
    roster = {t: {"starters": {pos: "" for pos in POSITIONS}, "bench": [], "academy": []} for t in team_ids}
    all_players = {p["id"]: p for p in players + academy}
    placed = [(pid, e, all_players[pid]["position"]) for pid, e in entries.items()] + [(x["id"], x, x["position"]) for x in extra]
    for pid, e, pos in placed:
        if not e["team"]:
            continue
        r = roster[e["team"]]
        if e["academy"]:
            r["academy"].append(pid)
        elif e["starter"] and not r["starters"][pos]:
            r["starters"][pos] = pid
        else:
            r["bench"].append(pid)
    for t, r in roster.items():  # 주전이 빈 포지션은 같은 포지션 후보 중 2025 경기가 많은 선수로
        for pos in POSITIONS:
            if r["starters"][pos]:
                continue
            cands = [pid for pid in r["bench"] if (all_players.get(pid) or next(x for x in extra if x["id"] == pid))["position"] == pos]
            if cands:
                r["starters"][pos] = cands[0]
                r["bench"].remove(cands[0])
    wr = winrates_2025(dom, targets)
    for t in roster:
        roster[t]["winrate2025"] = wr.get(t)

    to_id = {**ee.TEAM_SHORT}
    history = {"season": YEAR, "champions": {k: to_id.get(v, v) for k, v in champs.items()}, "places": {}, "moves": []}

    # 검사
    for pid, e in entries.items():
        assert e["dest"] == all_players[pid]["team"], pid
        assert e["team"] is None or e["team"] in team_ids, (pid, e["team"])
    ids = [x["id"] for x in extra] + list(entries)
    assert len(ids) == len(set(ids)), "중복 id"
    real_main = Counter(p["team"] for p in players)
    assert max(real_main.values()) <= 10, real_main.most_common(3)
    empty = sorted(f"{t}:{pos}" for t, r in roster.items() for pos in POSITIONS if not r["starters"][pos])

    out = {"season": YEAR, "entries": entries, "extra": extra, "teams": roster, "history": history}
    ee.dump(ee.clean(out), "start2025.json")
    print(dict(report))
    print("2025 우승:", history["champions"])
    print(f"2025 끝 빈 주전 자리 {len(empty)}: {' '.join(empty)}")
    print("타이틀 보유:", sum(1 for e in list(entries.values()) + extra if e["titles"]))
    big = {t: len([*filter(None, r['starters'].values())]) + len(r["bench"]) for t, r in roster.items()}
    print("2025 끝 1군 10명 초과:", {t: n for t, n in big.items() if n > 10})


if __name__ == "__main__":
    main()
