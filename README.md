# VetMan 해외 브리핑

해외 수의 미디어와 커뮤니티에서 주목할 글을 **매일** 선별·번역·요약해 제공하는 데일리 브리핑 파이프라인.

## 수집 소스 (3단 구조)

| 우선순위 | 소스 | 조건 |
|---|---|---|
| 기본 (Plan C) | 수의 전문 미디어 RSS 5종 + 구글 뉴스 수의 쿼리 2종 + ScienceDaily 수의학 | 항상 동작, 키 불필요 |
| 보조 (Plan B) | Claude 웹 검색으로 레딧(r/Veterinary 등) 화제 글 수집 | Anthropic 직접 연결일 때만 (호환 게이트웨이에선 비활성) |
| 확장 | Reddit API 직접 수집 (업보트·댓글 전문 포함) | `REDDIT_CLIENT_ID/SECRET` 있을 때 자동 활성화 |

구글 뉴스 RSS 덕분에 직접 수집이 차단된 매체(dvm360, AVMA 등)의 기사도 우회로 확보된다.
Google News는 미국판에만 의존하지 않고 영국·캐나다·호주·뉴질랜드·아일랜드·인도·싱가포르·남아프리카·일본·독일·프랑스·스페인·브라질·멕시코 현지판과 현지어 쿼리를 함께 사용한다. 현재 직접 RSS 13개와 Google News 88개, 총 101개 채널을 권역별 round-robin으로 섞어 특정 국가가 후보를 독식하지 않게 한다.
`data/seen.json`에 이미 소개한 글 URL을 기록해 일간 실행 간 중복을 방지한다.

## 구조

```
config.js            RSS 피드 목록, 서브레딧, 선별 기준, 모델 설정
src/rss.js           RSS/Atom 수집 (유료 글 필터 포함)
src/websearch.js     Claude 웹 검색으로 레딧 시그널 수집
src/reddit.js        Reddit API 수집 (OAuth)
src/select.js        규칙 필터 + Claude 관련성 스코어링(0~10) → 상위 8개
src/generate.js      한국어 제목·요약·글감 포인트 생성
src/identity.js      원문 URL 정규화·추적 파라미터 제거·안정적인 기사 ID 생성
src/quality.js       외국어 혼입·미번역 용어·본문 길이 품질 게이트
src/repair-publication.js 중복 원문·공개 차단 품질 항목을 삭제하지 않고 억제
src/quality-report.js  원본·공개·억제 건수와 품질 플래그 운영 리포트
src/images.js        원문 대표 이미지 정규화·공통 이미지 제거·중복 방지
src/repair-images.js 기존 발행 데이터의 대표 이미지 일괄 정리
src/repair-content.js 기존 발행 데이터의 번역 잔여물 일괄 점검·교정
src/validate.js       데이터·canonical·사이트맵·보안 산출물 검증
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
npm run publish:today  # 전체 파이프라인 → 오늘자 발행 데이터 생성·기존 이슈와 병합
npm run check          # 테스트 → 사이트 빌드 → SEO/데이터 검증
npm run dev            # 로컬 미리보기 http://localhost:8788
node src/run.js --publish        # draft 없이 바로 발행 (검수 필요 표시 아이템은 제외)
# draft 검수 후 수동 발행:
node src/publish.js 2026-07-19
npm run build          # site/ 빌드
npm run repair-publication # 기존 발행 데이터의 중복·품질 불량 항목을 억제(원본 보존)
npm run quality-report # 공개/억제 건수와 품질 플래그 리포트
npm run repair-images  # 기존 발행 데이터의 공통·반복 이미지 제거
```

## 크리덴셜 (.env)

| 변수 | 필수 | 설명 |
|---|---|---|
| `ANTHROPIC_API_KEY` | ✅ | 스코어링·번역·요약·웹 검색. Anthropic 키 또는 (호환 모드) MiniMax 키 |
| `ANTHROPIC_BASE_URL` | 선택 | 설정 시 Anthropic 호환 게이트웨이로 전환. MiniMax: `https://api.minimax.io/anthropic` |
| `CLAUDE_MODEL` | 선택 | 기본 `claude-sonnet-5`. MiniMax 사용 시 `MiniMax-M2` |
| `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET` | 선택 | 있으면 Reddit API 직접 수집 활성화 |
| `REDDIT_USER_AGENT` | 선택 | `platform:app:version (by /u/유저명)` 형식 |

### Cloudflare Pages 환경변수

| 변수 | 용도 |
|---|---|
| `ADMIN_PASSWORD` | `/admin` 검수 API 인증용. 저장소나 프런트엔드 코드에 넣지 않고 Pages Secret으로만 등록 |
| `SITE_ORIGIN` | API CORS 허용 원본. 기본값은 `https://news.vetmanlab.com` |
| `NEWSLETTER_ENABLED` | `true`로 명시적으로 켠 경우에만 뉴스레터 구독 API 활성화 |
| `SUBS` | Cloudflare KV 바인딩. `sub:<email>`·`tok:<token>` 키를 저장 |
| `RESEND_API_KEY` 또는 `SES_*` | 실제 발송 워커를 붙일 때만 설정. 발송 수단 없이 구독 폼을 켜지 않는다 |
| `TURNSTILE_SECRET_KEY` | 선택. 등록하면 AI 초안 생성 요청에 Cloudflare Turnstile 검증을 요구 |

`ADMIN_PASSWORD`를 설정하지 않으면 관리자 API는 의도적으로 401을 반환합니다. 관리자 화면 주소를 아는 것만으로는 데이터에 접근할 수 없습니다.

초안 생성·뉴스레터 API는 `https://news.vetmanlab.com`에서 온 브라우저 요청만 허용하며, `Origin`이 없는 서버 간 호출은 거부합니다. 초안 생성 요청의 크기도 제한해 LLM 비용이 외부에 노출되지 않도록 합니다.

뉴스레터는 현재 수신거부 API까지 준비되어 있지만, 발송 제공자와 KV 바인딩을 확인하기 전에는 비활성화한다. 활성화할 때는 `SUBS` 바인딩 → 테스트 주소 구독 → 실제 메일 수신 → 수신거부 링크 → 중복 구독 응답을 순서대로 검증한다.

홈 검색은 최신 발행분에만 갇히지 않도록 전체 색인을 필요할 때 불러옵니다. 검색 색인은 날짜별 `site/search/*.json` 청크와 `search-manifest.json`으로 나뉘어, 새 발행 때 최신 청크만 바뀌고 과거 청크의 CDN 캐시가 유지됩니다. 구버전 배포나 청크 장애에서는 `search.json`으로 폴백합니다.

매일 CI는 외부 대표 이미지와 RSS/Google News 소스 응답·항목 수·마지막 발행 시각도 점검합니다. 실패 목록은 GitHub Actions artifact(`image-health-*`, `source-health-*`)와 Step Summary에 남고, 소스군 전체 장애 또는 허용치를 넘는 실패는 발행을 중단합니다.

발행 데이터는 공개 전에 두 번 검사합니다. `repair-publication`은 최신 정상본을 우선 보존하고, 다른 날짜의 중복 원문과 외국어·깨진 문장·최소 본문 길이 미달 항목을 `visibility: suppressed`로 표시합니다. 원본 JSON과 억제 사유는 남아 있어 되돌리거나 다시 검수할 수 있습니다. `quality-report`는 매일 공개 건수·억제 건수·이미지 유무·카테고리별 편중을 Actions artifact로 남깁니다.

이미지는 원문 페이지가 명시한 `og:image`, Twitter 이미지, JSON-LD 이미지 중 실제 대표 이미지 후보만 사용합니다. Google News 공통 로고·사이트 공통 배경·반복 이미지가 감지되면 URL을 비우고, 이미지 없는 기사는 큰 대체 플레이트 없이 제목·출처 중심으로 렌더링합니다. 기존 데이터는 `npm run repair-images`로 일괄 정리할 수 있으며, 빌드 단계에서도 같은 규칙을 한 번 더 적용합니다.

**MiniMax 호환 모드 제약**: structured outputs 대신 프롬프트 기반 JSON 파싱을 쓰고(자동 전환),
Anthropic 웹 검색 도구가 없어 Plan B(레딧 시그널)는 비활성화된다. RSS 수집·선별·요약은 전부 동작.

## 발행 흐름

- **자동 (기본)**: GitHub Actions가 매일 09:00 KST에 `--publish`로 실행 → 사이트 빌드 → 커밋·푸시.
  Cloudflare Pages를 리포에 연결해두면 푸시 즉시 배포된다.
  외국어 혼입이 끝내 해소되지 않은 아이템(`needsReview`)은 자동 발행에서 제외된다.
- **수동 검수 모드**: 로컬에서 `npm run run` → draft 확인 → `node src/publish.js <날짜>` → `npm run build`.
- `site/latest.json`은 VetMan 본체에서 embed할 수 있는 공개 endpoint.
- `npm run validate`는 발행 이슈·중복 원문·사이트맵·관리자 산출물·보안 문자열을 검사한다. CI는 빌드 직후 이 검사를 통과해야 커밋한다.
- `site/latest.json`, 검색 색인, 주제 허브, 뉴스 사이트맵은 억제 항목을 포함하지 않는다. 브리프는 홈 카드로만 제공하고 개별 색인 페이지를 만들지 않는다.
- 기존 기사 URL은 legacySlug로 보존하고, 새 기사는 원문 URL 기반 v1_... ID를 사용한다. 제목 교정만으로 이미 색인된 주소가 바뀌지 않게 하는 규칙이다.
- 같은 원문이 여러 날짜에 재수록되면 최신본만 색인하고 과거 페이지는 noindex, follow로 유지한다.
- CI는 라이브 latest.json보다 오래된 날짜를 배포하려는 경우 중단한다. 라이브와 저장소의 날짜가 어긋난 상태에서 수동 배포하지 않는다.

## 정책 메모

- 원문 본문은 저장·재게시하지 않고 요약 + 원문 링크만 제공
- 약물 용량 등 임상 디테일은 옮기지 않음 (프롬프트에 명시)
- 유료(members only) 글은 수집 단계에서 제외
- 페이지 하단에 "임상 정보는 참고용" 고지 포함
