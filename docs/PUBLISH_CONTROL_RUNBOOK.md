# 발행 제어 Runbook

신규 기사는 `draft`에서 시작하고 shadow 자료에는 공개 URL이 없다. `people.json`에 실제 등록된 사람과 역할이 없으면 승인 명령은 실패한다. 사람이 검수하지 않은 상태를 자동으로 approved, reviewed 또는 published로 바꾸는 우회 방법은 제공하지 않는다.

## 사람 승인 순서

1. `npm run publish:first-candidates`로 후보 상태를 확인한다.
2. `npm run publish:prepare -- <draft-id>`로 발행 전 패키지를 만든다.
3. `npm run publish:validate -- <draft-id>`로 공식 source, canonical, 품질, 이미지 권리, 중복, JSON-LD를 확인한다.
4. 등록된 실제 reviewer가 체크리스트를 직접 확인한 뒤 `npm run publish:approve -- <draft-id> --reviewer <reviewer-id> --checklist=all --apply`를 실행한다. 기본은 dry-run이다.
5. 승인 이후 파일이 바뀌지 않았는지 확인하고 `npm run publish:release -- <draft-id> --apply`를 실행한다. 승인 hash가 달라지면 fail-closed로 중단한다.
6. release는 자동 commit·push하지 않는다. 빌드·SEO audit·XML/JSON-LD 검증과 PR review를 거친다.

high-risk는 `vet` 또는 `admin` 역할의 실제 승인 없이는 release할 수 없다. source가 unresolved이거나 duplicate인 후보도 release할 수 없다. rollback은 `npm run publish:rollback -- <article-id> --apply`로 수행하며 이전 파일을 삭제하지 않고 backup과 이력을 남긴다.
