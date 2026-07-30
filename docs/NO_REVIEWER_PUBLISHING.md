# 수의사 감수자 없음 운영 정책

현재 `data/editorial/settings.json`은 다음 운영 모드다.

- `editorialMode`: `organization-only`
- `veterinaryReviewerAvailable`: `false`
- 등록 reviewer: 0명

따라서 사이트는 실제 수의사 감수나 전문가 검증이 완료된 것처럼 표시하지 않는다. 기사 작성 주체는 확인된 개인이 없을 때 `베트맨랩` Organization으로 표시하고, 수의사 감수 여부는 “현재 등록된 수의사 감수자가 없습니다”로 표시한다.

## 신규 콘텐츠

- high-risk: `blocked-clinical`; 공개·색인·승인 불가
- medium-risk: `internal-draft` 또는 `public-brief`; public-brief는 `noindex,follow`
- low-risk: 자동 출처·언어·주장·이미지 검사를 모두 통과한 경우에도 `public-brief`만 허용
- `index-analysis`: 실제 사람 편집 검수 기록 없이는 생성하지 않음

public brief는 기본 RSS, 일반 sitemap, news sitemap에서 제외한다. 별도 `brief-rss.xml`은 public brief가 실제로 존재할 때만 생성된다.

## 명령

```sh
npm run brief:prepare -- <draft-id>
npm run brief:validate -- <draft-id>
npm run brief:preview -- <draft-id>
npm run brief:release -- <draft-id> --apply
```

모든 명령은 기본 dry-run이다. 현재 첫 발행 후보 5개는 한국어 본문과 권리 확인 이미지가 없어 `needs-language-fix` 상태이며 release하지 않는다.

## 사람 등록 이후

실제 사람 정보가 확인된 경우에만 다음 명령을 dry-run으로 검토한다.

```sh
npm run people:add -- --id <id> --name <name> --role editor
npm run people:add -- --id <id> --name <name> --role veterinary-reviewer --credentials "확인된 자격" --profile-url <확인된-HTTPS-프로필-URL>
```

수의사 감수자를 등록하는 것만으로 기존 기사가 자동 승인되거나 발행되지는 않는다. 운영 설정을 별도로 검토하고, 실제 체크리스트와 Git 검수 이력을 남겨야 한다.
