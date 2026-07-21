// Cloudflare Pages Function — POST /api/subscribe
// 뉴스레터 구독 이메일을 KV에 저장한다. 바인딩: SUBS (wrangler.toml)
//
// 저장 구조
//   sub:<email>  → { email, at, token, source }   구독 레코드
//   tok:<token>  → <email>                        수신거부 링크용 역인덱스
//
// 정보통신망법상 광고성 정보 수신동의는 명시적이어야 하고, 수신거부 수단을
// 함께 제공해야 한다. 폼 제출 자체를 동의로 보되 시점을 기록하고,
// 발송 시 쓸 수신거부 토큰을 가입 시점에 미리 만들어 둔다.
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function onRequestOptions() {
  return new Response(null, { headers: CORS });
}

export async function onRequestPost({ request, env }) {
  const KV = env.SUBS || env.KV;
  if (!KV) return json({ error: "구독 저장소가 아직 설정되지 않았습니다." }, 503);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "잘못된 요청입니다." }, 400);
  }

  // 허니팟 — 사람에게는 보이지 않는 필드다. 채워져 있으면 봇으로 보고 조용히 성공 처리한다
  if (String(body.website || "").trim()) return json({ ok: true });

  const email = String(body.email || "").trim().toLowerCase();
  if (email.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) {
    return json({ error: "이메일 형식을 확인해 주세요." }, 400);
  }

  const key = "sub:" + email;
  const existing = await KV.get(key);
  if (existing) return json({ ok: true, already: true });

  const token = crypto.randomUUID();
  const record = {
    email,
    at: new Date().toISOString(),
    token,
    consent: true, // 폼 제출 = 수신동의. 문구는 구독 폼에 함께 표기한다
    source: "site-footer",
  };
  await KV.put(key, JSON.stringify(record));
  await KV.put("tok:" + token, email);
  return json({ ok: true });
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...CORS },
  });
}
