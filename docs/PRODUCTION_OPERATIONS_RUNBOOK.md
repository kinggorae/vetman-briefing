# Production 운영 런북

이 문서는 `news.vetmanlab.com`을 무료 공개 서비스로 운영할 때의 발행·배포·장애 확인 기준이다. 목표는 새 글을 늘리는 것보다 먼저, 기존 공개 기사와 화면 계약이 다음날에도 유지되도록 하는 것이다.

## 자동 실행 순서

- 매일 09:00 KST: `.github/workflows/daily.yml`이 공식 피드 진단 → 원문 수집 → 초안 생성 → 품질 게이트 → 오늘 발행분 생성을 수행한다.
- 매일 발행 단계: `reports/brief-release.json`의 발행 누계가 30건 미만이면 작업을 실패시켜 조용한 결번을 막는다.
- 발행 전: `retention:guard`가 직전 공개 기사 URL이 현재 산출물에서 사라졌는지 검사한다.
- 배포 후: `verify:deployment`와 `monitor:production`이 운영 URL을 검사한다.
- 매일 10:00 KST: `production-monitoring.yml`이 별도로 운영 계약을 재검사한다. 일일 작업이 실패하거나 배포가 늦어져도 감지할 수 있다.

## Production monitor가 확인하는 것

다음 항목 중 critical이 하나라도 있으면 해당 workflow는 실패하고 GitHub Issue 라벨을 통해 알림을 남긴다.

- `/latest.json`: 오늘 날짜, 최소 30개, 선언 count와 실제 items 수 일치
- `/`: `h1`, `main#main-content`, SearchAction, archive 링크, 정적 기사 카드 30개
- `/search.json`, `/search-manifest.json`: 검색 count·chunk·기사 키 일치
- `/archive.json`: 과거 이슈와 weekly 배열 계약
- `/sitemap.xml`, `/news-sitemap.xml`, `/rss.xml`: XML·URL 수·대표 기사 canonical·최근 News sitemap 계약
- `/manifest.webmanifest`, `/sw.js`: PWA 기본 계약과 `vmcache-v8` shell 캐시
- `/deployment.json`: 빌드 시점·source commit·공개 기사 수 메타데이터

## 장애 대응

1. `production-monitoring-failure` 또는 `production-deploy-failure` Issue의 실행 로그와 artifact를 연다.
2. `/latest.json` 날짜·개수, `reports/brief-release.json`, `reports/retention-guard.json`, `reports/operations-status.json`을 먼저 비교한다.
3. 기존 글이 사라진 경우 `retention:guard`의 삭제 목록을 기준으로 원인을 확인하고, 원인 해결 전에는 강제 배포하지 않는다.
4. 배포 산출물만 되돌릴 때는 GitHub Actions의 `Deploy site`를 실행할 커밋을 선택한다. 데이터 삭제나 `git reset --hard`는 운영 절차로 사용하지 않는다.
5. 소스 피드 장애는 `reports/source-health.json`에서 `failing`·`degraded`를 확인한다. 공식 원문 URL을 확인하지 않은 relay URL을 자동 발행하지 않는다.

## 수동 검증 명령

```bash
npm ci
npm test
npm run build
npm run validate
npm run retention:guard
MONITOR_BASE_URL=https://news.vetmanlab.com \
MONITOR_MIN_LATEST_ITEMS=30 \
MONITOR_REQUIRE_TODAY_AFTER_KST=10 \
npm run monitor:production
```

실제 Search Console·네이버 CSV가 없는 상태에서는 노출 성과를 추정하거나 생성하지 않는다. 검색 노출은 sitemap/RSS 제출 이후 Search Console과 네이버 웹마스터 도구의 실제 수집·색인 데이터를 별도로 확인한다.
