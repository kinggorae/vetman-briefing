# 공식 피드 운영

공식 RSS/Atom과 공식기관·학회 피드를 우선한다. Google News relay는 발견 신호일 뿐 최종 sourceUrl이 아니다.

`npm run sources:diagnose`는 HTTP 상태, redirect, MIME/XML, 발행 간격, canonical, GUID, ETag, Last-Modified, 실패 누적을 기록한다. 정상이나 발행 빈도가 낮은 피드는 `quiet`로 구분한다. 대체 후보는 공식 도메인의 `rel=alternate`, sitemap, RSS 안내에서만 찾고 `data/sources/feed-repairs.json`에 사람이 승인한 항목이 있을 때만 `npm run sources:repair -- --apply-approved`가 반영한다.

## 공급량 확장 기준

`data/source-publishers.json`이 공식 소스의 원본 목록이고, 변경 후에는 `npm run source:registry:generate`로 `data/sources/registry.json`을 재생성한다. RSS가 HTTP 200을 반환하더라도 robots.txt가 해당 피드 수집을 막으면 등록하지 않는다. 직접 원문을 우회하지 않고, 허용된 Oxford·대학·공식 학술지 피드와 PubMed를 우선한다.

현재 source-first 일간 기준은 활성 소스 48개 이상, RSS/Atom 피드 35개 이상, 후보 풀 260개, 심층 생성 60개다. 발행은 하루 최대 90건을 목표로 하되, 품질 게이트를 통과한 후보가 30건 이상이면 가용분을 먼저 공개해 하루 전체가 결번이 되지 않게 한다.

수집량을 변경할 때는 다음 순서로 확인한다.

1. `npm run source:registry:generate`
2. `npm run sources:check`
3. `npm run ingest:dry -- --pubmed --max=260 --per-source=16`
4. `npm test && npm run validate && npm run seo:audit && npm run retention:guard`

피드 캐시는 `.source-cache/feeds`에 원자적으로 저장한다. ETag와 Last-Modified를 사용하며 304, timeout, 응답 크기 제한, 재시도·백오프를 적용한다. 실패하거나 빈 응답이 오면 기존 정상 캐시를 삭제하거나 덮어쓰지 않는다.

보고서: `reports/feed-diagnostics.json`, `reports/feed-diagnostics.md`, `reports/source-health.json`.
