# Update·정정 정책

신규 후보는 duplicate, minor-update, substantive-update, correction, separate-story, unresolved로 분류한다. 자동 분류는 검수 후보일 뿐 기존 기사를 덮어쓰지 않는다.

- minor-update: 날짜·제목 등 경미한 변화만 기록하고 dateModified를 바꾸지 않는다.
- substantive-update: 핵심 주장·수치·결과가 달라질 때 사람 승인 후 실제 수정일을 기록한다.
- correction: 오류와 정정 이력을 명시하고 correction-required 상태로 보낸다.
- separate-story: 독립적인 사건일 때만 새 canonical 후보를 허용한다.
- unresolved: 출처·본문 비교가 불충분하면 보류한다.

`npm run updates:approve -- ID`는 기본 dry-run이다. 적용에는 등록된 실제 reviewerId와 `--apply`가 필요하며, 미등록 사람 정보나 자동 reviewed 상태를 만들지 않는다.
