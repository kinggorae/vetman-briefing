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
현재 상태: 로컬 구현·검증 완료, 사람 승인과 PR/production 배포 전 단계

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
- 승인 전에는 production push, merge, Cloudflare Pages 배포를 수행하지 않을 것
