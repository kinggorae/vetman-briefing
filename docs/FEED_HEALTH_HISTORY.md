# 피드 상태 이력

`reports/feed-history.json`은 진단 실행별 HTTP 상태, XML 파싱, latency, 항목 수, 최신 게시일, canonical/relay 비율, 오류와 연속 성공 횟수를 저장한다. 3회 연속 성공 전에는 `healthy`로 확정하지 않는다. 저빈도 매체가 최근 오류 없이 정상 응답하지만 게시 간격이 긴 경우 `quiet`로 분리한다.

`npm run sources:diagnose`는 네트워크 진단과 대체 공식 피드 후보 탐색을 수행하고, `npm run sources:repair:validate`는 후보를 `approved-candidate`, `needs-human-review`, `rejected`, `retired-source`로 분류한다. 결과는 레지스트리나 기존 URL을 자동으로 변경하지 않는다.
