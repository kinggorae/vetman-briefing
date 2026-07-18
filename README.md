# VetMan 해외 브리핑

해외 수의 미디어와 커뮤니티에서 주목할 글을 **매일** 선별·번역·요약해 제공하는 데일리 브리핑 파이프라인.

## 수집 소스 (3단 구조)

| 우선순위 | 소스 | 조건 |
|---|---|---|
| 기본 (Plan C) | 수의 전문 미디어 RSS 5종 + 구글 뉴스 수의 쿼리 2종 + ScienceDaily 수의학 | 항상 동작, 키 불필요 |
| 보조 (Plan B) | Claude 웹 검색으로 레딧(r/Veterinary 등) 화제 글 수집 | Anthropic 직접 연결일 때만 (호환 게이트웨이에선 비활성) |
| 확장 | Reddit API 직접 수집 (업보트·댓글 전문 포함) | `REDDIT_CLIENT_ID/SECRET` 있을 때 자동 활성화 |

구글 뉴스 RSS 덕분에 직접 수집이 차단된 매체(dvm360, AVMA 등)의 기사도 우회로 확보된다.
`data/seen.json`에 이미 소개한 글 URL을 기록해 일간 실행 간 중복을 방지한다.

## 구조

```
config.js            RSS 피드 목록, 서브레딧, 선별 기준, 모델 설정
src/rss.js           RSS/Atom 수집 (유료 글 필터 포함)
src/websearch.js     Claude 웹 검색으로 레딧 시그널 수집
src/reddit.js        Reddit API 수집 (OAuth)
src/select.js        규칙 필터 + Claude 관련성 스코어링(0~10) → 상위 8개
src/generate.js      한국어 제목·요약·글감 포인트 생성
src/run.js           전체 파이프라인 → data/issues/<week>.draft.json
src/publish.js       검수 완료된 draft를 발행 상태로 전환
src/build.js         data/issues/*.json → site/ 정적 사이트 + latest.json
```

## 사용법

```bash
npm install
cp .env.example .env   # LLM_API_KEY 필수, 나머지는 선택

npm run collect        # 수집만 (키 불필요, data/candidates.json)
npm run run            # 전체 파이프라인 → 오늘자 draft 생성
node src/run.js --publish        # draft 없이 바로 발행 (검수 필요 표시 아이템은 제외)
# draft 검수 후 수동 발행:
node src/publish.js 2026-07-19
npm run build          # site/ 빌드
```

## 크리덴셜 (.env)

| 변수 | 필수 | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | 스코어링·번역·요약·웹 검색. Anthropic 키 또는 (호환 모드) MiniMax 키 |
| `ANTHROPIC_BASE_URL` | 선택 | 설정 시 Anthropic 호환 게이트웨이로 전환. MiniMax: `https://api.minimax.io/anthropic` |
| `CLAUDE_MODEL` | 선택 | 기본 `claude-sonnet-5`. MiniMax 사용 시 `MiniMax-M2` |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | 선택 | 있으면 Reddit API 직접 수집 활성화 |
| `REDDIT_USER_AGENT` | 선택 | `platform:app:version (by /u/유저명)` 형식 |

**MiniMax 호환 모드 제약**: structured outputs 대신 프롬프트 기반 JSON 파싱을 쓰고(자동 전환),
Anthropic 웹 검색 도구가 없어 Plan B(레딧 시그널)는 비활성화된다. RSS 수집·선별·요약은 전부 동작.

## 발행 흐름

- **자동 (기본)**: GitHub Actions가 매일 09:00 KST에 `--publish`로 실행 → 사이트 빌드 → 커밋·푸시.
  Cloudflare Pages를 리포에 연결해두면 푸시 즉시 배포된다.
  외국어 혼입이 끝내 해소되지 않은 아이템(`needsReview`)은 자동 발행에서 제외된다.
- **수동 검수 모드**: 로컬에서 `npm run run` → draft 확인 → `node src/publish.js <날짜>` → `npm run build`.
- `site/latest.json`은 VetMan 본체에서 embed할 수 있는 공개 endpoint.

## 정책 메모

- 원문 본문은 저장·재게시하지 않고 요약 + 원문 링크만 제공
- 약물 용량 등 임상 디테일은 옮기지 않음 (프롬프트에 명시)
- 유료(members only) 글은 수집 단계에서 제외
- 페이지 하단에 "임상 정보는 참고용" 고지 포함
