# VetManLab SEO·품질 고도화 보고서

작성일: 2026-07-29
작업 브랜치: `codex/seo-hardening`
기준 커밋: `origin/main` 최신본
구현 커밋: `00cdf52`
PR: [#2](https://github.com/kinggorae/vetman-briefing/pull/2)
Production 배포: Cloudflare Pages `vetman-briefing`, production branch `main`, 검증 deployment `e6b4d086` (source `190470a`)

## 1. 변경한 파일

- 품질·색인: `src/lib/quality.js` 신규, `src/quality.js`, `src/quality-report.js`, `src/validate.js`
- 구조화 데이터·빌드: `src/lib/schema.js` 신규, `src/build.js`
- 데이터 파이프라인: `src/generate.js`, `src/run.js`, `src/images.js`
- 원문 정규화: `src/normalize-sources.js` 신규, `data/source-resolutions.json` 신규
- 기존 데이터 교정: `data/issues/2026-07-28.json`, `data/issues/2026-07-29.json`
- 회귀 테스트: `test/core.test.js`
- 생성 결과: `site/`의 HTML, JSON, RSS, sitemap, news sitemap, 서비스워커 캐시 버전 등

`src/build.js` 전체 재작성은 하지 않고, 먼저 품질·스키마 로직을 단위 모듈로 분리했습니다. `seo.js`, `sitemap.js`, `rss.js`, `templates/article.js`는 현재 빌드 결합도가 높아 이번 범위에서는 추가 분리하지 않았습니다.

## 2. 핵심 설계 결정

- 독립 기사 페이지는 `analysis` 또는 `evidence`이면서 3문단·420자·레이더·출처·한국어 문장·치명 오류 조건을 모두 통과할 때만 index합니다.
- `brief`는 기존 데이터와 호환되며 기본 noindex입니다. 짧은 글은 홈페이지·날짜 페이지 카드에 남길 수 있습니다.
- 품질 미통과 독립 페이지와 기존 URL은 삭제하지 않고 `noindex,follow`로 보존합니다. sitemap, news sitemap, 검색 색인, 주제 허브에는 통과 기사만 넣습니다.
- 명백한 오탈자만 교정하고 의미가 불확실한 `병원ugeom`, `조객 참여` 등은 임의 교정하지 않고 검수 경고/noindex로 남겼습니다.
- 작성자·감수자·AI 사용·정정 정보는 실제 필드가 있을 때만 화면과 JSON-LD에 출력합니다. 없을 때 가짜 수의사·자격·감수자를 만들지 않습니다.
- `dateModified`는 실제 `updatedAt`가 있는 경우에만 출력합니다. 개별 발행 시각이 없는 레거시 항목은 이슈에 기록된 `generatedAt`을 발행 시각으로 사용해 화면·JSON-LD·RSS·뉴스 sitemap을 일치시켰습니다.
- 원문 링크의 편집 출처에는 `nofollow`를 제거하고 `noopener noreferrer`를 사용합니다. 후원 슬롯만 `sponsored nofollow`를 유지합니다.
- 이미지가 없으면 `og.png`는 공유 fallback으로만 사용하고, 기사 대표 이미지가 있는 것처럼 본문에 표시하지 않습니다. 외부 HTTP 이미지는 HTTPS로 정규화합니다.
- 검색 데이터는 입력 시 지연 로딩하고 초기 기사 렌더링 수를 제한했습니다. 주제 페이지는 링크 보존을 위해 생성하되, 기사 3건 미만은 noindex입니다.
- 기존 주간 URL `weekly/2026-W23`은 카드 표시용으로 복원하고, 전문 색인 조건 미충족 상태에서는 `noindex,follow`로 유지합니다.

## 3. 수정된 기존 데이터

명백한 오류를 다음처럼 교정했습니다.

- `강아지 주인의 위한` → `강아지 주인을 위한`
- `무뎌지(Blacklegged Tick)` → `검은다리진드기`, 관련 `Lyme disease` 표현을 `라임병`으로 정리
- `원-health` → `원헬스(One Health)` 및 일부 문장 종결 오류
- `백식`, `백석`, `콤백 백석` → `백신`, `콤비네이션 백신`
- `고양이벼loquato`, `벼loquato` → `고양이벼룩`, `벼룩`
- `수아지(말 새끼)` → `망아지(말 새끼)`

`병원ugeom`, `조객 참여`는 의미 확인 없이 바꾸지 않았습니다.

## 4. index/noindex 기사 수

현재 생성 기준은 다음과 같습니다.

| 구분 | 건수 |
|---|---:|
| 원본 기사 항목 | 463 |
| 카드 공개 항목 | 324 |
| 독립 기사 HTML | 463 |
| 엄격한 index 기사 | 173 |
| noindex 기사 | 290 |
| index 기사 중 3문단 미만 | 0 |

초기 감사의 “색인 대상 약 318개”는 실험 전 후보군 기준입니다. 최종 게이트에서는 145개를 추가로 noindex 처리했으며, 주된 원인은 brief/본문·문장 오류·Google News relay 원문 미정규화입니다. noindex 기사의 기존 URL은 유지됩니다.

## 5. 이미지·원문 URL·품질 경고 통계

- 고유 기사 이미지 있음: 87건
- 이미지 없음: 376건 — warning으로 관리하며 이미지 부재만으로 일괄 noindex하지 않음
- Google News 중계 URL: 187건
- 원문 정규화 성공: 0건
- 정규화 실패·기존 URL 보존: 187건
- 재현 가능한 결과 캐시: `data/source-resolutions.json`
- 정규화되지 않은 relay URL 때문에 전문 색인 게이트에서 제외된 항목: 39건
- 공개 항목의 중복 원문: 0건

품질 플래그는 다중 플래그 방식이라 합계가 기사 수를 의미하지 않습니다.

`banned-term` 11, `internal-ascii` 19, `body-not-korean-sentence` 7, `brief-too-short` 49, `source-relay` 39, `title-not-korean-sentence` 3, `lead-not-korean-sentence` 4, `body-too-short` 19, `garbled-text` 5, `repeated-word` 4, `paragraph-too-short` 1.

## 6. 실행한 테스트와 결과

- `npm ci`: 성공
- `npm test`: 성공, 10개 통과
- `npm run build`: 성공, 38개 이슈 생성
- `npm run validate`: 성공
- `npm run check`: 성공
- `npm audit --omit=dev`: 취약점 0건
- 생성된 모든 JSON-LD: JSON 파싱 성공
- sitemap, news sitemap, RSS: XML 파싱 성공
- sitemap URL과 canonical, noindex 제외, 내부 링크 파일 존재 여부: 통과
- 홈페이지 robots: `index,follow`
- index 기사 중 `dateModified` 출력: 0건(실제 `updatedAt` 데이터가 없기 때문)
- 기사 원문 편집 링크의 불필요한 `nofollow`: 0건
- sitemap URL: 215개
- news sitemap URL: 11개
- RSS 기사: 50개, `content:encoded` 전체 본문 포함
- Lighthouse 모바일: 실행하지 않음(로컬 정적 검증까지 수행)
- 기존 주간 URL `weekly/2026-W23` 보존 및 내부 링크 검증: 통과
- production live smoke test: homepage/article/sitemap/news sitemap/RSS 응답 및 핵심 robots 상태 통과

## 7. 남은 수동 검수 항목

- `병원ugeom`, `조객 참여`를 포함한 생성·번역 오류 후보의 원문 대조
- 39건의 Google News relay 원문을 사람이 최종 출판사 URL로 확인
- 173개 index 기사의 임상 표현, 수치, 근거 수준, 한국 적용 해설 샘플링
- 376건의 이미지 권리·라이선스·대체 이미지 검토
- 기사별 `author`, `reviewer`, `reviewedAt`, `updatedAt`, DOI와 저널 메타데이터 입력 여부 확인
- 실제 운영 도메인에서 모바일 레이아웃, 키보드 포커스, 색상 대비, 이미지 로딩 확인
- 로컬 Browser 런타임이 제공되지 않아 대표 페이지의 실제 스크린샷 시각 검수는 수행하지 못함

## 8. Google Search Console·네이버 서치어드바이저 제출 작업

사람이 운영 계정에서 다음을 수행해야 합니다.

1. Google Search Console에서 도메인/URL 접두사 속성을 확인하고 `https://news.vetmanlab.com/sitemap.xml`을 제출합니다.
2. 최근 뉴스 노출이 필요한 경우 `https://news.vetmanlab.com/news-sitemap.xml`을 별도로 제출하고, 대표 index 기사 몇 개를 URL 검사·색인 생성 요청합니다.
3. 색인 제외 보고서에서 의도한 `noindex` 기사와 실제 오류를 구분해 확인합니다.
4. 네이버 서치어드바이저에서 사이트 소유 확인 후 `sitemap.xml`과 RSS URL을 제출하고, 수집 요청 및 색인 상태를 확인합니다.
5. 모바일 최적화·페이지 수집·검색 노출 리포트에서 canonical, robots, 리디렉션 상태를 운영 도메인 기준으로 재확인합니다.

## 9. production 배포 전 체크리스트

- 데이터 교정·noindex 판정·원문 URL 변경을 편집자가 검토
- 이미지 사용 권리와 크레딧 확인
- Cloudflare Pages preview에서 canonical, robots, sitemap, RSS, JSON-LD, 내부 링크 smoke test
- Google Search Console·네이버 속성 및 sitemap 제출 준비
- Lighthouse 모바일과 실제 iOS/Android 화면 검수
- 서비스워커 `vmcache-v5` 갱신·오래된 캐시 제거 확인
- 뉴스 sitemap의 최근 48시간 기사와 실제 발행일 확인
- 운영 배포 후 대표 기사 URL 검사 및 404/리디렉션 모니터링
- 최종 확인 후에만 별도 커밋·push·production 배포 수행

## 10. 2차 고도화: editorial authority·media·SEO audit

작성 브랜치: `codex/seo-authority-media`
기준: `origin/main`에 1차 SEO 하드닝 커밋을 보존해 병합한 상태
상태: PR merge 및 production 배포 확인 완료
커밋: `355742e40e34d13e3e1ec6a15b4d1ff4edf2fff1` (`feat: add editorial authority, media, and SEO auditing`)
PR: [#3](https://github.com/kinggorae/vetman-briefing/pull/3)
merge: `269552f0e462d85145d2dde18b3c6926a5d290bc`
Preview: https://codex-seo-authority-media.vetman-briefing.pages.dev
Production deployment: Cloudflare Pages `vetman-briefing`, `main`, deployment `581ed57e`
Production smoke: `https://news.vetmanlab.com/`, article, sitemap, news sitemap, RSS, robots, media 모두 HTTP 200

### 변경 파일과 설계

- `src/editorial-cards.js`, `scripts/generate-editorial-cards.js`: index 기사에만 안정적인 ID 기반 SVG·WebP·PNG 편집 카드를 생성합니다. 1200×630 자체 호스팅 카드이며 실제 환자·검사 이미지가 아님을 alt/caption에 명시합니다.
- `scripts/image-audit.js`, `reports/image-audit.json`, `reports/image-audit.md`: 463개 기사의 이미지 출처·프로토콜·응답·중복·메타데이터·카드 보완 현황을 재현 가능하게 기록합니다. 외부 이미지는 권리 확인 없이 다운로드하지 않았습니다.
- `scripts/resolve-source-urls.js`, `reports/source-url-audit.json`: Google News 중계 URL을 dry-run으로 제한적으로 추적합니다. raw URL·캐시·재시도·타임아웃·제목 검증·수동 큐를 보존하며, 이번 환경에서 성공 0·후보 0·manual-review 상태 0·실패 187건, 수동 큐 187건입니다.
- `data/topics.json`, `config.js`: 주제 메타데이터를 분리하고 5개 이상 index 기사와 고유 intro가 있을 때만 주제 허브를 index합니다. 현재 허브 15개가 생성됐습니다.
- `data/authors.json`, `data/reviewers.json`: 현재는 빈 설정으로 두어 확인되지 않은 프로필을 만들지 않습니다. 실제 데이터가 입력될 때만 `/authors/`, `/reviewers/`와 Person JSON-LD가 생성됩니다.
- `functions/api/admin.js`, `site/admin-ui.html`, `site/admin-review.json`: 기존 Bearer 인증을 유지한 SEO·편집 검수 큐와 JSON/CSV 다운로드를 추가했습니다. 화면·데이터·응답 헤더 모두 noindex 상태입니다.
- `scripts/seo-audit.js`, `reports/seo-audit.json`, `package.json`, `package-lock.json`: `npm run seo:audit`가 색인 정책, known error, sitemap/RSS/XML, JSON-LD, 내부 링크, 이미지, relay, 용량을 검사합니다. 치명 오류만 exit 1입니다.
- `src/build.js`, `src/validate.js`, `test/core.test.js`: 초기 홈 데이터 축약·검색 shard 지연 로딩·엔티티 기반 관련 기사·이미지 표시·legacy 품질 필드 연결·회귀 검사를 반영했습니다.

### 2차 최종 통계

| 항목 | 결과 |
|---|---:|
| 원본 기사 | 463 |
| index 기사 | 170 |
| noindex 기사 | 293 |
| 1차 결과 대비 변화 | 173 → 170 (오염된 legacy `keyPointsKo`·`angleKo` 3건 추가 차단) |
| sitemap URL | 212 |
| news sitemap URL | 11 |
| index 기사 원본 이미지 없음 | 108 |
| index 기사 원본 이미지 있음 | 62 |
| index 기사 고유 편집 카드 | 108 |
| index 기사 실제 대표 이미지 | 170/170 |
| index 기사 hero 이미지·alt | 170/170 |
| 원본 이미지 URL | 87 (고유 87, 외부 87, HTTP 5, HTTPS 82, 응답 실패 0) |
| 이미지 원본 메타데이터 누락 | alt/caption/credit/license 각 87건 — 확인 전 임의 생성하지 않음 |
| Google News relay | 187 (성공 0, 후보 0, 실패 187, 수동 큐 187) |
| 홈페이지 HTML | 158,050 bytes (1차 252,971 bytes 대비 37.5% 감소) |
| 검색 전체 JSON | 153,890 bytes |
| 최초 검색 shard | 135,169 bytes (250KB 이하) |
| RSS 기사 / 본문 누락 | 50 / 0 |

색인 정책 사유는 중복 집계입니다. `brief-tier` 215, `suppressed` 30, `brief-too-short` 49, `source-relay` 39, `body-too-short` 19, `internal-ascii` 19, `banned-term` 11, `duplicate-source` 8, `body-not-korean-sentence` 7, `lead-not-korean-sentence` 4, `repeated-word` 4, `garbled-text` 5, `title-not-korean-sentence` 3, `paragraph-too-short` 1입니다. 최신 index/noindex 각 20건 표본은 `reports/seo-audit.json`의 `indexPolicy.samples`에 저장했습니다.

### 2차 검증 결과

- `npm ci`: 성공
- `npm test`: 성공, 12개 통과
- `npm run check`: 성공
- `npm run validate`: 성공
- `npm run seo:audit`: 성공, 치명 0·경고 0
- `npm audit --omit=dev`: production 취약점 0건
- 모든 JSON-LD 1,264개 블록 파싱 성공
- sitemap/news sitemap/RSS XML 파싱 성공
- index/noindex·canonical·sitemap 일치, noindex sitemap 포함 0건, 내부 링크 대상 누락 0건
- known error strings가 index 기사에 남은 건수 0건
- local HTTP smoke test: 홈페이지·최신 이슈·index/noindex 기사·주제·archive·weekly·admin·search shard·편집 카드 모두 200
- Lighthouse: 실행 파일이 환경에 없어 미실행
- 실제 브라우저 캡처: 브라우저 런타임이 제공되지 않아 미실행. 정적 HTML, 390px viewport 메타, 이미지 aspect-ratio, 키보드용 링크·aria 속성, 로컬 HTTP로 대체 확인

### 2차 배포 전 사람 검수

- `reports/source-url-audit.json`의 187개 수동 큐를 원문 제목·매체명과 대조해 최종 출판사 URL 확인
- HTTP 이미지 5건과 87건의 credit/license 권리 확인
- index 170건의 임상 표현·수치·번역·한국 적용 해설 표본 검수
- 실제 author/reviewer/credentials/전문 분야가 확인된 뒤에만 `data/authors.json`, `data/reviewers.json` 입력
- Cloudflare preview에서 extensionless routing, 관리자 인증, 모바일 화면, SW 캐시 갱신 확인

## 11. 3차 고도화: editorial review·rights·observability

작성 브랜치: `codex/editorial-review-observability`
기준: `origin/main` 최신 production 반영본
현재 상태: PR merge 및 production 배포 확인 완료

### 핵심 설계

- `src/lib/image-rights.js`가 `owned`, `licensed`, `official-press`, `source-embed`, `unknown`만 허용합니다. 권리 정보가 없는 외부 이미지는 추정하지 않고 `unknown`으로 남기며, index 기사에는 다운로드·복제 없이 ID 기반 자체 편집 카드로 대체합니다.
- `scripts/image-rights-audit.js`는 전체 463개 기사의 외부 이미지 URL에 HEAD 감사(상태·MIME·응답·프로토콜·중복)를 수행하고 `reports/image-rights-audit.json/.md`에 기록합니다. `imageUrlRaw`, `imageSourceUrl`, 권리 필드는 보존됩니다.
- `data/source-publishers.json`과 `scripts/resolve-source-candidates.js`는 공식 도메인·저장소 내 직접 원문·제목/날짜 유사도를 결합합니다. Google News 중계 URL을 반복 스크래핑하지 않으며, 높은 확신 조건을 충족하지 않으면 적용하지 않습니다. `scripts/source-review.js`는 명시적 승인·거절만 결정 파일에 저장합니다.
- `src/lib/editorial-review.js`는 임상 위험도와 `editorialStatus`를 정규화합니다. 기존 기사는 소급 차단하지 않고, 시행일 이후 새 기사에 high-risk 수의사 감수·medium-risk 사람 편집 검수 게이트를 적용합니다. 현재 확인되지 않은 검수자·저자 프로필은 생성하지 않았습니다.
- 기사 본문에 콘텐츠 유형, 자동화 사용, 편집 상태, 임상 위험도, 원문·발행일, 수정일, 정정·면책을 텍스트로 표시합니다. 관리자 화면에는 색인·등급·위험도·검수 상태·권리·출처 필터와 JSON/CSV 큐를 추가했으며 기존 인증/noindex를 유지합니다.
- `playwright.config.js`, `qa/site.spec.js`, `lighthouserc.cjs`와 GitHub Actions로 모바일·태블릿·데스크톱 브라우저 QA, axe critical 검사, Lighthouse 3회 중앙값, 실패 artifact를 구성했습니다. Chrome이 설치되지 않은 CI에서는 Playwright Chromium 설치를 시도합니다.
- `production-monitoring.yml`은 주 3회 운영 홈·robots·sitemap·news sitemap·RSS의 응답 및 XML을 확인하고 artifact만 남깁니다. 운영 데이터를 수정하지 않습니다.

### 3차 통계

| 항목 | 결과 |
|---|---:|
| 전체 기사 | 463 |
| index / noindex | 170 / 293 |
| sitemap / news sitemap | 212 / 11 |
| index 대표 이미지 | 170/170 |
| index 자체 편집 카드 | 170 |
| index 유효 이미지 권리 미분류 | 0 |
| 권리 불명 외부 원본(재복제 없음) | 87 |
| 외부 이미지 응답 성공 / 실패 | 87 / 0 |
| 외부 이미지 HTTP / HTTPS | 5 / 82 |
| 중계 URL resolved / candidate / unresolved / rejected / manually-approved | 0 / 0 / 187 / 0 / 0 |
| 임상 위험도 low / medium / high | 111 / 211 / 141 |
| 명시적 작성자·감수 프로필 | 0건 생성(가짜 정보 방지) |
| 홈페이지 HTML | 157,971 bytes |
| 검색 전체 JSON / 첫 shard | 151,602 / 133,553 bytes |
| RSS 본문 누락 | 0 |

### 3차 검증 결과

- `npm ci`: 성공. 설치 후 `npm audit --omit=dev`: production 취약점 0건.
- `npm test`: 성공, 기존 12개를 유지하고 신규 2개를 추가해 14개 통과.
- `npm run check`: 성공. 전체 build·validate 포함.
- `npm run seo:audit`: 성공, 170 index·293 noindex·212 sitemap·치명 0·경고 0.
- `npm run image:rights`: 463개 감사, index 이미지 170/170, 권리 미분류 유효 이미지 0, 외부 응답 실패 0.
- `npm run source:resolve -- --dry-run`: 187개 모두 상태 기록, 자동 적용 0. `npm run source:review`: 후보·미해결 수동 큐 출력.
- `npm run test:browser`: 390×844·768×1024·1440×1000에서 12/12 통과. 콘솔 오류·로컬 요청 실패·깨진 이미지·robots/canonical/H1·axe critical·키보드 포커스 오류 0.
- `npm run lighthouse`: 홈·대표 기사·주제 허브 각 3회 실행. 중앙값은 `reports/lighthouse-summary.json/.md`에 URL별로 저장했으며 Performance/Accessibility/Best Practices/SEO 치명 기준과 CLS/LCP 경고 기준을 통과했습니다.
- `npm run monitor:production`: 운영 endpoint 5/5 HTTP 200, XML critical 0. sitemap 212개 URL, 대표 URL 응답 200·canonical 일치·noindex 없음, 급격한 sitemap 변동 경고 없음.
- JSON-LD·sitemap/news sitemap/RSS XML·내부 링크·noindex/sitemap 충돌: 0건.

### 남은 사람 검수

- `reports/source-resolution.md`의 187개 큐를 매체 공식 사이트에서 제목·발행일·canonical과 대조하고 승인 URL을 `source-review` CLI로 명시적으로 기록합니다.
- `reports/image-rights-audit.md`의 87개 원본 외부 이미지에 사용 권한·크레딧·라이선스를 확인합니다. 확인 전에는 자체 호스팅·license 표기를 하지 않습니다.
- high 141개와 medium 211개의 임상 표현, 연구 대상·연구 유형·표본 수·상관/인과·약물 용량·국내 적용 표현을 우선 검수합니다. 현재 기사는 기존 정책에 따라 일괄 noindex하지 않았습니다.
- 실제 작성자·편집자·수의사 감수자가 확인된 경우에만 `data/authors.json`, `data/reviewers.json`과 기사 필드를 입력합니다.
- Cloudflare preview에서 모바일 메뉴, 실제 외부 원문 링크, 카드 시각 품질을 확인합니다.

### Search Console·네이버 확인

- Google Search Console에서 `sitemap.xml`과 `news-sitemap.xml` 처리 상태, 발견 URL 212개, 의도한 noindex 293개, canonical/중복/크롤링 오류를 확인합니다.
- 뉴스·Discover 노출은 대표 이미지·발행 시각·정책 위반·수동 조치 여부를 별도 확인합니다. Lighthouse 점수는 검색 노출 보장이 아니라 회귀 기준으로 사용합니다.
- 네이버 서치어드바이저에서 sitemap/RSS 수집 성공, 모바일 사용성, canonical·noindex·리디렉션, 색인 제외 사유를 확인합니다.

### production 배포 체크리스트

- PR CI와 Cloudflare Pages preview에서 `npm test`, `npm run check`, `npm run seo:audit`, Playwright, Lighthouse가 통과할 것
- 원출처·이미지 권리·임상 high/medium 우선 큐에 대한 사람 검수 정책을 확인할 것
- 현재 170/293 index 정책과 주요 URL을 비교하고 sitemap에 noindex URL이 없을 것
- production 배포 후 홈페이지, 대표 index/noindex 기사, 주제, archive, RSS, sitemap, robots, 이미지·관리자 인증 smoke test
- 서비스워커 캐시 `vmcache-v6` 갱신과 운영 Search Console·네이버 수집 상태를 확인할 것

### 3차 최종 배포 결과

- feature commit: `01345dbb49276b6ce72e2f3869862564159ddaed` (`feat: add editorial review and production observability`)
- CI 보정 commit: `ed5527aefbd5f11ab6c9c714fe38df337d1a13fb` (`fix: align Playwright browser cache in CI`)
- PR: [#5](https://github.com/kinggorae/vetman-briefing/pull/5)
- merge commit: `642b69edaeacd0dc57fac3b14869fa481e716881`
- Cloudflare Pages: 기존 `vetman-briefing` 프로젝트 `main` 배포 `a9cc129d` 완료. 새 프로젝트는 만들지 않았습니다.
- PR quality CI: 최초 Playwright 캐시 경로 불일치를 수정한 뒤 npm test/build/validate/seo audit, Playwright 12건, Lighthouse 3 URL×3회 모두 성공.
- preview 및 production smoke: 홈페이지, index/noindex 기사, 주제, archive, weekly, robots, sitemap, news sitemap, RSS, 대표 편집 카드 모두 HTTP 200.

## 12. 4차 고도화: editorial operations·source registry·search performance

작성 브랜치: `codex/editorial-operations-growth`
기준: `origin/main` 최신 production 반영본
현재 상태: PR #6 merge 및 기존 `vetman-briefing` production smoke 확인 완료

### 핵심 설계

- `src/lib/editorial-operations.js`에 `draft → automated → editor-review-required → vet-review-required → approved → published`와 `correction-required`, `archived`, `legacy-published` 상태를 명시했습니다. 기존 463개 기사는 파일을 변경하지 않고 읽기 시 `legacy-published`로만 호환합니다.
- `scripts/review-cli.js`는 기본 dry-run이며, 등록된 `data/editorial/people.json`의 reviewerId, 역할, 직접 원출처 URL, 전체 체크리스트를 확인해야 `--apply`가 가능합니다. 원자적 저장과 `data/editorial/reviews.jsonl` 감사 로그를 사용하고, contentHash/sourceHash가 달라지면 재검수 큐에 표시합니다. 현재 people.json은 빈 배열이며 가짜 reviewed 상태는 0건입니다.
- `src/publish.js`는 draft를 바로 published로 바꾸지 않습니다. 계약·품질·승인 상태를 모두 확인하고, high-risk는 vet 역할 승인 없이는 발행하지 않습니다. `src/run.js --publish`도 기존 호출 호환만 유지하고 draft로 저장합니다.
- `data/sources/registry.json`은 기존 매체 설정·저장소 내 직접 URL만 근거로 생성합니다. 추측 도메인은 확정하지 않으며, 상위 매체 RSS/Atom 후보는 캐시·제목 유사도·날짜·공식 도메인 검사를 거쳐 후보로만 제시합니다. `source:approve --apply`도 HTTPS·등록 도메인·개별 기사·제목 근거를 검증하고 sourceUrlRaw와 변경 이력을 보존합니다.
- `src/lib/evidence.js`와 기사 템플릿은 원문에서 확인된 연구 유형·대상 종·표본 수·중재·비교군·주요 결과·근거 수준·한계·저널·DOI·기관·연구비·이해상충만 표시합니다. 숫자 불일치는 자동 수정하지 않고 warning 큐로 남깁니다.
- `data/topic-intent.json`에 검색 의도와 사람이 관리하는 10개 핵심 허브를 분리했습니다. 기존 15개 URL은 유지하며 5개 이상 index 기사와 고유 intro 조건을 계속 적용합니다.
- `scripts/seo-performance.js`는 GSC와 네이버 CSV를 로컬에 가져오고, 관리자 화면에는 실제 데이터가 없을 때 빈 상태만 보여 줍니다. `.env.example`에는 선택적 API 변수명만 기록하고 secret은 저장하지 않았습니다.
- 관리자 검수 센터는 기존 Bearer 인증·noindex를 유지하며 상태 변경 API를 공개하지 않습니다. Git CLI를 통한 변경만 허용하고 검색 성과는 읽기 전용으로 제공합니다.

### 4차 통계

| 항목 | 결과 |
|---|---:|
| 기사 / index / noindex | 463 / 170 / 293 |
| 검수 상태 | legacy-published 463 · 신규 명시 상태 0 |
| index 상태 high-risk 검수 대기 | 75 |
| index 상태 medium-risk 검수 대기 | 93 |
| contentTier 추론 | analysis 147 · evidence 101 · brief 215 |
| 원출처 중계 기사 | 187 |
| source 후보 / resolved / unresolved / rejected / manually-approved | 0 / 0 / 187 / 0 / 0 |
| 매체 레지스트리 / 활성 매체 / RSS 설정 | 199 / 27 / 13 |
| 연구 메타데이터가 있는 기사 | 101 |
| 수치 경고 기사 | 64 (warning, 자동 수정·자동 noindex 없음) |
| GSC/네이버 가져온 행 | 0 / 0 (빈 상태 정상) |
| 대표 이미지 / sitemap / news sitemap | 170/170 / 212 / 11 |

### 4차 검증 결과

- `npm ci`: 성공. 설치 과정에서 dev dependency의 npm 경고가 있었으나 `npm audit --omit=dev`: 0 vulnerabilities.
- `npm test`: 성공, 16개 통과(기존 테스트 삭제·완화 없음).
- `npm run check`: 성공. build와 validate 포함.
- `npm run seo:audit`: 성공, 170 index·293 noindex·sitemap 212·news sitemap 11·치명 0·경고 0.
- `npm run review:stats`, `npm run review:next`, `npm run source:stats`, `npm run source:registry:audit`: 성공. 187개 중계 URL이 모두 검수 큐에 기록됨.
- `npm run test:browser`: 390×844·768×1024·1440×1000에서 12/12 통과. axe critical·콘솔/요청 실패·깨진 이미지·canonical/robots/H1 회귀 0.
- `npm run lighthouse`: 홈·대표 기사·감염·백신 허브를 3회씩 실행. 중앙값 Performance 100, Accessibility 95~96, Best Practices 100, SEO 100, 최대 CLS 0.028, 최대 LCP 약 1.9초, warning 0.
- JSON-LD·sitemap/news sitemap/RSS XML·내부 링크·index/noindex 일치: 0 오류.
- 인앱 브라우저 런타임은 제공되지 않아 별도 브라우저 연결은 수행하지 못했으나, 로컬 HTTP와 저장소 Playwright가 동일 대표 페이지·세 viewport에서 통과했습니다.

### 사람이 당장 처리할 상위 20개 기사

검수 우선순위는 위험도·index 상태·기존 발행 여부를 합산한 큐이며, 아래는 현재 index 상태에서 먼저 확인할 기사입니다.

1. `v1_5a9fbdf10a1f09c8` — 중환자 개에서 전신 면역염증 지표의 예후 예측 가치
2. `v1_2688f13fc6d2660b` — 노령 고양이 근감소증과 악액질, 노쇠: 메커니즘·진단·치료 총론
3. `v1_b1565da63f8497f3` — 개 치경부 결손 재생을 위한 신규 삼중 수화물 Gel 개발
4. `v1_122239e469ae8bb6` — 곰팡이와 박하화합물 병용으로 진드기 사멸 효과 입증
5. `v1_a7b57667e01fa858` — 고양이 유전성 메틸말론산혈증 사례: 임상·MRI·병리 소견
6. `v1_592f1d8e702ec6a0` — 양계장 Biosecurity 실패가 내성 대장균 확산을 주도
7. `v1_a8c8d0ced9731d44` — 쿠싱증후군·프레드니솔론 치료 동반 개에서 혈액응고 과다
8. `v1_97407f7b28526af0` — 퇴원 처방 개선과 환자 결과
9. `v1_9996059839065d8b` — 개 정형외과술 후 비외상성 부신출혈 1례
10. `v1_c3cdce99920a1017` — 소태반 추출물과 노령견 인지 기능 연구
11. `v1_2b0fbe31bd7499f6` — 필리핀 북부 강아지의 인체감염성 요충 연구
12. `v1_06ce49c95607933d` — 개에서 opiranserin 정맥 지속 주입의 진통 효과
13. `v1_cc752d4547496da4` — 개 반척추절제술의 국소 진통 연구
14. `v1_67badcee51a08493` — 젖소 유방염의 음파펄스·냉레이저 요법
15. `v1_94e3799cebd31d4b` — 아키타 수 puppies의 수영 강아지 증후군 사례
16. `2026-07-25_20` — 개 고등급 수막내 희소돌기아교종 사례
17. `2026-07-25_21` — 개 두개골 골화성 섬유종 영상·수술 사례
18. `2026-07-25_22` — 개 진행성 치주염의 세균·엑소솜 연구
19. `2026-07-25_23` — 개 각막 손상 HA 기반 광경화 접착제 사례
20. `2026-07-25_27` — 말 경추 추간공 해부학 연구

### Search Console·네이버에서 내려받을 CSV

- Google Search Console: Performance → Search results → 기간별 Queries, Pages, Countries, Devices CSV. 가능하면 날짜·검색어·페이지·노출·클릭·CTR·평균 게재순위가 포함된 원본을 보존합니다.
- 네이버 서치어드바이저: 검색 유입/검색어·페이지·기간·노출·클릭·CTR·평균 순위 CSV. 실제 UI의 한국어 헤더를 그대로 가져오면 importer가 매핑합니다.
- 가져온 뒤 `npm run seo:import:gsc -- <csv>`, `npm run seo:import:naver -- <csv>`, `npm run seo:performance`를 실행합니다. 성과는 색인·임상 품질 게이트를 자동 완화하지 않습니다.

### 4차 배포 전 체크리스트

- 실제 사람을 `data/editorial/people.json`에 등록하기 전에 이름·역할·자격·프로필 URL을 확인하고, 승인 시 reviewerId를 명시할 것
- `review:approve`의 dry-run 출력과 Git diff를 먼저 확인하고 high-risk에는 vet 역할을 사용할 것
- `reports/source-resolution.json`의 187개 원문 후보를 매체 공식 페이지의 제목·날짜·canonical과 대조한 뒤 하나씩 승인할 것
- 외부 이미지 87개의 사용 권한을 확인하기 전에는 `licensed`·credit·license를 채우거나 자체 호스팅하지 않을 것
- `reports/seo-performance.json`은 실제 GSC·네이버 CSV를 가져온 뒤에만 성과를 해석할 것
- PR CI와 Cloudflare preview에서 전체 테스트·Playwright·Lighthouse를 재실행하고 기존 170/293·212/11·주요 URL을 비교할 것
- PR #6 merge 후 production smoke에서 홈페이지·robots·sitemap·news sitemap·RSS·주제 허브 5/5 HTTP 200과 critical 0을 확인할 것

### 4차 최종 배포 결과

- feature commit: `181b15bf311b9bcfad2a85cdb3605110958b2f52` (`feat: add editorial operations and search performance workflow`)
- CI 보정 commit: `df80141` (`fix: avoid redundant Playwright system dependency install`)
- PR: [#6](https://github.com/kinggorae/vetman-briefing/pull/6)
- merge commit: `88b9d10497c2a3f01404dd76f26e56ec27cc44e6`
- production: 기존 Cloudflare Pages 프로젝트 `vetman-briefing`의 `https://news.vetmanlab.com/`에서 운영 smoke 확인 완료. 새 프로젝트는 만들지 않았습니다.
- production 확인: 홈페이지·robots.txt·sitemap.xml·news-sitemap.xml·rss.xml·주제 허브 HTTP 200, `npm run monitor:production` 5/5 OK·critical 0·warnings 0, sitemap 212개와 news sitemap 11개 유지
- 운영 기사 HTML에서 4차 신뢰·연구 메타데이터 UI를 확인했습니다. Cloudflare 배포 ID와 GitHub deployment status는 Pages 연동이 노출하지 않아 기록하지 않았습니다.
- Cloudflare PR preview: branch/commit preview endpoint가 `Deployment Not Found`를 반환했고 GitHub deployment status도 없었습니다. 이 제한은 숨기지 않고 기록하며, 로컬 Playwright·Lighthouse와 merge 후 production smoke로 대체 검증했습니다.

## 13. 5차 고도화: source-first newsroom·검수 운영·예약 편성

작성 브랜치: `codex/source-first-newsroom`
기준: `origin/main` 최신 production 반영본
배포 원칙: 신규 수집 결과는 사람이 승인하기 전까지 `draft`이며, 기존 463개 기사는 마이그레이션하지 않았습니다.

### 핵심 설계

- `data/sources/registry.json`을 실제 수집 설정으로 확장했습니다. 199개 매체 중 설정된 활성 매체 27개, 공식 RSS/Atom 피드 13개를 보존하고 fetch 전략·속도 제한·타임아웃·상태·실패 누적 필드를 추가했습니다. `sources:list`, `sources:health`, `sources:check`, `sources:discover-feeds`, `sources:disable`, `sources:report`를 제공합니다.
- `src/lib/source-first.js`는 RSS/Atom XML을 메타데이터만 파싱하고, feed URL·GUID·DOI·제목 유사도로 중복을 분류합니다. 공식 기사 페이지는 robots.txt 확인 후 canonical·제목·발행일만 제한적으로 확인하며, 본문 전체를 캐시하지 않습니다. `.source-cache/`는 Git에서 제외됩니다.
- `scripts/ingest.js`는 공식 RSS/Atom을 기본 수집원으로 사용하고 Google News는 이 경로에 포함하지 않습니다. `sourceUrlRaw`, `sourceUrl`, `sourceStatus`, `discoverySource`, `canonicalUrl`, `contentHash`, `metadataHash`, source evidence, AI provenance를 저장하며, 자동 published로 전환하지 않습니다. `--generate`가 없으면 LLM을 호출하지 않습니다.
- 기존 `src/run.js`도 공식 registry 피드를 우선 사용하도록 변경했고 Google News는 `--discover-google-news`를 명시한 발견 신호로만 처리합니다. relay URL은 신규 최종 `sourceUrl`이 될 수 없고, papers-only 경로도 `.draft.json`으로만 저장합니다.
- `src/build.js`는 날짜 형식의 published issue만 공개 build에 포함하고 `.draft.json`과 미래 `scheduledAt`을 제외합니다. relay raw URL은 `sourceUrlRaw`로만 보존하고 화면 링크·`isBasedOn`·citation URL에 재사용하지 않습니다. 기존 URL은 유지됩니다.
- `scripts/generate-review-packets.js`가 index 상태 high 75·medium 93건을 원문·연구 메타데이터·수치 경고·체크리스트와 함께 패킷화합니다. 기존 187개 unresolved relay 기사는 sourceLabel 빈도순 145개 매체 배치, 총 187건으로 `reports/source-review-batches/`에 생성했습니다.
- `scripts/source-registry.js`의 수동 승인도 HTTPS·공식 레지스트리 도메인·HTTP 응답·robots·canonical·원문 제목 유사도·발행일 근접성을 확인합니다. `sourceUrlRaw`와 결정 로그를 보존하며 기본은 dry-run입니다.
- `scripts/schedule.js`와 `schedule:plan/set/cancel`을 추가했습니다. approved 상태와 위험도별 검수 조건을 통과한 문서만 예약 가능하고, 기본은 dry-run입니다. `data/editorial/schedule.jsonl`에 예약·취소 이력을 기록하며 자동 발행은 수행하지 않습니다. 현재 legacy-published만 존재하므로 자동 편성 후보는 0건입니다.
- `docs/SEARCH_CONSOLE_RUNBOOK.md`, GSC·네이버 CSV 헤더 템플릿, `docs/CLOUDFLARE_PREVIEW.md`를 추가했습니다. 실제 인증정보·성과 데이터는 만들지 않았습니다. Branch preview alias는 `codex-source-first-newsroom.vetman-briefing.pages.dev`와 짧은 별칭 모두 404/Deployment Not Found였고, Pages 프로젝트가 Git provider 없이 운영되어 main merge만으로 자동 배포되지 않았습니다. 기존 프로젝트에 Wrangler로 production 배포했습니다.
- `.github/workflows/daily.yml`은 source health와 draft 수집·보고서 artifact만 수행하며 `data/issues/*.json`, `site/`를 자동 발행하지 않습니다. quality CI에도 source health·ingest dry-run·검수 패킷을 추가했습니다.

### 5차 통계

| 항목 | 결과 |
|---|---:|
| 기사 / index / noindex | 463 / 170 / 293 |
| source registry / 활성 매체 / 공식 피드 | 199 / 27 / 13 |
| source health 매체 상태 | healthy 0 · stale 3 · degraded 9 · failing 1 · disabled 186 |
| dry-run 피드 항목 / 고유 후보 | 677 / 569 |
| exact duplicate / update-of-existing | 33 / 75 |
| 관련성 제외 / draft 후보 | 121 / 50 |
| canonical 확인 / verified canonical | 50 / 50 |
| 신규 draft relay sourceUrl | 0 |
| 기존 relay 검수 큐 | 187건 · unresolved 187 |
| source-review 배치 | 145개 매체 그룹 · 187건 |
| 임상 검수 패킷 | 168건 · high 75 · medium 93 |
| 자동 편성 후보 / 예약 발행 | 0 / 0 |
| GSC·네이버 실제 import 행 | 0 / 0 (빈 상태 유지) |

### 5차 검증 결과

- `npm ci`: 성공. 설치 전체 audit에는 dev dependency 경고가 있었으나 `npm audit --omit=dev`: production vulnerabilities 0건.
- `npm test`: 성공, 기존 테스트를 삭제·완화하지 않고 19개 통과.
- `npm run check`: 성공. build·validate 포함. source-first draft 파일과 미래 scheduledAt이 공개 build에 섞이지 않는 경계를 적용했습니다.
- `npm run seo:audit`: 성공, 170 index·293 noindex·sitemap 212·치명 0·경고 0.
- `npm run sources:health`: 성공적으로 리포트를 생성했습니다. 13개 피드 중 1개 네트워크 실패와 stale/degraded 상태는 warning으로 기록했으며 레지스트리·production을 자동 수정하지 않았습니다.
- `npm run ingest:dry`: 성공. 677개 수집 항목·569 unique·33 exact duplicate·75 update 후보·50 draft 후보를 기록했으며 canonical 50건을 확인했습니다. relay 최종 sourceUrl은 0건입니다.
- `npm run review:stats`, `npm run source:stats`, `npm run source:registry:audit`, `npm run review:packets`, `npm run source:review:batches`, `npm run schedule:plan`: 성공. 기존 463건은 모두 legacy-published로 유지되고 실제 reviewed·approved 상태는 생성되지 않았습니다.
- JSON-LD 1,264개 파싱 오류 0, sitemap/news sitemap/RSS XML 파싱 오류 0, sitemap canonical 212개 일치, sitemap 내 noindex 0, 내부 링크 누락 0을 확인했습니다.
- `npm run test:browser`: 390×844·768×1024·1440×1000에서 12/12 통과. 콘솔 오류·로컬 요청 실패·깨진 이미지·axe critical 오류 0.
- `npm run lighthouse`: 3 URL×3회 중앙값 저장. Performance 100, Accessibility 95~96, Best Practices 100, SEO 100, warning 0, 최대 CLS 약 0.028, 최대 LCP 약 1.91초.
- `git diff --check`: 통과. secret 값·API key·Cloudflare token을 코드·로그·보고서에 출력하지 않았습니다.

### 사람이 처리할 우선 작업

1. `reports/source-review-batches/001-dvm360.md`부터 공식 사이트의 개별 기사·canonical·제목·발행일을 대조하고 `npm run source:approve -- ARTICLE_ID URL --apply`를 한 건씩 수행합니다.
2. `reports/clinical-review-packets.json`의 high 75건을 먼저 원문과 대조합니다. 표본 수·대상 종·연구 유형·약물/단위·상관/인과·한계·국내 적용 문구를 체크하고 실제 수의사만 vet reviewer로 등록합니다.
3. medium 93건은 임상 행동 권고 여부에 따라 editor 또는 vet 검수 경로를 선택합니다. 기존 기사를 자동 approved로 변경하지 않습니다.
4. `reports/source-health.md`의 Veterinary Evidence failing 피드와 stale/degraded 피드의 공식 RSS URL·robots·이용약관을 사람이 확인합니다.
5. GSC·네이버 실제 CSV를 보안 경로에서 내려받은 뒤 import하여 CTR·5~20위·색인 제외·News/Discover를 비교합니다.

### 5차 배포 체크리스트

- source health 실패가 단순 네트워크 warning인지 공식 피드 변경인지 확인
- PR CI에서 `npm ci`, 전체 테스트, SEO audit, source health, ingest dry-run, Playwright, Lighthouse를 재실행
- `data/drafts`와 `.draft.json` 외에 신규 published/index 문서가 생기지 않았는지 확인
- 기존 170/293, sitemap 212/11, canonical, 주요 URL, 이미지 170/170을 비교
- Cloudflare Pages 기존 `vetman-briefing` preview가 실제 commit을 가리키는지 확인하고, preview가 없으면 production을 대체 경로로 사용하지 않기
- merge 전 임상·원출처·이미지 권리 사람이 승인하지 않은 상태가 reviewed/approved로 바뀌지 않았는지 확인
- production 배포 후 홈페이지·대표 기사·주제·archive·weekly·RSS·sitemap·robots smoke test와 Search Console·네이버 수집 상태 확인

### 5차 최종 배포 결과

- feature commit: `02ac82a94b81b4adf19be3be04487f101993f449` (`feat: build source-first newsroom ingestion pipeline`)
- PR: [#8](https://github.com/kinggorae/vetman-briefing/pull/8)
- merge commit: `6bc8686604f858f209627a99a519417de84e102f`
- production deployment: 기존 Cloudflare Pages 프로젝트 `vetman-briefing`에 `main` 환경으로 배포 완료. deployment URL은 `https://75986d5a.vetman-briefing.pages.dev`이며 custom domain `https://news.vetmanlab.com/`에 반영되었습니다. 새 프로젝트는 만들지 않았습니다.
- production smoke: 홈페이지·robots.txt·sitemap.xml·news-sitemap.xml·rss.xml·대표 기사 모두 HTTP 200. production sitemap 212개, news sitemap 11개, RSS 50개 item과 전체 본문 `content:encoded`을 확인했습니다.
- 배포 직후 production 홈페이지가 로컬 `site/index.html`과 158,089 bytes 및 SHA-256으로 일치함을 확인했습니다.
- PR CI: `quality` workflow 성공. `npm ci`, test/build/validate, SEO audit, source health, ingest dry-run, review/source stats, Playwright, Lighthouse를 모두 통과했습니다.
- 남은 운영 작업: 기존 unresolved relay 187건과 index high/medium 임상 검수 75/93건은 사람 승인 전까지 자동 변경하지 않습니다. 공식 피드 health의 stale 3·degraded 9·failing 1 상태도 계속 모니터링합니다.

## 14. 6차 고도화: newsroom review·reliable feed operations

작성 브랜치: `codex/newsroom-review-feed-health`
기준: 5차가 반영된 `origin/main`
배포 원칙: 기존 170개 index 기사와 canonical을 유지하고, 신규 후보는 모두 draft/preview로만 처리했습니다.

### 구현 내용

- `src/lib/source-first.js`의 피드 fetch에 ETag/If-None-Match, Last-Modified/If-Modified-Since, 304 처리, 응답 크기 제한 2MB, 항목 수 제한, timeout·지수 backoff·재시도, DOCTYPE/ENTITY 차단, 빈 응답 시 기존 캐시 보존, 원자적 캐시 저장을 추가했습니다.
- `scripts/sources.js`에 `sources:diagnose`, `sources:repair`를 추가했습니다. 공식 도메인의 alternate/sitemap에서만 대체 후보를 찾으며 `data/sources/feed-repairs.json`의 사람 승인 항목이 없으면 레지스트리를 변경하지 않습니다. `healthy/quiet/stale/degraded/failing/retired/disabled` 상태를 기록합니다.
- `reports/feed-diagnostics.json`과 Markdown 보고서에 HTTP/redirect/MIME/XML, 최신 게시일·평균 간격, 공식 도메인, canonical 확보율, relay 비율, ETag, Last-Modified, 중복 GUID, 연속 실패와 대체 후보를 저장했습니다. 이번 실행은 13개 피드, stale 1·degraded 11·failing 1이었고, 대체 공식 후보는 5개였습니다.
- `reports/draft-newsroom.json`을 인증 관리자 정적 데이터로 연결했습니다. draft 50건, 통합 큐 218건, update 후보 75건을 위험도·중복 상태·공식 URL·경고·명령과 함께 읽기 전용으로 표시합니다. 공개 기사·sitemap·RSS·탐색 링크에는 draft가 들어가지 않습니다.
- `scripts/updates.js`에 duplicate/minor-update/substantive-update/correction/separate-story/unresolved 분류와 compare/approve/reject CLI를 추가했습니다. 기본 dry-run이며 등록된 실제 reviewerId와 `--apply` 없이는 기록을 적용하지 않습니다. 현재 75개 update 후보는 duplicate 71·unresolved 4로 분류되었고 기존 JSON은 덮어쓰지 않았습니다.
- `data/editorial/terminology.json`과 `language:audit`, `terminology:audit`, `claims:audit`를 추가했습니다. 실제 기사에서 확인할 수 있는 수의학 용어만 등록하고, 한글 내부 ASCII·직역 오류·최초/입증/완치 주장·수치·종·사례보고 일반화를 자동 수정하지 않고 검수 큐로 보냅니다. 이번 감사는 언어 경고 20건, 용어 경고 0건, 임상 주장 경고 64건입니다.
- `publish:package`와 `draft:e2e`를 추가했습니다. 발행 전 패키지는 JSON-LD/RSS/sitemap 포함 여부까지 미리 계산하지만 `previewOnly: true`, `eligibleForPublish: false`로 저장합니다. 조건을 만족한 low-risk 후보 5건을 end-to-end preview까지 수행했고 자동 published는 0건입니다.
- `docs/EDITOR_DAILY_RUNBOOK.md`, `docs/VET_REVIEW_CHECKLIST.md`, `docs/SOURCE_FEED_OPERATIONS.md`, `docs/UPDATE_AND_CORRECTION_POLICY.md`를 추가하고 quality/daily GitHub Actions에 피드 진단·감사·draft preview 리포트 artifact를 연결했습니다.

### 6차 검증 결과

- `npm test`: 22개 통과(기존 19개 + 신규 3개). XML entity/크기 차단, 언어·주장 감사, update 분류 회귀를 포함합니다.
- `npm run build`, `npm run validate`, `npm run seo:audit`: 성공. index/noindex 170/293, sitemap 212, SEO 치명 오류 0을 유지했습니다.
- `npm run sources:diagnose`, `npm run sources:health`: 13개 피드 진단 성공. 실패 피드가 있어도 기존 캐시·레지스트리·기사 데이터는 삭제되지 않았습니다.
- `npm run ingest:dry`: 677개 수집·569 unique·33 duplicate·75 update 후보·50 draft 후보·자동 published 0을 유지했습니다.
- `npm run updates:stats`, `npm run language:audit`, `npm run terminology:audit`, `npm run claims:audit`, `npm run review:queue`, `npm run draft:e2e`: 모두 성공했습니다.
- `npm audit --omit=dev`: production 취약점 0건.
- 남은 브라우저/ Lighthouse 검증은 5차에서 통과한 Playwright 390/768/1440과 Lighthouse 기준을 유지하며 CI에서 재실행하도록 workflow에 포함했습니다.

### 사람 검수 우선순위

1. index high-risk 75건: 원문·대상 종·수치·약물·연구 유형을 수의사가 확인
2. 언어 경고 20건과 임상 주장 경고 64건: 원문과 한글 문장 대조
3. update 후보 75건: duplicate 71건의 대표 원출처와 unresolved 4건의 판단
4. feed stale/degraded/failing: 공식 피드 변경·robots·이용약관 확인 후 대체 피드 승인 여부 판단
5. GSC·네이버 실제 CSV를 내려받아 성과 대시보드에 import

6차 브랜치는 이 보고서와 검증 산출물을 포함해 PR 전 상태로 정리하며, 실제 사람 승인 없이 기존 기사나 신규 draft를 published/approved로 변경하지 않습니다.

### 6차 최종 배포 결과

- feature commit: `d350de9` (`feat: add newsroom review and reliable feed operations`)
- PR: [#10](https://github.com/kinggorae/vetman-briefing/pull/10)
- merge commit: `0359a12488efc2260c8b224bf22149eb5b0f2d0a`
- CI: GitHub Actions `quality` 성공. Playwright 12개와 Lighthouse 3 URL×3회 중앙값 검증을 포함합니다.
- production deployment: 기존 Cloudflare Pages 프로젝트 `vetman-briefing`의 main 배포 완료. deployment URL `https://b3ae2ca5.vetman-briefing.pages.dev`, custom domain `https://news.vetmanlab.com/`에 반영했습니다. 새 프로젝트는 만들지 않았습니다.
- production smoke: 홈페이지·robots.txt·sitemap.xml·news-sitemap.xml·rss.xml 모두 HTTP 200; sitemap 212 URL, news sitemap 11 URL, RSS 50 item/50 content:encoded를 확인했습니다.
- production security smoke: `/admin-ui.html`은 `noindex,nofollow`, 인증 없는 `/api/admin?resource=audit`는 HTTP 401입니다.
- 배포 후 상태: index/noindex 170/293, 자동 published 0건, feed stale 1·degraded 11·failing 1. 사람 검수가 필요한 high-risk 75건, 언어 경고 20건, 임상 주장 경고 64건은 자동 승인하지 않았습니다.

## 15. 7차 고도화: shadow newsroom·controlled publishing

작성 브랜치: `codex/shadow-newsroom-rollout`
기준: 6차 production 반영 후 `origin/main`
배포 원칙: 기존 index/noindex 170/293과 canonical을 유지하고, shadow 산출물과 신규 draft는 공개 site·sitemap·RSS에 넣지 않았습니다.

### 구현 내용

- `scripts/sources.js`에 `reports/feed-history.json` 누적 이력을 추가했습니다. HTTP/redirect·MIME·XML·최신 게시일·발행 간격·canonical/relay·ETag/Last-Modified·GUID·오류를 실행별로 기록하고, 성공 3회 전에는 healthy로 확정하지 않습니다. 저빈도 정상 피드는 quiet 후보로 구분할 수 있는 상태 체계를 유지합니다.
- `scripts/validate-feed-candidates.js`와 `npm run sources:repair:validate`를 추가했습니다. 기존 5개 대체 후보를 공식 도메인·XML·최근 항목·canonical·relay·GUID·3회 성공 이력으로 검증하며, 이번 실행은 approved-candidate 0·needs-human-review 5·rejected 0·retired-source 0이었습니다. 레지스트리나 source URL은 자동 변경하지 않았습니다.
- `.github/workflows/shadow-newsroom.yml`을 추가했습니다. 매일 05:30 KST와 수동 실행을 지원하고 source 진단·ingest dry-run·중복/update·언어/용어/주장 감사·첫 발행 후보·검수 패킷을 artifact와 Step Summary에 남깁니다. `contents: read`만 사용하며 data/issues·published·sitemap·RSS·PR merge·production을 수정하지 않습니다.
- `scripts/shadow-newsroom.js`는 실제 실행 결과만 `reports/shadow/YYYY-MM-DD/`와 누적 이력에 저장하고, 최대 10개 후보 패킷에 원문 메타데이터·한글 초안·연구/수치/약물·경고·중복·이미지·JSON-LD·체크리스트·CLI를 포함합니다. 오늘 실행은 수집 677·unique 569·duplicate 33·update 75·draft 50·패킷 10·자동 published 0이며, 실제 실행 1회뿐이므로 추세를 계산하지 않았습니다.
- `scripts/publish-control.js`의 prepare/validate/approve/release/rollback을 추가했습니다. 기본 dry-run, 실제 `people.json` reviewerId와 역할, 완료 체크리스트, 공식 source/canonical, 품질·이미지 권리·중복·JSON-LD 검사를 요구하며, 승인 후 contentHash 변경·high-risk 비수의사·unresolved source·미승인 상태는 fail-closed로 차단합니다. release는 원자적 저장·backup·이력만 수행하고 자동 commit/push하지 않습니다.
- `scripts/first-publish-candidates.js`로 기존 low-risk preview 5개를 재분류했습니다. 5개 모두 한국어 제목·리드·본문 초안이 없어 `needs-language-fix`이며 ready-for-editor 0·needs-source-fix 0·duplicate 0·rejected 0입니다. 실제 reviewer가 0명이므로 published로 전환하지 않았습니다.
- `src/build.js`와 관리자 정적 데이터에 최근 shadow 실행·패킷·피드 복구 검증·첫 발행 후보·GSC/Naver 빈 상태를 연결했습니다. `functions/admin-review.json.js`를 추가해 `admin-review.json` 직접 접근도 Bearer 인증 없이는 401이 되도록 했고, 관리자 화면은 읽기 전용 noindex/nofollow로 유지했습니다.
- 운영 문서 `docs/SHADOW_NEWSROOM_OPERATIONS.md`, `docs/PUBLISH_CONTROL_RUNBOOK.md`, `docs/FEED_HEALTH_HISTORY.md`와 7차 CI artifact 설정을 추가했습니다. GSC/Naver 성과 데이터는 실제 CSV가 없으므로 0행 빈 상태이며 가짜 추세를 생성하지 않았습니다.

### 7차 검증 결과

- `npm ci`: 성공. 설치 전체 audit에는 기존 dev dependency 경고가 있었으나 `npm audit --omit=dev`: production vulnerabilities 0건.
- `npm test`: 25개 통과(기존 22개 + shadow/publish 회귀 3개). unregistered reviewer 승인 실패, shadow 공개 플래그, 5개 첫 발행 후보 unpublished 상태를 확인했습니다.
- `npm run check`, `npm run build`, `npm run validate`, `npm run seo:audit`: 성공. index/noindex 170/293, sitemap 211, SEO critical 0을 유지했습니다. UTC runner에서 발견된 `weekly/2026-W31` noindex·sitemap 불일치를 `weeklyIssue()` 공통 판정으로 수정했습니다.
- `npm run sources:diagnose`, `npm run sources:repair:validate`, `npm run sources:health`: 성공. 공식 피드 13개는 stale 1·degraded 11·failing 1이며 후보 5개 모두 사람 검토 대기입니다.
- `npm run shadow:run`, `npm run shadow:trend`: 성공. shadow 실행은 success, 검수 패킷 10개, 자동 published 0개, 실제 실행 1회로 trendAvailable false입니다.
- `npm run ingest:dry`, `npm run updates:stats`, `npm run language:audit`, `npm run terminology:audit`, `npm run claims:audit`: 성공. 677 수집·569 unique·33 duplicate·75 update·50 draft, update duplicate 71·unresolved 4, 언어 경고 20·용어 0·임상 주장 64를 기록했습니다.
- `npm run publish:prepare`와 `publish:validate`: preview-only로 성공했습니다. 등록되지 않은 reviewer를 사용한 `publish:approve`는 비정상 종료했으며 승인 기록을 만들지 않았습니다. 자동 published 0건입니다.
- Playwright: 390/768/1440 viewport 12개 통과. 콘솔/요청 실패·깨진 이미지·axe critical 0, 관리자 직접 JSON 접근 401을 확인했습니다.
- Lighthouse CI: 3 URL×3회 중앙값 성공, Performance 99~100, Accessibility 95~96, Best Practices 100, SEO 100, 최대 CLS 0.028, 최대 LCP 약 2.06초, warning 0입니다.
- JSON-LD/XML/internal link와 git diff check는 배포 전 최종 단계에서 재실행합니다.

### 사람이 다음으로 수행할 정확한 승인 절차

1. 실제 편집자 또는 수의사의 확인된 프로필을 `data/editorial/people.json`에 추가하고 역할·전문분야·profile URL을 검증합니다.
2. `npm run publish:first-candidates`에서 `ready-for-editor` 후보를 고르고 `npm run publish:prepare -- <draft-id>`로 패키지를 확인합니다.
3. `npm run publish:validate -- <draft-id>` 결과의 공식 canonical·중복·언어·주장·이미지 권리·내부 링크를 원문과 대조합니다.
4. 체크리스트를 실제로 완료한 뒤 `npm run publish:approve -- <draft-id> --reviewer <id> --checklist=all --apply`를 실행합니다. high-risk는 vet/admin 역할만 승인할 수 있습니다.
5. diff와 contentHash를 다시 확인하고 `npm run publish:release -- <draft-id> --apply`를 별도 PR에서 실행합니다. 승인 후 내용이 바뀌면 release는 거부됩니다.
6. 배포 후 sitemap/RSS/JSON-LD/운영 smoke test를 수행하고 문제가 있으면 `npm run publish:rollback -- <article-id> --apply`로 backup 기반 복구합니다.

### GSC·네이버 다음 단계

- GSC Search results의 기간별 쿼리·페이지·국가·기기 CSV와 Page indexing의 제외 사유를 내려받습니다.
- GSC sitemap 처리 상태, 대표 URL 검사, News/Discover 노출을 확인합니다.
- 네이버 서치어드바이저의 검색 유입·페이지·수집 오류·sitemap/RSS 상태 CSV를 내려받습니다.
- 인증정보를 저장소나 로그에 넣지 않고 `npm run seo:import:gsc -- <csv>`, `npm run seo:import:naver -- <csv>`로 로컬/보안 환경에서만 가져옵니다.

### 7차 배포 결과

- feature commit: `8b8d8b7485705379717cc6948206ae203bc3031f` (`feat: add shadow newsroom and controlled publishing`)
- PR: [#12](https://github.com/kinggorae/vetman-briefing/pull/12), CI `quality` 성공 후 merge
- merge commit: `f5f7814d3c171d57acde99a7b3848eb51876aec9`
- production deployment: 기존 Cloudflare Pages 프로젝트 `vetman-briefing`의 `main` 환경에 배포 완료. deployment URL은 `https://e452210f.vetman-briefing.pages.dev`이며 custom domain `https://news.vetmanlab.com/`에 반영했습니다. 새 프로젝트는 만들지 않았습니다.
- production smoke: `/`, `robots.txt`, `sitemap.xml`, `news-sitemap.xml`, `rss.xml`, `admin-ui.html` HTTP 200. sitemap 211·news sitemap 11·RSS 50 item/50 full `content:encoded`를 확인했습니다. 직접 `/admin-review.json`과 인증 없는 `/api/admin?resource=audit`는 HTTP 401입니다.
- 최종 상태: index/noindex 170/293, 공식 피드 stale 1·degraded 11·failing 1, 복구 후보 needs-human-review 5, shadow 자동 published 0, 실제 reviewer 0명입니다. 기존 high/medium-risk 검수 대기와 unresolved 원출처는 사람이 확인하기 전 변경하지 않았습니다.

## 16. 8차 고도화: editorial QA·first release workflow

작성 브랜치: `codex/editorial-qa-first-release`
기준: 7차 production 반영 후 `origin/main` 최신본
배포 원칙: 기존 170/293 색인 정책과 canonical을 유지하고, 실제 reviewer 0명 상태에서 승인·발행을 생성하지 않았습니다.

### 구현 내용

- `scripts/editorial-qa.js`와 `reports/language-review.json/md`를 추가했습니다. 7차 기준 언어 경고 20건을 `typo`, `terminology`, `untranslated-fragment`, `ambiguous`, `false-positive`로 분류하고 원문 URL·sourceTitle·필드·짧은 근거·신뢰도·의미 변경 여부·사람 검수 필요 여부를 기록합니다. 원문 전체는 저장하지 않습니다.
- `data/editorial/language-rules.json`과 `docs/KOREAN_EDITORIAL_STYLE.md`를 추가했습니다. 약물·용량·질환·종·연구 결론은 자동 교정하지 않고, 등록된 의미 보존 규칙만 안전한 수정 후보로 취급합니다.
- 원문 맥락이 명확한 `병원ugeom→병원 경험`, `조객 참여→조류 관찰자 참여`, `라신County→라신 카운티`, `소장관→소방관`을 수정했습니다. 문법 교정은 `dateModified`를 만들지 않았고 기존 legacy URL은 `legacySlug`로 보존했습니다. 오류 수정으로 기존 noindex 기사 1건이 새로 index되지 않도록 `indexPolicy: legacy-noindex`를 명시했습니다.
- `reports/claim-review.json/md`를 추가해 임상 주장 경고 64건을 `missing-context` 63건, `unit-mismatch` 1건으로 분류했습니다. 원문과 직접 대조하기 전에는 수치·단위·약물·종·연구 결론을 자동 수정하지 않으며, 이번 실행에서 확인된 `critical`은 0건입니다.
- 기존 low-risk 첫 발행 후보 5건은 공식 canonical·unique·low-risk 상태를 유지하지만 한국어 title/lead/body 초안이 없고 LLM 생성이 요청되지 않았으므로 모두 `needs-language-fix`로 보류했습니다. `reports/first-release-candidates-qa.json/md`에 원문 메타데이터와 사람이 작성해야 할 편집 패킷을 남겼으며 ready-for-editor 0, 자동 published 0입니다.
- `scripts/people-cli.js`와 `people:list/validate/add/disable`를 추가했습니다. 실제 입력·명시적 역할·placeholder 차단·수의사 credentials/profile URL 검증·dry-run·원자적 저장을 제공하며, 사람 등록만으로 기존 기사를 승인하지 않습니다. 현재 people 0명입니다.
- 관리자 `admin-review.json`에 언어·주장·첫 발행·people 상태와 GSC/네이버 필수 파일 목록을 연결했습니다. 인증된 관리자 화면은 reviewer 0명일 때 “실제 편집자 등록 필요”를 표시하고 승인·발행을 CLI/Git 검수 기록으로만 제한합니다. 관리자 데이터는 noindex이고 공개 sitemap/RSS에 포함되지 않습니다.
- 피드 진단에서 로컬·PR 테스트가 운영 성공 이력을 조작하지 않도록 `RECORD_FEED_HISTORY=1`일 때만 `feed-history.json`을 누적하게 했습니다. 예약 shadow workflow에만 이 환경변수를 설정했습니다.

### 8차 통계

| 항목 | 결과 |
|---|---:|
| 기사 / index / noindex | 463 / 170 / 293 |
| 언어 경고 기준 / 현재 감사 | 20 / 17 |
| 언어 분류 | untranslated-fragment 11 · false-positive 5 · ambiguous 2 · typo 1 · terminology 1 |
| 안전한 기존 데이터 교정 | 4건 · 의미 변경 0 · dateModified 변경 0 |
| 임상 주장 경고 / critical | 64 / 0 |
| 주장 분류 | missing-context 63 · unit-mismatch 1 |
| first-release 후보 | 5건 · ready-for-editor 0 · needs-language-fix 5 |
| 공식 피드 상태 | healthy 0 · quiet 0 · stale 1 · degraded 11 · failing 1 |
| shadow 실행 | 성공 · 검수 패킷 10 · 자동 published 0 |
| shadow 수집 | 677 · unique 569 · duplicate 33 · update 75 · draft 50 |
| 등록 reviewer | 0명 |
| GSC·네이버 import | 0행 · 실제 CSV 없음 |

### 8차 검증 결과

- `npm ci`: 성공. 설치 전체 audit에는 dev dependency 경고가 있었으나 `npm audit --omit=dev`: production vulnerabilities 0건.
- `npm test`: 성공, 29개 통과. 언어·주장 전체 분류, people CLI placeholder/수의사 필수 필드, legacy noindex 안정성, reviewer 없는 첫 발행 보류 회귀를 포함합니다.
- `npm run check`: 성공. build/validate 포함. index/noindex 170/293과 기존 canonical을 유지했습니다.
- `npm run seo:audit`: 성공. sitemap 211, news sitemap 11, JSON-LD/XML/internal link critical 0, noindex sitemap 충돌 0, index 이미지 170/170입니다.
- `npm run sources:diagnose`, `npm run sources:health`, `npm run ingest:dry`, `npm run updates:stats`, `npm run language:audit`, `npm run terminology:audit`, `npm run claims:audit`, `npm run editorial:review`, `npm run shadow:run`, `npm run people:list`, `npm run people:validate`, `npm run publish:validate`: 성공. shadow 실행은 public false/published 0이며 로컬 실행에서 feed-history를 변경하지 않았습니다.
- Playwright: 모바일 390×844, 태블릿 768×1024, 데스크톱 1440×1000에서 12/12 통과. 콘솔·요청 실패, 깨진 이미지, axe critical 0입니다.
- Lighthouse CI: 3 URL×3회 중앙값. Performance 0.99~1.00, Accessibility 0.95~0.96, Best Practices 1.00, SEO 1.00, 최대 CLS 0.028, 최대 LCP 약 2.06초, warning 0입니다.
- JSON-LD 1,264개 파싱, sitemap/news sitemap/RSS XML 파싱, canonical 회귀 0, 기존 index ID 누락 0, 신규 published 0, `git diff --check`를 확인했습니다.

### 사람이 처리할 정확한 다음 절차

1. 실제 편집자 또는 수의사 확인 정보를 확보한 뒤 `npm run people:add -- --id <id> --name <name> --role <role>`를 dry-run으로 검토합니다. veterinary-reviewer는 확인된 credentials와 HTTPS profile URL 없이는 등록할 수 없습니다.
2. `reports/language-review.md`의 13개 사람 검수 대기 항목과 `reports/claim-review.md`의 64개 항목을 원문에서 대조합니다. 약물·용량·종·사람/동물 연구·결론은 자동 수정하지 않습니다.
3. 첫 발행 후보 5건은 원문을 직접 읽어 한국어 title/lead/body와 권리 확인 이미지를 작성한 뒤 `npm run publish:prepare`, `npm run publish:validate`를 실행합니다.
4. 체크리스트를 실제로 완료한 reviewer만 `npm run publish:approve -- <draft-id> --reviewer <id> --checklist=all --apply`를 실행할 수 있습니다. high-risk는 vet/admin 역할이 아니면 차단됩니다.
5. 승인 후 contentHash를 다시 확인하고 별도 diff 검토 후 `npm run publish:release -- <draft-id> --apply`를 실행합니다. 승인 후 본문이 바뀌면 release는 실패합니다.

### 8차 배포 상태

- feature commit: `6694b6b608384695d76378b24d5acadf8d6ee9de`
- PR: [#14](https://github.com/kinggorae/vetman-briefing/pull/14) — `feat: add editorial language and claim verification workflow`
- merge commit: `b135f9410c8e6260da65e15f83883a7eeed42ec9`
- production: 기존 Cloudflare Pages 프로젝트 `vetman-briefing`의 `main` 환경에 반영했습니다. Deployment URL은 `https://767b6eea.vetman-briefing.pages.dev`이며 custom domain `https://news.vetmanlab.com/`에 smoke test로 확인했습니다. 새 프로젝트는 만들지 않았습니다.
- production smoke: `/`, `robots.txt`, `sitemap.xml`, `news-sitemap.xml`, `rss.xml`, 대표 기사 모두 HTTP 200. sitemap 211·news sitemap 11·RSS 50 item/50 full `content:encoded`를 확인했습니다. 직접 `/admin-review.json`과 인증 없는 `/api/admin?resource=audit`는 HTTP 401입니다.
- 최종 불변 조건: index/noindex 170/293, canonical 변경 0, reviewer 0, 자동 published 0, draft 공개 0, sitemap/noindex 충돌 0, production secret 출력 0.
- PR CI: `quality` 성공. production 취약점 0건, Playwright 12/12, Lighthouse warning 0입니다.

## 17. 9차 고도화: no-reviewer-safe publishing

작성 브랜치: `codex/no-reviewer-safe-publishing`
기준: 8차 production 반영 후 `origin/main` 최신본
운영 전제: 실제 등록 reviewer 0명, 수의사 감수자 0명. 이번 단계에서도 신규 기사를 발행하거나 승인 상태로 바꾸지 않았습니다.

### 운영 모드와 공개 정책

- `data/editorial/settings.json`에 `editorialMode: organization-only`, `veterinaryReviewerAvailable: false`와 실제 조직명·About URL을 명시했습니다.
- 신규 high-risk는 `blocked-clinical`, 신규 medium-risk는 `internal-draft` 또는 `public-brief(noindex)`, 신규 low-risk는 모든 자동 검사 통과 시에만 `public-brief(noindex)` 대상입니다. 신규 `index-analysis`는 사람 편집 검수 기록 없이는 색인될 수 없습니다.
- public brief 미리보기·발행 전 패키지는 작성 주체를 `베트맨랩` Organization으로 표시하고 reviewer를 `null`로 유지합니다. sitemap·news sitemap·기본 RSS에는 포함하지 않습니다. 이번 실행에서 public brief release와 자동 published는 모두 0건입니다.
- 기존 legacy-published 463개는 일괄 상태 변경하지 않았고 index/noindex 170/293을 유지했습니다. 기존 기사에는 작성 주체, AI 사용 기록, 사람 편집 검수 기록, 수의사 감수자 없음, 임상 정보 면책을 신뢰 패널로 표시합니다.
- 관리자 화면은 reviewer 0명 상태, 등록 절차, high-risk 차단 사유를 표시하며 기존 인증·읽기 전용 경계를 유지합니다. `people:add`·기존 publish workflow는 실제 사람 등록 시 활성화할 수 있도록 보존했습니다.

### 언어·주장 검수

- `reports/language-review.json/md`의 경고 20건을 모두 분류했습니다: 미번역 조각 11, false positive 5, ambiguous 2, typo 1, terminology 1. 원문 근거가 없는 약물·용량·종·결론은 자동 수정하지 않았습니다.
- `reports/claim-review.json/md`의 임상 주장 경고 64건은 missing-context 63건과 unit-mismatch 1건입니다. missing-context는 species context 31, human population context 21, source detail 11로 세분화했고 나머지 분류는 0건입니다.
- unit-mismatch 후보 `2026-07-21_24`는 [PubMed 초록](https://pubmed.ncbi.nlm.nih.gov/42348039/) 및 [저널 메타데이터](https://link.springer.com/article/10.1007/s11259-026-11367-1)와 대조한 결과 2.33 mg/kg, 5.98 mg/kg, 약 61% 감소가 일치했습니다. 단위 변환·정정·`updatedAt` 변경은 하지 않았습니다.
- 기존 463개 기사 중 안전하지 않은 임상 명령 표현 6건은 legacy 검수 큐로 보냈고, 검증된 critical 0건이므로 기존 index 170개를 일괄 차단하지 않았습니다.
- 감수자 없는 콘텐츠에서 `반드시 투여`, `권장 용량`, `치료해야 한다`, `안전하다`, `효과가 입증됐다`, `완치`, `즉시 약물 사용`, `진단할 수 있다`, `예방할 수 있다` 등의 표현을 public brief 품질 게이트에서 차단합니다.

### Low-risk 첫 후보와 CLI

- 기존 low-risk 후보 5개는 모두 `needs-language-fix`입니다. 안전하게 작성된 한국어 title/lead/body와 권리 확인 이미지를 확인할 수 있는 후보가 없어 `ready-public-brief` 0건으로 유지했습니다.
- `reports/no-reviewer-low-risk-candidates.md`와 `reports/briefs/`에 dry-run 패키지를 생성했습니다. `brief:prepare`, `brief:validate`, `brief:preview`, `brief:release --apply`를 제공하지만 현재 후보의 validate는 한국어 본문·이미지 부재로 의도적으로 실패합니다.
- `people:list`와 `people:validate` 결과는 people 0명·유효성 통과입니다. 실제 입력 없이 사람을 생성하지 않았고, placeholder·빈 이름·수의사 credentials/profile URL 없는 등록을 거부합니다.

### 검증 결과

- `npm ci`: 성공. 설치 시 dev dependency deprecated/vulnerability 안내가 있었으나 `npm audit --omit=dev`: production vulnerability 0건.
- `npm test`: 33개 통과. reviewer 없음 정책, Organization 작성자, public brief noindex, 임상 명령 차단, low-risk 후보 보류, 기존 legacy 보호를 회귀 테스트했습니다.
- `npm run check`: 성공. build/validate 포함, index/noindex 170/293, sitemap 211, noindex 충돌 0.
- `npm run seo:audit`: 성공. critical 0, sitemap noindex 0, broken internal links 0, index image 170/170.
- `npm run language:audit`, `npm run claims:audit`, `npm run people:list`, `npm run people:validate`, `npm run brief:prepare`: 성공. `brief:validate`는 후보 차단 사유를 반환하며 의도된 fail-closed 결과입니다.
- `npm run shadow:run`: 성공, 수집 677·unique 569·duplicate 33·update 75·draft 50·검수 패킷 10·자동 published 0. 로컬 실행 전후 운영 shadow history는 2회로 동일했습니다. 예약 workflow에서만 `RECORD_FEED_HISTORY=1` 및 `RECORD_SHADOW_HISTORY=1`을 사용합니다.
- Playwright: 390×844, 768×1024, 1440×1000에서 12/12 통과. 콘솔·요청 실패·깨진 이미지·axe critical 0.
- Lighthouse CI: 3 URL×3회 중앙값, Performance 100, Accessibility 95~96, Best Practices 100, SEO 100, CLS 최대 0.028, 기사 LCP 1.72초. warning 0건입니다.
- 기사 HTML 463개 canonical 463/463, index 170·noindex 293, JSON-LD 파싱 오류 0. stale `VetManLab 편집팀` 작성자 문자열은 생성 결과에서 0건입니다.

### 배포 상태

- feature commit: `2933668e44982d5ce89364ff15b42c5008d4e33d` (`feat: support transparent publishing without veterinary reviewers`)
- PR: [#16](https://github.com/kinggorae/vetman-briefing/pull/16), `quality` CI 성공 후 merge
- merge commit: `c447917d7b318562e42b9eafe452ebcbf7a2e5e5`
- production: 기존 Cloudflare Pages 프로젝트 `vetman-briefing`의 `main` 환경에 배포 완료. Deployment URL은 `https://4b05594b.vetman-briefing.pages.dev`이며 custom domain `https://news.vetmanlab.com/`에 반영했습니다. 새 프로젝트는 만들지 않았습니다.
- production smoke: `/`, `/robots.txt`, `/sitemap.xml`, `/news-sitemap.xml`, `/rss.xml`, `/about`, 대표 기사 HTTP 200. sitemap 211·news sitemap 3·RSS 50 item/50 full `content:encoded`를 확인했습니다. `/admin-review.json`과 인증 없는 `/api/admin?resource=audit`는 HTTP 401입니다.
- production 대표 기사 JSON-LD author는 `베트맨랩` Organization이며 “현재 등록된 수의사 감수자가 없습니다”를 표시합니다. public brief·brief RSS·신규 published는 0건입니다.
- 최종 불변 조건: index/noindex 170/293, reviewer 0명, 자동 published 0건, 신규 index-analysis 0건, sitemap/noindex 충돌 0건, production secret 출력 0건.
