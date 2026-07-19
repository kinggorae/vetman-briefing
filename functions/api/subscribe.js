// Cloudflare Pages Function — POST /api/subscribe
// 뉴스레터 구독 이메일을 KV(SUBS)에 저장한다.
// 바인딩(Pages): KV namespace "SUBS"
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type" };

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost({ request, env }) {
  if (!env.SUBS) return json({ error: "구독 저장소가 아직 설정되지 않았습니다." }, 503);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "잘못된 요청" }, 400);
  }
  const email = String(body.email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ error: "이메일 형식이 올바르지 않습니다." }, 400);
  await env.SUBS.put("sub:" + email, JSON.stringify({ email, at: new Date().toISOString() }));
  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });
}
