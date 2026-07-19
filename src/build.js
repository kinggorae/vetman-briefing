import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE } from "../config.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES_DIR = path.join(ROOT, "data", "issues");
const SITE_DIR = path.join(ROOT, "site");

const CATEGORY_LABELS = {
  research: "최신 연구",
  clinical: "임상",
  practice_management: "병원 경영",
  career: "커리어",
  client_communication: "보호자 소통",
  industry: "업계",
  other: "기타",
};
const CAT_ORDER = ["research", "clinical", "practice_management", "client_communication", "career", "industry", "other"];

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
    id: `${issueDate}_${i + 1}`,
    day: issueDate,
    ts: pub ? pub.getTime() : Date.now() - i * 1000,
    cat: item.category || "other",
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
  const date = labelOf(issue);
  const articles = issue.items.map((it, i) => toArticle(it, i, date));
  const cats = CAT_ORDER.filter((c) => articles.some((a) => a.cat === c)).map((c) => ({ key: c, label: CATEGORY_LABELS[c] }));
  if (issue.weekly) {
    return {
      date,
      dateLabel: date,
      dateline: `${date} 주간 요약 · 이번 주 가장 주목한 기사`,
      editionNo: date.replace("-W", " · W"),
      count: articles.length,
      cats,
      articles,
      weekly: true,
    };
  }
  const d = new Date(date + "T00:00:00");
  const dateline = `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 · ${WEEKDAYS[d.getDay()]}요일`;
  const editionNo = Math.round((d - new Date("2021-01-01T00:00:00")) / 86400000);
  return {
    date,
    dateLabel: date.replace(/-/g, "."),
    dateline,
    editionNo: editionNo.toLocaleString("en-US"),
    count: articles.length,
    cats,
    articles,
  };
}

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
  --color-atomic-blue-100:rgba(79,149,255,.16); --color-atomic-blue-800:#9ec5ff;
}`;

const STATIC_CSS = `
*,*::before,*::after{box-sizing:border-box;}
html,body{margin:0;padding:0;}
body{font-family:var(--font-sans);color:var(--color-label-normal);background:var(--color-background-normal);-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility;}
a{color:var(--color-primary-normal);text-decoration:none;}
a:hover{color:var(--color-primary-strong);}
.vm-page ::selection{background:rgba(0,102,255,0.16);}
.vm-lead:hover .vm-hl,.vm-row:hover .vm-hl,.vm-card:hover .vm-hl,.vm-rail:hover .vm-hl,.vm-mr:hover .vm-mrt,.vm-toc-i:hover{color:var(--color-primary-normal);}
.vm-read{opacity:.55;}
.vm-chip{border:1px solid var(--color-line-normal);background:transparent;color:var(--color-label-neutral);cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:700;padding:6px 13px;border-radius:999px;white-space:nowrap;}
.vm-chip[aria-pressed="true"]{background:var(--color-label-strong);color:var(--color-background-normal);border-color:var(--color-label-strong);}
.vm-detail-body::-webkit-scrollbar{width:10px;}
.vm-detail-body::-webkit-scrollbar-thumb{background:var(--color-line-strong);border-radius:8px;border:3px solid var(--color-background-normal);}
.vm-plate-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;}
.vm-progress{height:100%;background:var(--color-primary-normal);transition:width .3s ease;}
@keyframes vmFade{from{opacity:0;}to{opacity:1;}}
@keyframes vmSlide{from{transform:translateX(36px);opacity:0;}to{transform:translateX(0);opacity:1;}}
:focus-visible{outline:2px solid var(--color-primary-normal);outline-offset:2px;}
@media (max-width:900px){
  .vm-wrap{padding-left:20px !important;padding-right:20px !important;}
  .vm-bar{padding-left:20px !important;padding-right:20px !important;gap:10px !important;}
  .vm-bar-label{display:none !important;}
  .vm-grid{grid-template-columns:1fr !important;}
  .vm-lead-col{padding:24px 0 28px !important;}
  .vm-rail-col{padding:8px 0 28px !important;border-left:0 !important;border-top:1px solid var(--color-line-normal);}
  .vm-band{grid-template-columns:1fr !important;}
  .vm-mast h1{font-size:40px !important;}
  .vm-lead-h{font-size:30px !important;}
  .vm-detail{width:100% !important;max-width:100% !important;}
  .vm-search{display:none !important;}
  .vm-dateline{display:none !important;}
}`;

const APP_JS = String.raw`
(function(){
  var DATA = JSON.parse(document.getElementById('vm-issue').textContent);
  var byId = {};
  function indexDay(){ byId={}; DATA.articles.forEach(function(a){ byId[a.id]=a; }); }
  indexDay();
  var LS={saved:'vm_saved',ideas:'vm_ideas',read:'vm_read',theme:'vm_theme',fs:'vm_fs'};
  function load(k,d){ try{ return JSON.parse(localStorage.getItem(k)) ?? d; }catch(e){ return d; } }
  var S={
    theme: load(LS.theme,(window.matchMedia&&matchMedia('(prefers-color-scheme:dark)').matches)?'dark':'light'),
    sort:'rel', cat:'all', unreadOnly:false, query:'',
    view:'home', openId:null, blogOpen:true, showAll:false,
    saved:load(LS.saved,{}), ideas:load(LS.ideas,{}), read:load(LS.read,{}),
    fs:load(LS.fs,1), toast:null, searchFocus:false, caret:0,
    archive:null, loadingDate:null, draft:null
  };
  function e(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];}); }
  function persist(k,v){ localStorage.setItem(LS[k],JSON.stringify(v)); }
  function isSaved(id){ return !!S.saved[id]; }
  function isIdea(id){ return !!S.ideas[id]; }
  function isRead(id){ return !!S.read[id]; }
  function saveColor(id){ return isSaved(id)?'var(--color-primary-normal)':'var(--color-label-assistive)'; }
  function meta(a){ return [a.source,a.country,a.date,a.read].filter(Boolean).map(e).join(' · '); }
  function metaShort(a){ return [a.source,a.country,a.date].filter(Boolean).map(e).join(' · '); }
  function snap(a){ return {id:a.id,day:a.day,title:a.title,dek:a.dek,kicker:a.kicker,source:a.source,country:a.country,date:a.date,read:a.read,cat:a.cat,image:a.image,plate:a.plate,blog:a.blog,blogAngle:a.blogAngle,isToday:a.isToday}; }

  var BM='<svg width="W" height="W" viewBox="0 0 24 24" fill="currentColor" style="display:block"><g transform="translate(4.1 2.1)"><path d="M 4.065 0 L 11.735 0 C 12.265 0 12.716 0 13.087 0.03 C 13.476 0.062 13.855 0.132 14.217 0.316 C 14.762 0.594 15.206 1.038 15.484 1.583 C 15.668 1.945 15.738 2.324 15.77 2.713 C 15.8 3.084 15.8 3.535 15.8 4.065 L 15.8 18.9 C 15.8 19.225 15.625 19.525 15.341 19.684 C 15.058 19.844 14.711 19.838 14.433 19.669 L 7.9 15.703 L 1.367 19.669 C 1.089 19.838 0.742 19.844 0.459 19.684 C 0.175 19.525 0 19.225 0 18.9 L 0 4.065 C 0 3.535 0 3.084 0.03 2.713 C 0.062 2.324 0.132 1.945 0.316 1.583 C 0.594 1.038 1.038 0.594 1.583 0.316 C 1.945 0.132 2.324 0.062 2.713 0.03 C 3.084 0 3.535 0 4.065 0 Z M 3.7 1.8 C 2.885 1.8 2.692 1.811 2.56 1.854 C 2.225 1.963 1.963 2.225 1.854 2.56 C 1.811 2.692 1.8 2.886 1.8 3.7 L 1.8 17.301 L 7.433 13.881 C 7.72 13.707 8.08 13.707 8.367 13.881 L 14 17.301 L 14 3.7 C 14 2.886 13.989 2.692 13.946 2.56 C 13.837 2.225 13.575 1.963 13.24 1.854 C 13.108 1.811 12.915 1.8 12.1 1.8 L 3.7 1.8 Z" fill-rule="evenodd"></path></g></svg>';
  var EXT='<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="display:block"><g transform="translate(2.85 2.85)"><path d="M 11.9 0 C 11.403 0 11 0.403 11 0.9 C 11 1.397 11.403 1.8 11.9 1.8 L 15.227 1.8 L 8.514 8.514 C 8.162 8.865 8.162 9.435 8.514 9.786 C 8.865 10.138 9.435 10.138 9.787 9.786 L 16.5 3.073 L 16.5 6.4 C 16.5 6.897 16.903 7.3 17.4 7.3 C 17.897 7.3 18.3 6.897 18.3 6.4 L 18.3 0.9 C 18.3 0.403 17.897 0 17.4 0 L 11.9 0 Z"></path><path d="M 7.25 0.001 C 7.747 0.001 8.15 0.404 8.15 0.901 C 8.15 1.398 7.747 1.801 7.25 1.801 L 5.7 1.801 C 4.845 1.801 4.258 1.801 3.803 1.838 C 3.358 1.875 3.119 1.941 2.947 2.029 C 2.551 2.231 2.23 2.552 2.029 2.947 C 1.941 3.12 1.874 3.359 1.838 3.803 C 1.801 4.259 1.8 4.846 1.8 5.701 L 1.8 12.601 C 1.8 13.456 1.801 14.043 1.838 14.498 C 1.874 14.942 1.941 15.181 2.029 15.354 C 2.23 15.749 2.551 16.07 2.947 16.272 C 3.119 16.36 3.358 16.426 3.803 16.463 C 4.258 16.5 4.845 16.501 5.7 16.501 L 12.6 16.501 C 13.455 16.501 14.042 16.5 14.497 16.463 C 14.942 16.426 15.18 16.36 15.353 16.272 C 15.748 16.07 16.07 15.749 16.271 15.354 C 16.359 15.181 16.426 14.942 16.462 14.498 C 16.499 14.043 16.5 13.456 16.5 12.601 L 16.5 11.051 C 16.5 10.554 16.903 10.151 17.4 10.151 C 17.897 10.151 18.3 10.554 18.3 11.051 L 18.3 12.638 C 18.3 13.446 18.3 14.107 18.256 14.644 C 18.211 15.2 18.114 15.702 17.875 16.171 C 17.501 16.905 16.904 17.502 16.171 17.876 C 15.702 18.114 15.2 18.211 14.644 18.257 C 14.107 18.301 13.446 18.301 12.638 18.301 L 5.662 18.301 C 4.854 18.301 4.193 18.301 3.656 18.257 C 3.1 18.211 2.598 18.114 2.129 17.876 C 1.396 17.502 0.799 16.905 0.425 16.171 C 0.186 15.702 0.089 15.2 0.044 14.644 C 0 14.107 0 13.446 0 12.638 L 0 5.663 C 0 4.855 0 4.194 0.044 3.657 C 0.089 3.101 0.186 2.599 0.425 2.13 C 0.799 1.396 1.396 0.8 2.129 0.426 C 2.598 0.187 3.1 0.09 3.656 0.044 C 4.193 0.001 4.854 0.001 5.662 0.001 L 7.25 0.001 Z"></path></g></svg>';
  var COPY='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a2 2 0 0 1 2-2h9"></path></svg>';
  var IDEA='<svg width="W" height="W" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M9 18h6M10 21h4"></path><path d="M12 2a6 6 0 0 0-4 10.5c.7.7 1 1.4 1 2.5h6c0-1.1.3-1.8 1-2.5A6 6 0 0 0 12 2z"></path></svg>';
  var CHEV='<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="display:block;flex:none;"><g transform="translate(3.9 7.9)"><path d="M 0.264 0.264 C 0.615 -0.088 1.185 -0.088 1.536 0.264 L 8.1 6.827 L 14.664 0.264 C 15.015 -0.088 15.585 -0.088 15.936 0.264 C 16.288 0.615 16.288 1.185 15.936 1.536 L 8.736 8.736 C 8.385 9.088 7.815 9.088 7.464 8.736 L 0.264 1.536 C -0.088 1.185 -0.088 0.615 0.264 0.264 Z" fill-rule="evenodd"></path></g></svg>';
  var ARL='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M15 18l-6-6 6-6"></path></svg>';
  var ARR='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M9 6l6 6-6 6"></path></svg>';

  function sorted(){ var arr=DATA.articles.slice(); if(S.sort==='latest'){ arr.sort(function(x,y){return y.ts-x.ts;}); } return arr; }
  function match(a,q){ return (a.title+' '+a.dek+' '+a.source+' '+a.kicker+' '+(a.body||[]).join(' ')).toLowerCase().indexOf(q)>=0; }
  function activeList(){
    var arr=sorted();
    if(S.cat!=='all') arr=arr.filter(function(a){return a.cat===S.cat;});
    if(S.unreadOnly) arr=arr.filter(function(a){return !isRead(a.id);});
    var q=S.query.trim().toLowerCase();
    if(q) arr=arr.filter(function(a){return match(a,q);});
    return arr;
  }
  // 현재 문맥의 순서 있는 목록(연속 읽기용)
  function contextList(){
    if(S.view==='saved') return Object.keys(S.saved).map(function(k){return S.saved[k];});
    if(S.view==='ideas') return Object.keys(S.ideas).map(function(k){return S.ideas[k];});
    return activeList();
  }

  function tag(today,h,fs){ return today?'<span style="display:inline-flex;align-items:center;height:'+h+'px;padding:0 6px;background:var(--color-atomic-blue-100);color:var(--color-atomic-blue-800);border-radius:4px;font-size:'+fs+'px;font-weight:700;">오늘</span>':''; }
  function plateImg(a){ return a.image ? '<img class="vm-plate-img" src="'+e(a.image)+'" alt="'+e(a.title)+'" loading="lazy" onerror="this.remove()">' : ''; }
  var ICON_DOC='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="display:block;width:100%;height:100%;"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"></path><path d="M14 3v5h5"></path><path d="M8.5 13h7M8.5 16.5h7M8.5 9.5h2"></path></svg>';
  var ICON_NEWS='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="display:block;width:100%;height:100%;"><path d="M4 5h13v14a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z"></path><path d="M17 8h2a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2"></path><path d="M7 8h7M7 11.5h7M7 15h4"></path></svg>';
  // 이미지 없을 때: 결함이 아니라 의도된 "출처 플레이트". 아이콘+출처명+라벨.
  function plate(a,o){
    o=o||{};
    var research=a.cat==='research';
    var icon=research?ICON_DOC:ICON_NEWS;
    var isz=Math.max(20, Math.min(56, Math.round((o.big||15)*1.7)));
    var showLabel=(o.big||15)>=20; // 큰 박스에서만 하단 라벨
    var name='<div style="font-family:var(--font-display);font-size:'+Math.min(o.big||15,22)+'px;font-weight:800;letter-spacing:-.01em;color:var(--color-primary-heavy);line-height:1.15;text-align:center;max-width:92%;">'+e(a.plate)+'</div>';
    var label=showLabel?'<div style="font-size:10.5px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--color-primary-normal);opacity:.75;">'+(research?'PubMed · 최신 연구':'해외 수의 미디어')+'</div>':'';
    var fb='<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:'+(showLabel?10:6)+'px;padding:'+(o.pad||12)+'px;background:linear-gradient(135deg, rgba(0,102,255,0.05), rgba(0,102,255,0.10));">'
      +'<div style="width:'+isz+'px;height:'+isz+'px;color:var(--color-primary-normal);opacity:.55;">'+icon+'</div>'
      + name + label
      +'</div>';
    return fb + plateImg(a);
  }
  function bookmarkBtn(id,w,box){
    var st = box==='plain' ? 'width:'+(w+11)+'px;height:'+(w+11)+'px;border:0;background:transparent;' : 'width:'+(w+11)+'px;height:'+(w+11)+'px;border:1px solid var(--color-line-normal);background:var(--color-background-elevated);';
    return '<button data-save="'+id+'" title="저장" style="'+st+'display:inline-flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;color:'+saveColor(id)+';">'+BM.replace(/W/g,w)+'</button>';
  }
  function readCls(id){ return isRead(id)?' vm-read':''; }

  function leadCard(a){
    return '<article class="vm-lead'+readCls(a.id)+'" data-open="'+a.id+'" style="cursor:pointer;">'
    +'<div style="position:relative;border-radius:4px;overflow:hidden;background:rgba(0,102,255,0.07);border:1px solid var(--color-line-normal);height:320px;margin-bottom:20px;">'
    + plate(a,{label:true,big:34,pad:22})
    +'<div style="position:absolute;top:16px;right:16px;z-index:2;">'+bookmarkBtn(a.id,18,'box')+'</div></div>'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-primary-normal);">'+e(a.kicker)+'</span>'+tag(a.isToday,18,10.5)+(isRead(a.id)?'<span style="font-size:10.5px;color:var(--color-label-alternative);">읽음</span>':'')+'</div>'
    +'<h2 class="vm-hl vm-lead-h" style="font-family:var(--font-display);font-size:40px;line-height:1.12;font-weight:800;letter-spacing:-.03em;margin:0 0 16px;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</h2>'
    +'<p style="font-size:17px;line-height:1.7;color:var(--color-label-neutral);margin:0 0 14px;max-width:56ch;">'+e(a.dek)+'</p>'
    + (a.body&&a.body[0]?'<p style="font-size:15px;line-height:1.75;color:var(--color-label-neutral);margin:0 0 16px;max-width:60ch;display:-webkit-box;-webkit-line-clamp:5;-webkit-box-orient:vertical;overflow:hidden;">'+e(a.body[0])+'</p>':'')
    +'<div style="display:flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.02em;color:var(--color-label-alternative);text-transform:uppercase;">'+meta(a)+'</div>'
    +'<div style="margin-top:16px;border-left:2px solid var(--color-primary-normal);padding-left:12px;"><span style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--color-primary-normal);">병원 블로그 글감</span><p style="margin:4px 0 0;font-size:13.5px;line-height:1.55;color:var(--color-label-neutral);">'+e(a.blog)+'</p></div>'
    +'</article>';
  }
  function railCard(a){
    return '<article class="vm-rail'+readCls(a.id)+'" data-open="'+a.id+'" style="padding:20px 0;border-top:1px solid var(--color-line-normal);cursor:pointer;">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;"><div style="display:flex;align-items:center;gap:8px;"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-primary-normal);">'+e(a.kicker)+'</span>'+tag(a.isToday,16,10)+'</div>'+bookmarkBtn(a.id,15,'plain')+'</div>'
    +'<h3 class="vm-hl" style="font-family:var(--font-display);font-size:21px;line-height:1.28;font-weight:700;letter-spacing:-.017em;margin:0 0 8px;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</h3>'
    +'<p style="font-size:14px;line-height:1.6;color:var(--color-label-neutral);margin:0 0 10px;">'+e(a.dek)+'</p>'
    +'<div style="font-size:11.5px;letter-spacing:.02em;text-transform:uppercase;color:var(--color-label-alternative);">'+metaShort(a)+'</div></article>';
  }
  function mostRead(list){
    return '<div style="margin-top:14px;border-top:2px solid var(--color-label-strong);padding-top:14px;"><div style="font-family:var(--font-display);font-size:15px;font-weight:800;letter-spacing:.02em;color:var(--color-label-strong);margin-bottom:6px;">주목 브리핑 TOP 5</div>'
    + list.map(function(a,i){ return '<div class="vm-mr'+readCls(a.id)+'" data-open="'+a.id+'" style="display:flex;gap:12px;align-items:baseline;padding:11px 0;border-top:1px solid var(--color-line-normal);cursor:pointer;"><span style="flex:none;font-family:var(--font-display);font-size:20px;font-weight:800;color:var(--color-primary-normal);width:20px;line-height:1;">'+(i+1)+'</span><div><div class="vm-mrt" style="font-size:14px;font-weight:700;line-height:1.35;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</div><div style="margin-top:3px;font-size:11px;text-transform:uppercase;letter-spacing:.02em;color:var(--color-label-alternative);">'+[a.source,a.country].filter(Boolean).map(e).join(' · ')+'</div></div></div>'; }).join('')+'</div>';
  }
  function bandCard(a){
    return '<article class="vm-card'+readCls(a.id)+'" data-open="'+a.id+'" style="background:var(--color-background-normal);padding:24px 22px 26px;display:flex;flex-direction:column;cursor:pointer;">'
    +'<div style="height:112px;border-radius:4px;overflow:hidden;background:rgba(0,102,255,0.07);border:1px solid var(--color-line-normal);margin-bottom:14px;position:relative;">'+plate(a,{big:15,pad:12})+'<div style="position:absolute;top:8px;right:8px;z-index:2;">'+bookmarkBtn(a.id,15,'box')+'</div></div>'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-primary-normal);">'+e(a.kicker)+'</span>'+tag(a.isToday,16,10)+'</div>'
    +'<h3 class="vm-hl" style="font-family:var(--font-display);font-size:19px;line-height:1.32;font-weight:700;letter-spacing:-.015em;margin:0 0 10px;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</h3>'
    +'<p style="font-size:13.5px;line-height:1.6;color:var(--color-label-neutral);margin:0 0 10px;">'+e(a.dek)+'</p>'
    +'<div style="font-size:11.5px;letter-spacing:.02em;text-transform:uppercase;color:var(--color-label-alternative);">'+metaShort(a)+'</div>'
    +'<div style="margin-top:auto;padding-top:12px;"><span style="font-size:12px;line-height:1.5;color:var(--color-label-alternative);"><b style="color:var(--color-primary-normal);font-weight:700;">글감</b> · '+e(a.blog)+'</span></div></article>';
  }
  function rowCard(a){
    var ideaBtn = '<button data-idea="'+a.id+'" title="글감 담기" style="flex:none;width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--color-line-normal);background:var(--color-background-normal);border-radius:9px;cursor:pointer;color:'+(isIdea(a.id)?'var(--color-primary-normal)':'var(--color-label-assistive)')+';">'+IDEA.replace(/W/g,16)+'</button>';
    return '<article class="vm-row'+readCls(a.id)+'" data-open="'+a.id+'" style="display:flex;gap:20px;padding:24px 0;border-bottom:1px solid var(--color-line-normal);cursor:pointer;">'
    +'<div style="flex:none;width:128px;height:96px;border-radius:4px;overflow:hidden;background:rgba(0,102,255,0.07);border:1px solid var(--color-line-normal);position:relative;">'+plate(a,{big:13,pad:8,center:true})+'</div>'
    +'<div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-primary-normal);">'+e(a.kicker)+'</span>'+tag(a.isToday,16,10)+'</div>'
    +'<h3 class="vm-hl" style="font-family:var(--font-display);font-size:22px;line-height:1.3;font-weight:700;letter-spacing:-.017em;margin:0 0 8px;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</h3>'
    +'<p style="font-size:14.5px;line-height:1.6;color:var(--color-label-neutral);margin:0 0 8px;max-width:70ch;">'+e(a.dek)+'</p>'
    +'<div style="font-size:11.5px;letter-spacing:.02em;text-transform:uppercase;color:var(--color-label-alternative);">'+meta(a)+'</div></div>'
    +'<div style="flex:none;display:flex;flex-direction:column;gap:8px;">'+bookmarkBtn(a.id,17,'box')+ideaBtn+'</div></article>';
  }

  function catRow(){
    if(!DATA.cats.length) return '';
    var chips='<button class="vm-chip" data-cat="all" aria-pressed="'+(S.cat==='all')+'">전체</button>';
    chips+=DATA.cats.map(function(c){return '<button class="vm-chip" data-cat="'+c.key+'" aria-pressed="'+(S.cat===c.key)+'">'+e(c.label)+'</button>';}).join('');
    var total=DATA.articles.length, readCnt=DATA.articles.filter(function(a){return isRead(a.id);}).length;
    var pct=total?Math.round(readCnt/total*100):0;
    return '<div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;padding:14px 0 4px;">'
    +'<div style="display:flex;gap:7px;flex-wrap:wrap;flex:1;min-width:0;">'+chips+'</div>'
    +'<button class="vm-chip" data-act="unread" aria-pressed="'+S.unreadOnly+'">안 읽은 글만</button>'
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:10px;padding:8px 0 2px;font-size:11.5px;color:var(--color-label-alternative);"><div style="flex:1;height:4px;border-radius:99px;background:var(--color-material-base);overflow:hidden;"><div class="vm-progress" style="width:'+pct+'%;"></div></div><span style="font-variant-numeric:tabular-nums;">'+readCnt+' / '+total+' 읽음</span></div>';
  }

  function homeView(){
    var arr=activeList();
    if(!arr.length){ return '<div style="text-align:center;padding:64px 0;color:var(--color-label-alternative);"><div style="font-family:var(--font-display);font-size:19px;font-weight:700;color:var(--color-label-neutral);">해당 조건의 글이 없습니다</div><p style="margin:8px 0 0;font-size:14px;">필터를 바꿔보세요.</p></div>'; }
    var lead=arr[0], rail=arr.slice(1,3), bandAll=arr.slice(3);
    var band=S.showAll?bandAll:bandAll.slice(0,6);
    var top5=arr.slice(0,5), more=bandAll.length-band.length;
    var h='<div><div class="vm-grid" style="display:grid;grid-template-columns:2fr 1fr;gap:0;border-bottom:2px solid var(--color-label-strong);">'
    +'<div class="vm-lead-col" style="padding:28px 40px 34px 0;">'+leadCard(lead)+'</div>'
    +'<div class="vm-rail-col" style="padding:28px 0 34px 40px;border-left:1px solid var(--color-line-normal);">'+rail.map(railCard).join('')+mostRead(top5)+'</div></div>';
    if(bandAll.length){
      h+='<div style="padding:16px 0 13px;border-bottom:1px solid var(--color-line-normal);"><span style="font-family:var(--font-display);font-size:19px;font-weight:800;letter-spacing:-.01em;color:var(--color-label-strong);">오늘의 다른 소식</span></div>'
      +'<div class="vm-band" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--color-line-normal);">'+band.map(bandCard).join('')+'</div>';
      if(more>0){ h+='<div style="display:flex;justify-content:center;padding:28px 0 0;"><button data-act="more" style="display:inline-flex;align-items:center;gap:8px;border:1px solid var(--color-line-strong);background:var(--color-background-normal);color:var(--color-label-strong);cursor:pointer;font-family:inherit;font-size:14px;font-weight:700;padding:12px 24px;border-radius:10px;">기사 '+more+'건 더 보기</button></div>'; }
    }
    return h+'</div>';
  }
  function listView(items,emptyT,emptyH){
    if(!items.length){ return '<div style="text-align:center;padding:72px 0;color:var(--color-label-alternative);"><div style="font-family:var(--font-display);font-size:20px;font-weight:700;color:var(--color-label-neutral);">'+emptyT+'</div><p style="margin:8px 0 0;font-size:14px;">'+emptyH+'</p></div>'; }
    return '<div style="padding-top:8px;">'+items.map(rowCard).join('')+'</div>';
  }
  function ideaCard(a){
    var angle=(a.blogAngle||[]).map(function(p){return '<li style="margin-bottom:3px;">'+e(p)+'</li>';}).join('');
    return '<article style="border:1px solid var(--color-primary-normal);border-radius:12px;padding:18px 20px;margin-bottom:16px;">'
    +'<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;"><div style="min-width:0;"><div style="font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--color-primary-normal);margin-bottom:6px;">글감 · '+e(a.kicker)+' · '+e(a.source)+'</div><div style="font-family:var(--font-display);font-size:18px;font-weight:800;color:var(--color-label-strong);line-height:1.35;">'+e(a.blog)+'</div></div><button data-idea="'+a.id+'" title="빼기" style="flex:none;width:32px;height:32px;border:1px solid var(--color-line-normal);background:transparent;border-radius:8px;cursor:pointer;color:var(--color-label-alternative);display:inline-flex;align-items:center;justify-content:center;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg></button></div>'
    + (angle?'<ul style="margin:12px 0 0;padding-left:18px;color:var(--color-label-neutral);font-size:14px;line-height:1.7;">'+angle+'</ul>':'')
    +'<div style="margin-top:12px;display:flex;gap:8px;"><button data-act="copyone" data-id="'+a.id+'" style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--color-primary-normal);background:transparent;color:var(--color-primary-normal);cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:700;padding:7px 12px;border-radius:8px;">'+COPY+' 이 글감 복사</button>'+(byId[a.id]?'<button data-open="'+a.id+'" style="border:1px solid var(--color-line-normal);background:transparent;color:var(--color-label-neutral);cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:700;padding:7px 12px;border-radius:8px;">기사 보기</button>':'')+'</div></article>';
  }
  function ideasView(){
    var items=Object.keys(S.ideas).map(function(k){return S.ideas[k];});
    if(!items.length) return '<div style="text-align:center;padding:72px 0;color:var(--color-label-alternative);"><div style="font-family:var(--font-display);font-size:20px;font-weight:700;color:var(--color-label-neutral);">글감 보관함이 비어 있습니다</div><p style="margin:8px 0 0;font-size:14px;">기사의 <b>글감 담기</b> 버튼을 눌러 블로그 글감을 모아보세요. 모은 글감은 한 번에 초안으로 복사할 수 있습니다.</p></div>';
    return '<div style="padding-top:16px;"><div style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:12px;flex-wrap:wrap;"><button data-act="makedraft" style="display:inline-flex;align-items:center;gap:8px;background:var(--color-primary-normal);color:#fff;border:0;cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:700;padding:11px 18px;border-radius:10px;">✍️ AI 블로그 초안 만들기</button><button data-act="copyall" style="display:inline-flex;align-items:center;gap:8px;background:transparent;color:var(--color-primary-normal);border:1px solid var(--color-primary-normal);cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:700;padding:11px 18px;border-radius:10px;">'+COPY+' 전체 복사</button></div>'+items.map(ideaCard).join('')+'</div>';
  }
  function archiveView(){
    if(S.archive===null){ return '<div style="text-align:center;padding:72px 0;color:var(--color-label-alternative);">지난 브리핑을 불러오는 중…</div>'; }
    var wk=S.archive.weeklies||[], iss=S.archive.issues||[];
    if(!iss.length){ return '<div style="text-align:center;padding:72px 0;color:var(--color-label-alternative);">아직 지난 브리핑이 없습니다.</div>'; }
    var h='<div style="padding-top:16px;">';
    if(wk.length){
      h+='<div style="font-family:var(--font-display);font-size:15px;font-weight:800;color:var(--color-primary-normal);margin:0 0 4px;">📅 주간 요약</div>';
      h+=wk.map(function(x){ return '<button data-href="'+e(x.href)+'" style="width:100%;text-align:left;display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:16px 0;border-bottom:1px solid var(--color-line-normal);border-top:0;border-left:0;border-right:0;background:transparent;cursor:pointer;font-family:inherit;"><div><div style="font-family:var(--font-display);font-size:18px;font-weight:800;color:var(--color-label-strong);">'+e(x.week)+' 주간 요약</div><div style="margin-top:4px;font-size:13px;color:var(--color-label-alternative);line-height:1.5;">'+e((x.titles||[]).slice(0,3).join(" · "))+'</div></div><div style="flex:none;font-size:12px;color:var(--color-label-alternative);font-weight:700;white-space:nowrap;">'+x.count+'건 →</div></button>'; }).join('');
      h+='<div style="font-family:var(--font-display);font-size:15px;font-weight:800;color:var(--color-label-strong);margin:24px 0 4px;">날짜별</div>';
    }
    h+=iss.map(function(x){
      var cur=x.date===DATA.date;
      return '<button data-date="'+x.date+'" style="width:100%;text-align:left;display:flex;align-items:baseline;justify-content:space-between;gap:16px;padding:18px 0;border-bottom:1px solid var(--color-line-normal);border-top:0;border-left:0;border-right:0;background:transparent;cursor:pointer;font-family:inherit;">'
      +'<div><div style="font-family:var(--font-display);font-size:20px;font-weight:800;color:var(--color-label-strong);">'+e(x.dateLabel||x.date)+'</div><div style="margin-top:4px;font-size:13px;color:var(--color-label-alternative);line-height:1.5;">'+e((x.titles||[]).slice(0,3).join(' · '))+'</div></div>'
      +'<div style="flex:none;font-size:12px;color:'+(cur?'var(--color-primary-normal)':'var(--color-label-alternative)')+';font-weight:700;white-space:nowrap;">'+(cur?'현재 · ':'')+x.count+'건</div></button>';
    }).join('');
    return h+'</div>';
  }

  function detail(){
    var a=byId[S.openId]; if(!a) return '';
    var ctx=contextList(); var ids=ctx.map(function(x){return x.id;});
    var idx=ids.indexOf(a.id);
    var prev=idx>0?ctx[idx-1]:null, next=idx>=0&&idx<ctx.length-1?ctx[idx+1]:null;
    var pos=idx>=0?(idx+1)+' / '+ctx.length:'';
    var img=a.image?'<img class="vm-plate-img" src="'+e(a.image)+'" alt="'+e(a.title)+'" onerror="this.remove()">':'';
    var body=(a.body||[]).map(function(p){return '<p style="font-size:calc(16px*var(--fs));line-height:1.85;color:var(--color-label-neutral);margin:0 0 16px;">'+e(p)+'</p>';}).join('');
    var angle=(a.blogAngle||[]).map(function(p){return '<li style="margin-bottom:2px;">'+e(p)+'</li>';}).join('');
    var chev=S.blogOpen?'rotate(180deg)':'rotate(0deg)';
    // 목차
    var toc=ctx.map(function(x,i){ var on=x.id===a.id; return '<button class="vm-toc-i" data-open="'+x.id+'" style="width:100%;text-align:left;display:flex;gap:10px;align-items:baseline;padding:9px 0;border:0;border-top:1px solid var(--color-line-normal);background:transparent;cursor:pointer;font-family:inherit;'+(on?'color:var(--color-primary-normal);':'color:var(--color-label-neutral);')+(isRead(x.id)&&!on?'opacity:.5;':'')+'"><span style="flex:none;width:22px;font-family:var(--font-display);font-weight:800;font-size:13px;color:'+(on?'var(--color-primary-normal)':'var(--color-label-alternative)')+';">'+(i+1)+'</span><span style="font-size:13.5px;font-weight:'+(on?'700':'600')+';line-height:1.4;">'+e(x.title)+'</span></button>'; }).join('');
    return '<div data-act="close" style="position:fixed;inset:0;background:var(--color-material-dimmer);z-index:50;animation:vmFade .18s ease-out;"></div>'
    +'<div class="vm-detail" data-theme="'+S.theme+'" style="--fs:'+S.fs+';position:fixed;top:0;right:0;bottom:0;width:760px;max-width:calc(100vw - 24px);background:var(--color-background-normal);color:var(--color-label-normal);z-index:51;display:flex;flex-direction:column;box-shadow:var(--elevation-5);animation:vmSlide .24s ease-out;font-family:var(--font-sans);">'
    // header
    +'<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-bottom:1px solid var(--color-line-normal);">'
    +'<div style="display:flex;align-items:center;gap:8px;min-width:0;">'
    +'<button data-act="prev" '+(prev?'':'disabled')+' title="이전 기사" style="width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--color-line-normal);background:var(--color-background-normal);border-radius:8px;cursor:'+(prev?'pointer':'default')+';color:'+(prev?'var(--color-label-neutral)':'var(--color-label-assistive)')+';">'+ARL+'</button>'
    +'<button data-act="next" '+(next?'':'disabled')+' title="다음 기사" style="width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--color-line-normal);background:var(--color-background-normal);border-radius:8px;cursor:'+(next?'pointer':'default')+';color:'+(next?'var(--color-label-neutral)':'var(--color-label-assistive)')+';">'+ARR+'</button>'
    +'<span style="font-family:var(--font-display);font-size:12.5px;font-weight:700;color:var(--color-label-alternative);font-variant-numeric:tabular-nums;padding-left:4px;">'+pos+'</span>'
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:6px;">'
    +'<div style="display:inline-flex;border:1px solid var(--color-line-normal);border-radius:8px;overflow:hidden;margin-right:2px;"><button data-act="fs-" title="글자 작게" style="width:30px;height:32px;border:0;border-right:1px solid var(--color-line-normal);background:var(--color-background-normal);cursor:pointer;color:var(--color-label-neutral);font-family:inherit;font-size:12px;font-weight:700;">가−</button><button data-act="fs+" title="글자 크게" style="width:32px;height:32px;border:0;background:var(--color-background-normal);cursor:pointer;color:var(--color-label-neutral);font-family:inherit;font-size:15px;font-weight:700;">가＋</button></div>'
    +'<button data-idea="'+a.id+'" title="글감 담기" style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--color-line-normal);background:var(--color-background-normal);border-radius:8px;cursor:pointer;color:'+(isIdea(a.id)?'var(--color-primary-normal)':'var(--color-label-neutral)')+';">'+IDEA.replace(/W/g,16)+'</button>'
    +'<button data-act="share" data-id="'+a.id+'" title="공유" style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--color-line-normal);background:var(--color-background-normal);border-radius:8px;cursor:pointer;color:var(--color-label-neutral);">'+SHARE+'</button>'
    +'<button data-act="copylink" data-id="'+a.id+'" title="링크 복사" style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--color-line-normal);background:var(--color-background-normal);border-radius:8px;cursor:pointer;color:var(--color-label-neutral);">'+COPY+'</button>'
    +'<button data-save="'+a.id+'" title="저장" style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--color-line-normal);background:var(--color-background-normal);border-radius:8px;cursor:pointer;color:'+saveColor(a.id)+';">'+BM.replace(/W/g,16)+'</button>'
    +'<button data-act="close" title="닫기" style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:0;background:var(--color-material-base);border-radius:8px;cursor:pointer;color:var(--color-label-neutral);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>'
    +'</div></div>'
    // body
    +'<div class="vm-detail-body" id="vm-db" style="overflow-y:auto;padding:30px 44px 20px;">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-primary-normal);">'+e(a.kicker)+'</span>'+tag(a.isToday,17,10)+'</div>'
    +'<h1 style="font-family:var(--font-display);font-size:calc(34px*var(--fs));line-height:1.2;font-weight:800;letter-spacing:-.028em;margin:0 0 16px;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</h1>'
    +'<div style="display:flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.02em;text-transform:uppercase;color:var(--color-label-alternative);padding-bottom:20px;border-bottom:1px solid var(--color-line-normal);">'+meta(a)+'</div>'
    +'<div style="position:relative;overflow:hidden;height:240px;margin:22px 0;border-radius:6px;background:rgba(0,102,255,0.07);border:1px solid var(--color-line-normal);">'+plate(a,{label:true,big:26,pad:20})+'</div>'
    +'<p style="font-size:calc(17px*var(--fs));line-height:1.75;color:var(--color-label-normal);margin:0 0 18px;font-weight:500;">'+e(a.dek)+'</p>'
    +body
    +'<div style="margin:26px 0 4px;padding:16px 18px;background:var(--color-background-alternative);border-radius:12px;"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--color-label-alternative);margin-bottom:6px;">원문 출처</div><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;"><div style="font-size:14px;color:var(--color-label-neutral);"><b style="color:var(--color-label-strong);font-weight:700;">'+e(a.source)+'</b>'+(a.country?' · '+e(a.country):'')+(a.date?' · '+e(a.date):'')+'</div><a href="'+e(a.sourceUrl)+'" target="_blank" rel="noopener nofollow" style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:var(--color-primary-normal);">원문 사이트로 이동 '+EXT+'</a></div><p style="margin:10px 0 0;font-size:11.5px;line-height:1.5;color:var(--color-label-alternative);">해외 공개 자료의 요약·번역이며 임상 정보는 참고용입니다. 적용 전 원문과 최신 문헌을 확인하세요.</p></div>'
    + (a.blog ? '<div style="margin:20px 0 8px;border:1px solid var(--color-primary-normal);border-radius:12px;overflow:hidden;"><button data-act="blog" style="width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 18px;border:0;background:rgba(0,102,255,0.06);cursor:pointer;font-family:inherit;text-align:left;"><span style="display:flex;flex-direction:column;gap:2px;"><span style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--color-primary-normal);">병원 블로그 글감 제안</span><span style="font-size:14.5px;font-weight:700;color:var(--color-label-strong);">'+e(a.blog)+'</span></span><span style="color:var(--color-primary-normal);transform:'+chev+';display:inline-flex;">'+CHEV+'</span></button>'
      + (S.blogOpen ? '<div style="padding:16px 18px 18px;">'+(angle?'<div style="font-size:12px;font-weight:700;color:var(--color-label-neutral);margin-bottom:8px;">이렇게 풀어보세요</div><ul style="margin:0 0 14px;padding-left:18px;color:var(--color-label-neutral);font-size:14px;line-height:1.75;">'+angle+'</ul>':'')+'<div style="display:flex;gap:8px;flex-wrap:wrap;"><button data-idea="'+a.id+'" style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--color-primary-normal);background:'+(isIdea(a.id)?'var(--color-primary-normal)':'transparent')+';color:'+(isIdea(a.id)?'#fff':'var(--color-primary-normal)')+';cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;padding:9px 14px;border-radius:9px;">'+IDEA.replace(/W/g,15)+(isIdea(a.id)?' 글감함에 담김':' 글감함에 담기')+'</button><button data-act="makedraftone" data-id="'+a.id+'" style="display:inline-flex;align-items:center;gap:6px;border:0;background:var(--color-primary-normal);color:#fff;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;padding:9px 14px;border-radius:9px;">✍️ 이 글감으로 초안</button><button data-act="copyblog" data-id="'+a.id+'" style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--color-line-normal);background:var(--color-background-normal);color:var(--color-label-neutral);cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;padding:9px 14px;border-radius:9px;">'+COPY+' 복사</button></div></div>' : '')
      +'</div>' : '')
    // 다음 기사 미리보기
    + (next ? '<div data-open="'+next.id+'" style="margin:26px 0 6px;padding:18px 20px;border:1px solid var(--color-line-normal);border-radius:12px;cursor:pointer;display:flex;align-items:center;gap:14px;"><div style="min-width:0;flex:1;"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--color-primary-normal);margin-bottom:5px;">다음 기사 '+(idx+2)+'/'+ctx.length+'</div><div style="font-family:var(--font-display);font-size:18px;font-weight:800;color:var(--color-label-strong);line-height:1.35;text-wrap:pretty;">'+e(next.title)+'</div></div><span style="flex:none;color:var(--color-primary-normal);">'+ARR+'</span></div>' : '<div style="margin:26px 0 6px;padding:18px;text-align:center;color:var(--color-label-alternative);font-size:13px;">마지막 기사입니다.</div>')
    // 목차
    +'<div style="margin:10px 0 6px;"><div style="font-family:var(--font-display);font-size:14px;font-weight:800;color:var(--color-label-strong);padding:6px 0 2px;">목차 · '+ctx.length+'건</div>'+toc+'</div>'
    +'</div>'
    // footer
    +'<div style="padding:12px 20px;border-top:1px solid var(--color-line-normal);display:flex;gap:8px;align-items:center;">'
    +'<button data-act="prev" '+(prev?'':'disabled')+' style="display:inline-flex;align-items:center;gap:6px;border:1px solid var(--color-line-normal);background:var(--color-background-normal);color:'+(prev?'var(--color-label-normal)':'var(--color-label-assistive)')+';cursor:'+(prev?'pointer':'default')+';font-family:inherit;font-size:14px;font-weight:700;padding:12px 16px;border-radius:10px;">'+ARL+' 이전</button>'
    +'<a href="'+e(a.sourceUrl)+'" target="_blank" rel="noopener nofollow" style="display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--color-line-normal);background:var(--color-background-normal);color:var(--color-label-neutral);cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:700;padding:12px 14px;border-radius:10px;">원문 '+EXT+'</a>'
    +'<button data-act="next" '+(next?'':'disabled')+' style="flex:1;display:inline-flex;align-items:center;justify-content:center;gap:8px;background:'+(next?'var(--color-primary-normal)':'var(--color-material-base)')+';color:'+(next?'#fff':'var(--color-label-assistive)')+';border:0;cursor:'+(next?'pointer':'default')+';font-family:inherit;font-size:14px;font-weight:700;padding:12px 18px;border-radius:10px;">다음 기사 '+ARR+'</button>'
    +'</div></div>';
  }

  function segBg(on){ return on?'var(--color-label-strong)':'transparent'; }
  function segFg(on){ return on?'var(--color-background-normal)':'var(--color-label-alternative)'; }
  function navBtn(view,label,count){
    var on=S.view===view;
    return '<button data-nav="'+view+'" style="flex:none;display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;color:'+(on?'var(--color-primary-normal)':'var(--color-label-neutral)')+';">'+label+(count!=null?' '+count:'')+'</button>';
  }

  function render(){
    var savedCount=Object.keys(S.saved).length, ideaCount=Object.keys(S.ideas).length;
    var moon='<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="display:block"><g transform="translate(2.529 2.431)"><path d="M 7.161 0.281 C 7.416 0.551 7.48 0.949 7.321 1.284 C 6.827 2.331 6.55 3.502 6.55 4.739 C 6.55 9.213 10.176 12.839 14.65 12.839 C 15.732 12.839 16.762 12.628 17.703 12.245 C 18.046 12.105 18.441 12.19 18.696 12.459 C 18.951 12.729 19.015 13.127 18.856 13.463 C 17.272 16.816 13.858 19.139 9.9 19.139 C 4.432 19.139 0 14.706 0 9.239 C 0 5.09 2.552 1.539 6.168 0.066 C 6.512 -0.073 6.906 0.012 7.161 0.281 Z" fill-rule="evenodd"></path></g></svg>';
    var sun='<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="display:block"><g transform="translate(1.1 1.1)"><path d="M 10 20.9 C 10 21.397 10.403 21.8 10.9 21.8 C 11.397 21.8 11.8 21.397 11.8 20.9 L 11.8 18.9 C 11.8 18.403 11.397 18 10.9 18 C 10.403 18 10 18.403 10 18.9 Z"></path><path d="M 10 2.9 C 10 3.397 10.403 3.8 10.9 3.8 C 11.397 3.8 11.8 3.397 11.8 2.9 L 11.8 0.9 C 11.8 0.403 11.397 0 10.9 0 C 10.403 0 10 0.403 10 0.9 Z"></path><path d="M 5.5 10.897 C 5.5 7.915 7.918 5.497 10.9 5.497 C 13.882 5.497 16.3 7.915 16.3 10.897 C 16.3 13.88 13.882 16.297 10.9 16.297 C 7.918 16.297 5.5 13.88 5.5 10.897 Z M 10.9 7.297 C 8.912 7.297 7.3 8.909 7.3 10.897 C 7.3 12.885 8.912 14.497 10.9 14.497 C 12.888 14.497 14.5 12.885 14.5 10.897 C 14.5 8.909 12.888 7.297 10.9 7.297 Z" fill-rule="evenodd"></path><path d="M 0 10.9 C 0 10.403 0.403 10 0.9 10 L 2.9 10 C 3.397 10 3.8 10.403 3.8 10.9 C 3.8 11.397 3.397 11.8 2.9 11.8 L 0.9 11.8 C 0.403 11.8 0 11.397 0 10.9 Z"></path><path d="M 18 10.9 C 18 10.403 18.403 10 18.9 10 L 20.9 10 C 21.397 10 21.8 10.403 21.8 10.9 C 21.8 11.397 21.397 11.8 20.9 11.8 L 18.9 11.8 C 18.403 11.8 18 11.397 18 10.9 Z"></path></g></svg>';
    var search='<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" style="display:block;flex:none"><g transform="translate(2.35 2.35)"><path d="M 7.9 0 C 3.537 0 0 3.537 0 7.9 C 0 12.263 3.537 15.8 7.9 15.8 C 9.757 15.8 11.465 15.159 12.814 14.086 L 17.764 19.036 C 18.115 19.388 18.685 19.388 19.036 19.036 C 19.388 18.685 19.388 18.115 19.036 17.764 L 14.086 12.813 C 15.159 11.465 15.8 9.757 15.8 7.9 C 15.8 3.537 12.263 0 7.9 0 Z M 1.8 7.9 C 1.8 4.531 4.531 1.8 7.9 1.8 C 11.269 1.8 14 4.531 14 7.9 C 14 11.269 11.269 14 7.9 14 C 4.531 14 1.8 11.269 1.8 7.9 Z" fill-rule="evenodd"></path></g></svg>';
    var searching=!!S.query.trim();
    var stripLabel, stripMeta;
    if(S.view==='saved'){ stripLabel='저장한 글'; stripMeta=savedCount+'건 저장됨'; }
    else if(S.view==='ideas'){ stripLabel='글감 보관함'; stripMeta=ideaCount+'개 담김'; }
    else if(S.view==='archive'){ stripLabel='지난 브리핑'; stripMeta='날짜별 아카이브'; }
    else if(searching){ stripLabel='검색 결과'; stripMeta='"'+e(S.query.trim())+'" · '+activeList().length+'건'; }
    else if(DATA.weekly){ stripLabel='주간 요약'; stripMeta=DATA.date+' · 총 '+DATA.count+'건'; }
    else { stripLabel='오늘의 브리핑'; stripMeta=DATA.dateLabel+' · 총 '+DATA.count+'건'; }
    var showSort = (S.view==='home' && !searching) || searching;

    var h='';
    h+='<div style="position:sticky;top:0;z-index:30;background:var(--color-background-normal);border-bottom:1px solid var(--color-line-normal);"><div class="vm-bar" style="max-width:1180px;margin:0 auto;padding:9px 40px;display:flex;align-items:center;gap:16px;">'
    +'<button data-nav="home" style="flex:none;border:0;background:transparent;cursor:pointer;font-family:var(--font-display);font-size:18px;font-weight:800;letter-spacing:-.02em;color:var(--color-label-strong);">VetMan 브리핑</button>'
    +'<div class="vm-search" style="flex:1;max-width:420px;display:flex;align-items:center;gap:8px;background:var(--color-material-thin);border-radius:9px;padding:9px 12px;color:var(--color-label-alternative);">'+search+'<input id="vm-q" value="'+e(S.query)+'" placeholder="기사 검색 — 제목·본문·출처" style="border:0;outline:0;background:transparent;font-family:inherit;font-size:13px;color:var(--color-label-normal);width:100%;"></div>'
    +'<div style="flex:none;display:flex;align-items:center;gap:14px;"><span class="vm-bar-label">'+navBtn('ideas','글감함',ideaCount)+'</span><span class="vm-bar-label">'+navBtn('saved','저장',savedCount)+'</span><span class="vm-bar-label">'+navBtn('archive','지난 브리핑')+'</span>'
    +'<button data-act="theme" title="테마 전환" style="flex:none;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:1px solid var(--color-line-normal);background:var(--color-background-normal);color:var(--color-label-neutral);cursor:pointer;border-radius:9px;">'+(S.theme==='dark'?sun:moon)+'</button></div>'
    +'</div></div>';

    h+='<div class="vm-wrap" style="max-width:1180px;margin:0 auto;padding:0 40px 64px;">';
    h+='<div class="vm-dateline" style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;font-size:12px;color:var(--color-label-alternative);"><span style="flex:1;text-align:left;">'+e(DATA.dateline)+'</span><span style="flex:1;text-align:center;letter-spacing:.06em;">해외 수의 뉴스 데일리 브리핑</span><span style="flex:1;text-align:right;">원문 출처 표기 · 번역 참고용</span></div>';
    h+='<div style="height:1px;background:var(--color-line-normal);"></div>';
    h+='<header class="vm-mast" style="text-align:center;padding:26px 0 20px;"><div style="font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:var(--color-primary-normal);font-weight:700;">'+(DATA.weekly?'Weekly Digest · '+e(DATA.date):'Daily Edition · No. '+e(DATA.editionNo))+'</div><h1 style="font-family:var(--font-display);font-size:58px;font-weight:800;letter-spacing:-.032em;line-height:1.02;margin:12px 0 0;color:var(--color-label-strong);">VetMan 해외 브리핑</h1><p style="max-width:560px;margin:16px auto 0;font-size:14px;line-height:1.6;color:var(--color-label-alternative);">해외 수의 전문 미디어의 오늘 소식을 선별·번역해 한국 동물병원 원장에게 전하는 데일리 브리핑. 각 글에는 병원 블로그 글감 제안이 함께 붙습니다.</p></header>';
    h+='<div style="border-top:2px solid var(--color-label-strong);border-bottom:1px solid var(--color-line-normal);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:11px 0;"><div style="display:flex;align-items:baseline;gap:10px;min-width:0;"><span style="font-family:var(--font-display);font-size:17px;font-weight:800;letter-spacing:-.01em;color:var(--color-label-strong);white-space:nowrap;">'+stripLabel+'</span><span style="font-size:12.5px;color:var(--color-label-alternative);">'+stripMeta+'</span></div>'
    + (showSort ? '<div style="display:inline-flex;padding:3px;background:var(--color-material-base);border-radius:8px;gap:2px;flex:none;"><button data-act="rel" style="border:0;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;padding:5px 11px;border-radius:6px;background:'+segBg(S.sort==='rel')+';color:'+segFg(S.sort==='rel')+';">관련성순</button><button data-act="latest" style="border:0;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;padding:5px 11px;border-radius:6px;background:'+segBg(S.sort==='latest')+';color:'+segFg(S.sort==='latest')+';">최신순</button></div>' : '')
    +'</div>';

    if(S.view==='saved'){ h+=listView(Object.keys(S.saved).map(function(k){return S.saved[k];}),'저장한 글이 없습니다','기사의 북마크 아이콘을 눌러 저장해 보세요.'); }
    else if(S.view==='ideas'){ h+=ideasView(); }
    else if(S.view==='archive'){ h+=archiveView(); }
    else if(searching){ h+=listView(activeList(),'검색 결과가 없습니다','다른 검색어를 입력해 보세요.'); }
    else { h+=catRow(); h+=homeView(); }

    h+='<footer style="margin-top:40px;border-top:2px solid var(--color-label-strong);padding-top:24px;display:flex;align-items:flex-start;justify-content:space-between;gap:24px;flex-wrap:wrap;">'
    +'<p style="margin:0;max-width:520px;font-size:11.5px;line-height:1.6;color:var(--color-label-alternative);">본 콘텐츠는 해외 공개 자료의 요약·번역이며, 임상 정보는 참고용입니다. 실제 적용 전 반드시 원문과 최신 문헌을 확인하세요. 모든 항목에 원문 출처가 표기됩니다.<br>단축키 — ←/→ 이전·다음 기사, S 저장, D 글감 담기, / 검색, Esc 닫기.</p>'
    +'<form id="vm-sub" style="flex:none;max-width:340px;"><div style="font-family:var(--font-display);font-size:14px;font-weight:800;color:var(--color-label-strong);margin-bottom:8px;">뉴스레터로 매일 아침 받기</div><div style="display:flex;gap:8px;"><input id="vm-email" type="email" required placeholder="이메일 주소" style="flex:1;min-width:0;border:1px solid var(--color-line-normal);background:var(--color-background-normal);color:var(--color-label-normal);border-radius:9px;padding:10px 12px;font-family:inherit;font-size:13px;outline:0;"><button type="submit" style="flex:none;border:0;background:var(--color-primary-normal);color:#fff;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;padding:10px 16px;border-radius:9px;white-space:nowrap;">구독</button></div></form>'
    +'</footer>';
    h+='</div>';
    h+=detail();
    h+=draftModal();
    if(S.toast){ h+='<div style="position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:60;background:var(--color-label-strong);color:var(--color-background-normal);padding:12px 20px;border-radius:10px;font-size:13px;font-weight:600;box-shadow:var(--elevation-4);animation:vmFade .18s ease-out;">'+e(S.toast)+'</div>'; }

    var root=document.getElementById('vm');
    root.setAttribute('data-theme',S.theme);
    document.documentElement.setAttribute('data-theme',S.theme);
    root.innerHTML=h;
    if(S.searchFocus){ var q=document.getElementById('vm-q'); if(q){ q.focus(); try{ q.setSelectionRange(S.caret,S.caret); }catch(e){} } }
    document.documentElement.style.overflow = S.openId ? 'hidden' : '';
  }

  var toastTimer;
  function toast(msg){ S.toast=msg; render(); clearTimeout(toastTimer); toastTimer=setTimeout(function(){ S.toast=null; render(); },1600); }

  // ── 기능 A: 블로그 초안 생성기 ──
  function draftModal(){
    if(!S.draft) return '';
    var d=S.draft, inner;
    if(d.loading){ inner='<div style="padding:56px 20px;text-align:center;color:var(--color-label-alternative);"><div style="font-family:var(--font-display);font-size:17px;font-weight:700;color:var(--color-label-neutral);">블로그 초안을 작성하고 있어요…</div><p style="margin:8px 0 0;font-size:13px;">담아둔 글감 '+d.n+'개로 초안을 만드는 중입니다. 10~20초 걸립니다.</p></div>'; }
    else if(d.error){ inner='<div style="padding:48px 20px;text-align:center;color:var(--color-status-negative,#ff4242);"><div style="font-weight:700;">초안 생성에 실패했어요</div><p style="margin:8px 0 0;font-size:13px;color:var(--color-label-alternative);">'+e(d.error)+'</p></div>'; }
    else if(d.result){
      var r=d.result;
      var titles=(r.titles||[]).map(function(t,i){return '<button data-act="copytitle" data-t="'+encodeURIComponent(t)+'" style="display:block;width:100%;text-align:left;border:1px solid var(--color-line-normal);background:var(--color-background-normal);border-radius:9px;padding:11px 14px;margin-bottom:8px;cursor:pointer;font-family:inherit;font-size:15px;font-weight:700;color:var(--color-label-strong);">'+(i+1)+'. '+e(t)+'</button>';}).join('');
      var tags=(r.hashtags||[]).map(function(t){return '<span style="display:inline-block;font-size:12.5px;color:var(--color-primary-normal);background:rgba(0,102,255,.08);border-radius:99px;padding:3px 10px;margin:0 6px 6px 0;">'+e(t)+'</span>';}).join('');
      inner='<div style="padding:22px 24px 26px;">'
        +'<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--color-primary-normal);margin-bottom:8px;">제목 후보 (클릭하면 복사)</div>'+titles
        +'<div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--color-primary-normal);margin:18px 0 8px;">본문</div>'
        +'<div style="white-space:pre-wrap;font-size:15px;line-height:1.85;color:var(--color-label-neutral);background:var(--color-background-alternative);border-radius:10px;padding:16px 18px;">'+e(r.body||'')+'</div>'
        +'<div style="margin:16px 0 8px;">'+tags+'</div>'
        +'<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap;"><button data-act="copydraft" style="display:inline-flex;align-items:center;gap:6px;background:var(--color-primary-normal);color:#fff;border:0;cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:700;padding:11px 18px;border-radius:10px;">'+COPY+' 제목+본문+태그 전체 복사</button><button data-act="draftclose" style="border:1px solid var(--color-line-normal);background:var(--color-background-normal);color:var(--color-label-neutral);cursor:pointer;font-family:inherit;font-size:13.5px;font-weight:700;padding:11px 16px;border-radius:10px;">닫기</button></div>'
        +'<p style="margin:14px 0 0;font-size:11px;color:var(--color-label-alternative);line-height:1.5;">AI가 생성한 초안입니다. 발행 전 사실관계·의료광고 규정을 확인하고 병원 톤에 맞게 다듬어 사용하세요.</p>'
        +'</div>';
    }
    return '<div data-act="draftclose" style="position:fixed;inset:0;background:var(--color-material-dimmer);z-index:70;animation:vmFade .18s ease-out;"></div>'
      +'<div data-theme="'+S.theme+'" style="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);width:640px;max-width:calc(100vw - 32px);max-height:calc(100vh - 48px);overflow:auto;background:var(--color-background-normal);color:var(--color-label-normal);border-radius:16px;z-index:71;box-shadow:var(--elevation-5);animation:vmFade .2s ease-out;font-family:var(--font-sans);">'
      +'<div style="position:sticky;top:0;background:var(--color-background-normal);display:flex;align-items:center;justify-content:space-between;padding:16px 22px;border-bottom:1px solid var(--color-line-normal);"><div style="font-family:var(--font-display);font-size:16px;font-weight:800;color:var(--color-label-strong);">✍️ 블로그 초안</div><button data-act="draftclose" style="width:32px;height:32px;border:0;background:var(--color-material-base);border-radius:8px;cursor:pointer;color:var(--color-label-neutral);display:inline-flex;align-items:center;justify-content:center;"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg></button></div>'
      +inner+'</div>';
  }
  function makeDraft(ideas){
    if(!ideas.length){ toast('먼저 글감을 담아주세요'); return; }
    S.draft={loading:true,n:ideas.length}; render();
    fetch('api/draft',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ideas:ideas})})
      .then(function(r){return r.json();})
      .then(function(res){ if(res.error){ S.draft={error:res.error}; } else { S.draft={result:res}; } render(); })
      .catch(function(err){ S.draft={error:'네트워크 오류 ('+err.message+')'}; render(); });
  }
  function draftFullText(r){ return (r.titles&&r.titles[0]?r.titles[0]+'\n\n':'')+(r.body||'')+'\n\n'+((r.hashtags||[]).join(' ')); }

  // ── 기능 C: 공유 ──
  function shareArticle(a){
    var url=location.origin+location.pathname+'#'+a.id;
    if(navigator.share){ navigator.share({title:a.title,text:a.dek,url:url}).catch(function(){}); }
    else { copy(url,'링크를 복사했습니다'); }
  }
  var SHARE='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"></path></svg>';

  // ── 기능 B: 구독 ──
  function subscribe(email){
    fetch('api/subscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email})})
      .then(function(r){return r.json();})
      .then(function(res){ toast(res.ok?'구독 신청 완료! 매일 아침 받아보세요':(res.error||'실패')); })
      .catch(function(){ toast('네트워크 오류'); });
  }
  function markRead(id){ if(!S.read[id]){ S.read[id]=1; persist('read',S.read); } }
  function openArticle(id){
    if(byId[id]){ S.openId=id; S.blogOpen=true; S.searchFocus=false; markRead(id); var db; render(); db=document.getElementById('vm-db'); if(db) db.scrollTop=0; }
    else { var d=id.split('_')[0]; location.href = (location.pathname.indexOf('/issues/')>=0?'':'issues/')+d+'.html#'+id; }
  }
  function toggleIdea(id){
    var a=byId[id]; if(!a && S.ideas[id]){ delete S.ideas[id]; persist('ideas',S.ideas); toast('글감함에서 뺐습니다'); render(); return; }
    if(!a) return;
    if(S.ideas[id]){ delete S.ideas[id]; toast('글감함에서 뺐습니다'); } else { S.ideas[id]=snap(a); toast('글감함에 담았습니다'); }
    persist('ideas',S.ideas); render();
  }
  function blogText(a){ return a.blog + (a.blogAngle&&a.blogAngle.length?'\n\n[이렇게 풀어보세요]\n'+a.blogAngle.map(function(x){return '· '+x;}).join('\n'):'') + '\n\n(출처: '+a.source+(a.country?' · '+a.country:'')+')'; }
  function copy(t,msg){ if(navigator.clipboard) navigator.clipboard.writeText(t); toast(msg); }

  function loadArchive(){
    fetch('archive.json').then(function(r){return r.json();}).then(function(list){ S.archive=list; render(); }).catch(function(){ S.archive=[]; render(); });
  }
  function loadDate(date){
    if(date===DATA.date){ S.view='home'; render(); return; }
    S.loadingDate=date; render();
    fetch('data/'+date+'.json').then(function(r){return r.json();}).then(function(d){ DATA=d; indexDay(); S.view='home'; S.openId=null; S.query=''; S.cat='all'; S.showAll=false; S.loadingDate=null; try{history.replaceState(null,'','issues/'+date+'.html');}catch(e){} render(); }).catch(function(){ S.loadingDate=null; toast('불러오지 못했습니다'); render(); });
  }

  document.addEventListener('click',function(ev){
    var el=ev.target.closest('[data-save],[data-idea],[data-open],[data-act],[data-nav],[data-cat],[data-date],[data-href]');
    if(!el) return;
    if(el.hasAttribute('data-href')){ ev.stopPropagation(); location.href=el.getAttribute('data-href'); return; }
    if(el.hasAttribute('data-save')){ ev.stopPropagation(); var id=el.getAttribute('data-save'); var a=byId[id]; if(S.saved[id]){ delete S.saved[id]; } else { S.saved[id]= a?snap(a):(S.saved[id]||{id:id}); } persist('saved',S.saved); render(); return; }
    if(el.hasAttribute('data-idea')){ ev.stopPropagation(); toggleIdea(el.getAttribute('data-idea')); return; }
    if(el.hasAttribute('data-nav')){ ev.stopPropagation(); var v=el.getAttribute('data-nav'); S.view=v; S.openId=null; if(v!=='home'&&v!=='archive') S.query=''; if(v==='home') S.query=''; if(v==='archive'&&S.archive===null) loadArchive(); S.searchFocus=false; render(); return; }
    if(el.hasAttribute('data-cat')){ ev.stopPropagation(); S.cat=el.getAttribute('data-cat'); S.showAll=false; S.searchFocus=false; render(); return; }
    if(el.hasAttribute('data-date')){ ev.stopPropagation(); loadDate(el.getAttribute('data-date')); return; }
    var act=el.getAttribute('data-act');
    if(act){
      ev.stopPropagation();
      if(act==='theme'){ S.theme=S.theme==='dark'?'light':'dark'; persist('theme',S.theme); }
      else if(act==='rel'){ S.sort='rel'; }
      else if(act==='latest'){ S.sort='latest'; }
      else if(act==='unread'){ S.unreadOnly=!S.unreadOnly; S.showAll=false; }
      else if(act==='more'){ S.showAll=true; }
      else if(act==='close'){ S.openId=null; }
      else if(act==='blog'){ S.blogOpen=!S.blogOpen; }
      else if(act==='prev'||act==='next'){ var ctx=contextList(),ids=ctx.map(function(x){return x.id;}),i=ids.indexOf(S.openId); var t=act==='next'?ctx[i+1]:ctx[i-1]; if(t){ openArticle(t.id); return; } }
      else if(act==='fs+'){ S.fs=Math.min(1.5,Math.round((S.fs+0.1)*10)/10); persist('fs',S.fs); }
      else if(act==='fs-'){ S.fs=Math.max(0.85,Math.round((S.fs-0.1)*10)/10); persist('fs',S.fs); }
      else if(act==='copylink'){ copy(location.origin+location.pathname+'#'+el.getAttribute('data-id'),'링크를 복사했습니다'); return; }
      else if(act==='copyblog'){ copy(blogText(byId[el.getAttribute('data-id')]),'글감을 복사했습니다'); return; }
      else if(act==='copyone'){ var a=S.ideas[el.getAttribute('data-id')]; if(a) copy(blogText(a),'글감을 복사했습니다'); return; }
      else if(act==='copyall'){ var items=Object.keys(S.ideas).map(function(k){return S.ideas[k];}); var t='# VetMan 해외 브리핑 — 블로그 글감 모음\n\n'+items.map(function(a,i){return (i+1)+'. '+blogText(a);}).join('\n\n———\n\n'); copy(t,items.length+'개 글감을 초안으로 복사했습니다'); return; }
      else if(act==='makedraft'){ makeDraft(Object.keys(S.ideas).map(function(k){return S.ideas[k];})); return; }
      else if(act==='makedraftone'){ var a=byId[el.getAttribute('data-id')]; if(a) makeDraft([snap(a)]); return; }
      else if(act==='draftclose'){ S.draft=null; render(); return; }
      else if(act==='copytitle'){ copy(decodeURIComponent(el.getAttribute('data-t')),'제목을 복사했습니다'); return; }
      else if(act==='copydraft'){ if(S.draft&&S.draft.result) copy(draftFullText(S.draft.result),'초안을 복사했습니다'); return; }
      else if(act==='share'){ var a=byId[el.getAttribute('data-id')]; if(a) shareArticle(a); return; }
      S.searchFocus=false; render(); return;
    }
    if(el.hasAttribute('data-open')){ openArticle(el.getAttribute('data-open')); }
  });
  document.addEventListener('input',function(ev){ if(ev.target.id==='vm-q'){ S.query=ev.target.value; S.searchFocus=true; S.caret=ev.target.selectionStart; if(S.query.trim()){ S.view='home'; } render(); } });
  document.addEventListener('submit',function(ev){ if(ev.target.id==='vm-sub'){ ev.preventDefault(); var em=document.getElementById('vm-email'); if(em&&em.value) subscribe(em.value.trim()); } });
  document.addEventListener('keydown',function(ev){
    var t=ev.target, typing = t&&(t.tagName==='INPUT'||t.tagName==='TEXTAREA');
    if(ev.key==='Escape'){ if(S.draft){ S.draft=null; render(); } else if(S.openId){ S.openId=null; render(); } return; }
    if(typing) return;
    if(S.openId && (ev.key==='ArrowRight'||ev.key==='j')){ ev.preventDefault(); var ctx=contextList(),ids=ctx.map(function(x){return x.id;}),i=ids.indexOf(S.openId); if(ctx[i+1]) openArticle(ctx[i+1].id); }
    else if(S.openId && (ev.key==='ArrowLeft'||ev.key==='k')){ ev.preventDefault(); var ctx=contextList(),ids=ctx.map(function(x){return x.id;}),i=ids.indexOf(S.openId); if(ctx[i-1]) openArticle(ctx[i-1].id); }
    else if((ev.key==='s'||ev.key==='S') && S.openId){ var id=S.openId,a=byId[id]; if(S.saved[id]) delete S.saved[id]; else S.saved[id]=snap(a); persist('saved',S.saved); render(); }
    else if((ev.key==='d'||ev.key==='D') && S.openId){ toggleIdea(S.openId); }
    else if(ev.key==='/'){ ev.preventDefault(); S.view='home'; S.searchFocus=true; render(); }
  });
  if(location.hash && byId[location.hash.slice(1)]){ S.openId=location.hash.slice(1); markRead(S.openId); }
  render();
})();`;

function renderPage(issue, allIssues, { isIndex = false, weekly = false } = {}) {
  const data = buildIssueData(issue);
  const canonicalPath = isIndex ? "/" : weekly ? `/weekly/${labelOf(issue)}.html` : `/issues/${labelOf(issue)}.html`;
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${seoHead(issue, data, canonicalPath)}
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/wanteddev/wanted-sans@v1.0.4/packages/wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0066ff">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon.svg">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="VetMan 브리핑">
<style>${TOKENS_CSS}${STATIC_CSS}</style>
<script>try{var t=JSON.parse(localStorage.getItem('vm_theme'))||((window.matchMedia&&matchMedia('(prefers-color-scheme:dark)').matches)?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}</script>
</head>
<body>
<div class="vm-page" id="vm" data-theme="light" style="min-height:100vh;background:var(--color-background-normal);color:var(--color-label-normal);font-family:var(--font-sans);"></div>
${noscriptFallback(data)}
<script id="vm-issue" type="application/json">${json}</script>
<script>${APP_JS}</script>
<script>if('serviceWorker' in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});}</script>
</body>
</html>`;
}

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0066ff"/><text x="256" y="366" font-family="'Wanted Sans Variable',system-ui,sans-serif" font-size="300" font-weight="800" fill="#fff" text-anchor="middle">V</text></svg>`;

const MANIFEST = JSON.stringify({
  name: "VetMan 해외 브리핑",
  short_name: "VetMan 브리핑",
  description: SITE.description,
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#0066ff",
  lang: "ko",
  icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any maskable" }],
});

const SW_JS = `const C='vmcache-v2';
const SHELL=['/','/latest.json','/archive.json','/icon.svg','/manifest.webmanifest'];
self.addEventListener('install',function(e){e.waitUntil(caches.open(C).then(function(c){return c.addAll(SHELL);}).then(function(){return self.skipWaiting();}));});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.map(function(k){if(k!==C)return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});
self.addEventListener('fetch',function(e){
  var r=e.request; if(r.method!=='GET')return;
  var u=new URL(r.url); if(u.origin!==location.origin)return;
  e.respondWith(fetch(r).then(function(res){var cp=res.clone();caches.open(C).then(function(c){c.put(r,cp);});return res;}).catch(function(){return caches.match(r).then(function(m){return m||caches.match('/');});}));
});`;

// ── 주간 다이제스트: ISO 주차별 상위 기사 모음 ──
function isoWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThu = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((d - firstThu) / 86400000 - 3 + ((firstThu.getUTCDay() + 6) % 7)) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function buildWeeklies(issues) {
  // 주차 → 그 주의 모든 아이템(원본 item + 날짜)
  const weeks = {};
  for (const issue of issues) {
    const wk = isoWeek(labelOf(issue));
    (weeks[wk] = weeks[wk] || []).push(...issue.items.map((it) => ({ ...it, _day: labelOf(issue) })));
  }
  return Object.entries(weeks)
    .map(([wk, items]) => {
      const top = items
        .filter((it) => it.category !== "research")
        .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0))
        .slice(0, 12);
      return { week: wk, count: top.length, items: top };
    })
    .filter((w) => w.count >= 3)
    .sort((a, b) => (a.week < b.week ? 1 : -1));
}

function renderWeekly(weekly, allWeeklies) {
  // 주간 이슈를 일반 이슈처럼 렌더 (date 대신 week 라벨)
  const issue = { date: weekly.week, status: "published", generatedAt: new Date().toISOString(), items: weekly.items, weekly: true };
  return renderPage(issue, [], { isIndex: false, weekly: true });
}

// 검수 대시보드 (비공개, 링크 없음). 간단 게이트 + 품질 스캔 + 제외→JSON 복사.
const ADMIN_HTML = String.raw`<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>검수 · VetMan</title>
<style>
:root{--bg:#f4f5f7;--card:#fff;--ink:#1b1c1e;--mut:#6b7280;--line:#e2e4e8;--blue:#0066ff;--red:#e52222;--amb:#d47800;--grn:#009632}
*{box-sizing:border-box}body{margin:0;font-family:"Pretendard Variable","Apple SD Gothic Neo",system-ui,sans-serif;background:var(--bg);color:var(--ink)}
.wrap{max-width:960px;margin:0 auto;padding:24px 18px 80px}
h1{font-size:22px;margin:0 0 4px}.sub{color:var(--mut);font-size:13px;margin-bottom:18px}
.bar{position:sticky;top:0;background:var(--bg);padding:12px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap;border-bottom:1px solid var(--line);z-index:5}
select,button,input{font-family:inherit;font-size:14px}
select{padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--card)}
button{border:0;border-radius:8px;padding:9px 15px;font-weight:700;cursor:pointer}
.primary{background:var(--blue);color:#fff}.ghost{background:var(--card);border:1px solid var(--line);color:var(--ink)}
.stat{margin-left:auto;font-size:13px;color:var(--mut);font-variant-numeric:tabular-nums}
.item{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:14px 0}
.item.ex{opacity:.5;border-style:dashed}
.itop{display:flex;gap:12px;align-items:flex-start}
.itop input{width:18px;height:18px;margin-top:4px;flex:none}
.cat{font-size:11px;font-weight:700;color:var(--blue);text-transform:uppercase;letter-spacing:.04em}
.ttl{font-size:17px;font-weight:800;margin:3px 0 4px;line-height:1.35}
.src{font-size:12px;color:var(--mut)}
.flags{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 0}
.flag{font-size:11px;font-weight:700;border-radius:6px;padding:2px 8px}
.f-red{background:#feecec;color:var(--red)}.f-amb{background:#fef4e6;color:var(--amb)}.f-grn{background:#d9ffe6;color:var(--grn)}
.body{margin-top:10px;font-size:14px;line-height:1.75;color:#333;white-space:pre-wrap;display:none}
.item.open .body{display:block}
.toggle{font-size:12px;color:var(--blue);cursor:pointer;font-weight:700;margin-top:8px;display:inline-block}
.angle{margin-top:10px;padding:10px 12px;background:#f0f5ff;border-radius:8px;font-size:13px}
.gate{max-width:340px;margin:80px auto;text-align:center}
.gate input{width:100%;padding:12px;border:1px solid var(--line);border-radius:9px;margin:12px 0}
</style></head><body><div class="wrap" id="app"></div>
<script>
var PASS='vetman2026';
var app=document.getElementById('app');
var ISSUE=null, EX={};
function e(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
function foreign(it){var m=JSON.stringify([it.titleKo,it.leadKo,it.bodyKo,it.keyPointsKo,it.angleKo]).match(/[一-鿿぀-ヿЀ-ӿ]+/g);return m?m.join(','):null;}
function flags(it){
  var out=[];
  if(it.needsReview) out.push(['f-red','검수필요']);
  var fr=foreign(it); if(fr) out.push(['f-red','외국어:'+fr.slice(0,16)]);
  var blen=(it.bodyKo||[]).join('').length;
  if(blen<250) out.push(['f-amb','본문짧음 '+blen+'자']);
  if(!it.imageUrl && it.sourceType!=='paper') out.push(['f-amb','이미지없음']);
  if(!it.sourceUrl||it.sourceUrl==='#') out.push(['f-red','출처링크없음']);
  if(!out.length) out.push(['f-grn','이상없음']);
  return out;
}
function gate(){
  app.innerHTML='<div class="gate"><h1>검수 대시보드</h1><p style="color:#6b7280;font-size:13px">암호를 입력하세요.</p><input id="pw" type="password" placeholder="암호"><button class="primary" style="width:100%" onclick="tryPw()">확인</button><p style="color:#9aa;font-size:11px;margin-top:16px">※ 이 페이지는 검색엔진에 노출되지 않지만 URL을 아는 사람은 접근할 수 있습니다. 강력한 보호가 필요하면 Cloudflare Access를 설정하세요.</p></div>';
}
window.tryPw=function(){var v=document.getElementById('pw').value;if(v===PASS){localStorage.setItem('vm_admin',v);boot();}else alert('암호가 틀렸습니다');};
function load(date){
  fetch('raw/'+date+'.json').then(function(r){return r.json();}).then(function(d){ISSUE=d;EX={};render();});
}
function render(){
  if(!ISSUE){app.innerHTML='<p>불러오는 중…</p>';return;}
  var items=ISSUE.items||[];
  var exCount=Object.keys(EX).filter(function(k){return EX[k];}).length;
  var h='<h1>검수 · '+e(ISSUE.date)+'</h1><div class="sub">발행 상태: '+e(ISSUE.status||'')+' · 총 '+items.length+'건</div>';
  h+='<div class="bar"><select id="dsel" onchange="load(this.value)"></select><button class="primary" onclick="copyClean()">제외 반영 JSON 복사</button><button class="ghost" onclick="copyAll()">전체 JSON</button><span class="stat">'+items.length+'건 중 <b>'+exCount+'건 제외</b> → 발행 '+(items.length-exCount)+'건</span></div>';
  h+=items.map(function(it,i){
    var fl=flags(it).map(function(f){return '<span class="flag '+f[0]+'">'+e(f[1])+'</span>';}).join('');
    var ex=EX[i]?' ex':'';
    return '<div class="item'+ex+'" id="it'+i+'"><div class="itop"><input type="checkbox" '+(EX[i]?'checked':'')+' onchange="toggleEx('+i+')" title="제외"><div style="flex:1;min-width:0"><div class="cat">'+e(it.category||'')+' · '+e(it.sourceLabel||'')+'</div><div class="ttl">'+(i+1)+'. '+e(it.titleKo)+'</div><div class="src">'+e(it.leadKo||'')+'</div><div class="flags">'+fl+'</div><span class="toggle" onclick="tg('+i+')">본문 펼치기 ▾</span><div class="body">'+(it.bodyKo||[]).map(e).join('\n\n')+'</div>'+(it.angleKo?'<div class="angle"><b>글감</b> · '+e(it.angleKo)+'</div>':'')+'<div class="src" style="margin-top:8px">원문: <a href="'+e(it.sourceUrl)+'" target="_blank">'+e(it.sourceTitle||it.sourceUrl)+'</a></div></div></div></div>';
  }).join('');
  app.innerHTML=h;
  // date dropdown
  fetch('archive.json').then(function(r){return r.json();}).then(function(a){var sel=document.getElementById('dsel');if(!sel)return;sel.innerHTML=(a.issues||[]).map(function(x){return '<option value="'+x.date+'"'+(x.date===ISSUE.date?' selected':'')+'>'+x.date+' ('+x.count+'건)</option>';}).join('');});
}
window.toggleEx=function(i){EX[i]=!EX[i];render();};
window.tg=function(i){document.getElementById('it'+i).classList.toggle('open');event.target.textContent=document.getElementById('it'+i).classList.contains('open')?'본문 접기 ▴':'본문 펼치기 ▾';};
window.copyClean=function(){var out=Object.assign({},ISSUE);out.items=ISSUE.items.filter(function(it,i){return !EX[i];});navigator.clipboard.writeText(JSON.stringify(out,null,2));alert('제외 반영 JSON을 복사했습니다.\n\ndata/issues/'+ISSUE.date+'.json 에 붙여넣고 재배포하세요.');};
window.copyAll=function(){navigator.clipboard.writeText(JSON.stringify(ISSUE,null,2));alert('전체 JSON 복사됨');};
function boot(){fetch('archive.json').then(function(r){return r.json();}).then(function(a){var d=(a.issues&&a.issues[0])?a.issues[0].date:null;if(d)load(d);else app.innerHTML='<p>이슈가 없습니다.</p>';});}
if(localStorage.getItem('vm_admin')===PASS) boot(); else gate();
</script></body></html>`;

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
  fs.mkdirSync(path.join(SITE_DIR, "data"), { recursive: true });

  const latest = issues[0];
  fs.writeFileSync(path.join(SITE_DIR, "index.html"), renderPage(latest, issues, { isIndex: true }));

  const archive = [];
  for (const issue of issues) {
    const data = buildIssueData(issue);
    fs.writeFileSync(path.join(SITE_DIR, "issues", `${labelOf(issue)}.html`), renderPage(issue, issues));
    fs.writeFileSync(path.join(SITE_DIR, "data", `${labelOf(issue)}.json`), JSON.stringify(data));
    archive.push({ date: data.date, dateLabel: data.dateLabel, count: data.count, titles: data.articles.slice(0, 3).map((a) => a.title) });
  }

  // 주간 다이제스트
  fs.mkdirSync(path.join(SITE_DIR, "weekly"), { recursive: true });
  const weeklies = buildWeeklies(issues);
  for (const wk of weeklies) {
    const issue = { date: wk.week, status: "published", generatedAt: new Date().toISOString(), items: wk.items, weekly: true };
    fs.writeFileSync(path.join(SITE_DIR, "weekly", `${wk.week}.html`), renderPage(issue, [], { weekly: true }));
  }
  const latestWeekly = weeklies[0] ? `/weekly/${weeklies[0].week}.html` : null;
  fs.writeFileSync(
    path.join(SITE_DIR, "archive.json"),
    JSON.stringify({
      latestWeekly,
      weeklies: weeklies.map((w) => ({ week: w.week, count: w.count, href: `/weekly/${w.week}.html`, titles: w.items.slice(0, 3).map((it) => it.titleKo) })),
      issues: archive,
    })
  );
  fs.writeFileSync(path.join(SITE_DIR, "latest.json"), JSON.stringify(latest, null, 2));
  fs.writeFileSync(path.join(SITE_DIR, "sitemap.xml"), buildSitemap(issues));
  fs.writeFileSync(path.join(SITE_DIR, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE.baseUrl}/sitemap.xml\n`);
  fs.writeFileSync(path.join(SITE_DIR, "rss.xml"), buildRss(issues));
  fs.writeFileSync(path.join(SITE_DIR, "llms.txt"), buildLlmsTxt(issues));

  // PWA
  fs.writeFileSync(path.join(SITE_DIR, "manifest.webmanifest"), MANIFEST);
  fs.writeFileSync(path.join(SITE_DIR, "icon.svg"), ICON_SVG);
  fs.writeFileSync(path.join(SITE_DIR, "sw.js"), SW_JS);

  // 검수 대시보드 + raw 이슈(재발행용 원본)
  fs.mkdirSync(path.join(SITE_DIR, "raw"), { recursive: true });
  for (const issue of issues) fs.writeFileSync(path.join(SITE_DIR, "raw", `${labelOf(issue)}.json`), JSON.stringify(issue));
  fs.writeFileSync(path.join(SITE_DIR, "admin.html"), ADMIN_HTML);

  const mockup = path.join(ROOT, "design", "mockup.html");
  if (fs.existsSync(mockup)) fs.copyFileSync(mockup, path.join(SITE_DIR, "design.html"));
  // 서버리스 엔드포인트는 리포 루트 functions/ 에 두면 배포 시 자동 컴파일됨(사이트에 복사 불필요)

  console.log(`빌드 완료: ${issues.length}개 이슈 → site/ (최신: ${labelOf(latest)})`);
}

build();
