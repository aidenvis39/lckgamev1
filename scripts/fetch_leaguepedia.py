"""Leaguepedia(lol.fandom.com) Cargo API에서 LCK / LCK CL 2025~2026 출전 선수의
생년월일, 국적, 현재 소속, 계약 만료일, 팀 이력(Tenures)을 받아 raw/leaguepedia/ 에 저장한다.

사용법: python3 -I scripts/fetch_leaguepedia.py .
Leaguepedia 콘텐츠 라이선스: CC BY-SA 3.0
"""
import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(sys.argv[1])
OUT = ROOT / "raw/leaguepedia"
API = "https://lol.fandom.com/api.php"
UA = "lck-sim-research/0.1 (personal data analysis; low request rate)"
TOURNAMENT_WHERE = " OR ".join(f"SP.OverviewPage LIKE '{p}%'" for p in
                               ("LCK/2025", "LCK/2026", "LCK CL/2025", "LCK CL/2026"))


def cargo(params, max_wait=900):
    """POST 한 번. rate limit이면 30초부터 두 배씩 기다렸다가 다시 시도한다.
    결과는 쿼리별로 raw/leaguepedia/cache/ 에 저장해서, 중간에 실패해도 다시 실행하면 이어서 받는다."""
    data = urllib.parse.urlencode({"action": "cargoquery", "format": "json", **params}).encode()
    cache = OUT / "cache" / (hashlib.sha1(data).hexdigest() + ".json")
    if cache.exists():
        return json.loads(cache.read_text())
    wait = 30
    while True:
        req = urllib.request.Request(API, data=data, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            d = json.load(r)
        if "cargoquery" in d:
            rows = [row["title"] for row in d["cargoquery"]]
            cache.parent.mkdir(parents=True, exist_ok=True)
            cache.write_text(json.dumps(rows, ensure_ascii=False))
            time.sleep(3)
            return rows
        code = d.get("error", {}).get("code")
        if code != "ratelimited" or wait > max_wait:
            raise RuntimeError(d)
        print(f"  rate limited, waiting {wait}s", flush=True)
        time.sleep(wait)
        wait *= 2


def cargo_all(params, page=500):
    rows, offset = [], 0
    while True:
        batch = cargo({**params, "limit": page, "offset": offset})
        rows += batch
        print(f"  {params['tables'][:30]}... offset={offset} got={len(batch)}", flush=True)
        if len(batch) < page:
            return rows
        offset += page


def main():
    OUT.mkdir(parents=True, exist_ok=True)

    # 1) 대회별 출전 기록 + 선수 정보 (한 번의 조인 쿼리)
    part_path = OUT / "participation.json"
    if not part_path.exists():
        rows = cargo_all({
            "tables": "ScoreboardPlayers=SP,PlayerRedirects=PR,Players=P",
            "join_on": "SP.Link=PR.AllName,PR.OverviewPage=P.OverviewPage",
            "fields": ", ".join([
                "SP.OverviewPage=Tournament", "SP.Team=Team", "SP.Role=Role", "COUNT(*)=Games",
                "P.OverviewPage=Page", "P.ID=ID", "P.NativeName=NativeName", "P.Name=Name",
                "P.Birthdate=Birthdate", "P.Country=Country", "P.Nationality=Nationality",
                "P.Residency=Residency", "P.Team=CurrentTeam", "P.Role=CurrentRole",
                "P.IsRetired=IsRetired", "P.Contract=ContractEnd",
            ]),
            "where": f"({TOURNAMENT_WHERE})",
            "group_by": "SP.OverviewPage, SP.Team, P.OverviewPage",
        })
        part_path.write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    rows = json.loads(part_path.read_text())
    pages = sorted({r["Page"] for r in rows if r.get("Page")})
    print(f"participation rows={len(rows)} players={len(pages)}")

    # 2) 팀 이력 (Tenures): 선수 60명씩 묶어서 조회
    ten_path = OUT / "tenures.json"
    if not ten_path.exists():
        tenures = []
        for i in range(0, len(pages), 60):
            names = ", ".join("'" + p.replace("'", "\\'") + "'" for p in pages[i:i + 60])
            tenures += cargo_all({
                "tables": "Tenures",
                "fields": "Player, Team, DateJoin, DateLeave, Duration, ContractEnd, NextTeam, NextIsRetired, IsCurrent",
                "where": f"Player IN ({names})",
            })
        ten_path.write_text(json.dumps(tenures, ensure_ascii=False, indent=1))
    print(f"tenures rows={len(json.loads(ten_path.read_text()))}")


if __name__ == "__main__":
    main()
