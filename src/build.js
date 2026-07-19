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

// 출처 매체 → 국가 (아는 것만; 모르면 생략)
const SOURCE_COUNTRY = {
  "Veterinary Practice News": "미국",
  "Today's Veterinary Business": "미국",
  "Today's Veterinary Practice": "미국",
  "Today's Veterinary Nurse": "미국",
  "Dr. Andy Roark": "미국",
  VetGirl: "미국",
  "Vet Candy": "미국",
  "IVC Journal": "미국",
  "Veterinary Record": "영국",
  "Vet Practice Magazine": "호주",
};

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

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

// ── 데이터 스키마 매핑: 파이프라인 item → 디자인 Article ──
function toArticle(item, i, issueDate) {
  const body = item.bodyKo?.length ? item.bodyKo : item.summaryKo ? [item.summaryKo] : [];
  const dek = item.leadKo || item.summaryKo || "";
  const chars = (item.titleKo || "").length + dek.length + body.join("").length;
  const readMin = Math.max(1, Math.round(chars / 500));
  const pub = item.publishedAt ? new Date(item.publishedAt) : null;
  const dateStr = pub
    ? `${String(pub.getMonth() + 1).padStart(2, "0")}.${String(pub.getDate()).padStart(2, "0")}`
    : "";
  const isToday = pub ? pub.toISOString().slice(0, 10) === issueDate : false;
  return {
    id: `a${i + 1}`,
    ts: pub ? pub.getTime() : Date.now() - i * 1000,
    kicker: CATEGORY_LABELS[item.category] || item.category || "브리핑",
    isToday,
    title: item.titleKo || "",
    dek,
    source: item.sourceLabel || "",
    country: SOURCE_COUNTRY[item.sourceLabel] || "",
    date: dateStr,
    read: `${readMin}분 읽기`,
    plate: item.sourceLabel || "출처",
    image: item.imageUrl || null,
    sourceUrl: item.sourceUrl || "#",
    body,
    blog: item.angleKo || "",
    blogAngle: item.keyPointsKo?.length ? item.keyPointsKo : [],
  };
}

function buildIssueData(issue) {
  const date = labelOf(issue); // YYYY-MM-DD
  const d = new Date(date + "T00:00:00");
  const dateline = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 · ${WEEKDAYS[d.getDay()]}요일`;
  const editionNo = Math.round((d - new Date("2021-01-01T00:00:00")) / 86400000);
  const articles = issue.items.map((it, i) => toArticle(it, i, date));
  return {
    date,
    dateLabel: date.replace(/-/g, "."),
    dateline,
    editionNo: editionNo.toLocaleString("en-US"),
    count: articles.length,
    articles,
  };
}

// ── SEO ──
function seoHead(issue, data, canonicalPath) {
  const label = labelOf(issue);
  const title = `${label} 수의계 해외 뉴스 브리핑 | ${SITE.name}`;
  const desc = data.articles[0]?.dek || SITE.description;
  const canonical = `${SITE.baseUrl}${canonicalPath}`;
  const ogImage = data.articles.find((a) => a.image)?.image;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: title,
    description: SITE.description,
    url: canonical,
    itemListElement: data.articles.map((a, idx) => ({
      "@type": "ListItem",
      position: idx + 1,
      item: {
        "@type": "NewsArticle",
        headline: a.title,
        description: a.dek,
        url: `${canonical}#${a.id}`,
        ...(a.image ? { image: a.image } : {}),
        ...(a.ts ? { datePublished: new Date(a.ts).toISOString() } : {}),
        publisher: { "@type": "Organization", name: SITE.name, url: SITE.baseUrl },
        isBasedOn: a.sourceUrl,
        inLanguage: "ko",
      },
    })),
  };
  return `
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc.slice(0, 155))}">
<meta name="keywords" content="동물병원, 수의사, 수의학 뉴스, 해외 수의 트렌드, 동물병원 경영, 수의 임상, ${data.articles
    .slice(0, 3)
    .map((a) => esc(a.title.split(",")[0].split("…")[0].trim()))
    .join(", ")}">
<link rel="canonical" href="${esc(canonical)}">
<link rel="alternate" type="application/rss+xml" title="${esc(SITE.name)}" href="${SITE.baseUrl}/rss.xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc.slice(0, 155))}">
<meta property="og:url" content="${esc(canonical)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ""}
<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">
<meta name="robots" content="index, follow">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;
}

// noscript / 크롤러용 실제 콘텐츠
function noscriptFallback(data) {
  return `<noscript><div style="max-width:720px;margin:0 auto;padding:40px 20px;font-family:sans-serif;">
<h1>${esc(SITE.name)} — ${esc(data.date)}</h1>
${data.articles
    .map(
      (a) => `<article style="margin-bottom:28px;border-bottom:1px solid #ddd;padding-bottom:20px;">
<h2>${esc(a.title)}</h2><p><b>${esc(a.dek)}</b></p>
${a.body.map((p) => `<p>${esc(p)}</p>`).join("")}
<p>원문: <a href="${esc(a.sourceUrl)}" rel="nofollow">${esc(a.source)}</a></p></article>`
    )
    .join("")}
</div></noscript>`;
}

const TOKENS_CSS = `
:root{
  --color-primary-normal:#0066ff; --color-primary-strong:#005eeb; --color-primary-heavy:#0054d1;
  --color-label-normal:#1b1c1e; --color-label-strong:#000; --color-label-neutral:rgba(46,47,51,.88);
  --color-label-alternative:rgba(46,47,51,.61); --color-label-assistive:rgba(55,56,60,.28);
  --color-background-normal:#fff; --color-background-alternative:#f7f7f8; --color-background-elevated:#fff;
  --color-line-normal:rgba(112,115,124,.22); --color-line-strong:rgba(112,115,124,.61);
  --color-material-dimmer:rgba(0,0,0,.55); --color-material-thin:rgba(112,115,124,.05); --color-material-base:rgba(112,115,124,.08);
  --color-atomic-blue-100:#eaf2fe; --color-atomic-blue-800:#0054d1;
  --elevation-4:0px 0px 60px 0px rgba(23,23,23,.10); --elevation-5:0px 15px 75px 0px rgba(23,23,23,.16); --elevation-input:0px 1px 2px 0px rgba(0,0,0,.03);
  --font-display:"Wanted Sans Variable","Pretendard Variable","Apple SD Gothic Neo",system-ui,sans-serif;
  --font-sans:"Pretendard Variable","Apple SD Gothic Neo","Noto Sans KR",system-ui,-apple-system,sans-serif;
}
:root[data-theme="dark"], .vm-page[data-theme="dark"], .vm-detail[data-theme="dark"]{
  --color-primary-normal:#4f95ff; --color-primary-strong:#69a5ff; --color-primary-heavy:#9ec5ff;
  --color-label-normal:rgba(255,255,255,.96); --color-label-strong:#fff; --color-label-neutral:rgba(255,255,255,.88);
  --color-label-alternative:rgba(255,255,255,.61); --color-label-assistive:rgba(255,255,255,.28);
  --color-background-normal:#171719; --color-background-alternative:#1b1c1e; --color-background-elevated:#212225;
  --color-line-normal:rgba(255,255,255,.22); --color-line-strong:rgba(255,255,255,.4);
  --color-material-thin:rgba(255,255,255,.05); --color-material-base:rgba(255,255,255,.08);
  --color-atomic-blue-100:#17281f00; --color-atomic-blue-100:rgba(79,149,255,.16); --color-atomic-blue-800:#9ec5ff;
}`;

const STATIC_CSS = `
*,*::before,*::after{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{font-family:var(--font-sans);color:var(--color-label-normal);background:var(--color-background-normal);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;}
a{color:var(--color-primary-normal);text-decoration:none;}
a:hover{color:var(--color-primary-strong);}
.vm-page ::selection{background:rgba(0,102,255,0.16);}
.vm-lead:hover .vm-hl,.vm-row:hover .vm-hl,.vm-card:hover .vm-hl,.vm-rail:hover .vm-hl,.vm-mr:hover .vm-mrt{color:var(--color-primary-normal);}
.vm-detail-body::-webkit-scrollbar{width:10px;}
.vm-detail-body::-webkit-scrollbar-thumb{background:var(--color-line-strong);border-radius:8px;border:3px solid var(--color-background-normal);}
.vm-plate-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
@keyframes vmFade{from{opacity:0;}to{opacity:1;}}
@keyframes vmSlide{from{transform:translateX(36px);opacity:0;}to{transform:translateX(0);opacity:1;}}
:focus-visible{outline:2px solid var(--color-primary-normal);outline-offset:2px;}
@media (max-width:900px){
  .vm-wrap{padding-left:20px !important;padding-right:20px !important;}
  .vm-bar{padding-left:20px !important;padding-right:20px !important;}
  .vm-grid{grid-template-columns:1fr !important;}
  .vm-lead-col{padding:24px 0 28px !important;}
  .vm-rail-col{padding:8px 0 28px !important;border-left:0 !important;border-top:1px solid var(--color-line-normal);}
  .vm-band{grid-template-columns:1fr !important;}
  .vm-mast h1{font-size:40px !important;}
  .vm-lead-h{font-size:30px !important;}
  .vm-detail{width:100% !important;max-width:100% !important;}
  .vm-search{display:none !important;}
}`;

// 클라이언트 앱 — 렌더링 + 인터랙션 (바닐라 JS)
const APP_JS = String.raw`
(function(){
  var DATA = JSON.parse(document.getElementById('vm-issue').textContent);
  var A = DATA.articles;
  var byId = {}; A.forEach(function(a){ byId[a.id]=a; });
  var LS = { saved:'vm_saved', theme:'vm_theme' };
  function load(k,d){ try{ return JSON.parse(localStorage.getItem(k)) ?? d; }catch(e){ return d; } }
  var initTheme = load(LS.theme, (window.matchMedia && matchMedia('(prefers-color-scheme:dark)').matches) ? 'dark':'light');
  var S = { theme:initTheme, sort:'rel', saved:load(LS.saved,{}), query:'', view:'home', openId:null, blogOpen:false, showAll:false, searchFocus:false, caret:0 };
  var BM = '<svg width="W" height="W" viewBox="0 0 24 24" fill="currentColor" style="display:block"><g transform="translate(4.1 2.1)"><path d="M 4.065 0 L 11.735 0 C 12.265 0 12.716 0 13.087 0.03 C 13.476 0.062 13.855 0.132 14.217 0.316 C 14.762 0.594 15.206 1.038 15.484 1.583 C 15.668 1.945 15.738 2.324 15.77 2.713 C 15.8 3.084 15.8 3.535 15.8 4.065 L 15.8 18.9 C 15.8 19.225 15.625 19.525 15.341 19.684 C 15.058 19.844 14.711 19.838 14.433 19.669 L 7.9 15.703 L 1.367 19.669 C 1.089 19.838 0.742 19.844 0.459 19.684 C 0.175 19.525 0 19.225 0 18.9 L 0 4.065 C 0 3.535 0 3.084 0.03 2.713 C 0.062 2.324 0.132 1.945 0.316 1.583 C 0.594 1.038 1.038 0.594 1.583 0.316 C 1.945 0.132 2.324 0.062 2.713 0.03 C 3.084 0 3.535 0 4.065 0 Z M 3.7 1.8 C 2.885 1.8 2.692 1.811 2.56 1.854 C 2.225 1.963 1.963 2.225 1.854 2.56 C 1.811 2.692 1.8 2.886 1.8 3.7 L 1.8 17.301 L 7.433 13.881 C 7.72 13.707 8.08 13.707 8.367 13.881 L 14 17.301 L 14 3.7 C 14 2.886 13.989 2.692 13.946 2.56 C 13.837 2.225 13.575 1.963 13.24 1.854 C 13.108 1.811 12.915 1.8 12.1 1.8 L 3.7 1.8 Z" fill-rule="evenodd"></path></g></svg>';
  var EXT = '<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="display:block"><g transform="translate(2.85 2.85)"><path d="M 11.9 0 C 11.403 0 11 0.403 11 0.9 C 11 1.397 11.403 1.8 11.9 1.8 L 15.227 1.8 L 8.514 8.514 C 8.162 8.865 8.162 9.435 8.514 9.786 C 8.865 10.138 9.435 10.138 9.787 9.786 L 16.5 3.073 L 16.5 6.4 C 16.5 6.897 16.903 7.3 17.4 7.3 C 17.897 7.3 18.3 6.897 18.3 6.4 L 18.3 0.9 C 18.3 0.403 17.897 0 17.4 0 L 11.9 0 Z"></path><path d="M 7.25 0.001 C 7.747 0.001 8.15 0.404 8.15 0.901 C 8.15 1.398 7.747 1.801 7.25 1.801 L 5.7 1.801 C 4.845 1.801 4.258 1.801 3.803 1.838 C 3.358 1.875 3.119 1.941 2.947 2.029 C 2.551 2.231 2.23 2.552 2.029 2.947 C 1.941 3.12 1.874 3.359 1.838 3.803 C 1.801 4.259 1.8 4.846 1.8 5.701 L 1.8 12.601 C 1.8 13.456 1.801 14.043 1.838 14.498 C 1.874 14.942 1.941 15.181 2.029 15.354 C 2.23 15.749 2.551 16.07 2.947 16.272 C 3.119 16.36 3.358 16.426 3.803 16.463 C 4.258 16.5 4.845 16.501 5.7 16.501 L 12.6 16.501 C 13.455 16.501 14.042 16.5 14.497 16.463 C 14.942 16.426 15.18 16.36 15.353 16.272 C 15.748 16.07 16.07 15.749 16.271 15.354 C 16.359 15.181 16.426 14.942 16.462 14.498 C 16.499 14.043 16.5 13.456 16.5 12.601 L 16.5 11.051 C 16.5 10.554 16.903 10.151 17.4 10.151 C 17.897 10.151 18.3 10.554 18.3 11.051 L 18.3 12.638 C 18.3 13.446 18.3 14.107 18.256 14.644 C 18.211 15.2 18.114 15.702 17.875 16.171 C 17.501 16.905 16.904 17.502 16.171 17.876 C 15.702 18.114 15.2 18.211 14.644 18.257 C 14.107 18.301 13.446 18.301 12.638 18.301 L 5.662 18.301 C 4.854 18.301 4.193 18.301 3.656 18.257 C 3.1 18.211 2.598 18.114 2.129 17.876 C 1.396 17.502 0.799 16.905 0.425 16.171 C 0.186 15.702 0.089 15.2 0.044 14.644 C 0 14.107 0 13.446 0 12.638 L 0 5.663 C 0 4.855 0 4.194 0.044 3.657 C 0.089 3.101 0.186 2.599 0.425 2.13 C 0.799 1.396 1.396 0.8 2.129 0.426 C 2.598 0.187 3.1 0.09 3.656 0.044 C 4.193 0.001 4.854 0.001 5.662 0.001 L 7.25 0.001 Z"></path></g></svg>';
  var COPY = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a2 2 0 0 1 2-2h9"></path></svg>';
  var e = function(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); };
  function meta(a){ return [a.source,a.country,a.date,a.read].filter(Boolean).map(e).join(' · '); }
  function metaShort(a){ return [a.source,a.country,a.date].filter(Boolean).map(e).join(' · '); }
  function isSaved(id){ return !!S.saved[id]; }
  function saveColor(id){ return isSaved(id)?'var(--color-primary-normal)':'var(--color-label-assistive)'; }
  function tag(today,h,fs){ return today?'<span style="display:inline-flex;align-items:center;height:'+h+'px;padding:0 6px;background:var(--color-atomic-blue-100);color:var(--color-atomic-blue-800);border-radius:4px;font-size:'+fs+'px;font-weight:700;">오늘</span>':''; }
  // 이미지가 있으면 오버레이(깨지면 사라짐), 아래엔 항상 텍스트 라벨이 깔림
  function plateImg(a){
    return a.image ? '<img class="vm-plate-img" src="'+e(a.image)+'" alt="'+e(a.title)+'" loading="lazy" onerror="this.remove()">' : '';
  }

  function sorted(){ var arr=A.slice(); if(S.sort==='latest'){ arr.sort(function(x,y){return y.ts-x.ts;}); } return arr; }
  function filtered(){
    var q=S.query.trim().toLowerCase();
    var base = S.view==='saved' ? A.filter(function(a){return isSaved(a.id);}) : sorted();
    if(!q) return base;
    return base.filter(function(a){
      return (a.title+' '+a.dek+' '+a.source+' '+a.kicker+' '+a.body.join(' ')).toLowerCase().indexOf(q)>=0;
    });
  }

  function bookmarkBtn(id,w,box){
    var st = box==='plain'
      ? 'width:'+(w+11)+'px;height:'+(w+11)+'px;border:0;background:transparent;'
      : 'width:'+(w+11)+'px;height:'+(w+11)+'px;border:1px solid var(--color-line-normal);background:var(--color-background-elevated);';
    return '<button data-save="'+id+'" title="저장" style="'+st+'display:inline-flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;color:'+saveColor(id)+';">'+BM.replace(/W/g,w)+'</button>';
  }

  function leadCard(a){
    return '<article class="vm-lead" data-open="'+a.id+'" style="cursor:pointer;">'
    +'<div style="position:relative;border-radius:4px;overflow:hidden;background:rgba(0,102,255,0.07);border:1px solid var(--color-line-normal);height:320px;display:flex;flex-direction:column;justify-content:space-between;padding:22px;margin-bottom:20px;">'
    + plateImg(a)
    +'<span style="position:relative;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--color-primary-heavy);">출처 이미지</span>'
    +'<div style="position:relative;display:flex;flex-direction:column;gap:6px;"><span style="font-family:var(--font-display);font-size:34px;font-weight:800;letter-spacing:-.02em;color:var(--color-primary-heavy);line-height:1.05;">'+e(a.plate)+'</span></div>'
    +'<div style="position:absolute;top:16px;right:16px;">'+bookmarkBtn(a.id,18,'box')+'</div>'
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-primary-normal);">'+e(a.kicker)+'</span>'+tag(a.isToday,18,10.5)+'</div>'
    +'<h2 class="vm-hl vm-lead-h" style="font-family:var(--font-display);font-size:40px;line-height:1.12;font-weight:800;letter-spacing:-.03em;margin:0 0 16px;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</h2>'
    +'<p style="font-size:17px;line-height:1.7;color:var(--color-label-neutral);margin:0 0 16px;max-width:56ch;">'+e(a.dek)+'</p>'
    +'<div style="display:flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.02em;color:var(--color-label-alternative);text-transform:uppercase;">'+meta(a)+'</div>'
    +'<div style="margin-top:16px;border-left:2px solid var(--color-primary-normal);padding-left:12px;"><span style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--color-primary-normal);">병원 블로그 글감</span><p style="margin:4px 0 0;font-size:13.5px;line-height:1.55;color:var(--color-label-neutral);">'+e(a.blog)+'</p></div>'
    +'</article>';
  }
  function railCard(a){
    return '<article class="vm-rail" data-open="'+a.id+'" style="padding:20px 0;border-top:1px solid var(--color-line-normal);cursor:pointer;">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;"><div style="display:flex;align-items:center;gap:8px;"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-primary-normal);">'+e(a.kicker)+'</span>'+tag(a.isToday,16,10)+'</div>'+bookmarkBtn(a.id,15,'plain')+'</div>'
    +'<h3 class="vm-hl" style="font-family:var(--font-display);font-size:21px;line-height:1.28;font-weight:700;letter-spacing:-.017em;margin:0 0 8px;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</h3>'
    +'<p style="font-size:14px;line-height:1.6;color:var(--color-label-neutral);margin:0 0 10px;">'+e(a.dek)+'</p>'
    +'<div style="font-size:11.5px;letter-spacing:.02em;text-transform:uppercase;color:var(--color-label-alternative);">'+metaShort(a)+'</div>'
    +'</article>';
  }
  function mostRead(list){
    return '<div style="margin-top:14px;border-top:2px solid var(--color-label-strong);padding-top:14px;"><div style="font-family:var(--font-display);font-size:15px;font-weight:800;letter-spacing:.02em;color:var(--color-label-strong);margin-bottom:6px;">주목 브리핑 TOP 5</div>'
    + list.map(function(a,i){
      return '<div class="vm-mr" data-open="'+a.id+'" style="display:flex;gap:12px;align-items:baseline;padding:11px 0;border-top:1px solid var(--color-line-normal);cursor:pointer;"><span style="flex:none;font-family:var(--font-display);font-size:20px;font-weight:800;color:var(--color-primary-normal);width:20px;line-height:1;">'+(i+1)+'</span><div><div class="vm-mrt" style="font-size:14px;font-weight:700;line-height:1.35;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</div><div style="margin-top:3px;font-size:11px;text-transform:uppercase;letter-spacing:.02em;color:var(--color-label-alternative);">'+[a.source,a.country].filter(Boolean).map(e).join(' · ')+'</div></div></div>';
    }).join('')
    +'</div>';
  }
  function bandCard(a){
    return '<article class="vm-card" data-open="'+a.id+'" style="background:var(--color-background-normal);padding:24px 22px 26px;display:flex;flex-direction:column;cursor:pointer;">'
    +'<div style="height:112px;border-radius:4px;overflow:hidden;background:rgba(0,102,255,0.07);border:1px solid var(--color-line-normal);display:flex;align-items:flex-end;padding:12px;margin-bottom:14px;position:relative;">'+plateImg(a)+'<span style="position:relative;font-family:var(--font-display);font-size:15px;font-weight:800;color:var(--color-primary-heavy);">'+e(a.plate)+'</span><div style="position:absolute;top:8px;right:8px;">'+bookmarkBtn(a.id,15,'box')+'</div></div>'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-primary-normal);">'+e(a.kicker)+'</span>'+tag(a.isToday,16,10)+'</div>'
    +'<h3 class="vm-hl" style="font-family:var(--font-display);font-size:19px;line-height:1.32;font-weight:700;letter-spacing:-.015em;margin:0 0 10px;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</h3>'
    +'<p style="font-size:13.5px;line-height:1.6;color:var(--color-label-neutral);margin:0 0 10px;">'+e(a.dek)+'</p>'
    +'<div style="font-size:11.5px;letter-spacing:.02em;text-transform:uppercase;color:var(--color-label-alternative);">'+metaShort(a)+'</div>'
    +'<div style="margin-top:auto;padding-top:12px;"><span style="font-size:12px;line-height:1.5;color:var(--color-label-alternative);"><b style="color:var(--color-primary-normal);font-weight:700;">글감</b> · '+e(a.blog)+'</span></div>'
    +'</article>';
  }
  function rowCard(a){
    return '<article class="vm-row" data-open="'+a.id+'" style="display:flex;gap:20px;padding:24px 0;border-bottom:1px solid var(--color-line-normal);cursor:pointer;">'
    +'<div style="flex:none;width:128px;height:96px;border-radius:4px;overflow:hidden;background:rgba(0,102,255,0.07);border:1px solid var(--color-line-normal);display:flex;align-items:center;justify-content:center;padding:8px;text-align:center;position:relative;">'+plateImg(a)+'<span style="position:relative;font-family:var(--font-display);font-size:14px;font-weight:800;color:var(--color-primary-heavy);line-height:1.15;">'+e(a.plate)+'</span></div>'
    +'<div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-primary-normal);">'+e(a.kicker)+'</span>'+tag(a.isToday,16,10)+'</div>'
    +'<h3 class="vm-hl" style="font-family:var(--font-display);font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-.017em;margin:0 0 8px;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</h3>'
    +'<p style="font-size:14.5px;line-height:1.6;color:var(--color-label-neutral);margin:0 0 8px;max-width:70ch;">'+e(a.dek)+'</p>'
    +'<div style="font-size:11.5px;letter-spacing:.02em;text-transform:uppercase;color:var(--color-label-alternative);">'+meta(a)+'</div></div>'
    + bookmarkBtn(a.id,17,'box')
    +'</article>';
  }

  function homeView(){
    var arr=sorted();
    var lead=arr[0], rail=arr.slice(1,3), bandAll=arr.slice(3);
    var band = S.showAll ? bandAll : bandAll.slice(0,6);
    var top5 = arr.slice(0,5);
    var more = bandAll.length - band.length;
    var h='<div><div class="vm-grid" style="display:grid;grid-template-columns:2fr 1fr;gap:0;border-bottom:2px solid var(--color-label-strong);">'
    +'<div class="vm-lead-col" style="padding:28px 40px 34px 0;">'+(lead?leadCard(lead):'')+'</div>'
    +'<div class="vm-rail-col" style="padding:28px 0 34px 40px;border-left:1px solid var(--color-line-normal);">'+rail.map(railCard).join('')+mostRead(top5)+'</div>'
    +'</div>';
    if(bandAll.length){
      h+='<div style="padding:16px 0 13px;border-bottom:1px solid var(--color-line-normal);"><span style="font-family:var(--font-display);font-size:19px;font-weight:800;letter-spacing:-.01em;color:var(--color-label-strong);">오늘의 다른 소식</span></div>'
      +'<div class="vm-band" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--color-line-normal);">'+band.map(bandCard).join('')+'</div>';
      if(more>0){ h+='<div style="display:flex;justify-content:center;padding:28px 0 0;"><button data-act="more" style="display:inline-flex;align-items:center;gap:8px;border:1px solid var(--color-line-strong);background:var(--color-background-normal);color:var(--color-label-strong);cursor:pointer;font-family:inherit;font-size:14px;font-weight:700;padding:12px 24px;border-radius:10px;">기사 '+more+'건 더 보기</button></div>'; }
    }
    h+='</div>';
    return h;
  }
  function listView(){
    var items=filtered();
    if(!items.length){
      var t = S.view==='saved' ? '저장한 글이 없습니다' : '검색 결과가 없습니다';
      var hint = S.view==='saved' ? '기사의 북마크 아이콘을 눌러 저장해 보세요.' : '다른 검색어를 입력해 보세요.';
      return '<div style="text-align:center;padding:72px 0;color:var(--color-label-alternative);"><div style="font-family:var(--font-display);font-size:20px;font-weight:700;color:var(--color-label-neutral);">'+t+'</div><p style="margin:8px 0 0;font-size:14px;">'+hint+'</p></div>';
    }
    return '<div style="padding-top:8px;">'+items.map(rowCard).join('')+'</div>';
  }

  function detail(){
    var a=byId[S.openId]; if(!a) return '';
    var img = a.image ? '<img class="vm-plate-img" src="'+e(a.image)+'" alt="'+e(a.title)+'" onerror="this.remove()">' : '';
    var body = a.body.map(function(p){return '<p style="font-size:16px;line-height:1.8;color:var(--color-label-neutral);margin:0 0 16px;">'+e(p)+'</p>';}).join('');
    var angle = a.blogAngle.map(function(p){return '<li style="margin-bottom:2px;">'+e(p)+'</li>';}).join('');
    var chev = S.blogOpen ? 'rotate(180deg)' : 'rotate(0deg)';
    return '<div data-act="close" style="position:fixed;inset:0;background:var(--color-material-dimmer);z-index:50;animation:vmFade .18s ease-out;"></div>'
    +'<div class="vm-detail" data-theme="'+S.theme+'" style="position:fixed;top:0;right:0;bottom:0;width:720px;max-width:calc(100vw - 24px);background:var(--color-background-normal);color:var(--color-label-normal);z-index:51;display:flex;flex-direction:column;box-shadow:var(--elevation-5);animation:vmSlide .24s ease-out;font-family:var(--font-sans);">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 22px;border-bottom:1px solid var(--color-line-normal);"><div style="display:flex;align-items:center;gap:8px;min-width:0;"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-primary-normal);white-space:nowrap;">'+e(a.kicker)+'</span>'+tag(a.isToday,17,10)+'</div>'
    +'<div style="display:flex;align-items:center;gap:6px;">'
    +'<button data-act="copylink" data-id="'+a.id+'" title="링크 복사" style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--color-line-normal);background:var(--color-background-normal);border-radius:8px;cursor:pointer;color:var(--color-label-neutral);">'+COPY+'</button>'
    +'<button data-save="'+a.id+'" title="저장" style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--color-line-normal);background:var(--color-background-normal);border-radius:8px;cursor:pointer;color:'+saveColor(a.id)+';">'+BM.replace(/W/g,16)+'</button>'
    +'<button data-act="close" title="닫기" style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:0;background:var(--color-material-base);border-radius:8px;cursor:pointer;color:var(--color-label-neutral);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="display:block"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>'
    +'</div></div>'
    +'<div class="vm-detail-body" style="overflow-y:auto;padding:30px 44px 20px;">'
    +'<h1 style="font-family:var(--font-display);font-size:34px;line-height:1.2;font-weight:800;letter-spacing:-.028em;margin:0 0 16px;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</h1>'
    +'<div style="display:flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.02em;text-transform:uppercase;color:var(--color-label-alternative);padding-bottom:20px;border-bottom:1px solid var(--color-line-normal);">'+meta(a)+'</div>'
    +'<div style="position:relative;overflow:hidden;height:220px;margin:22px 0;border-radius:6px;background:rgba(0,102,255,0.07);border:1px solid var(--color-line-normal);display:flex;flex-direction:column;justify-content:space-between;padding:20px;">'+img+'<span style="position:relative;font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--color-primary-heavy);">출처 이미지</span><span style="position:relative;font-family:var(--font-display);font-size:26px;font-weight:800;letter-spacing:-.02em;color:var(--color-primary-heavy);">'+e(a.plate)+'</span></div>'
    +'<p style="font-size:17px;line-height:1.75;color:var(--color-label-normal);margin:0 0 18px;font-weight:500;">'+e(a.dek)+'</p>'
    +body
    +'<div style="margin:26px 0 4px;padding:16px 18px;background:var(--color-background-alternative);border-radius:12px;"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--color-label-alternative);margin-bottom:6px;">원문 출처</div><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;"><div style="font-size:14px;color:var(--color-label-neutral);"><b style="color:var(--color-label-strong);font-weight:700;">'+e(a.source)+'</b>'+(a.country?' · '+e(a.country):'')+(a.date?' · '+e(a.date):'')+'</div><a href="'+e(a.sourceUrl)+'" target="_blank" rel="noopener nofollow" style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:var(--color-primary-normal);">원문 사이트로 이동 '+EXT+'</a></div><p style="margin:10px 0 0;font-size:11.5px;line-height:1.5;color:var(--color-label-alternative);">해외 공개 자료의 요약·번역이며 임상 정보는 참고용입니다. 적용 전 원문과 최신 문헌을 확인하세요.</p></div>'
    + (a.blog ? '<div style="margin:20px 0 8px;border:1px solid var(--color-primary-normal);border-radius:12px;overflow:hidden;"><button data-act="blog" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border:0;background:rgba(0,102,255,0.06);cursor:pointer;font-family:inherit;text-align:left;"><span style="display:flex;flex-direction:column;gap:2px;"><span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--color-primary-normal);">병원 블로그 글감 제안</span><span style="font-size:14.5px;font-weight:700;color:var(--color-label-strong);">'+e(a.blog)+'</span></span><svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="display:block;flex:none;color:var(--color-primary-normal);transform:'+chev+';"><g transform="translate(3.9 7.9)"><path d="M 0.264 0.264 C 0.615 -0.088 1.185 -0.088 1.536 0.264 L 8.1 6.827 L 14.664 0.264 C 15.015 -0.088 15.585 -0.088 15.936 0.264 C 16.288 0.615 16.288 1.185 15.936 1.536 L 8.736 8.736 C 8.385 9.088 7.815 9.088 7.464 8.736 L 0.264 1.536 C -0.088 1.185 -0.088 0.615 0.264 0.264 Z" fill-rule="evenodd"></path></g></svg></button>'
      + (S.blogOpen ? '<div style="padding:16px 18px 18px;">'+(angle?'<div style="font-size:12px;font-weight:700;color:var(--color-label-neutral);margin-bottom:8px;">이렇게 풀어보세요</div><ul style="margin:0 0 14px;padding-left:18px;color:var(--color-label-neutral);font-size:14px;line-height:1.75;">'+angle+'</ul>':'')+'<button data-act="copyblog" data-id="'+a.id+'" style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--color-primary-normal);background:var(--color-background-normal);color:var(--color-primary-normal);cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;padding:9px 14px;border-radius:9px;">'+COPY+' 글감 복사하기</button></div>' : '')
      +'</div>' : '')
    +'</div>'
    +'<div style="padding:14px 22px;border-top:1px solid var(--color-line-normal);display:flex;gap:8px;align-items:center;"><button data-act="close" style="border:1px solid var(--color-line-normal);background:var(--color-background-normal);color:var(--color-label-normal);cursor:pointer;font-family:inherit;font-size:14px;font-weight:700;padding:12px 18px;border-radius:10px;">닫기</button><a href="'+e(a.sourceUrl)+'" target="_blank" rel="noopener nofollow" style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:8px;background:var(--color-primary-normal);color:#fff;cursor:pointer;font-family:inherit;font-size:14px;font-weight:700;padding:12px 18px;border-radius:10px;">원문 전체 보기 '+EXT+'</a></div>'
    +'</div>';
  }

  function segBg(on){ return on?'var(--color-label-strong)':'transparent'; }
  function segFg(on){ return on?'var(--color-background-normal)':'var(--color-label-alternative)'; }
  function render(){
    var savedCount=Object.keys(S.saved).filter(function(k){return S.saved[k];}).length;
    var mode = (S.view==='saved'||S.query.trim()) ? 'list' : 'home';
    var stripLabel, stripMeta;
    if(S.view==='saved'){ stripLabel='저장한 글'; stripMeta=savedCount+'건 저장됨'; }
    else if(S.query.trim()){ stripLabel='검색 결과'; stripMeta='"'+e(S.query.trim())+'" · '+filtered().length+'건'; }
    else { stripLabel='오늘의 브리핑'; stripMeta=DATA.dateLabel+' · 총 '+DATA.count+'건'; }
    var moon='<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="display:block"><g transform="translate(2.529 2.431)"><path d="M 7.161 0.281 C 7.416 0.551 7.48 0.949 7.321 1.284 C 6.827 2.331 6.55 3.502 6.55 4.739 C 6.55 9.213 10.176 12.839 14.65 12.839 C 15.732 12.839 16.762 12.628 17.703 12.245 C 18.046 12.105 18.441 12.19 18.696 12.459 C 18.951 12.729 19.015 13.127 18.856 13.463 C 17.272 16.816 13.858 19.139 9.9 19.139 C 4.432 19.139 0 14.706 0 9.239 C 0 5.09 2.552 1.539 6.168 0.066 C 6.512 -0.073 6.906 0.012 7.161 0.281 Z" fill-rule="evenodd"></path></g></svg>';
    var sun='<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="display:block"><g transform="translate(1.1 1.1)"><path d="M 10 20.9 C 10 21.397 10.403 21.8 10.9 21.8 C 11.397 21.8 11.8 21.397 11.8 20.9 L 11.8 18.9 C 11.8 18.403 11.397 18 10.9 18 C 10.403 18 10 18.403 10 18.9 Z"></path><path d="M 10 2.9 C 10 3.397 10.403 3.8 10.9 3.8 C 11.397 3.8 11.8 3.397 11.8 2.9 L 11.8 0.9 C 11.8 0.403 11.397 0 10.9 0 C 10.403 0 10 0.403 10 0.9 Z"></path><path d="M 5.5 10.897 C 5.5 7.915 7.918 5.497 10.9 5.497 C 13.882 5.497 16.3 7.915 16.3 10.897 C 16.3 13.88 13.882 16.297 10.9 16.297 C 7.918 16.297 5.5 13.88 5.5 10.897 Z M 10.9 7.297 C 8.912 7.297 7.3 8.909 7.3 10.897 C 7.3 12.885 8.912 14.497 10.9 14.497 C 12.888 14.497 14.5 12.885 14.5 10.897 C 14.5 8.909 12.888 7.297 10.9 7.297 Z" fill-rule="evenodd"></path><path d="M 0 10.9 C 0 10.403 0.403 10 0.9 10 L 2.9 10 C 3.397 10 3.8 10.403 3.8 10.9 C 3.8 11.397 3.397 11.8 2.9 11.8 L 0.9 11.8 C 0.403 11.8 0 11.397 0 10.9 Z"></path><path d="M 18 10.9 C 18 10.403 18.403 10 18.9 10 L 20.9 10 C 21.397 10 21.8 10.403 21.8 10.9 C 21.8 11.397 21.397 11.8 20.9 11.8 L 18.9 11.8 C 18.403 11.8 18 11.397 18 10.9 Z"></path></g></svg>';
    var search='<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="display:block;flex:none"><g transform="translate(2.35 2.35)"><path d="M 7.9 0 C 3.537 0 0 3.537 0 7.9 C 0 12.263 3.537 15.8 7.9 15.8 C 9.757 15.8 11.465 15.159 12.814 14.086 L 17.764 19.036 C 18.115 19.388 18.685 19.388 19.036 19.036 C 19.388 18.685 19.388 18.115 19.036 17.764 L 14.086 12.813 C 15.159 11.465 15.8 9.757 15.8 7.9 C 15.8 3.537 12.263 0 7.9 0 Z M 1.8 7.9 C 1.8 4.531 4.531 1.8 7.9 1.8 C 11.269 1.8 14 4.531 14 7.9 C 14 11.269 11.269 14 7.9 14 C 4.531 14 1.8 11.269 1.8 7.9 Z" fill-rule="evenodd"></path></g></svg>';
    var h='';
    // sticky bar
    h+='<div style="position:sticky;top:0;z-index:30;background:var(--color-background-normal);border-bottom:1px solid var(--color-line-normal);"><div class="vm-bar" style="max-width:1180px;margin:0 auto;padding:9px 40px;display:flex;align-items:center;gap:18px;">'
    +'<button data-act="home" style="flex:none;border:0;background:transparent;cursor:pointer;font-family:var(--font-display);font-size:18px;font-weight:800;letter-spacing:-.02em;color:var(--color-label-strong);">VetMan 브리핑</button>'
    +'<div class="vm-search" style="flex:1;max-width:460px;display:flex;align-items:center;gap:8px;background:var(--color-material-thin);border-radius:9px;padding:9px 12px;color:var(--color-label-alternative);">'+search+'<input id="vm-q" value="'+e(S.query)+'" placeholder="기사 검색 — 제목·본문·출처" style="border:0;outline:0;background:transparent;font-family:inherit;font-size:13px;color:var(--color-label-normal);width:100%;"></div>'
    +'<button data-act="saved" style="flex:none;display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;color:'+(S.view==='saved'?'var(--color-primary-normal)':'var(--color-label-neutral)')+';">'+BM.replace(/W/g,17)+' 저장 '+savedCount+'</button>'
    +'<button data-act="theme" title="테마 전환" style="flex:none;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:1px solid var(--color-line-normal);background:var(--color-background-normal);color:var(--color-label-neutral);cursor:pointer;border-radius:9px;">'+(S.theme==='dark'?sun:moon)+'</button>'
    +'</div></div>';
    // content wrap
    h+='<div class="vm-wrap" style="max-width:1180px;margin:0 auto;padding:0 40px 64px;">';
    h+='<div style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;font-size:12px;color:var(--color-label-alternative);"><span style="flex:1;text-align:left;">'+e(DATA.dateline)+'</span><span style="flex:1;text-align:center;letter-spacing:.06em;">해외 수의 뉴스 데일리 브리핑</span><span style="flex:1;text-align:right;">원문 출처 표기 · 번역 참고용</span></div>';
    h+='<div style="height:1px;background:var(--color-line-normal);"></div>';
    h+='<header class="vm-mast" style="text-align:center;padding:26px 0 20px;"><div style="font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:var(--color-primary-normal);font-weight:700;">Daily Edition · No. '+e(DATA.editionNo)+'</div><h1 style="font-family:var(--font-display);font-size:58px;font-weight:800;letter-spacing:-.032em;line-height:1.02;margin:12px 0 0;color:var(--color-label-strong);">VetMan 해외 브리핑</h1><p style="max-width:560px;margin:16px auto 0;font-size:14px;line-height:1.6;color:var(--color-label-alternative);">해외 수의 전문 미디어의 오늘 소식을 선별·번역해 한국 동물병원 원장에게 전하는 데일리 브리핑. 각 글에는 병원 블로그 글감 제안이 함께 붙습니다.</p></header>';
    h+='<div style="border-top:2px solid var(--color-label-strong);border-bottom:1px solid var(--color-line-normal);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:11px 0;"><div style="display:flex;align-items:baseline;gap:10px;"><span style="font-family:var(--font-display);font-size:17px;font-weight:800;letter-spacing:-.01em;color:var(--color-label-strong);">'+stripLabel+'</span><span style="font-size:12.5px;color:var(--color-label-alternative);">'+stripMeta+'</span></div>'
    +'<div style="display:inline-flex;padding:3px;background:var(--color-material-base);border-radius:8px;gap:2px;"><button data-act="rel" style="border:0;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;padding:5px 11px;border-radius:6px;background:'+segBg(S.sort==='rel')+';color:'+segFg(S.sort==='rel')+';">관련성순</button><button data-act="latest" style="border:0;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;padding:5px 11px;border-radius:6px;background:'+segBg(S.sort==='latest')+';color:'+segFg(S.sort==='latest')+';">최신순</button></div></div>';
    h += mode==='home' ? homeView() : listView();
    h+='<footer style="margin-top:40px;border-top:2px solid var(--color-label-strong);padding-top:24px;display:flex;align-items:flex-start;justify-content:space-between;gap:24px;flex-wrap:wrap;"><p style="margin:0;max-width:620px;font-size:11.5px;line-height:1.6;color:var(--color-label-alternative);">본 콘텐츠는 해외 공개 자료의 요약·번역이며, 임상 정보는 참고용입니다. 실제 적용 전 반드시 원문과 최신 문헌을 확인하세요. 모든 항목에 원문 출처가 표기됩니다.</p></footer>';
    h+='</div>';
    h += detail();
    if(S.toast){ h+='<div style="position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:60;background:var(--color-label-strong);color:var(--color-background-normal);padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:var(--elevation-4);animation:vmFade .18s ease-out;">'+e(S.toast)+'</div>'; }

    var root=document.getElementById('vm');
    root.setAttribute('data-theme',S.theme);
    document.documentElement.setAttribute('data-theme',S.theme);
    root.innerHTML=h;
    // restore search focus/caret
    if(S.searchFocus){ var q=document.getElementById('vm-q'); if(q){ q.focus(); try{ q.setSelectionRange(S.caret,S.caret); }catch(e){} } }
    document.documentElement.style.overflow = S.openId ? 'hidden' : '';
  }

  var toastTimer;
  function toast(msg){ S.toast=msg; render(); clearTimeout(toastTimer); toastTimer=setTimeout(function(){ S.toast=null; render(); },1700); }
  function persist(){ localStorage.setItem(LS.saved,JSON.stringify(S.saved)); }

  document.addEventListener('click',function(ev){
    var el=ev.target.closest('[data-save],[data-open],[data-act]');
    if(!el) return;
    if(el.hasAttribute('data-save')){ ev.stopPropagation(); var id=el.getAttribute('data-save'); S.saved[id]=!S.saved[id]; if(!S.saved[id]) delete S.saved[id]; persist(); render(); return; }
    var act=el.getAttribute('data-act');
    if(act){
      if(act==='home'){ S.view='home'; S.query=''; S.openId=null; S.showAll=false; }
      else if(act==='saved'){ S.view=S.view==='saved'?'home':'saved'; S.query=''; S.openId=null; }
      else if(act==='theme'){ S.theme=S.theme==='dark'?'light':'dark'; localStorage.setItem(LS.theme,JSON.stringify(S.theme)); }
      else if(act==='rel'){ S.sort='rel'; }
      else if(act==='latest'){ S.sort='latest'; }
      else if(act==='more'){ S.showAll=true; }
      else if(act==='close'){ S.openId=null; S.blogOpen=false; }
      else if(act==='blog'){ S.blogOpen=!S.blogOpen; }
      else if(act==='copylink'){ var id=el.getAttribute('data-id'); navigator.clipboard && navigator.clipboard.writeText(location.origin+location.pathname+'#'+id); toast('링크를 복사했습니다'); return; }
      else if(act==='copyblog'){ var a=byId[el.getAttribute('data-id')]; var t=a.blog+'\n\n'+a.blogAngle.map(function(x){return '· '+x;}).join('\n'); navigator.clipboard && navigator.clipboard.writeText(t); toast('글감을 복사했습니다'); return; }
      S.searchFocus=false; render(); return;
    }
    if(el.hasAttribute('data-open')){ S.openId=el.getAttribute('data-open'); S.blogOpen=false; S.searchFocus=false; render(); }
  });
  document.addEventListener('input',function(ev){
    if(ev.target.id==='vm-q'){ S.query=ev.target.value; S.searchFocus=true; S.caret=ev.target.selectionStart; if(S.query.trim()) S.view='home'; render(); }
  });
  document.addEventListener('keydown',function(ev){ if(ev.key==='Escape' && S.openId){ S.openId=null; S.blogOpen=false; render(); } });
  // deep-link to an article
  if(location.hash && byId[location.hash.slice(1)]){ S.openId=location.hash.slice(1); }
  render();
})();`;

function renderPage(issue, allIssues, { isIndex = false } = {}) {
  const data = buildIssueData(issue);
  const canonicalPath = isIndex ? "/" : `/issues/${labelOf(issue)}.html`;
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${seoHead(issue, data, canonicalPath)}
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/wanteddev/wanted-sans@v1.0.4/packages/wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<style>${TOKENS_CSS}${STATIC_CSS}</style>
<script>try{var t=JSON.parse(localStorage.getItem('vm_theme'))||((window.matchMedia&&matchMedia('(prefers-color-scheme:dark)').matches)?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}</script>
</head>
<body>
<div class="vm-page" id="vm" data-theme="light" style="min-height:100vh;background:var(--color-background-normal);color:var(--color-label-normal);font-family:var(--font-sans);"></div>
${noscriptFallback(data)}
<script id="vm-issue" type="application/json">${json}</script>
<script>${APP_JS}</script>
</body>
</html>`;
}

function buildSitemap(issues) {
  const urls = [`${SITE.baseUrl}/`, ...issues.map((i) => `${SITE.baseUrl}/issues/${labelOf(i)}.html`)];
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

function buildLlmsTxt(issues) {
  const latest = issues[0];
  return `# ${SITE.name}

> ${SITE.description}

한국 동물병원 원장·수의사를 위한 서비스입니다. 매일 오전 해외 수의 전문 미디어의 주요 글을 선별해 한국어 기사로 재작성하고, 병원 블로그 글감 아이디어를 함께 제공합니다.

## 최신 브리핑 (${labelOf(latest)})
${latest.items.map((it) => `- ${it.titleKo}: ${it.leadKo || it.summaryKo || ""}`).join("\n")}

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
  fs.writeFileSync(path.join(SITE_DIR, "index.html"), renderPage(latest, issues, { isIndex: true }));
  for (const issue of issues) {
    fs.writeFileSync(path.join(SITE_DIR, "issues", `${labelOf(issue)}.html`), renderPage(issue, issues));
  }
  fs.writeFileSync(path.join(SITE_DIR, "latest.json"), JSON.stringify(latest, null, 2));
  fs.writeFileSync(path.join(SITE_DIR, "sitemap.xml"), buildSitemap(issues));
  fs.writeFileSync(path.join(SITE_DIR, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE.baseUrl}/sitemap.xml\n`);
  fs.writeFileSync(path.join(SITE_DIR, "rss.xml"), buildRss(issues));
  fs.writeFileSync(path.join(SITE_DIR, "llms.txt"), buildLlmsTxt(issues));

  const mockup = path.join(ROOT, "design", "mockup.html");
  if (fs.existsSync(mockup)) fs.copyFileSync(mockup, path.join(SITE_DIR, "design.html"));

  console.log(`빌드 완료: ${issues.length}개 이슈 → site/ (최신: ${labelOf(latest)})`);
}

build();
