# Search Console·네이버 운영 런북

이 저장소는 검색 성과를 색인·품질 기준을 완화하는 근거로 사용하지 않습니다. 인증정보와 원본 내보내기 파일은 저장소에 커밋하지 않습니다.

## Google Search Console

1. 속성 `https://news.vetmanlab.com/`에서 최근 28일과 비교 기간을 선택합니다.
2. 성능 보고서에서 `검색어`, `페이지`, `국가`, `기기`를 포함해 CSV를 내보냅니다. 날짜별 추이를 보려면 날짜 차원도 포함합니다.
3. 색인 생성 보고서에서 제외 사유를 별도로 확인합니다. `noindex`, 중복·대체 페이지, Google이 선택한 canonical과 사이트 canonical 불일치를 구분합니다.
4. 뉴스·Discover 보고서가 제공되는 경우 노출·클릭·CTR을 별도로 확인합니다.

## 네이버 서치어드바이저

검색 유입·검색어·페이지별 성과를 같은 기간으로 내려받고 CSV 헤더를 `reports/import-templates/naver-search-advisor.csv`와 맞춥니다. 네이버가 제공하는 원본 페이지 URL을 그대로 보존해야 기사 매핑이 가능합니다.

## 가져오기와 해석

현재 저장소에는 실제 검색 성과 CSV가 없으므로 import 행은 0건이다. 다음 파일을 사람이 내려받아야 한다.

- Google Search Console 검색 실적 CSV
- Google 페이지 색인 보고서
- Google News 실적과 Discover 실적(제공되는 경우)
- 네이버 콘텐츠 노출·클릭 CSV
- 네이버 수집·색인 오류 보고서

```sh
npm run seo:import:gsc -- /secure/path/gsc.csv
npm run seo:import:naver -- /secure/path/naver.csv
npm run seo:performance
```

- 노출은 높고 CTR이 낮은 페이지: 제목·설명·대표 이미지·검색 의도를 사람이 검토합니다.
- 평균 순위 5~20위: 내용의 고유한 임상·편집 가치를 검토한 뒤 개선 후보로 분류합니다.
- 노출이 없는 index 기사: 색인 상태, canonical, sitemap, 내부 링크, 원출처를 확인합니다.
- noindex인데 수요가 있는 기사: 색인 기준을 자동 완화하지 않고 원문·본문·검수 필요성을 먼저 확인합니다.
- Google과 네이버 차이: 크롤링·노출 정책 차이로 해석하며 단일 지표로 품질을 판단하지 않습니다.

실제 계정에서만 데이터를 내려받습니다. 샘플 성과를 만들지 않으며 API 자격증명은 CI secret 또는 로컬 환경변수로만 주입하고 `.env.example` 외 파일에 기록하지 않습니다. Google News·Discover 노출과 sitemap 제출·색인 제외·canonical 문제는 각 도구에서 사람이 확인합니다.
