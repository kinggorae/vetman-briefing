import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { FEED_MAX_AGE_DAYS } from "../config.js";

const parser = new XMLParser({ ignoreAttributes: false });

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

function stripHtml(html = "") {
  return html
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

function asArray(x) {
  return Array.isArray(x) ? x : x == null ? [] : [x];
}

export async function fetchFeed(feed) {
  const res = await fetch(feed.url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
    redirect: "follow",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`${feed.name}: HTTP ${res.status}`);
  const xml = parser.parse(await res.text());

  const channel = xml.rss?.channel ?? xml.feed; // RSS 2.0 또는 Atom
  const rawItems = asArray(channel?.item ?? channel?.entry);
  const maxAge = feed.maxAgeDays ?? FEED_MAX_AGE_DAYS;
  const cutoff = Date.now() - maxAge * 86400000;
  const isGnews = feed.type === "gnews";

  const items = rawItems
    .map((it) => {
      const link = typeof it.link === "string" ? it.link : it.link?.["@_href"] ?? "";
      const published = it.pubDate ?? it.published ?? it.updated ?? null;
      const bodyRaw =
        it["content:encoded"] ?? it.description ?? it.summary ?? it.content?.["#text"] ?? "";
      let title = stripHtml(String(it.title ?? ""));
      // 구글 뉴스: 매체명을 라벨로 쓰고, 제목 뒤의 " - 매체명" 접미사 제거
      const publisher = isGnews
        ? String(it.source?.["#text"] ?? it.source ?? "").trim() || feed.name
        : feed.name;
      if (isGnews) title = title.replace(/\s+-\s+[^-]+$/, "");
      return {
        id: crypto.createHash("md5").update(link || title).digest("hex").slice(0, 10),
        sourceType: "rss",
        sourceLabel: publisher,
        title,
        body: stripHtml(String(bodyRaw)).slice(0, 4000),
        url: link,
        publishedAt: published ? new Date(published).toISOString() : null,
      };
    })
    .filter((it) => it.url && it.title)
    .filter((it) => !it.publishedAt || new Date(it.publishedAt).getTime() >= cutoff)
    .filter((it) => !/members only|log in\/register/i.test(it.body));

  return feed.max ? items.slice(0, feed.max) : items;
}
