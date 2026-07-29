const cors = (request) => {
  const origin = request.headers.get("Origin") || "";
  return origin === "https://news.vetmanlab.com" ? { "Access-Control-Allow-Origin": origin } : {};
};

function unauthorized(request) {
  return new Response(JSON.stringify({ error: "인증이 필요합니다." }), {
    status: 401,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...cors(request) },
  });
}

export async function onRequestOptions({ request }) {
  return new Response(null, { headers: { "Access-Control-Allow-Methods": "GET, OPTIONS", "Access-Control-Allow-Headers": "Authorization", ...cors(request) } });
}

export async function onRequestGet({ request, env }) {
  const expected = String(env.ADMIN_PASSWORD || "");
  const auth = request.headers.get("Authorization") || "";
  if (!expected || auth !== `Bearer ${expected}`) return unauthorized(request);
  if (!env.ASSETS) return new Response(JSON.stringify({ error: "정적 저장소가 없습니다." }), { status: 503, headers: { "content-type": "application/json" } });

  const url = new URL(request.url);
  const resource = url.searchParams.get("resource");
  const target = resource === "archive"
    ? "/archive.json"
    : resource === "audit"
    ? "/admin-review.json"
    : resource === "raw" && /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("date") || "")
    ? `/raw/${url.searchParams.get("date")}.json`
    : null;
  if (!target) return new Response(JSON.stringify({ error: "잘못된 리소스입니다." }), { status: 400, headers: { "content-type": "application/json", "cache-control": "no-store", ...cors(request) } });

  const response = await env.ASSETS.fetch(new URL(target, request.url));
  const headers = new Headers(response.headers);
  headers.set("cache-control", "no-store");
  for (const [key, value] of Object.entries(cors(request))) headers.set(key, value);
  return new Response(response.body, { status: response.status, headers });
}
