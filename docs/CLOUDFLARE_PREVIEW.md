# Cloudflare Pages branch preview 진단

현재 production 프로젝트는 `vetman-briefing`이며 production 주소는 `https://news.vetmanlab.com/`입니다. branch/commit preview에서 `Deployment Not Found`가 반환되면 production을 preview 대체 주소로 사용하지 않습니다.

## 읽기 전용 확인 순서

1. Cloudflare Pages의 `vetman-briefing` 프로젝트에서 Git integration이 올바른 GitHub 저장소와 연결되어 있는지 확인합니다.
2. Preview deployments가 활성화되어 있고 branch 이름이 실제 push 브랜치와 일치하는지 확인합니다.
3. GitHub Actions의 deployment status와 Cloudflare deployment 목록에서 동일한 commit SHA가 존재하는지 확인합니다.
4. workflow가 pull request 또는 branch push를 조건에서 제외하지 않는지 확인합니다.
5. `Deployment Not Found`가 계속되면 해당 preview alias가 생성되지 않은 상태로 기록하고 production에 우회 배포하지 않습니다.

## 인증정보가 있는 환경에서만

Wrangler 또는 Cloudflare API 확인은 기존 secret이 제공될 때만 수행합니다. 저장소에는 값이 아니라 변수 이름만 둡니다.

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

권한이 있는 CI에서만 Pages 프로젝트·deployment 조회를 수행하고, 토큰을 명령행 인자·로그·artifact에 출력하지 않습니다. 별도 Pages 프로젝트를 만들지 않으며 production 배포 명령을 preview 진단에 사용하지 않습니다.

## 현재 운영 원칙

preview가 확인되지 않은 상태에서는 로컬 build, 정적 smoke test, GitHub CI 결과를 배포 게이트로 사용합니다. production은 기존 Cloudflare Pages 프로젝트의 main 배포 방식만 사용합니다.
