// admin-review.json contains draft, source and shadow material. Keep the
// static asset behind the same Bearer gate as the administrator API.
function unauthorized() {
  return new Response(JSON.stringify({ error: "인증이 필요합니다." }), {
    status: 401,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

export async function onRequestGet({ request, env }) {
  const expected = String(env.ADMIN_PASSWORD || "");
  if (!expected || request.headers.get("Authorization") !== `Bearer ${expected}`) return unauthorized();
  if (!env.ASSETS) return new Response(JSON.stringify({ error: "정적 저장소가 없습니다." }), { status: 503, headers: { "content-type": "application/json" } });
  const response = await env.ASSETS.fetch(new URL("/admin-review.json", request.url));
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  return new Response(response.body, { status: response.status, headers });
}
