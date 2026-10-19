# LCK 구단 운영 시뮬레이션 (프로토타입)

LCK 구단의 단장 겸 감독이 되어 밴픽, 로스터, 운영으로 우승을 노리는 시뮬레이션 게임.
**웹 게임**, **경기 시뮬 엔진**, **데이터 파이프라인**으로 되어 있음.
엔진의 조절값은 실제 LCK 2026 경기 통계에 맞춰 튜닝되어 있음.

## 웹 게임

팀을 고르고, 내 경기는 직접 밴픽하고, 중계를 보며 여러 시즌을 이어 간다.
- 한 해: LCK 정규시즌 → Road to MSI → MSI → LCK 플레이오프 → 월즈. 해외 5개 리그(LPL·LEC·LCS·LCP·CBLOL, 46팀)도 뒤에서 같이 진행되어 대표가 매번 새로 정해짐. MSI 성적에 따라 월즈 출전권이 지역별로 바뀜(2025~2026 실제 규칙).
- 시즌 중 여러 번 선수가 성장하고(MSI·월즈에 나가면 더), 시즌이 끝나면 나이를 먹고 은퇴함.
- 스토브리그: 구단주 평가 → 재계약 → FA 4라운드·이적료 영입·트레이드 → 등록 → 다음 시즌. 연봉 상한과 이적 예산 안에서 움직임. 2군(LCK CL)과 가상 신인도 있음.
- 이적 실험실(같은 포지션 두 선수 맞트레이드 전후 비교)도 있음.

```bash
cd web
npm install
npm run dev        # http://localhost:5173
```

Cloudflare Workers에 정적 사이트로 올려 친구들과 함께 쓸 수 있음 (서버 비용 없음).
배포 방법과 친구만 들어오게 막는 법은 [docs/WEB.md](docs/WEB.md) 참고.

## 엔진 명령줄 도구

```
$ npm run match -- GEN T1 --seed 7
━━ 1세트 ━━ 블루 GEN vs 레드 T1
  밴   GEN: 럼블, 아칼리, 리 신, 카르마, 라칸
       T1: 바이, 오리아나, 니코, 라이즈, 신드라
  탑   Kiin(나르) 3/7/5               vs  Doran(사이온) 0/4/8
  미드 Chovy(아리) 4/2/8              vs  Faker(카시오페아) 4/1/6
  ...
  03:28 [T1] 퍼스트 블러드! Peyz(애쉬) → Duro(세라핀)
  15:00 [GEN] 15분 골드 +2,907 (탑 +1,666 / 정글 +846 / 미드 +931 / 원딜 -290 / 서폿 -546)
  17:58 [T1] 교전 승리 3:0 → 마법공학 용 (골드 차이 -2,315)
  23:54 [T1] 교전 승리 1:3 → 대지 용 (골드 차이 -478)
  29:45 [GEN] 교전 승리 3:3 → 바론 (골드 차이 +3,388)
  33:36 [GEN] 넥서스 파괴 — GEN 승리
```

Node 22.18 이상이 필요함.

```bash
cd engine
npm install                         # 타입체크용 typescript만 설치 (런타임 의존성 없음)
npm run match -- GEN T1 --bo 5      # 한 시리즈 + 밴픽·중계·KDA
npm run season -- --seed 3          # 정규시즌 1회 (LCK 2026 방식: 1~2라운드 + 레전드/라이즈 그룹)
npm run season -- --runs 500        # 500시즌 평균: 팀별 1위·6위 안 확률
npm run calibrate                   # 시뮬 vs 실제 LCK 2026 통계 비교
npm run tune                        # 조절값 자동 튜닝 → data/params.json
npm run transfer -- faker clozer    # 같은 포지션 두 선수 맞트레이드 전후 비교 (시즌 300회)
npm run year -- --runs 100          # LCK·MSI·월즈 한 해 전체 100회: 대회별 우승 팀·리그 분포
npm run career -- --years 10        # AI끼리 10년 커리어: 리그 실력 유지, 나이별 성장, 은퇴·FA·신인, 월즈 우승 지역
npm run calibrate -- --intl         # 해외 리그 팀 승률 + 국제전 리그 쌍 승률 비교
npm run tune -- --intl              # 해외 팀워크 + 리그 보정만 다시 맞춤
npm test && npm run typecheck
```

팀 약칭: GEN, HLE, T1, DK, KT, BRO, NS, BFX, DRX, DNS (해외 팀은 `npm run match` 도움말에 전부 나옴. 예: `npm run match -- GEN BLG --bo 5`)

## 저장소 구조

| 경로 | 내용 |
|---|---|
| `web/` | 웹 게임 (Vite + React). 엔진을 브라우저에서 그대로 돌림. 설명은 [docs/WEB.md](docs/WEB.md) |
| `engine/` | 경기 시뮬 엔진 (TypeScript). 설명은 [docs/ENGINE.md](docs/ENGINE.md) |
| `scripts/` | 데이터 파이프라인 (Python, pandas)<br>`build_all.py`: 원본 → 분석 결과<br>`build_world.py`: 해외 5개 리그와 국제전 기준값<br>`player_intangibles.py`: 선수 운영 기여 회귀분석<br>`export_engine_data.py`: 분석 결과 → 엔진 입력<br>`fetch_leaguepedia.py`: Leaguepedia 수집 |
| `output/` | 분석 결과: 튜닝 기준값, 챔피언·메타, 선수·팀 통계, 성장 곡선. 설명은 [docs/DATA.md](docs/DATA.md) |
| `raw/` | 원본 중 용량이 작은 것: Leaguepedia, 나무위키 대조표, Data Dragon<br>Oracle's Elixir CSV(600MB)는 넣지 않았음. 받는 법은 DATA.md 참고 |
| `docs/` | 데이터·엔진·웹 문서 |

## 선수 능력치
- **개인 기록 능력치**: 라인전, 한타, 시야, 생존, 챔프폭. 2026 실제 기록을 같은 포지션 안 백분위로 바꾼 값.
- **챔피언 숙련도**: 실제 출전 기록 기반
- **운영 기여**: 콜·운영처럼 기록에 안 잡히는 기여
  - 2020~2026 LCK 3,465경기와 이적한 선수 85명을 이용한 회귀분석으로 추정함
  - **이적하면 선수를 따라감.** 예: Faker ↔ Clozer 맞트레이드 시 T1 -5.5%p, DNS +4.5%p
  - 자세한 내용은 [docs/ENGINE.md](docs/ENGINE.md) 5절
- **해외 선수**: 리그 안 백분위에 리그 보정을 더해 LCK 기준으로 맞춤. 보정값은 2024~2026 국제전 541경기에 맞췄음 ([docs/ENGINE.md](docs/ENGINE.md) 8절)

## 캘리브레이션 요약 (튜닝에 쓰지 않은 시드, 50시즌·15,993경기)

| 지표 | 시뮬 | 실제 LCK 2026 |
|---|---|---|
| 평균 경기 시간 | 32.3분 | 32.2분 |
| 경기당 킬 | 29.0 | 29.4 |
| 블루 진영 승률 | 54.4% | 56.4% |
| 15분 골드 1k당 승리 로짓 | 0.522 | 0.534 |
| 원딜 라인 영향력 | 0.37 | 0.39 |
| 팀별 정규시즌 승률 오차 | 1.6%p | – |
| 강팀 승률 (승률 차이 20~30%p / 30~45%p) | 81.9% / 92.4% | 87.9% / 92.3% (2025+26 합산 81.4% / 89.5%) |

- 비교한 27개 지표 전부 허용 오차의 2배 안에 들어옴.
- 시즌 500회를 돌리면 상위 5팀이 실제 2026 레전드 그룹(GEN·HLE·T1·DK·KT)과 같게 나옴.
- 전체 표는 [docs/ENGINE.md](docs/ENGINE.md)에 있음.

## 데이터 출처와 라이선스
- 경기 데이터: Oracle's Elixir (Tim Sevenhuysen, OraclesElixir.com)
- 선수 정보: Leaguepedia (CC BY-SA 3.0)
- 생년월일 대조: 나무위키 (CC BY-NC-SA 2.0 KR)
- 챔피언 정보: Riot Games Data Dragon
- 실존 선수·팀·챔피언 이름과 개인정보가 들어 있으니 **저장소는 비공개로 유지할 것.** 상업 출시 땐 가상 데이터로 바꿀 것.
