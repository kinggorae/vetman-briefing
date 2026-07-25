// Cloudflare Pages Function — POST /api/draft
// 담은 글감(들)을 한국 동물병원 블로그용 초안으로 생성한다.
// 환경변수(Pages): LLM_BASE_URL, LLM_API_KEY, CLAUDE_MODEL
const DEFAULT_ORIGIN = "https://news.vetmanlab.com";

function originFor(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.SITE_ORIGIN || DEFAULT_ORIGIN;
  return origin === allowed ? origin : allowed;
}

function cors(request, env) {
  return {
    "Access-Control-Allow-Origin": originFor(request, env),
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
}

export async function onRequestOptions({ request, env }) {
  return new Response(null, { headers: cors(request, env) });
}

export async function onRequestPost({ request, env }) {
  const origin = request.headers.get("Origin") || "";
  const allowed = env.SITE_ORIGIN || DEFAULT_ORIGIN;
  if (origin && origin !== allowed) return json({ error: "허용되지 않은 출처입니다." }, 403, request, env);
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 120000) return json({ error: "요청이 너무 큽니다." }, 413, request, env);
  const base = env.LLM_BASE_URL || "https://api.anthropic.com";
  const key = env.LLM_API_KEY;
  const model = env.CLAUDE_MODEL || "MiniMax-M2";
  if (!key) return json({ error: "서버에 LLM_API_KEY가 설정되지 않았습니다." }, 500, request, env);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "잘못된 요청" }, 400, request, env);
  }
  const ideas = Array.isArray(body.ideas) ? body.ideas.slice(0, 6) : [];
  if (!ideas.length) return json({ error: "글감이 없습니다." }, 400, request, env);

  if (env.TURNSTILE_SECRET_KEY) {
    const token = String(body.turnstileToken || "");
    if (!token) return json({ error: "보안 확인이 필요합니다." }, 403, request, env);
    const verify = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET_KEY, response: token, remoteip: request.headers.get("CF-Connecting-IP") || undefined }),
    });
    const result = await verify.json().catch(() => null);
    if (!verify.ok || !result?.success) return json({ error: "보안 확인에 실패했습니다." }, 403, request, env);
  }

  const src = ideas
    .map(
      (it, i) =>
        `[${i + 1}] 주제: ${it.title || ""}\n글감 제안: ${it.blog || ""}\n핵심 포인트: ${(it.blogAngle || []).join(" / ")}\n출처: ${it.source || ""}`
    )
    .join("\n\n");

  const system = [
    "당신은 한국 동물병원의 네이버 블로그를 대신 써주는 전문 카피라이터입니다.",
    "아래 해외 수의 소식 글감을 바탕으로, 보호자(반려동물 주인)가 읽을 병원 블로그 글의 초안을 작성합니다.",
    "",
    "규칙:",
    "- 대상 독자는 보호자입니다. 전문용어는 쉽게 풀고, 과장·불안 조장 금지, 의료광고 규정을 의식해 단정적 효능 주장 금지.",
    "- 약물 용량·구체적 처치법은 쓰지 말고 '수의사와 상담' 수준으로.",
    "- 자연스러운 한국어. 중국어·일본어·러시아어 절대 혼입 금지.",
    "- 글감이 여러 개면 하나의 일관된 글로 엮되, 억지로 다 넣지 말고 관련 있는 것 위주로.",
  ].join("\n");

  const schema = {
    type: "object",
    properties: {
      titles: { type: "array", items: { type: "string" } },
      body: { type: "string" },
      hashtags: { type: "array", items: { type: "string" } },
    },
    required: ["titles", "body", "hashtags"],
    additionalProperties: false,
  };

  const user = [
    "다음 글감으로 병원 블로그 글 초안을 만들어주세요.",
    "",
    src,
    "",
    "출력(JSON만): titles=끌리는 제목 후보 3개, body=도입·본론·마무리를 갖춘 700~1100자 본문(문단 사이 빈 줄), hashtags=관련 해시태그 6~10개(# 포함).",
    "설명·코드블록 없이 JSON만 출력하세요. 스키마: " + JSON.stringify(schema),
  ].join("\n");

  const call = async (sys, usr, temp) => {
    const res = await fetch(base.replace(/\/$/, "") + "/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 4000, temperature: temp, system: sys, messages: [{ role: "user", content: usr }] }),
    });
    if (!res.ok) throw new Error("LLM " + res.status);
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/) || text.match(/(\{[\s\S]*\})|(\[[\s\S]*\])/);
    return JSON.parse(m ? m[1] || m[2] : text);
  };
  const FR = /[一-鿿぀-ヿ㇐-ㇿ々〆Ѐ-ӿ]+/g;
  const foreign = (obj) => {
    const mm = JSON.stringify(obj).match(FR);
    return mm ? mm.join(", ") : null;
  };
  const strip = (s) => String(s).replace(FR, "").replace(/\s{2,}/g, " ").replace(/\s+([,.?!·])/g, "$1").trim();
  const stripAll = (o) => ({
    titles: (o.titles || []).map(strip).filter(Boolean),
    body: strip(o.body || ""),
    hashtags: (o.hashtags || []).map((t) => strip(t)).filter((t) => t && t !== "#"),
  });

  try {
    let parsed = await call(system, user, 0.35);
    // 한국어 순수성 가드: 외국어 혼입 시 교정 재호출(최대 3회, temperature 0)
    for (let i = 0; i < 3; i++) {
      const bad = foreign(parsed);
      if (!bad) break;
      try {
        parsed = await call(
          "당신은 한국어 교정자입니다. JSON의 값에 섞인 외국어(중국어 한자·일본어 가나·러시아어)를 자연스러운 한국어로 바꿔주세요. 의미·구조는 유지하고, 인명·기관명·의학 약어(NSAID 등)의 영어 알파벳은 그대로 둡니다. 반드시 순수 한국어. JSON만 출력.",
          `이 JSON에서 외국어("${bad}")를 한국어로 고쳐주세요:\n\n${JSON.stringify(parsed)}`,
          0
        );
      } catch { break; }
    }
    // 최종 안전망: 그래도 남으면 외국 문자 제거
    if (foreign(parsed)) parsed = stripAll(parsed);
    return json(parsed, 200, request, env);
  } catch (err) {
    return json({ error: "생성 실패: " + err.message }, 500, request, env);
  }
}

function json(obj, status = 200, request, env) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...cors(request, env) },
  });
}
