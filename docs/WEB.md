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
| 팀 선택 | LCK 10개 구단 중 하나. 주전 5명, 개인 능력 등급, 운영 강약, 실제 2026 정규시즌 세트 승률 표시 |
| 홈 | 다음 경기(단계 이름·BO), 상대 전력 비교(해외 팀 포함), LCK 순위 요약, 같은 날 다른 경기, 최근 결과. 플레이오프에서 내가 상대를 지목할 차례면 지목 화면. 시즌이 끝나면 LCK·MSI·월즈 우승팀과 내 성적 |
| 밴픽 | 프로 순서 20단계, 피어리스. 추천(내 픽 가치 / 밴 차례엔 상대가 노릴 챔피언), 포지션 필터·검색·정렬, 남은 밴픽 AI에게 맡기기 |
| 중계 | 시간 순서 이벤트, 킬·포탑·용·바론 스코어보드, 골드 차이 그래프, 1/3/8배속, 결과로 건너뛰기 |
| 세트 결과 | 박스 스코어(KDA, MVP), 오브젝트, 골드 흐름. 진 팀이 다음 세트 진영 선택 |
| 리그 | LCK 1~2라운드 순위, 레전드·라이즈 그룹 순위, LCK 일정. 해외 5개 리그(LPL·LEC·LCS·LCP·CBLOL) 전반·전체 순위와 MSI·월즈 진출선 |
| 대회 | Road to MSI, MSI(플레이인·브래킷), LCK 포스트시즌(플레이인·플레이오프), 월즈(플레이인·스위스·녹아웃) 대진표와 최종 순위. 시리즈를 누르면 세트 결과 |
| 로스터 | 선수 카드(능력치, 운영 기여, 챔피언 폭), 주전 교체 |
| 이적 실험실 | 같은 포지션 두 선수 맞트레이드 전후 LCK 시즌 100회 비교. 선수 B는 해외 선수도 고를 수 있음 |

한 해는 LCK 1~2라운드 → Road to MSI → MSI → LCK 3~4라운드 → LCK 플레이인·플레이오프 → 월즈 순서다 (엔진 문서 7절).
해외 5개 리그는 같은 날짜에 뒤에서 진행되고, 순위에 따라 MSI·월즈 대표가 매번 새로 정해진다.
내 경기는 직접 밴픽하고, 같은 날 나머지 경기는 AI끼리 시뮬한다. "AI에게 맡기고 하루 진행"을 누르면 내 경기도 AI가 대신 치른다.
내 경기가 없는 날(출전 못 한 대회, 탈락 후)은 "다음 내 경기까지 진행"으로 넘긴다.

- **BO5 이어 하기**: 세트가 끝날 때마다 저장한다. 중간에 나가도 그 세트부터 다시 할 수 있다 (밴픽 도중은 저장 안 함).
- **저장**: 브라우저 localStorage `lck-manager:career:v2` (한 해 끝까지 약 330KB). 예전 v1(정규시즌만 있던 버전) 저장은 이어 할 수 없어 지우고 안내한다.

```
web/
  wrangler.jsonc     Cloudflare 배포 설정
  src/
    engine.ts        엔진 데이터 로드 + 웹에서 쓰는 엔진 API 모음
    game/            커리어(엔진 한 해 상태 + 세트 기록 + 진행 중 시리즈, 저장), 팀·리그 스타일, 팀 전력 요약
    screens/         홈, 리그, 대회, 로스터, 이적 실험실, 팀 선택
    screens/match/   밴픽 → 중계 → 세트 결과 → 시리즈 결과
    workers/         이적 실험실 Web Worker
    ui/              배지, 챔피언 아이콘, 골드 그래프 등 공용 조각
```

## Cloudflare 배포

정적 파일만 올리므로 서버 비용이 없다. Workers의 정적 자산 요청은 무료다.
친구들은 같은 주소로 들어와 각자 자기 브라우저에서 한 해를 치른다 (저장은 브라우저마다 따로).

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
