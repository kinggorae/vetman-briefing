# 복구 절차

매일 09:00 KST에 GitHub Actions가 수집·생성·빌드·배포를 자동 실행한다.
그 과정에서 사이트가 망가졌을 때 되돌리는 방법.

## 복원 지점

| 종류 | 위치 | 만들어지는 시점 |
|---|---|---|
| `stable-*` 태그 | GitHub | 사람이 직접 (안정 확인 후) |
| `pre-run-YYYYMMDD` 태그 | GitHub | 매일 자동발행 **직전** |
| `daily: YYYY-MM-DD` 커밋 | GitHub | 매일 자동발행 **직후** |
| Pages 배포 | Cloudflare | 배포할 때마다 (약 한 달 보관) |
| 로컬 아카이브 | `~/vetman-backups/*.tar.gz` | 사람이 직접 |

데이터(`data/`)와 빌드 결과(`site/`)가 모두 저장소에 커밋되므로,
git 이력 자체가 백업이다. 태그는 그중 되돌릴 지점을 표시해 둔 것.

## 상황별 대응

### 1. 사이트 내용이 이상하다 — 일단 화면부터 되돌린다

가장 빠른 방법은 Cloudflare에서 이전 배포로 롤백하는 것이다.
저장소는 그대로 두고 화면만 즉시 되돌아간다.

```
Cloudflare 대시보드 → Workers & Pages → vetman-briefing
→ Deployments → 되돌릴 배포의 ⋯ → Rollback to this deployment
```

배포 목록은 CLI로도 볼 수 있다.

```sh
npx wrangler pages deployment list --project-name vetman-briefing
```

### 2. 데이터까지 되돌려야 한다

```sh
git fetch --all --tags

# 오늘 자동발행이 망친 경우 — 실행 직전 상태로
git checkout pre-run-$(date -u +%Y%m%d) -- data site

# 특정 안정 지점으로
git checkout stable-2026-07-22 -- data site

git commit -m "revert: 자동발행 결과 되돌림"
git push
npm run build
npx wrangler pages deploy
```

`-- data site`로 경로를 제한하는 이유: 소스 코드까지 과거로 돌리지 않기 위해서다.
코드 문제라면 경로 제한 없이 `git revert <커밋>`을 쓴다.

### 3. 저장소가 통째로 망가졌다

```sh
cd ~/vetman-backups
tar xzf vetman-data-<날짜>.tar.gz -C /경로/talktalk/
```

아카이브에는 `data/`, `config.js`, `wrangler.toml`, `.github/`, `functions/`가 들어 있다.
`site/`는 없다 — `npm run build`로 다시 만들면 된다.

### 4. 하루치 발행을 다시 하고 싶다

```sh
# 해당 날짜 이슈 파일을 지우고
rm data/issues/2026-07-22.json
# 다시 실행
node --env-file=.env src/run.js --publish
```

주의: `data/seen.json`에 이미 처리한 URL이 쌓여 있어 같은 기사는 다시 수집되지 않는다.
의도적으로 다시 받으려면 `seen.json`에서 해당 URL을 지운다.

## 자동 방어 장치

파이프라인에 이미 들어가 있는 것들. 어떤 사고를 막는지 알고 있어야 한다.

- **같은 날짜 이슈 병합** (`src/run.js`) — 하루에 여러 번 실행돼도 기존 발행분을
  덮어쓰지 않고 신규 비중복분만 추가한다. 예전에 CI 재실행이 그날 기사를
  통째로 날린 사고가 있었다.
- **발행 게이트** (`src/run.js`) — 본문 600자 미만이면서 레이더(진료 포인트·보호자
  문답·근거 등급)가 하나도 없는 항목은 발행하지 않는다.
- **발행 전 검사** (`daily.yml`) — 최신 이슈가 5건 미만이거나 `site/index.html`이
  비어 있으면 커밋·배포하지 않고 워크플로를 실패시킨다.
- **실행 시간 상한** (`daily.yml`) — 75분. 비공개 저장소 Actions 무료 한도(월 2,000분)를
  폭주한 실행이 태우지 않도록.

## 배포 전 확인 습관

로컬에서 배포할 때는 항상 먼저 원격을 받아온다.
CI가 만든 그날 발행분을 로컬 옛 상태로 덮어쓴 적이 있다.

```sh
git fetch origin main && git status
```
