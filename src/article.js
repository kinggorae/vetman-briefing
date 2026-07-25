// 원문 페이지에서 본문 전문과 대표 이미지(og:image)를 수집한다.
// RSS description은 몇 줄짜리 요약뿐이라, 긴 기사형 아이템을 쓰려면 전문이 필요.
import { cleanImageUrl } from "./images.js";

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

function jsonLdImages(html = "") {
  const found = [];
  for (const match of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const value = JSON.parse(match[1].trim());
      const visit = (node) => {
        if (!node || typeof node !== "object") return;
        if (Array.isArray(node)) return node.forEach(visit);
        for (const [key, child] of Object.entries(node)) {
          if (["image", "contentUrl", "thumbnailUrl"].includes(key)) {
            if (typeof child === "string") found.push(child);
            else if (Array.isArray(child)) {
              found.push(...child.flatMap((item) => (typeof item === "string" ? [item] : item?.url ? [item.url] : [])));
            } else if (child && typeof child.url === "string") {
              found.push(child.url);
            }
          }
          visit(child);
        }
      };
      visit(value);
    } catch {
      // 일부 CMS는 JSON-LD 안에 주석이나 trailing comma를 남긴다. 메타태그 후보는 계속 사용한다.
    }
  }
  return found;
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

    const metaImage = (name) => [
      html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${name}["'][^>]*content=["']([^"']+)["']`, "i"))?.[1],
      html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${name}["']`, "i"))?.[1],
    ];
    const imageCandidates = [
      ...["og:image", "twitter:image", "twitter:image:src"].flatMap(metaImage),
      html.match(/<link[^>]+rel=["']image_src["'][^>]*href=["']([^"']+)["']/i)?.[1],
      ...jsonLdImages(html),
    ].filter(Boolean);
    // 원문 페이지가 명시한 후보 중 실제 기사 이미지로 보이는 첫 번째만 사용한다.
    // Google News 프록시·사이트 공통 배경·로고는 cleanImageUrl에서 제거한다.
    const imageUrl = imageCandidates.map((candidate) => cleanImageUrl(candidate, res.url || url)).find(Boolean) || null;

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
