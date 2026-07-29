# Shadow 뉴스룸 운영

Shadow 실행은 매일 05:30 KST(UTC 20:30)에 GitHub Actions에서 수행하며 `workflow_dispatch`로 수동 재실행할 수 있다. 이 workflow는 `contents: read` 권한만 사용하고, `data/issues`, published 상태, sitemap, RSS, PR 또는 production을 수정하지 않는다.

## 결과 확인

- Actions의 Step Summary에서 실패 단계와 수집 통계를 확인한다.
- `shadow-newsroom-*` artifact에서 날짜별 `run.json`, `review-packet.json`, Markdown 보고서를 내려받는다.
- 관리자 인증 화면의 Shadow 뉴스룸에서 최근 실행, 최대 10개 검수 후보, 피드 복구 후보와 GSC·네이버 상태를 확인한다.
- 실제 실행 이력이 2회 미만이면 추세를 만들지 않는다. 추세는 최근 실제 실행 7회만 사용한다.

## 장애 대응

피드 장애는 기존 캐시·데이터를 삭제하지 않는 실패로 처리한다. Step Summary의 실패 단계와 source를 확인한 뒤 `npm run sources:check -- <source-id>`, `npm run sources:diagnose`, `npm run shadow:run` 순서로 재현한다. 대체 피드는 3회 연속 성공 전까지 healthy로 확정하거나 레지스트리에 자동 적용하지 않는다.

운영 이슈 자동 생성은 기본 비활성이다. 조직에서 필요할 때만 별도 GitHub App/토큰과 운영 이슈 식별자를 제공하고, 저장소에 인증정보를 기록하지 않는다.
