# VetManLab SEO·품질 고도화 보고서

작성일: 2026-07-29  
작업 브랜치: `codex/seo-hardening`  
기준 커밋: `origin/main` 최신본  
배포·push·PR: 수행하지 않음

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
