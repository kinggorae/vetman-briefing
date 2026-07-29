# 편집자 일일 운영 런북

1. `npm run sources:diagnose`로 공식 피드 상태와 대체 후보를 확인한다.
2. `npm run ingest:dry`로 신규 후보를 수집한다. 이 명령은 published 기사를 만들지 않는다.
3. `npm run review:queue`와 인증 관리자 뉴스룸에서 high-risk, correction, 최신 draft 순으로 확인한다.
4. `npm run language:audit`, `npm run terminology:audit`, `npm run claims:audit`의 경고를 원문과 대조한다.
5. 기존 기사와 겹치는 후보는 `npm run updates:compare -- ID`로 확인한다. 사람 승인 전 기존 JSON을 수정하지 않는다.
6. 필요한 경우 `npm run publish:package -- ID`로 발행 전 미리보기만 만든다.

승인 명령은 등록된 실제 reviewerId와 Git diff를 요구한다. 관리자 화면은 인증된 읽기 전용이며 공개 API나 draft URL을 제공하지 않는다.
