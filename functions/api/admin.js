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

// !== 는 첫 불일치 문자에서 즉시 끝나 응답 시간에 정보가 남는다. 관리자
// 비밀번호는 길이와 무관하게 일정 시간으로 비교한다.
function timingSafeEqual(a, b) {
  const encoder = new TextEncoder();
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  // 길이가 다르면 그 자체로 불일치지만, 비교는 끝까지 수행한다
  let diff = left.length ^ right.length;
  const max = Math.max(left.length, right.length);
  for (let i = 0; i < max; i += 1) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}

export async function onRequestGet({ request, env }) {
  const expected = String(env.ADMIN_PASSWORD || "");
  const auth = request.headers.get("Authorization") || "";
  if (!expected || !timingSafeEqual(auth, `Bearer ${expected}`)) return unauthorized(request);
  if (!env.ASSETS) return new Response(JSON.stringify({ error: "정적 저장소가 없습니다." }), { status: 503, headers: { "content-type": "application/json" } });

  const url = new URL(request.url);
  const resource = url.searchParams.get("resource");
  const target = resource === "archive"
    ? "/archive.json"
    : resource === "audit"
    ? "/admin-review.json"
    : resource === "performance"
    ? "/seo-performance.json"
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
