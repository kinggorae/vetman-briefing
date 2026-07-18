import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const labelOf = (issue) => issue.date ?? issue.week; // 일간(date) 전환 전 주간(week) 이슈 호환

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
  line-height: 1.65; -webkit-font-smoothing: antialiased;
}
.wrap { max-width: 720px; margin: 0 auto; padding: 40px 20px 80px; }
header.masthead { margin-bottom: 8px; }
.brand { font-size: 13px; font-weight: 700; letter-spacing: .12em; color: var(--accent); text-transform: uppercase; }
h1 { font-size: 26px; margin: 6px 0 4px; letter-spacing: -.01em; }
.issue-meta { color: var(--muted); font-size: 14px; }
.status-badge {
  display: inline-block; font-size: 12px; font-weight: 700; color: #fff;
  background: var(--badge); border-radius: 4px; padding: 1px 8px; margin-left: 8px; vertical-align: 2px;
}
.intro { margin: 20px 0 28px; padding: 14px 16px; background: var(--accent-soft); border-radius: 10px; font-size: 14.5px; }
article.item {
  background: var(--card); border: 1px solid var(--line); border-radius: 14px;
  padding: 22px 24px; margin-bottom: 18px;
}
.item-meta { font-size: 13px; color: var(--muted); display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.cat {
  font-size: 12px; font-weight: 600; color: var(--accent);
  background: var(--accent-soft); border-radius: 999px; padding: 2px 10px;
}
article.item h2 { font-size: 19px; margin: 10px 0 10px; letter-spacing: -.01em; }
.summary { font-size: 15.5px; }
.angle {
  margin-top: 14px; padding: 12px 14px; border-left: 3px solid var(--accent);
  background: var(--accent-soft); border-radius: 0 8px 8px 0; font-size: 14.5px;
}
.angle b { color: var(--accent); }
.source { margin-top: 14px; font-size: 13.5px; }
.source a { color: var(--muted); text-decoration: none; border-bottom: 1px dotted var(--muted); }
.source a:hover { color: var(--accent); border-color: var(--accent); }
nav.archive { margin-top: 44px; padding-top: 20px; border-top: 1px solid var(--line); }
nav.archive h3 { font-size: 14px; color: var(--muted); margin-bottom: 10px; }
nav.archive a { display: inline-block; margin: 0 10px 8px 0; color: var(--accent); text-decoration: none; font-size: 14.5px; }
footer.disclaimer { margin-top: 40px; font-size: 12.5px; color: var(--muted); }
a.home { color: var(--accent); text-decoration: none; font-size: 14px; }
`;

function renderItem(item) {
  const cat = CATEGORY_LABELS[item.category] || item.category || "";
  const label = item.sourceLabel || (item.subreddit ? `r/${item.subreddit}` : "");
  const stats = [
    item.upvotes != null ? `<span>▲ ${item.upvotes.toLocaleString()}</span>` : "",
    item.numComments != null ? `<span>💬 ${item.numComments.toLocaleString()}</span>` : "",
  ].join("");
  return `
<article class="item">
  <div class="item-meta">
    ${cat ? `<span class="cat">${esc(cat)}</span>` : ""}
    <span>${esc(label)}</span>
    ${stats}
  </div>
  <h2>${esc(item.titleKo)}</h2>
  <p class="summary">${esc(item.summaryKo)}</p>
  <div class="angle"><b>글감 포인트</b> — ${esc(item.angleKo)}</div>
  <p class="source">원문: <a href="${esc(item.sourceUrl)}" target="_blank" rel="noopener">${esc(item.sourceTitle)}</a></p>
</article>`;
}

function renderIssuePage(issue, allIssues, { isIndex = false } = {}) {
  const label = labelOf(issue);
  const badge = STATUS_BADGES[issue.status]
    ? `<span class="status-badge">${STATUS_BADGES[issue.status]}</span>`
    : "";
  const prefix = isIndex ? "" : "../";
  const archiveLinks = allIssues
    .map((i) =>
      labelOf(i) === label
        ? `<a style="font-weight:700">${labelOf(i)}</a>`
        : `<a href="${prefix}issues/${labelOf(i)}.html">${labelOf(i)}</a>`
    )
    .join("");

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VetMan 해외 브리핑 — ${esc(label)}</title>
<style>${CSS}</style>
</head>
<body>
<div class="wrap">
  <header class="masthead">
    <div class="brand">VetMan 해외 브리핑</div>
    <h1>${esc(label)} 데일리 브리핑${badge}</h1>
    <div class="issue-meta">해외 수의 미디어·커뮤니티에서 오늘 주목할 글 ${issue.items.length}건</div>
  </header>
  ${issue.note ? `<div class="intro">⚠️ ${esc(issue.note)}</div>` : `<div class="intro">해외 수의사들은 지금 이런 이야기를 하고 있습니다. 각 아이템의 <b>글감 포인트</b>는 우리 병원 블로그 소재로 바로 활용할 수 있는 관점 제안입니다.</div>`}
  ${issue.items.map(renderItem).join("\n")}
  <nav class="archive"><h3>지난 이슈</h3>${archiveLinks}</nav>
  <footer class="disclaimer">
    본 콘텐츠는 해외 커뮤니티 공개 글의 요약·번역이며, 임상 정보는 참고용입니다. 실제 적용 전 반드시 원문과 최신 문헌을 확인하세요.<br>
    모든 아이템에는 원문 링크가 포함되어 있습니다. · VetMan
  </footer>
</div>
</body>
</html>`;
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
  // VetMan embed용 JSON endpoint
  fs.writeFileSync(path.join(SITE_DIR, "latest.json"), JSON.stringify(latest, null, 2));

  console.log(`빌드 완료: ${issues.length}개 이슈 → site/ (최신: ${labelOf(latest)})`);
}

build();
