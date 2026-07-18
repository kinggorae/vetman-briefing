import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE } from "../config.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES_DIR = path.join(ROOT, "data", "issues");
const SITE_DIR = path.join(ROOT, "site");

const CATEGORY_LABELS = {
  clinical: "임상",
  practice_management: "병원 경영",
  career: "커리어",
  client_communication: "보호자 소통",
  industry: "업계",
  other: "기타",
};

const STATUS_BADGES = {
  sample: "샘플",
  draft: "검수 전",
};

function esc(s = "") {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const labelOf = (issue) => issue.date ?? issue.week;

function loadIssues() {
  if (!fs.existsSync(ISSUES_DIR)) return [];
  return fs
    .readdirSync(ISSUES_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(ISSUES_DIR, f), "utf8")))
    .sort((a, b) => (labelOf(a) < labelOf(b) ? 1 : -1));
}

const CSS = `
:root {
  --bg: #faf9f6; --card: #ffffff; --text: #1f2328; --muted: #6b7280;
  --line: #e5e2db; --accent: #0f6f5c; --accent-soft: #e6f2ef; --badge: #b45309;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14161a; --card: #1c1f24; --text: #e7e9ec; --muted: #9aa3ad;
    --line: #2b2f36; --accent: #4cc2a9; --accent-soft: #1d2f2b; --badge: #d97706;
  }
}
* { box-sizing: border-box; margin: 0; }
body {
  background: var(--bg); color: var(--text);
  font-family: "Apple SD Gothic Neo", "Pretendard", "Noto Sans KR", system-ui, sans-serif;
  line-height: 1.7; -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 760px; margin: 0 auto; padding: 40px 20px 80px; }
header.masthead { margin-bottom: 8px; }
.brand { font-size: 13px; font-weight: 700; letter-spacing: .12em; color: var(--accent); text-transform: uppercase; }
.brand a { color: inherit; text-decoration: none; }
h1 { font-size: 26px; margin: 6px 0 4px; letter-spacing: -.01em; }
.issue-meta { color: var(--muted); font-size: 14px; }
.status-badge {
  display: inline-block; font-size: 12px; font-weight: 700; color: #fff;
  background: var(--badge); border-radius: 4px; padding: 1px 8px; margin-left: 8px; vertical-align: 2px;
}
.intro { margin: 20px 0 28px; padding: 14px 16px; background: var(--accent-soft); border-radius: 10px; font-size: 14.5px; }
article.item {
  background: var(--card); border: 1px solid var(--line); border-radius: 14px;
  padding: 24px 26px; margin-bottom: 22px; overflow: hidden;
}
.thumb {
  margin: -24px -26px 18px; display: block; width: calc(100% + 52px);
  max-height: 320px; object-fit: cover;
}
.item-meta { font-size: 13px; color: var(--muted); display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.cat {
  font-size: 12px; font-weight: 600; color: var(--accent);
  background: var(--accent-soft); border-radius: 999px; padding: 2px 10px;
}
article.item h2 { font-size: 20px; margin: 10px 0 8px; letter-spacing: -.01em; line-height: 1.45; }
.lead { font-size: 16px; font-weight: 600; margin-bottom: 12px; }
.body p { font-size: 15.5px; margin-bottom: 10px; }
.keypoints { margin: 14px 0; padding: 14px 16px 14px 34px; background: var(--bg); border-radius: 10px; }
.keypoints li { font-size: 14.5px; margin-bottom: 4px; }
.keypoints-title { font-size: 13px; font-weight: 700; color: var(--accent); margin: 0 0 6px -18px; list-style: none; }
.angle {
  margin-top: 14px; padding: 12px 14px; border-left: 3px solid var(--accent);
  background: var(--accent-soft); border-radius: 0 8px 8px 0; font-size: 14.5px;
}
.angle b { color: var(--accent); }
.source { margin-top: 14px; font-size: 13.5px; color: var(--muted); }
.source a { color: var(--muted); text-decoration: none; border-bottom: 1px dotted var(--muted); }
.source a:hover { color: var(--accent); border-color: var(--accent); }
nav.archive { margin-top: 44px; padding-top: 20px; border-top: 1px solid var(--line); }
nav.archive h3 { font-size: 14px; color: var(--muted); margin-bottom: 10px; }
nav.archive a { display: inline-block; margin: 0 10px 8px 0; color: var(--accent); text-decoration: none; font-size: 14.5px; }
footer.disclaimer { margin-top: 40px; font-size: 12.5px; color: var(--muted); }
`;

function slugify(item, idx) {
  return `item-${idx + 1}`;
}

function renderItem(item, idx) {
  const cat = CATEGORY_LABELS[item.category] || item.category || "";
  const label = item.sourceLabel || (item.subreddit ? `r/${item.subreddit}` : "");
  const stats = [
    item.upvotes != null ? `<span>▲ ${item.upvotes.toLocaleString()}</span>` : "",
    item.numComments != null ? `<span>💬 ${item.numComments.toLocaleString()}</span>` : "",
  ].join("");
  const img = item.imageUrl
    ? `<img class="thumb" src="${esc(item.imageUrl)}" alt="${esc(item.titleKo)}" loading="lazy" onerror="this.remove()">`
    : "";

  // 신형(leadKo/bodyKo/keyPointsKo)·구형(summaryKo) 포맷 모두 렌더링
  const bodyHtml = item.bodyKo?.length
    ? `${item.leadKo ? `<p class="lead">${esc(item.leadKo)}</p>` : ""}
  <div class="body">${item.bodyKo.map((p) => `<p>${esc(p)}</p>`).join("\n")}</div>
  ${
    item.keyPointsKo?.length
      ? `<ul class="keypoints"><li class="keypoints-title">핵심 포인트</li>${item.keyPointsKo
          .map((k) => `<li>${esc(k)}</li>`)
          .join("")}</ul>`
      : ""
  }`
    : `<div class="body"><p>${esc(item.summaryKo ?? "")}</p></div>`;

  return `
<article class="item" id="${slugify(item, idx)}">
  ${img}
  <div class="item-meta">
    ${cat ? `<span class="cat">${esc(cat)}</span>` : ""}
    <span>${esc(label)}</span>
    ${stats}
    ${item.publishedAt ? `<time datetime="${esc(item.publishedAt)}">${esc(item.publishedAt.slice(0, 10))}</time>` : ""}
  </div>
  <h2>${esc(item.titleKo)}</h2>
  ${bodyHtml}
  <div class="angle"><b>글감 포인트</b> — ${esc(item.angleKo)}</div>
  <p class="source">원문: <a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener nofollow">${esc(item.sourceTitle)}</a> (${esc(label)})</p>
</article>`;
}

// SEO/GEO: 페이지별 메타태그 + JSON-LD 구조화 데이터
function seoHead(issue, canonicalPath) {
  const label = labelOf(issue);
  const title = `${label} 수의계 해외 뉴스 브리핑 | ${SITE.name}`;
  const desc = issue.items[0]?.leadKo || issue.items[0]?.summaryKo || SITE.description;
  const canonical = `${SITE.baseUrl}${canonicalPath}`;
  const ogImage = issue.items.find((i) => i.imageUrl)?.imageUrl;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: title,
    description: SITE.description,
    url: canonical,
    itemListElement: issue.items.map((item, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      item: {
        "@type": "NewsArticle",
        headline: item.titleKo,
        description: item.leadKo || item.summaryKo || "",
        url: `${canonical}#${slugify(item, idx)}`,
        ...(item.imageUrl ? { image: item.imageUrl } : {}),
        ...(item.publishedAt ? { datePublished: item.publishedAt } : {}),
        publisher: { "@type": "Organization", name: SITE.name, url: SITE.baseUrl },
        isBasedOn: item.sourceUrl,
        inLanguage: "ko",
      },
    })),
  };

  return `
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc.slice(0, 155))}">
<meta name="keywords" content="동물병원, 수의사, 수의학 뉴스, 해외 수의 트렌드, 동물병원 경영, 수의 임상, ${issue.items
    .map((i) => esc(i.titleKo.split(",")[0].split("…")[0].trim()))
    .slice(0, 3)
    .join(", ")}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="alternate" type="application/rss+xml" title="${esc(SITE.name)}" href="${SITE.baseUrl}/rss.xml">
<meta property="og:type" content="article">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc.slice(0, 155))}">
<meta property="og:url" content="${esc(canonical)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ""}
<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">
<meta name="robots" content="index, follow">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
}

function renderIssuePage(issue, allIssues, { isIndex = false } = {}) {
  const label = labelOf(issue);
  const badge = STATUS_BADGES[issue.status]
    ? `<span class="status-badge">${STATUS_BADGES[issue.status]}</span>`
    : "";
  const prefix = isIndex ? "" : "../";
  const canonicalPath = isIndex ? "/" : `/issues/${label}.html`;
  const archiveLinks = allIssues
    .map((i) =>
      labelOf(i) === label
        ? `<a style="font-weight:700" aria-current="page">${labelOf(i)}</a>`
        : `<a href="${prefix}issues/${labelOf(i)}.html">${labelOf(i)}</a>`
    )
    .join("");

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${seoHead(issue, canonicalPath)}
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="masthead">
    <div class="brand"><a href="${isIndex ? "./" : "../"}">${esc(SITE.name)}</a></div>
    <h1>${esc(label)} 데일리 브리핑${badge}</h1>
    <p class="issue-meta">해외 수의 미디어·커뮤니티에서 오늘 주목할 글 ${issue.items.length}건 · <time datetime="${esc(
    issue.generatedAt ?? ""
  )}">${esc(label)}</time></p>
  </header>
  ${issue.note ? `<div class="intro">⚠️ ${esc(issue.note)}</div>` : `<div class="intro">해외 수의사들은 지금 이런 이야기를 하고 있습니다. 각 아이템의 <b>글감 포인트</b>는 우리 병원 블로그 소재로 바로 활용할 수 있는 관점 제안입니다.</div>`}
  <main>
  ${issue.items.map((item, idx) => renderItem(item, idx)).join("\n")}
  </main>
  <nav class="archive" aria-label="지난 이슈"><h3>지난 이슈</h3>${archiveLinks}</nav>
  <footer class="disclaimer">
    본 콘텐츠는 해외 공개 자료의 요약·번역이며, 임상 정보는 참고용입니다. 실제 적용 전 반드시 원문과 최신 문헌을 확인하세요.<br>
    모든 아이템에는 원문 출처 링크가 포함되어 있습니다. · ${esc(SITE.name)}
  </footer>
</div>
</body>
</html>`;
}

function buildSitemap(issues) {
  const urls = [
    `${SITE.baseUrl}/`,
    ...issues.map((i) => `${SITE.baseUrl}/issues/${labelOf(i)}.html`),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n")}
</urlset>`;
}

function buildRss(issues) {
  const items = issues
    .slice(0, 20)
    .map(
      (i) => `  <item>
    <title>${esc(`${labelOf(i)} 수의계 해외 뉴스 브리핑`)}</title>
    <link>${SITE.baseUrl}/issues/${labelOf(i)}.html</link>
    <guid>${SITE.baseUrl}/issues/${labelOf(i)}.html</guid>
    ${i.generatedAt ? `<pubDate>${new Date(i.generatedAt).toUTCString()}</pubDate>` : ""}
    <description>${esc(i.items.map((it) => it.titleKo).join(" / "))}</description>
  </item>`
    )
    .join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>${esc(SITE.name)}</title>
  <link>${SITE.baseUrl}</link>
  <description>${esc(SITE.description)}</description>
  <language>ko</language>
${items}
</channel></rss>`;
}

// GEO: AI 검색엔진용 사이트 설명 파일
function buildLlmsTxt(issues) {
  const latest = issues[0];
  return `# ${SITE.name}

> ${SITE.description}

한국 동물병원 원장·수의사를 위한 서비스입니다. 매일 오전 해외 수의 전문 미디어(Veterinary Practice News, Today's Veterinary Business, Today's Veterinary Practice 등)의 주요 글을 선별해 한국어 기사로 재작성하고, 병원 블로그 글감 아이디어를 함께 제공합니다.

## 최신 브리핑 (${labelOf(latest)})
${latest.items.map((it) => `- [${it.titleKo}](${SITE.baseUrl}/#${""}): ${it.leadKo || it.summaryKo || ""}`).join("\n")}

## 주요 페이지
- [최신 브리핑](${SITE.baseUrl}/)
- [브리핑 데이터 JSON](${SITE.baseUrl}/latest.json)
- [RSS](${SITE.baseUrl}/rss.xml)
`;
}

function build() {
  const issues = loadIssues();
  if (issues.length === 0) {
    console.error("data/issues/ 에 이슈 파일이 없습니다.");
    process.exit(1);
  }

  fs.rmSync(SITE_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(SITE_DIR, "issues"), { recursive: true });

  const latest = issues[0];
  fs.writeFileSync(path.join(SITE_DIR, "index.html"), renderIssuePage(latest, issues, { isIndex: true }));
  for (const issue of issues) {
    fs.writeFileSync(path.join(SITE_DIR, "issues", `${labelOf(issue)}.html`), renderIssuePage(issue, issues));
  }
  fs.writeFileSync(path.join(SITE_DIR, "latest.json"), JSON.stringify(latest, null, 2));
  fs.writeFileSync(path.join(SITE_DIR, "sitemap.xml"), buildSitemap(issues));
  fs.writeFileSync(path.join(SITE_DIR, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE.baseUrl}/sitemap.xml\n`);
  fs.writeFileSync(path.join(SITE_DIR, "rss.xml"), buildRss(issues));
  fs.writeFileSync(path.join(SITE_DIR, "llms.txt"), buildLlmsTxt(issues));

  console.log(`빌드 완료: ${issues.length}개 이슈 → site/ (최신: ${labelOf(latest)})`);
}

build();
