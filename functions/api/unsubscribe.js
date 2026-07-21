// Cloudflare Pages Function — GET /api/unsubscribe?t=<token>
// 발송 메일 하단의 수신거부 링크가 여기로 온다. 로그인 없이 한 번에 해지되어야 한다
// (정보통신망법: 수신거부 수단은 별도 비용·복잡한 절차 없이 제공).
export async function onRequestGet({ request, env }) {
  const KV = env.SUBS || env.KV;
  const token = new URL(request.url).searchParams.get("t") || "";

  let ok = false;
  if (KV && token) {
    const email = await KV.get("tok:" + token);
    if (email) {
      await KV.delete("sub:" + email);
      await KV.delete("tok:" + token);
      ok = true;
    }
  }

  return new Response(page(ok), {
    status: ok ? 200 : 404,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function page(ok) {
  const title = ok ? "수신거부가 완료되었습니다" : "링크가 유효하지 않습니다";
  const desc = ok
    ? "더 이상 브리핑 메일을 보내지 않습니다. 저장된 이메일 주소도 함께 삭제했습니다."
    : "이미 해지되었거나 링크가 만료되었을 수 있습니다. 계속 메일이 온다면 문의해 주세요.";
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} | VetMan 해외 브리핑</title>
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;
    font-family:"Pretendard Variable","Apple SD Gothic Neo",system-ui,sans-serif;background:#fff;color:#171719}
  @media (prefers-color-scheme:dark){body{background:#171719;color:#f7f7f8}}
  .box{max-width:460px;text-align:center}
  h1{font-size:26px;font-weight:800;letter-spacing:-.02em;margin:0 0 12px;line-height:1.3}
  p{margin:0 0 24px;font-size:15px;line-height:1.7;opacity:.7}
  a{display:inline-block;background:#0066ff;color:#fff;text-decoration:none;font-weight:700;
    font-size:14px;padding:12px 22px;border-radius:10px}
</style></head>
<body><div class="box">
  <h1>${title}</h1>
  <p>${desc}</p>
  <a href="/">오늘의 브리핑 보기</a>
</div></body></html>`;
}
