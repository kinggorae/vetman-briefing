# Newsweek 원출처 검수 배치

- 공식 도메인: 레지스트리 미확정
- 공식 RSS: 없음
- 검색 템플릿: 없음
- 승인 예시: `npm run source:approve -- ARTICLE_ID https://official.example/article`

> 후보 URL은 사람이 제목·발행일·canonical·개별 기사 페이지를 확인한 뒤 승인해야 합니다.

## 1. 강아지가 리콜 사료 먹었을 때 수의사가 알려주는 대처법

- 기사 ID: `2026-07-25_7`
- 원문 제목: Realized your dog has eaten recalled food? Vet explains exactly what to do
- 발행일: 2026-07-24T10:00:00.000Z
- relay URL: https://news.google.com/rss/articles/CBMinAFBVV95cUxQZ0RnRkNaeGJqTW43VFIwRlZFS0M2dV9ia2plTDB1NW13RkpfVTdEU0FVQ3JhdU9XR3NIX21oRTA5WS1uTmZ6VkpMZm5aNE1iZFJFRXkybXI2V0RGX1dfNG52MGt2VjdnRjdYWloyeXZEWnZZblRtVEE4WHBaYXdjNXNBTG9wTElORzNVbWx5QU1wTUNxdUt1S0pqRWU?oc=5
- 공식 도메인: 미매핑
- 후보: 없음
- 검색 후보: Realized your dog has eaten recalled food? Vet explains exactly what to do | 강아지가 리콜 사료 먹었을 때 수의사가 알려주는 대처법 | Newsweek 강아지가 리콜 사료 먹었을 때 수의사가 알려주는 대처법
- 상태: unresolved · 사유: publisher-domain-not-mapped
- 승인 명령: `npm run source:approve -- 2026-07-25_7 <확인한-공식-URL>`
