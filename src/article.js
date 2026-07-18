// 원문 페이지에서 본문 전문과 대표 이미지(og:image)를 수집한다.
// RSS description은 몇 줄짜리 요약뿐이라, 긴 기사형 아이템을 쓰려면 전문이 필요.
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function stripHtml(html = "") {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8220;|&#8221;|&ldquo;|&rdquo;/g, '"')
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchArticleMeta(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,*/*" },
      redirect: "follow",
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return {};
    const html = await res.text();

    const og =
      html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i) ??
      html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    const imageUrl = og?.[1]?.startsWith("http") ? og[1] : null;

    // 본문 추출: <p> 태그 중 실문장으로 보이는 것만 수집 (60자 이상)
    const paras = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => stripHtml(m[1]))
      .filter((t) => t.length > 60);
    const fullText = paras.join("\n").slice(0, 7000);

    return {
      imageUrl,
      fullText: fullText.length > 400 ? fullText : null,
      finalUrl: res.url && !res.url.includes("news.google.com") ? res.url : null,
    };
  } catch {
    return {};
  }
}
