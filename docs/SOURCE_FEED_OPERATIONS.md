# 공식 피드 운영

공식 RSS/Atom과 공식기관·학회 피드를 우선한다. Google News relay는 발견 신호일 뿐 최종 sourceUrl이 아니다.

`npm run sources:diagnose`는 HTTP 상태, redirect, MIME/XML, 발행 간격, canonical, GUID, ETag, Last-Modified, 실패 누적을 기록한다. 정상이나 발행 빈도가 낮은 피드는 `quiet`로 구분한다. 대체 후보는 공식 도메인의 `rel=alternate`, sitemap, RSS 안내에서만 찾고 `data/sources/feed-repairs.json`에 사람이 승인한 항목이 있을 때만 `npm run sources:repair -- --apply-approved`가 반영한다.

피드 캐시는 `.source-cache/feeds`에 원자적으로 저장한다. ETag와 Last-Modified를 사용하며 304, timeout, 응답 크기 제한, 재시도·백오프를 적용한다. 실패하거나 빈 응답이 오면 기존 정상 캐시를 삭제하거나 덮어쓰지 않는다.

보고서: `reports/feed-diagnostics.json`, `reports/feed-diagnostics.md`, `reports/source-health.json`.
