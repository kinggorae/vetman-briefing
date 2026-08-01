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

    // 본문 추출: <p> 태그 중 실문장으로 보이는 것만 수집 (60자 이상).
    // 다만 문서 전체에서 긁으면 사이트 공통 문구(소개·푸터)가 앞을 차지해
    // 7000자 제한에서 정작 기사가 밀려난다. Vet Candy가 그래서 모든 URL에
    // "At Vet Candy, we are passionate about..."만 돌려주고 있었다.
    // <article>/<main>이 있으면 그 안에서만 모으고, 너무 적게 잡히면 전체로 되돌린다.
    const paragraphsIn = (fragment) => [...fragment.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((m) => stripHtml(m[1]))
      .filter((t) => t.length > 60);
    // 좁은 컨테이너부터 훑되, 본문이 충분히 잡힐 때만 채택한다.
    // 가장 긴 것을 고르면 전체 문서가 늘 이겨서 사이트 공통 문구가 다시 섞인다
    // (Vet Candy: <article> 6천자 vs 전체 14천자). 반대로 먼저 걸린 것을 그냥
    // 쓰면 Frontiers처럼 <article>에 메타데이터만 있는 곳에서 빈손이 된다.
    const scopes = [
      html.match(/<article[^>]*>([\s\S]*?)<\/article>/i)?.[1],
      html.match(/<main[^>]*>([\s\S]*?)<\/main>/i)?.[1],
      html,
    ].filter(Boolean);
    // 채택 기준 800자. 400자로 두면 Veterinary Practice News처럼 <article>에
    // 앞부분 3문단(534자)만 있고 나머지가 밖에 있는 페이지에서 빈약한 조각을
    // 받아들인다. 실측 7개 소스에서 400자 6/7 → 800자 7/7이었다.
    const SCOPE_MIN_CHARS = 800;
    let paras = [];
    for (const scope of scopes) {
      const found = paragraphsIn(scope);
      if (found.join("").length >= SCOPE_MIN_CHARS) { paras = found; break; }
    }
    // 어느 후보도 기준에 못 미치면 그중 가장 많이 잡힌 것을 쓴다(짧은 기사)
    if (!paras.length) paras = scopes.map(paragraphsIn).sort((a, b) => b.join("").length - a.join("").length)[0] || [];
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

// <p> 수집이 기사 본문 대신 내비게이션 목록이나 인라인 스크립트를 긁어오는
// 사이트가 있다. 그 텍스트를 생성기에 넘기면 엉뚱한 기사가 나오고, 검수
// 화면에서는 대조하지 않은 것을 대조한 것처럼 보여준다. 둘 다 막는다.
export function articleTextQuality(text, sourceTitle = "") {
  if (!text || text.length < 400) return { ok: false, reason: "too-short" };
  // 코드 조각: 중괄호·세미콜론·연산자 밀도가 산문보다 훨씬 높다
  if ((text.match(/[{};=<>|&$]/g) || []).length / text.length > 0.012) return { ok: false, reason: "looks-like-code" };
  // 내비게이션: 메뉴 항목은 Title Case라 대문자로 시작하는 단어 비율이 높다.
  // 실측(원문 11곳) — 정상 본문 9~23%, 내비 섞인 본문 25~28%, 순수 내비 53%.
  // 문장 길이만으로는 갈리지 않는다(내비 189자 vs 본문 95~161자).
  const words = text.match(/[A-Za-z][A-Za-z'-]*/g) || [];
  if (words.length >= 40 && words.filter((w) => /^[A-Z]/.test(w)).length / words.length > 0.4) {
    return { ok: false, reason: "looks-like-navigation" };
  }
  const sentences = (text.match(/[.!?]["')\]]?(?:\s|$)/g) || []).length;
  if ((sentences ? text.length / sentences : Infinity) > 300) return { ok: false, reason: "looks-like-navigation" };
  // 기사 본문이면 원문 제목의 주요 단어가 어딘가에 나온다
  const titleWords = [...new Set(String(sourceTitle).toLowerCase().match(/[a-z]{5,}/g) || [])];
  if (titleWords.length >= 3) {
    const hit = titleWords.filter((w) => text.toLowerCase().includes(w)).length;
    if (hit / titleWords.length < 0.34) return { ok: false, reason: "title-mismatch" };
  }
  return { ok: true, reason: "ok" };
}
