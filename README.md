# LCK 구단 운영 시뮬레이션 (프로토타입)

LCK 구단의 단장 겸 감독이 되어 밴픽, 로스터, 운영으로 우승을 노리는 시뮬레이션 게임의 **경기 시뮬 엔진**과 **데이터 파이프라인**.
엔진의 조절값은 실제 LCK 2026 경기 통계에 맞춰 튜닝되어 있음.

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

## 빠른 시작

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
npm test && npm run typecheck
```

팀 약칭: GEN, HLE, T1, DK, KT, BRO, NS, BFX, DRX, DNS

## 저장소 구조

| 경로 | 내용 |
|---|---|
| `engine/` | 경기 시뮬 엔진 (TypeScript). 설명은 [docs/ENGINE.md](docs/ENGINE.md) |
| `scripts/` | 데이터 파이프라인 (Python, pandas)<br>`build_all.py`: 원본 → 분석 결과<br>`player_intangibles.py`: 선수 운영 기여 회귀분석<br>`export_engine_data.py`: 분석 결과 → 엔진 입력<br>`fetch_leaguepedia.py`: Leaguepedia 수집 |
| `output/` | 분석 결과: 튜닝 기준값, 챔피언·메타, 선수·팀 통계, 성장 곡선. 설명은 [docs/DATA.md](docs/DATA.md) |
| `raw/` | 원본 중 용량이 작은 것: Leaguepedia, 나무위키 대조표, Data Dragon<br>Oracle's Elixir CSV(600MB)는 넣지 않았음. 받는 법은 DATA.md 참고 |
| `docs/` | 데이터·엔진 문서 |

## 선수 능력치
- **개인 기록 능력치**: 라인전, 한타, 시야, 생존, 챔프폭. 2026 실제 기록을 같은 포지션 안 백분위로 바꾼 값.
- **챔피언 숙련도**: 실제 출전 기록 기반
- **운영 기여**: 콜·운영처럼 기록에 안 잡히는 기여
  - 2020~2026 LCK 3,465경기와 이적한 선수 85명을 이용한 회귀분석으로 추정함
  - **이적하면 선수를 따라감.** 예: Faker ↔ Clozer 맞트레이드 시 T1 -5.5%p, DNS +4.5%p
  - 자세한 내용은 [docs/ENGINE.md](docs/ENGINE.md) 5절

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
