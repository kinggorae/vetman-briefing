const PRIMARY_TYPES = {
  article: ["Article", "NewsArticle", "Report"],
  collection: ["CollectionPage", "ItemList", "WebPage"],
  topic: ["CollectionPage", "ItemList"],
  page: ["WebPage", "AboutPage", "CollectionPage"],
};

function attributes(tag = "") {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gi)].map((match) => [match[1].toLowerCase(), match[3]])
  );
}

function tags(html = "", name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((match) => attributes(match[0]));
}

export function metaContent(html = "", key, value) {
  for (const tag of tags(html, "meta")) {
    if (tag[key] === value) return String(tag.content || "").trim();
  }
  return "";
}

export function canonicalUrl(html = "") {
  for (const tag of tags(html, "link")) {
    if (String(tag.rel || "").toLowerCase().split(/\s+/).includes("canonical")) return String(tag.href || "").trim();
  }
  return "";
}

export function pageKind(url = "") {
  const pathname = new URL(url, "https://news.vetmanlab.com").pathname;
  if (/^\/article\//.test(pathname)) return "article";
  if (/^\/topic(?:\/|$)/.test(pathname)) return "topic";
  if (/^\/(?:issues|weekly|archive|sources)(?:\/|$)/.test(pathname) || pathname === "/") return "collection";
  return "page";
}

export function extractJsonLd(html = "") {
  const entries = [];
  const errors = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      entries.push(JSON.parse(match[1].trim()));
    } catch (error) {
      errors.push(error.message);
    }
  }
  return { entries, errors };
}

function objects(value) {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(objects);
  return [value, ...(Array.isArray(value["@graph"]) ? value["@graph"].flatMap(objects) : [])];
}

function typesOf(entries) {
  return objects(entries).flatMap((entry) => [].concat(entry["@type"] || [])).filter(Boolean);
}

function primaryObjects(entries, allowed) {
  return objects(entries).filter((entry) => [].concat(entry["@type"] || []).some((type) => allowed.includes(type)));
}

export function validateSeoContract({ url, html = "", origin = "https://news.vetmanlab.com" } = {}) {
  const critical = [];
  const warnings = [];
  const kind = pageKind(url);
  const canonical = canonicalUrl(html);
  const robots = metaContent(html, "name", "robots").toLowerCase();
  const title = String(html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "").trim();
  const description = metaContent(html, "name", "description");
  const ogUrl = metaContent(html, "property", "og:url");
  const ogTitle = metaContent(html, "property", "og:title");
  const ogDescription = metaContent(html, "property", "og:description");
  const ogImage = metaContent(html, "property", "og:image");
  const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
  const h1Count = (visible.match(/<h1\b/gi) || []).length;
  const { entries, errors } = extractJsonLd(html);
  const types = typesOf(entries);
  const allowed = PRIMARY_TYPES[kind];
  const primary = primaryObjects(entries, allowed);
  const add = (reason, detail = {}) => critical.push({ url, reason, ...detail });

  if (!canonical) add("canonical-missing");
  else if (canonical !== url) add("canonical-mismatch", { canonical });
  if (robots.includes("noindex")) add("sitemap-page-noindex", { robots });
  if (!title || title.length < 10 || title.length > 180) add("title-invalid", { length: title.length });
  if (!description || description.length < 30 || description.length > 300) add("description-invalid", { length: description.length });
  if (ogUrl !== url) add("og-url-mismatch", { ogUrl });
  if (!ogTitle) add("og-title-missing");
  if (!ogDescription) add("og-description-missing");
  if (kind === "article" && !ogImage) add("article-og-image-missing");
  if (h1Count < 1) add("h1-missing");
  for (const error of errors) add("jsonld-parse-error", { error });
  if (!primary.length) add("primary-jsonld-missing", { expected: allowed, types });
  for (const entry of primary) {
    if (entry.url && entry.url !== url) add("jsonld-url-mismatch", { jsonLdUrl: entry.url });
    if (kind === "article" && !entry.headline) add("article-headline-missing");
    if (kind === "article" && !entry.image) add("article-jsonld-image-missing");
  }
  if (new URL(url).origin !== origin) warnings.push({ url, reason: "non-default-origin" });
  return { url, kind, canonical, robots, title, description, ogUrl, ogTitle, ogDescription, ogImage, h1Count, types, critical, warnings };
}
