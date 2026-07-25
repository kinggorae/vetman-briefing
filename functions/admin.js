// /admin 진입점. 관리자 UI 자체에는 비밀값을 넣지 않고, 데이터 요청은
// /api/admin에서 ADMIN_PASSWORD 환경변수로 검증한다.
export async function onRequestGet({ request, env }) {
  if (!env.ASSETS) return new Response("관리자 화면을 사용할 수 없습니다.", { status: 503 });
  return env.ASSETS.fetch(new URL("/admin-ui.html", request.url));
}
