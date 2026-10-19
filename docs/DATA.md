# 데이터 파이프라인

```bash
python3 -I scripts/build_all.py .            # raw/ → output/ 전체 재생성 (약 25초)
python3 -I scripts/player_intangibles.py .   # 선수 운영 기여 회귀분석 (약 15초)
python3 -I scripts/build_world.py .          # 해외 5개 리그 선수·팀, 국제전 리그 쌍 기준값 (약 5초)
python3 -I scripts/export_engine_data.py .   # output/ → engine/data/ (엔진 입력)
```

`build_world.py`가 만드는 것:
- `players/players_<lpl|lec|lcs|lcp|cblol>2026.csv`: 리그 안 포지션 백분위 능력치(LCK 표와 같은 방식)와 마지막 정규 스플릿 소속·출전 수
- `teams/overseas_teams2026.csv`: 마지막 정규 스플릿 참가팀(LPL 12, LEC 10, LCS 8, LCP 8, CBLOL 8)과 최근 정규 스플릿 2개 세트 승률
- `calibration/international_pairs.csv`, `international_strength.json`
  - 2024~2026 국제전 리그 쌍 전적과 리그 강도(브래들리-테리, LCK = 0)
  - 연도별 리그 이름을 맞춤: 2025 LTA N → LCS, LTA S → CBLOL, 2024 PCS·VCS·LJL → LCP
  - 예전 `international_region_matrix_*.csv`는 이 매핑이 없어서 엔진에선 안 씀

`export_engine_data.py` 규칙:
- **소속**: 2026에 리그를 옮긴 선수는 마지막으로 뛴 리그 팀에만 둔다 (예: Loki는 BRO 후보 → C9 미드).
- **주전**: LCK는 2026 출전 수, 해외는 마지막 정규 스플릿 출전 수가 가장 많은 선수.
- **표본 부족(15경기 미만)**: 가진 경기로 리그·포지션 백분위를 내고, 표본이 적은 만큼 중앙값(69.5) 쪽으로 당긴다. 예전엔 50으로 고정했음. `lowSample`로 표시.
- **해외 선수 운영 기여**: 추정치가 없어 0, `intangibleKnown: false`.
- `engine/data/world.json`: 해외 팀별 실제 승률, 국제전 리그 쌍 기준값.

`raw/oe_drive/`(Oracle's Elixir CSV, 약 600MB)는 용량 때문에 저장소에 넣지 않았다.
다시 만들려면 [Oracle's Elixir 구글 드라이브 폴더](https://drive.google.com/drive/folders/1gLSw0RLjBbtaNy0dgnGQDAZOHIgCe-HH)에서
`2020~2026_LoL_esports_match_data_from_OraclesElixir.csv` 를 받아 `raw/oe_drive/` 에 넣는다.
다운로드 한도 초과가 뜨면 구글 로그인 후 "사본 만들기"로 받는다.

## 원본 데이터 (`raw/`)

| 원본 | 범위 | 받은 경로 |
|---|---|---|
| **Oracle's Elixir** `oe_drive/` | 2020~2026 전 리그 경기 데이터. 2026은 10월 18일 경기까지 | 공식 구글 드라이브 폴더 → 사용자 드라이브 사본 → 공유 링크 |
| **Leaguepedia** `leaguepedia/` | LCK·LCK CL 2025~2026 출전 선수 155명의 신상(본명, 생년월일, 국적, 현 소속, 계약 만료일) + 팀 이력 1,214건 | 사용자가 브라우저에서 `Special:CargoExport`로 받음 (링크는 `leaguepedia/download_links.md`) |
| **나무위키** `namuwiki/` | LCK 2025 선수 67명의 생년월일 | 웹 검색(namu.wiki 한정)으로 수집. 지금은 Leaguepedia 값을 검증하는 용도로만 씀 |
| **Riot Data Dragon** `ddragon/` | 챔피언 173개, 16.20.1 (`ko_KR`, `en_US` champion.json만 보관) | 공식 CDN과 같은 버전 |

- 처음에 쓴 2025 GitHub 사본은 공식 파일과 대조했음. LCK 데이터는 6,660행이 전부 같았고, 이제 공식 파일로 바꿨음.
- 나무위키 생년월일 67건은 Leaguepedia와 **전부 일치**했음. 64건은 날짜까지 일치하고, 3건은 연도만 있어서 연도가 일치함.
- 이 클라우드 환경에서 Leaguepedia API(`scripts/fetch_leaguepedia.py`)를 쓰면 요청 제한에 걸림. 공유 IP라서 그런 것으로 보임. 갱신할 때는 `download_links.md`의 링크로 직접 받는 게 확실함.
- **출처 표기와 라이선스**
  - Oracle's Elixir: Tim Sevenhuysen, OraclesElixir.com (무료, 출처 표기)
  - Leaguepedia: CC BY-SA 3.0
  - 나무위키: CC BY-NC-SA 2.0 KR (비영리)
  - Data Dragon: Riot Games
  - 실존 선수의 생년월일과 계약 정보는 **분석용으로만** 쓸 것. 상업 게임에 그대로 넣지 말 것.

## output/ 구성

### calibration/ 튜닝 기준값 (2025, 2026 시즌별)
| 파일 | 내용 |
|---|---|
| `summary.json` | 시즌별 경기당 분포, 진영 승률, 골드차 로지스틱 계수, 시리즈 통계, 패치 변동성, 나이 데이터 커버리지 |
| `gold_diff_winrate_curve.csv` | 10/15/20/25분 골드차별 승률 |
| `objective_winrates.csv` | 오브젝트를 가져간 팀의 승률, 블루 진영·선픽 승률 |
| `lane_impact_gd15.csv` | 라인별 15분 골드차가 승패에 주는 영향 |
| `upset_by_strength_gap_lck{연도}.csv` | 전력 차이별 강팀 승률 |
| `international_region_matrix_{연도}.csv` | 국제대회 지역 대 지역 승률 |
| `game_length_hist_lck{연도}.csv`, `patch_calendar_lck{연도}.csv` | 경기 시간 분포, 패치 사용 기간 |

### champions/
| 파일 | 내용 |
|---|---|
| `champions.json` | Data Dragon 정보 + 프로 통계 (`pro2026_*`, `pro2025_*`) |
| `champion_stats.csv` | 범위별(LCK / Tier1 / 전체 × 2025·2026) 픽·밴·승률, 포지션, 시간대별 승률(`late_bias`) |
| `champion_patch_meta.csv`, `patch_volatility_tier1.csv` | 패치별 메타, 연속 패치 간 변화량 |
| `lane_matchups_{연도}.csv`, `bot_duos_{연도}.csv` | 라인 상성, 원딜+서폿 조합 |

### players/
| 파일 | 내용 |
|---|---|
| `players_lck{2025,2026}.csv`, `players_lckcl{2025,2026}.csv` | 선수별 스탯 + 게임 능력치 변환 예시(`rating_*`) + 본명·국적·생년월일·나이·경력 연차·현 소속·계약 만료일. **나이 커버리지 100%** |
| `player_master_lck_lckcl.csv` | 2025~2026 출전 선수 155명 명단: 신상, 리그·연도별 출전 경기와 팀, 커리어 시작일, 거친 팀 수 |
| `team_history.csv` | 선수별 팀 이력 (입단일, 이탈일, 계약 만료일, 다음 팀) |
| `birthdate_crosscheck.csv` | 나무위키 ↔ Leaguepedia 생년월일 대조 결과 |
| `age_profile_*.csv` | 시즌별 나이대 평균 능력치 (횡단면) |
| `aging_curve_delta.csv`, `aging_pairs.csv` | **2020~2026 여러 시즌에 걸친 성장·노쇠 곡선** (아래 설명) |
| `player_intangibles.csv`, `intangibles_summary.json` | 선수 운영 기여(개인 기록 밖의 기여)와 표준오차, 회귀 요약. `scripts/player_intangibles.py` 결과. 설명은 [ENGINE.md](ENGINE.md) 5절 |

`rating_*`는 같은 리그·시즌·포지션 안에서의 백분위를 40~99점으로 바꾼 값임. 15경기 미만 선수는 계산에서 빠짐.
- 라인전 = CSD/GD/XPD@15
- 한타 = DPM, 딜 비중, KP
- 시야 = VSPM, WCPM
- 생존 = 경기당 데스
- 챔프폭 = 플레이한 챔프 수

### teams/
`teams_lck{연도}.csv`(팀 성적과 스타일 지표), `series_lck{연도}.csv`(시리즈별 세트 결과), `team_season_effects.csv`(운영 기여 회귀의 팀 시즌 효과. 교차검증이 거의 0을 골라서 값은 모두 0에 가까움)

## 핵심 숫자: LCK 2025 → 2026

| 지표 | 2025 | 2026 |
|---|---|---|
| 경기 수 | 555 | 502 (10/18까지) |
| 평균 경기 시간 | 32.3분 | 32.2분 |
| 경기당 킬 / 용 / 바론 | 28.8 / 4.4 / 1.05 | 29.4 / 4.5 / 1.31 |
| **블루 진영 승률** | 51.0% | **56.4%** |
| 선픽 팀 승률 | 51.0% (항상 블루 = 선픽) | 48.6% (블루와 선픽이 같은 경기는 26%뿐) |
| 15분 +1k / +2k / +3k → 승률 | 68% / 81% / 90% | 63% / 74% / 83% |
| 15분 3k 이상 뒤진 팀의 역전률 | 3.8% | **9.9%** |
| 라인 영향력 (원딜/미드/정글/탑/서폿) | .30/.19/.26/.19/.07 | .39/.25/.15/.10/.11 |
| 첫 용 가져간 팀 승률 | 55.5% | 64.1% |
| BO3 1세트 승리 팀의 시리즈 승률 | 81.7% | 83.7% |
| BO5 역스윕 (0:2 → 3:2) | 29시리즈 중 1번 | 34시리즈 중 4번 |
| 국제대회 LCK 승률 | 74.7% | 68.2% |
| 아타칸 | 경기당 1회 | 없음 (2026 데이터에 기록 없음) |

2026은 2025보다 **역전이 쉽고, 진영 선택의 비중이 크고, 원딜·미드의 영향력이 커진** 메타임.

## 성장·노쇠 곡선 (`aging_curve_delta.csv`)

**계산 방법(델타 방식)**: 같은 리그에서 두 시즌 연속 15경기 이상 뛴 선수 317쌍을 모음. 각 쌍에서 다음 시즌 종합 능력치가 얼마나 변했는지 나이별로 평균 낸 뒤 누적함.

| 나이 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 다음 시즌 변화 | +8.0 | +5.4 | +5.8 | +0.5 | +1.7 | +0.1 | -1.6 | -2.8 | -0.7 | -4.1 | -1.7 |
| 표본(쌍) | 6 | 22 | 34 | 48 | 56 | 48 | 38 | 20 | 19 | 11 | 8 |

- 18세까지 급성장하고, 19~21세에 정점, 22세부터 서서히 하락하는 모양
- 능력치별로 보면 **라인전이 가장 먼저 꺾임**: 21세부터 마이너스로 돌아서고, 23세(-5.0)와 25세(-11.0)에 크게 하락함. 챔프폭은 24세 이후 줄어듦.
- **한계**
  - 생년월일이 2025~2026 출전 선수 것만 있음. 그래서 2020~2024 시즌의 나이 커버리지가 38~79%뿐임.
  - 2025년 전에 은퇴한 선수(대개 기량이 떨어져서 나간 선수)가 빠져 있음. 그래서 고연령 구간의 하락이 실제보다 **덜 가파르게** 나왔을 가능성이 큼.
  - 이걸 보완하려면 `download_links.md`의 "2020~2024" 링크 두 개를 받아서 `raw/leaguepedia/`에 넣고 다시 실행하면 됨.

## 그 밖에

- 계약 만료일이 있는 129명 중 **94명이 2026-11-16 만료**임. 다가오는 스토브리그에 FA가 대량으로 풀린다는 뜻이라 이적시장 시뮬 설계에 참고할 만함.
- 챔프 시간대별 승률에는 착시가 섞여 있음. 초반에 강한 챔프는 이기는 판이 원래 빨리 끝나서, 짧은 경기 승률이 실제보다 높게 나옴.

## 못 구한 데이터

| 데이터 | 이유 | 구할 곳 |
|---|---|---|
| 연봉, 바이아웃 | 비공개 | 기사, LCK 샐러리 규정 공지 |
| 솔랭 기반 챔프 승률·상성 | 접속 차단 | lolalytics, u.gg, op.gg, Riot API |
| 패치노트 (버프/너프 내용) | 아직 시도 안 함 | 공식 패치노트 |
| 2020~2024에만 뛴 선수의 생년월일 | 아직 안 받음 | `download_links.md`의 2020~2024 링크 |
| 스크림, 팀 내부 데이터 | 비공개 | 없음 |
