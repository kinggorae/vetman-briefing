# NerdWallet 원출처 검수 배치

- 공식 도메인: 레지스트리 미확정
- 공식 RSS: 없음
- 검색 템플릿: 없음
- 승인 예시: `npm run source:approve -- ARTICLE_ID https://official.example/article`

> 후보 URL은 사람이 제목·발행일·canonical·개별 기사 페이지를 확인한 뒤 승인해야 합니다.

## 1. 반려동물 보험, 과연 필요할까?

- 기사 ID: `2026-07-21_41`
- 원문 제목: Is Pet Insurance Worth It? 2026 Guide
- 발행일: 2026-07-10T07:00:00.000Z
- relay URL: https://news.google.com/rss/articles/CBMifEFVX3lxTE4xZWRGNmlZdXdlT0JKa1RlWWtUc0lfSFNtQVdyd191cDB3T05UVDhzZG5GU0huTWVMRGlpbUlVVk5WUE42N3FBWU5yNFhNNk9JX2VURDdXM29lMEtXckZSRTk4M3Q1c3lXYXVVdENPSFNSYkdhVlQtX0plZmM?oc=5
- 공식 도메인: 미매핑
- 후보: 없음
- 검색 후보: Is Pet Insurance Worth It? 2026 Guide | 반려동물 보험, 과연 필요할까? | NerdWallet 반려동물 보험, 과연 필요할까?
- 상태: unresolved · 사유: publisher-domain-not-mapped
- 승인 명령: `npm run source:approve -- 2026-07-21_41 <확인한-공식-URL>`
