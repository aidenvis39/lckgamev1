# 웹 버전

Vite + React 18 + TypeScript. 서버 없이 브라우저에서 엔진을 그대로 돌린다 (`web/`이 `../engine/src`를 직접 가져다 씀).
저장은 브라우저 localStorage, 이적 실험실의 시즌 100회 시뮬은 Web Worker에서 돈다.
Cloudflare Workers에 정적 사이트로 올린다.

## 로컬 실행

```bash
cd web
npm install
npm run dev        # http://localhost:5173
npm run build      # 타입체크 + dist/ 생성
npm run preview    # dist/를 로컬에서 확인
```

엔진 데이터(`engine/data/*.json`)나 조절값(`params.json`)이 바뀌면 다시 빌드만 하면 웹에 반영된다.

## 화면

| 화면 | 내용 |
|---|---|
| 팀 선택 | 10개 구단 중 하나. 주전 5명, 개인 능력 등급, 운영 강약, 실제 2026 정규시즌 세트 승률 표시 |
| 홈 | 다음 경기, 상대 전력 비교, 순위 요약, 같은 날 다른 경기, 최근 결과 |
| 밴픽 | 프로 순서 20단계, 피어리스. 추천(내 픽 가치 / 밴 차례엔 상대가 노릴 챔피언), 포지션 필터·검색·정렬, 남은 밴픽 AI에게 맡기기 |
| 중계 | 시간 순서 이벤트, 킬·포탑·용·바론 스코어보드, 골드 차이 그래프, 1/3/8배속, 결과로 건너뛰기 |
| 세트 결과 | 박스 스코어(KDA, MVP), 오브젝트, 골드 흐름. 진 팀이 다음 세트 진영 선택 |
| 순위·일정 | 정규시즌 순위표(레전드/라이즈 컷), 전체 일정 |
| 로스터 | 선수 카드(능력치, 운영 기여, 챔피언 폭), 주전 교체 |
| 이적 실험실 | 같은 포지션 두 선수 맞트레이드 전후 시즌 100회 비교 |

시즌은 LCK 2026 방식(1~2라운드 18일 + 레전드/라이즈 그룹 10일)이다. 내 경기는 직접 밴픽하고, 같은 날 나머지 경기는 AI끼리 시뮬한다.
"AI에게 맡기고 하루 진행"을 누르면 내 경기도 AI가 대신 치른다.

```
web/
  wrangler.jsonc     Cloudflare 배포 설정
  src/
    engine.ts        엔진 데이터 로드 + 웹에서 쓰는 엔진 API 모음
    game/            커리어(일정·순위·저장), 팀 스타일, 팀 전력 요약
    screens/         홈, 순위·일정, 로스터, 이적 실험실, 팀 선택
    screens/match/   밴픽 → 중계 → 세트 결과 → 시리즈 결과
    workers/         이적 실험실 Web Worker
    ui/              배지, 챔피언 아이콘, 골드 그래프 등 공용 조각
```

## Cloudflare 배포 (1단계: 각자 자기 브라우저에서 플레이)

정적 파일만 올리므로 서버 비용이 없다. Workers의 정적 자산 요청은 무료다.

### 방법 A. GitHub 연동 (추천, push하면 자동 배포)

1. Cloudflare 대시보드 → **Workers & Pages** → **Create application** → **GitHub**
   - 처음이면 Cloudflare GitHub 앱 설치를 허용한다. 비공개 저장소도 된다.
2. `aidenvis39/lckgamev1` 선택 후 설정:

   | 항목 | 값 |
   |---|---|
   | Project name | `lckgamev1` (`web/wrangler.jsonc`의 `name`과 같아야 함. 다르면 빌드 실패) |
   | Root directory | `web` |
   | Build command | `npm run build` |
   | Deploy command | `npx wrangler deploy` (기본값) |

   의존성 설치(`npm`)는 자동으로 된다.
3. **Save and Deploy** → `https://lckgamev1.<내 서브도메인>.workers.dev` 로 열린다.
4. 이후 `main`에 push할 때마다 다시 빌드·배포된다.

### 방법 B. 내 컴퓨터에서 바로 배포

```bash
cd web
npx wrangler login
npm run deploy
```

### 친구만 들어오게 막기 (Cloudflare Access)

실존 선수 이름과 나이가 들어 있으니 공개 URL로 두지 말고 친구 이메일만 허용하는 걸 권장한다.

1. Zero Trust를 켠다 (대시보드 → Zero Trust, 무료 플랜).
2. **Workers & Pages** → `lckgamev1` → **Access** 탭 → **Protect this Worker behind Access** → **All traffic**
3. 정책에 친구 이메일을 넣는다. 친구는 이메일로 받은 일회용 코드로 로그인한다.

주의: 워커 단위 Access는 WebSocket을 아직 지원하지 않는다. 2단계에서 실시간 밴픽을 붙이면 호스트 이름 기반 Access 앱으로 바꿔야 한다.

## 2단계: 친구 리그 (설계, 아직 구현 안 함)

1단계에선 각자 자기 시즌을 따로 한다. 2단계는 친구들이 **한 리그에서 각자 팀을 맡아** 같은 시즌을 치르는 것이다.

### 구성

```
브라우저 (지금 웹앱)  ──HTTP / WebSocket──▶  같은 워커 (/api/*)  ──▶  Durable Object "League" (리그 1개 = 객체 1개, SQLite)
```

- `wrangler.jsonc`에 `main`(워커 스크립트), `assets.run_worker_first: ["/api/*"]`, Durable Object 바인딩과 `new_sqlite_classes` 마이그레이션을 추가한다.
- 리그 하나가 Durable Object 하나다. 초대 코드로 찾는다 (`idFromName(code)`).
  - 일정, 순위, 팀 주인, 경기 결과를 그 객체의 SQLite에 저장한다.
  - 한 객체가 한 리그의 모든 요청을 순서대로 처리하므로 동시 제출 충돌이 없다.
- 엔진은 `fs`를 안 쓰므로 워커에서도 같은 코드를 그대로 돈다.
  - **경기 결과는 서버가 정한다.**
  - 경기 시뮬 시드는 밴픽이 끝날 때까지 서버만 알고 있다. 새로고침으로 결과를 미리 보고 밴픽을 바꾸는 꼼수를 막기 위해서다.
- Workers 무료 플랜에서 SQLite Durable Object를 쓸 수 있다. 친구 10명 규모면 무료 한도 안이다.

### 흐름

1. 방장이 리그를 만들면 초대 링크(`/l/ABC123`)가 나온다.
2. 친구가 링크를 열고 닉네임과 팀을 고른다. 팀당 한 명이고, 남은 팀은 AI가 맡는다. 참가 토큰은 브라우저에 저장된다.
3. 매치데이마다:
   - **사람 vs AI**: 각자 편할 때 밴픽한다.
     - 내 선택만 서버로 보낸다.
     - 서버는 같은 시드로 AI 차례를 다시 계산해 밴픽을 검증하고 경기를 시뮬한다.
   - **사람 vs 사람**: 둘 다 들어와 있으면 실시간 밴픽을 한다.
     - WebSocket, Hibernation API를 쓰고 차례당 30초다.
     - 마감까지 안 하면 AI가 대신 한다.
   - 방장이 "다음 날"을 누르거나 Durable Object 알람으로 정해진 시각에 매치데이를 넘긴다.
4. 시즌이 끝나면 이적 시장(FA, 트레이드 제안·수락)을 연다.

### API 초안

| 요청 | 내용 |
|---|---|
| `POST /api/leagues` | 리그 생성 → 초대 코드 |
| `GET /api/leagues/:code` | 일정·순위·팀 주인·내 다음 경기 |
| `POST /api/leagues/:code/join` | 닉네임 + 팀 선택 → 참가 토큰 |
| `POST /api/leagues/:code/series/:id/game` | 사람 vs AI 한 세트의 내 밴픽 제출 → 서버 시뮬 결과 |
| `GET /api/leagues/:code/ws` | WebSocket: 실시간 밴픽, "상대 접속함"·"매치데이 넘어감" 알림 |
| `POST /api/leagues/:code/advance` | 방장 전용: 다음 매치데이 |

### 구현 순서

1. 워커 + League Durable Object + REST. 비동기 리그만 지원하고, 사람 vs 사람 경기도 각자 밴픽을 제출하면 AI가 남은 차례를 채운다.
2. 사람 vs 사람 실시간 밴픽 (WebSocket)
3. 이적 시장, 시즌 넘기기
