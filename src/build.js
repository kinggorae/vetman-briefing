import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE, LEGAL, SPONSOR, TOPICS } from "../config.js";

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
  watercooler: "진료실 밖 이야기",
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

// 일부 생성물의 리드가 본문·글머리표까지 삼켜 과도하게 길다.
// 카드 높이가 들쭉날쭉해지므로 문장 경계에서 잘라 쓴다(전문은 본문에 그대로 남는다).
function trimDek(s) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  if (t.length <= 220) return t;
  const cut = t.slice(0, 220);
  const idx = Math.max(cut.lastIndexOf("."), cut.lastIndexOf("!"), cut.lastIndexOf("?"));
  return idx > 80 ? cut.slice(0, idx + 1) : cut.trim() + "…";
}

// 저널 정식명이 과도하게 길다("... : the official journal of ...", "... = Revue ...").
// 부제를 떼고 길이를 제한해 지면에 맞춘다.
function shortSource(s) {
  let t = String(s || "").replace(/\s+/g, " ").trim();
  t = t.split(/\s+[:=]\s+/)[0].trim();
  if (t.length > 42) t = t.slice(0, 40).trim() + "…";
  return t;
}

// 구글 뉴스가 주는 generic 로고(lh3.googleusercontent.com 등)는 기사 이미지가 아니다.
function usableImage(url) {
  if (!url) return null;
  try {
    const h = new URL(url).hostname;
    if (/(^|\.)googleusercontent\.com$/.test(h) || /(^|\.)gstatic\.com$/.test(h)) return null;
  } catch {
    return null;
  }
  return url;
}

function toArticle(item, i, issueDate) {
  const body = item.bodyKo?.length ? item.bodyKo : item.summaryKo ? [item.summaryKo] : [];
  // 리드가 빈 생성물이 있어 카드가 휑해진다 — 본문 첫 문단으로 대체
  const dek = trimDek(item.leadKo || item.summaryKo || body[0] || "");
  const chars = (item.titleKo || "").length + dek.length + body.join("").length;
  const readMin = Math.max(1, Math.round(chars / 500));
  const pub = item.publishedAt ? new Date(item.publishedAt) : null;
  // 발행일이 없는 기사도 있어 날짜가 통째로 비던 문제 → 이슈 날짜로 대체
  const shown = pub || new Date(issueDate + "T00:00:00");
  const dateStr = `${String(shown.getMonth() + 1).padStart(2, "0")}.${String(shown.getDate()).padStart(2, "0")}`;
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
    source: shortSource(item.sourceLabel),
    country: SOURCE_COUNTRY[item.sourceLabel] || "",
    date: dateStr,
    read: `${readMin}분 읽기`,
    plate: shortSource(item.sourceLabel) || "출처",
    image: usableImage(item.imageUrl),
    sourceUrl: item.sourceUrl || "#",
    body,
    blog: item.angleKo || "",
    blogAngle: item.keyPointsKo?.length ? item.keyPointsKo : [],
    radar: item.radar || null,
    tag: item.tagKo || "",
  };
}

function buildIssueData(issue) {
  const date = labelOf(issue);
  // 생성 실패로 제목·본문이 빈 항목은 절대 지면에 올리지 않는다(빈 카드 방지)
  const all = issue.items
    .map((it, i) => toArticle(it, i, date))
    .filter((a) => a.title.trim() && a.body.length);
  // 신뢰 뉴스 그리드와 "진료실 밖 이야기"(가십) 분리
  const articles = all.filter((a) => a.cat !== "watercooler");
  const stories = all.filter((a) => a.cat === "watercooler");
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
      stories,
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
    stories,
  };
}

// GA4 gtag 스니펫. 측정 ID가 없으면 아무것도 내보내지 않아 로딩 비용이 0이다.
function gaSnippet() {
  const id = SITE.ga4;
  if (!id) return "";
  return `
<script async src="https://www.googletagmanager.com/gtag/js?id=${esc(id)}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${esc(id)}');</script>`;
}

function seoHead(issue, data, canonicalPath, isIndex = false) {
  const label = labelOf(issue);
  // 브랜드 검색("베트맨랩") 대응 — 한글 브랜드명을 타이틀·설명에 실제 문자열로 넣는다
  const brand = `${SITE.brandKo}(${SITE.brandEn})`;
  // 홈과 최신 일자 페이지는 같은 이슈를 보여준다. 제목까지 같으면 두 페이지가
  // 같은 질의에서 서로 경쟁한다. 홈은 날짜 없는 상설 제목(브랜드 검색용),
  // 일자 페이지는 날짜가 박힌 아카이브 제목으로 역할을 나눈다.
  const title = isIndex
    ? `${SITE.name} — 한국 동물병원을 위한 해외 수의 브리핑 | ${brand}`
    : `${label} 수의계 해외 뉴스 브리핑 | ${SITE.name} · ${brand}`;
  const desc = isIndex
    ? `${brand}이 매일 아침 발행하는 해외 수의 브리핑. ${SITE.description}`.slice(0, 300)
    : `${brand}이 만드는 ${label} 해외 수의 브리핑. ${data.articles[0]?.dek || SITE.description}`.slice(0, 300);
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
        publisher: { "@type": "Organization", name: SITE.brandKo, alternateName: SITE.brandEn, url: SITE.baseUrl },
        isBasedOn: a.sourceUrl,
        inLanguage: "ko",
      },
    })),
  };
  // 발행 주체를 별도 개체로 선언 — 한글·영문 표기를 같은 브랜드로 묶어준다
  const orgLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: SITE.brandKo,
    alternateName: [SITE.brandEn, SITE.name, `${SITE.brandKo} ${SITE.name}`],
    url: SITE.baseUrl,
    logo: `${SITE.baseUrl}/icon.svg`,
    description: SITE.description,
  };
  const siteLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: `${SITE.brandKo} ${SITE.name}`,
    alternateName: [SITE.brandKo, SITE.brandEn, SITE.name],
    url: SITE.baseUrl,
    inLanguage: "ko",
    publisher: { "@type": "Organization", name: SITE.brandKo, alternateName: SITE.brandEn },
  };
  return `
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc.slice(0, 155))}">
<meta name="keywords" content="동물병원, 수의사, 수의학 뉴스, 해외 수의 트렌드, 동물병원 경영, 수의 임상, ${data.articles
    .slice(0, 3)
    .map((a) => esc(a.title.split(",")[0].split("…")[0].trim()))
    .join(", ")}">
<link rel="canonical" href="${esc(canonical)}">${
    SITE.verification?.google
      ? `\n<meta name="google-site-verification" content="${esc(SITE.verification.google)}">`
      : ""
  }${
    SITE.verification?.naver
      ? `\n<meta name="naver-site-verification" content="${esc(SITE.verification.naver)}">`
      : ""
  }
<link rel="alternate" type="application/rss+xml" title="${esc(SITE.name)}" href="${SITE.baseUrl}/rss.xml">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(SITE.name)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc.slice(0, 155))}">
<meta property="og:url" content="${esc(canonical)}">
${ogImage ? `<meta property="og:image" content="${esc(ogImage)}">` : ""}
<meta name="twitter:card" content="${ogImage ? "summary_large_image" : "summary"}">
<meta name="robots" content="index, follow">
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>
<script type="application/ld+json">${JSON.stringify(orgLd)}</script>
<script type="application/ld+json">${JSON.stringify(siteLd)}</script>`;
}

function noscriptFallback(data) {
  // 이 블록이 사이트 전체에서 유일하게 서버가 그려주는 링크다. SPA는 기사 카드를
  // JS로 그리기 때문에, 여기서 링크하지 않으면 기사 페이지 131개가 전부 고아가 된다
  // (사이트맵에만 있고 들어오는 링크가 없는 페이지는 색인이 잘 되지 않는다).
  //
  // 본문 전문을 여기 싣지 않는다 — 기사 페이지와 같은 글이 홈·일자 페이지에도
  // 중복되면 어느 쪽을 원본으로 볼지 검색엔진이 헷갈린다. 리드까지만 싣고
  // 본문은 기사 페이지 한 곳에만 둔다.
  const list = (data.articles || [])
    .map(
      (a) => `<li style="margin-bottom:16px;"><a href="${esc(articlePath(a))}"><b>${esc(a.title)}</b></a>
<div>${esc(a.dek)}</div>
<small>${[a.kicker, a.source, a.country].filter(Boolean).map(esc).join(" · ")}</small></li>`
    )
    .join("");
  return `<noscript><div style="max-width:720px;margin:0 auto;padding:40px 20px;font-family:sans-serif;">
<h1>${esc(SITE.brandKo)} ${esc(SITE.name)} — ${esc(data.date)}</h1>
<p>${esc(SITE.brandKo)}(${esc(SITE.brandEn)})이 만드는, 한국 동물병원을 위한 해외 수의 임상·연구·업계 브리핑입니다.</p>
<ul style="list-style:none;padding:0;">${list}</ul>
<nav><a href="/">오늘의 브리핑</a> · <a href="/topic/">주제별 보기</a> · <a href="/about">서비스 소개</a> · <a href="/privacy">개인정보처리방침</a> · <a href="/terms">이용약관</a> · <a href="/rss.xml">RSS</a></nav>
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
/* 셀이 이미 윗선과 여백을 그리므로 카드 자신의 윗선은 첫 카드에서만 지운다 */
.vm-cell > *:first-child{border-top:0 !important;padding-top:0 !important;}
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
  /* 1단이 되면 좌우 여백·세로선은 의미가 없다. 칸은 위아래로만 이어진다 */
  .vm-fold{grid-template-columns:1fr !important;padding-bottom:20px !important;}
  .vm-fold > *{grid-column:1 !important;grid-row:auto !important;padding-left:0 !important;padding-right:0 !important;border-left:0 !important;border-right:0 !important;}
  #vm-brief,#vm-side{padding-top:20px !important;border-top:1px solid var(--color-line-normal);}
  .vm-fp-body{column-count:1 !important;}
  .vm-quadzone,.vm-featzone{grid-template-columns:1fr !important;}
  .vm-slot{padding:16px 18px !important;}
  .vm-quad{padding-left:0 !important;padding-right:0 !important;border-left:0 !important;border-top:1px solid var(--color-line-normal);}
  .vm-featzone > *{padding-left:0 !important;padding-right:0 !important;border-left:0 !important;}
  #vm-feat-r{padding-top:20px !important;border-top:1px solid var(--color-line-normal);}
  .vm-band{grid-template-columns:1fr !important;}
  .vm-band-fill{display:none !important;}
  .vm-qa-grid{grid-template-columns:1fr !important;}
  .vm-mast h1{font-size:40px !important;}
  .vm-lead-h{font-size:30px !important;}
  .vm-detail{width:100% !important;max-width:100% !important;}
  .vm-search{display:none !important;}
  .vm-dateline{display:none !important;}
  /* 터치 타깃 확대 — 칩 29px·정렬 25px는 손가락으로 정확히 누르기 어렵다.
     시각적 크기는 유지하고 세로 패딩으로 누를 수 있는 면적만 키운다. */
  .vm-chip{min-height:44px !important;padding:0 15px !important;font-size:13px !important;}
  /* 좁은 화면에선 제목·요약이 정렬 버튼에 밀려 3줄로 구겨진다 → 세로로 쌓는다 */
  .vm-strip{flex-direction:column !important;align-items:flex-start !important;gap:10px !important;}
  .vm-strip > div{width:100% !important;flex-wrap:wrap !important;}
  .vm-seg{min-height:44px !important;padding:0 16px !important;}
  .vm-tap{min-width:44px !important;min-height:44px !important;}
  /* 푸터 법적 링크는 서로 붙어 있어 작으면 오탭한다 */
  .vm-foot-nav{gap:4px 20px !important;}
  .vm-foot-nav a{display:inline-flex;align-items:center;min-height:44px;font-size:13px !important;}
  /* 상세뷰 안의 액션(글자 크기·공유·복사·목차)도 같은 기준으로 넓힌다.
     inline 링크는 min-height가 먹지 않으므로 inline-flex인 것만 대상이 된다. */
  .vm-detail button,.vm-detail a[href]{min-height:44px !important;min-width:44px !important;}
  .vm-detail .vm-toc-i{align-items:center !important;}
  /* 상단 툴바에 7개가 다 들어가면 좁은 화면에서 서로 겹친다.
     하단 바(이전·원문·다음)와 겹치거나 부차적인 것만 숨겨 공유·저장·닫기를 남긴다. */
  .vm-dt-hide{display:none !important;}
}`;

const APP_JS = String.raw`
(function(){
  var DATA = JSON.parse(document.getElementById('vm-issue').textContent);
  var CFG = (function(){ try{ return JSON.parse(document.getElementById('vm-cfg').textContent); }catch(e){ return {newsletter:false}; } })();
  var byId = {};
  function indexDay(){ byId={}; DATA.articles.concat(DATA.stories||[],DATA.recent||[]).forEach(function(a){ byId[a.id]=a; }); }
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
  function snap(a){ return {id:a.id,day:a.day,title:a.title,dek:a.dek,kicker:a.kicker,source:a.source,country:a.country,date:a.date,read:a.read,cat:a.cat,image:a.image,plate:a.plate,blog:a.blog,blogAngle:a.blogAngle,isToday:a.isToday,radar:a.radar}; }

  var BM='<svg width="W" height="W" viewBox="0 0 24 24" fill="currentColor" style="display:block"><g transform="translate(4.1 2.1)"><path d="M 4.065 0 L 11.735 0 C 12.265 0 12.716 0 13.087 0.03 C 13.476 0.062 13.855 0.132 14.217 0.316 C 14.762 0.594 15.206 1.038 15.484 1.583 C 15.668 1.945 15.738 2.324 15.77 2.713 C 15.8 3.084 15.8 3.535 15.8 4.065 L 15.8 18.9 C 15.8 19.225 15.625 19.525 15.341 19.684 C 15.058 19.844 14.711 19.838 14.433 19.669 L 7.9 15.703 L 1.367 19.669 C 1.089 19.838 0.742 19.844 0.459 19.684 C 0.175 19.525 0 19.225 0 18.9 L 0 4.065 C 0 3.535 0 3.084 0.03 2.713 C 0.062 2.324 0.132 1.945 0.316 1.583 C 0.594 1.038 1.038 0.594 1.583 0.316 C 1.945 0.132 2.324 0.062 2.713 0.03 C 3.084 0 3.535 0 4.065 0 Z M 3.7 1.8 C 2.885 1.8 2.692 1.811 2.56 1.854 C 2.225 1.963 1.963 2.225 1.854 2.56 C 1.811 2.692 1.8 2.886 1.8 3.7 L 1.8 17.301 L 7.433 13.881 C 7.72 13.707 8.08 13.707 8.367 13.881 L 14 17.301 L 14 3.7 C 14 2.886 13.989 2.692 13.946 2.56 C 13.837 2.225 13.575 1.963 13.24 1.854 C 13.108 1.811 12.915 1.8 12.1 1.8 L 3.7 1.8 Z" fill-rule="evenodd"></path></g></svg>';
  var EXT='<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" style="display:block"><g transform="translate(2.85 2.85)"><path d="M 11.9 0 C 11.403 0 11 0.403 11 0.9 C 11 1.397 11.403 1.8 11.9 1.8 L 15.227 1.8 L 8.514 8.514 C 8.162 8.865 8.162 9.435 8.514 9.786 C 8.865 10.138 9.435 10.138 9.787 9.786 L 16.5 3.073 L 16.5 6.4 C 16.5 6.897 16.903 7.3 17.4 7.3 C 17.897 7.3 18.3 6.897 18.3 6.4 L 18.3 0.9 C 18.3 0.403 17.897 0 17.4 0 L 11.9 0 Z"></path><path d="M 7.25 0.001 C 7.747 0.001 8.15 0.404 8.15 0.901 C 8.15 1.398 7.747 1.801 7.25 1.801 L 5.7 1.801 C 4.845 1.801 4.258 1.801 3.803 1.838 C 3.358 1.875 3.119 1.941 2.947 2.029 C 2.551 2.231 2.23 2.552 2.029 2.947 C 1.941 3.12 1.874 3.359 1.838 3.803 C 1.801 4.259 1.8 4.846 1.8 5.701 L 1.8 12.601 C 1.8 13.456 1.801 14.043 1.838 14.498 C 1.874 14.942 1.941 15.181 2.029 15.354 C 2.23 15.749 2.551 16.07 2.947 16.272 C 3.119 16.36 3.358 16.426 3.803 16.463 C 4.258 16.5 4.845 16.501 5.7 16.501 L 12.6 16.501 C 13.455 16.501 14.042 16.5 14.497 16.463 C 14.942 16.426 15.18 16.36 15.353 16.272 C 15.748 16.07 16.07 15.749 16.271 15.354 C 16.359 15.181 16.426 14.942 16.462 14.498 C 16.499 14.043 16.5 13.456 16.5 12.601 L 16.5 11.051 C 16.5 10.554 16.903 10.151 17.4 10.151 C 17.897 10.151 18.3 10.554 18.3 11.051 L 18.3 12.638 C 18.3 13.446 18.3 14.107 18.256 14.644 C 18.211 15.2 18.114 15.702 17.875 16.171 C 17.501 16.905 16.904 17.502 16.171 17.876 C 15.702 18.114 15.2 18.211 14.644 18.257 C 14.107 18.301 13.446 18.301 12.638 18.301 L 5.662 18.301 C 4.854 18.301 4.193 18.301 3.656 18.257 C 3.1 18.211 2.598 18.114 2.129 17.876 C 1.396 17.502 0.799 16.905 0.425 16.171 C 0.186 15.702 0.089 15.2 0.044 14.644 C 0 14.107 0 13.446 0 12.638 L 0 5.663 C 0 4.855 0 4.194 0.044 3.657 C 0.089 3.101 0.186 2.599 0.425 2.13 C 0.799 1.396 1.396 0.8 2.129 0.426 C 2.598 0.187 3.1 0.09 3.656 0.044 C 4.193 0.001 4.854 0.001 5.662 0.001 L 7.25 0.001 Z"></path></g></svg>';
  var COPY='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block"><rect x="9" y="9" width="11" height="11" rx="2"></rect><path d="M5 15V6a2 2 0 0 1 2-2h9"></path></svg>';
  var IDEA='<svg width="W" height="W" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M9 18h6M10 21h4"></path><path d="M12 2a6 6 0 0 0-4 10.5c.7.7 1 1.4 1 2.5h6c0-1.1.3-1.8 1-2.5A6 6 0 0 0 12 2z"></path></svg>';
  var CHEV='<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" style="display:block;flex:none;"><g transform="translate(3.9 7.9)"><path d="M 0.264 0.264 C 0.615 -0.088 1.185 -0.088 1.536 0.264 L 8.1 6.827 L 14.664 0.264 C 15.015 -0.088 15.585 -0.088 15.936 0.264 C 16.288 0.615 16.288 1.185 15.936 1.536 L 8.736 8.736 C 8.385 9.088 7.815 9.088 7.464 8.736 L 0.264 1.536 C -0.088 1.185 -0.088 0.615 0.264 0.264 Z" fill-rule="evenodd"></path></g></svg>';
  var ARL='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M15 18l-6-6 6-6"></path></svg>';
  var ARR='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M9 6l6 6-6 6"></path></svg>';

  // 검색 중에는 화면에 있는 전부(오늘+최근+진료실 밖)를 대상으로 — 바로 아래 보이는 글이 안 걸리면 이상하다
  function sorted(){
    var base=S.query.trim()?DATA.articles.concat(DATA.recent||[],DATA.stories||[]):DATA.articles;
    var arr=base.slice(); if(S.sort==='latest'){ arr.sort(function(x,y){return y.ts-x.ts;}); } return arr;
  }
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
    if(S.query.trim()) return activeList();                     // 검색 중엔 검색 결과로 연속 읽기
    var cur=byId[S.openId];
    if(cur&&cur.cat==='watercooler') return (DATA.stories||[]); // 진료실 밖 이야기끼리 연속 읽기
    if(cur&&cur.day!==DATA.date) return (DATA.recent||[]);      // 최근 브리핑끼리 연속 읽기
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
    return '<button data-save="'+id+'" class="vm-tap" title="저장" style="'+st+'display:inline-flex;align-items:center;justify-content:center;border-radius:8px;cursor:pointer;color:'+saveColor(id)+';">'+BM.replace(/W/g,w)+'</button>';
  }
  function readCls(id){ return isRead(id)?' vm-read':''; }

  // ── 레이더 → 편집(신문) 지면 렌더. 뱃지·컬러박스·이모지 없이 타이포·괘선으로. ──
  // 논문 근거: 바이라인 아래 조용한 이탤릭 각주 한 줄
  function evLine(a){
    var ev=a.radar&&a.radar.evidence; if(!ev) return '';
    var bits=['근거'].concat([ev.design,ev.n].filter(Boolean)).map(e).join(' · ');
    return '<div style="margin-top:9px;font-size:12px;line-height:1.5;font-style:italic;color:var(--color-label-alternative);">'+bits+(ev.note?' <span style="font-style:normal;"> — '+e(ev.note)+'</span>':'')+'</div>';
  }
  // 상세뷰 편집 노트: 임상 메모(사이드바) + 진료실 문답(Q&A 칼럼)
  function radarBlock(a){
    var r=a.radar; if(!r||(!r.clinical&&!r.owner)) return '';
    var h='';
    // 임상 메모 — 채움색 없는 에디터 노트, 왼쪽 가는 선
    if(r.clinical){
      h+='<div style="margin:26px 0;padding:2px 0 2px 18px;border-left:2px solid var(--color-label-strong);">'
      +'<div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--color-label-alternative);margin-bottom:5px;">임상 메모</div>'
      +'<div style="font-size:calc(15px*var(--fs));line-height:1.7;color:var(--color-label-strong);">'+e(r.clinical)+'</div></div>';
    }
    // 진료실 문답 — 질문은 세리프 소제목, 답변은 본문. 괘선으로 구분
    if(r.owner&&(r.owner.q||r.owner.script)){
      h+='<div style="margin:26px 0;padding-top:18px;border-top:1px solid var(--color-line-normal);">'
      +'<div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--color-label-alternative);margin-bottom:12px;">진료실 문답</div>'
      + (r.owner.q?'<p style="font-family:var(--font-display);font-size:calc(20px*var(--fs));line-height:1.4;font-weight:700;color:var(--color-label-strong);margin:0 0 12px;text-wrap:pretty;">'+e(r.owner.q)+'</p>':'')
      + (r.owner.script?'<p style="font-size:calc(15.5px*var(--fs));line-height:1.85;color:var(--color-label-neutral);margin:0;">'+e(r.owner.script)+'</p>':'')
      + (r.owner.script?'<button data-act="copyscript" data-id="'+a.id+'" style="margin-top:12px;border:0;background:transparent;padding:0;cursor:pointer;font-family:inherit;font-size:12.5px;font-weight:600;color:var(--color-primary-normal);">답변 복사</button>':'')
      +'</div>';
    }
    return h;
  }

  function leadCard(a){
    return '<article class="vm-lead'+readCls(a.id)+'" data-open="'+a.id+'" style="cursor:pointer;">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:10px;"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-primary-normal);">'+e(a.kicker)+'</span>'+tag(a.isToday,18,10.5)+(isRead(a.id)?'<span style="font-size:10.5px;color:var(--color-label-alternative);">읽음</span>':'')+'</div>'+bookmarkBtn(a.id,17,'plain')+'</div>'
    +'<h2 class="vm-hl vm-lead-h" style="font-family:var(--font-display);font-size:40px;line-height:1.12;font-weight:800;letter-spacing:-.03em;margin:0 0 16px;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</h2>'
    +'<p style="font-size:17px;line-height:1.7;color:var(--color-label-neutral);margin:0 0 14px;max-width:56ch;">'+e(a.dek)+'</p>'
    // 리드는 본문을 넉넉히 실어 왼쪽 칼럼이 비지 않게 한다(신문 1면의 톱기사처럼)
    // 리드는 본문을 넉넉히 싣되, 3번째 문단은 행에 자리가 남을 때만 fillSlack()이 편다
    + (a.body||[]).slice(0,3).map(function(p,i){return '<p'+(i===2?' class="vm-fill"':'')+' style="font-size:15px;line-height:1.8;color:var(--color-label-neutral);margin:0 0 14px;max-width:60ch;display:'+(i===2?'none':'-webkit-box')+';-webkit-line-clamp:7;-webkit-box-orient:vertical;overflow:hidden;">'+e(p)+'</p>';}).join('')
    +'<div style="display:flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.02em;color:var(--color-label-alternative);text-transform:uppercase;">'+meta(a)+'</div>'
    +'</article>';
  }
  // 리드 아래로 이어지는 후속 기사(같은 칼럼) — 1면 왼쪽 단이 끊기지 않게
  function leadFollow(a){
    return '<article class="vm-follow'+readCls(a.id)+'" data-open="'+a.id+'" style="padding:18px 0;border-top:1px solid var(--color-line-normal);cursor:pointer;">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px;"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-primary-normal);">'+e(a.kicker)+'</span>'+tag(a.isToday,16,10)+'</div>'+bookmarkBtn(a.id,15,'plain')+'</div>'
    +'<h3 class="vm-hl" style="font-family:var(--font-display);font-size:23px;line-height:1.3;font-weight:700;letter-spacing:-.018em;margin:0 0 8px;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</h3>'
    +'<p style="font-size:14.5px;line-height:1.65;color:var(--color-label-neutral);margin:0 0 8px;max-width:62ch;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;">'+e(a.dek)+'</p>'
    // 자리가 남는 행에서만 펼쳐지는 진료 포인트 — 빈칸을 여백 대신 정보로 메운다
    + (a.radar&&a.radar.clinical?'<div class="vm-fill" style="display:none;margin:0 0 10px;padding-left:11px;border-left:2px solid var(--color-primary-normal);font-size:13px;line-height:1.6;color:var(--color-label-neutral);max-width:62ch;"><b style="color:var(--color-primary-normal);font-weight:700;">진료 포인트</b> '+e(a.radar.clinical)+'</div>':'')
    +'<div style="font-size:11.5px;letter-spacing:.02em;text-transform:uppercase;color:var(--color-label-alternative);">'+metaShort(a)+'</div></article>';
  }
  // ── 광고·제휴 슬롯 ──
  // 이용약관 7조: 광고임을 명확히 표기하고 편집 기사와 시각적으로 구분한다.
  // 그래서 제목은 본문 서체(산세리프)를 쓴다 — 기사 제목은 세리프라 한눈에 갈린다.
  var SLOT_PREVIEW=/[?&]slot=preview/.test(location.search);
  var SLOT_LABEL={sponsor:'광고',partner:'제휴',house:'베트맨랩 안내'};
  function slotAt(where){
    var s=(CFG.slots||[]).filter(function(x){ return x.at===where && (x.enabled||SLOT_PREVIEW); })[0];
    return s||null;
  }
  function sponsorBlock(s,wide){
    if(!s) return '';
    var off=!s.enabled;
    return '<aside class="vm-slot" style="border-top:1px solid var(--color-line-normal);border-bottom:1px solid var(--color-line-normal);background:var(--color-material-base);padding:'+(wide?'20px 24px':'16px 18px')+';margin:'+(wide?'0 0 26px':'18px 0 0')+';">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">'
      +'<span style="font-size:9.5px;font-weight:800;letter-spacing:.14em;border:1px solid var(--color-label-alternative);color:var(--color-label-alternative);padding:2px 6px;border-radius:3px;">'+e(SLOT_LABEL[s.kind]||'광고')+'</span>'
      +(s.advertiser?'<span style="font-size:11px;font-weight:700;color:var(--color-label-alternative);letter-spacing:.02em;">'+e(s.advertiser)+'</span>':'')
      +(off?'<span style="font-size:10px;font-weight:700;color:var(--color-primary-normal);">미리보기 — 게시되지 않음</span>':'')
    +'</div>'
    +(s.headline?'<div style="font-family:var(--font-sans);font-size:'+(wide?'19px':'15px')+';font-weight:700;line-height:1.35;letter-spacing:-.01em;color:var(--color-label-strong);margin-bottom:6px;">'+e(s.headline)+'</div>':'')
    +(s.body?'<p style="margin:0 0 10px;font-size:'+(wide?'14px':'13px')+';line-height:1.6;color:var(--color-label-neutral);max-width:70ch;">'+e(s.body)+'</p>':'')
    +(s.url&&s.cta?'<a href="'+e(s.url)+'" target="_blank" rel="noopener sponsored nofollow" style="display:inline-flex;align-items:center;gap:5px;font-size:13px;font-weight:700;color:var(--color-primary-normal);">'+e(s.cta)+' →</a>':'')
    +'</aside>';
  }

  // ── 1면 전용 렌더러 ──
  // 톱기사: 큰 제목 + 리드 + 본문 2단 조판(드롭캡). 신문 1면의 무게중심이다.
  function fpLead(a){
    var body=(a.body||[]).slice(0,3).map(function(p,i){return '<p style="margin:0 0 13px;'+(i?'':'')+'">'+e(p)+'</p>';}).join('');
    return '<article class="vm-lead'+readCls(a.id)+'" data-open="'+a.id+'" style="cursor:pointer;">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:12px;"><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;"><span style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--color-primary-normal);">'+e(a.kicker)+'</span>'+tag(a.isToday,18,10.5)+(isRead(a.id)?'<span style="font-size:10.5px;color:var(--color-label-alternative);">읽음</span>':'')+'</div>'+bookmarkBtn(a.id,17,'plain')+'</div>'
    +'<h2 class="vm-hl vm-lead-h" style="font-family:var(--font-display);font-size:46px;line-height:1.06;font-weight:800;letter-spacing:-.035em;margin:0 0 14px;color:var(--color-label-strong);text-wrap:balance;">'+e(a.title)+'</h2>'
    +'<p style="font-size:17.5px;line-height:1.6;font-weight:500;color:var(--color-label-normal);margin:0 0 16px;padding-bottom:16px;border-bottom:1px solid var(--color-line-normal);">'+e(a.dek)+'</p>'
    +'<div class="vm-fp-body" style="column-count:2;column-gap:30px;column-rule:1px solid var(--color-line-normal);font-size:14.5px;line-height:1.75;color:var(--color-label-neutral);">'+body+'</div>'
    +'<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--color-line-normal);display:flex;align-items:center;gap:8px;font-size:11.5px;letter-spacing:.03em;color:var(--color-label-alternative);text-transform:uppercase;">'+meta(a)+'</div>'
    +'</article>';
  }
  // 브리프: 제목만 촘촘히 쌓는 왼쪽 단. 밀도로 신문 느낌을 만든다.
  function briefRow(a,i){
    return '<div class="vm-brief-r'+readCls(a.id)+'" data-open="'+a.id+'" style="display:flex;gap:9px;padding:11px 0;border-bottom:1px solid var(--color-line-normal);cursor:pointer;">'
    +'<span style="flex:none;font-family:var(--font-display);font-size:11px;font-weight:800;color:var(--color-primary-normal);padding-top:3px;">'+String(i+1).padStart(2,'0')+'</span>'
    +'<div style="min-width:0;"><div class="vm-hl" style="font-size:13.5px;font-weight:700;line-height:1.4;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</div>'
    +'<div style="margin-top:3px;font-size:10.5px;letter-spacing:.03em;text-transform:uppercase;color:var(--color-label-alternative);">'+e(a.source)+'</div></div></div>';
  }
  // 쿼드: 같은 무게 4장. 제목 크기를 통일해 가로 리듬을 만든다.
  function quadCard(a,i){
    return '<article class="vm-quad-c'+readCls(a.id)+'" data-open="'+a.id+'" style="cursor:pointer;">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:7px;"><span style="font-size:10px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--color-primary-normal);">'+e(a.kicker)+'</span>'+bookmarkBtn(a.id,14,'plain')+'</div>'
    +'<h3 class="vm-hl" style="font-family:var(--font-display);font-size:18px;line-height:1.28;font-weight:700;letter-spacing:-.015em;margin:0 0 7px;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</h3>'
    +'<p style="font-size:13px;line-height:1.6;color:var(--color-label-neutral);margin:0 0 8px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;">'+e(a.dek)+'</p>'
    +'<div style="font-size:10.5px;letter-spacing:.03em;text-transform:uppercase;color:var(--color-label-alternative);">'+e(a.source)+'</div></article>';
  }
  // 피처: 가로로 넓게 눕힌 해설 기사. 진료 포인트를 항상 노출한다.
  function featureCard(a){
    var r=a.radar||{};
    return '<article class="vm-feat'+readCls(a.id)+'" data-open="'+a.id+'" style="cursor:pointer;">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:9px;"><div style="display:flex;align-items:center;gap:7px;"><span style="font-size:10.5px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--color-primary-normal);">깊이 보기 · '+e(a.kicker)+'</span>'+tag(a.isToday,16,10)+'</div>'+bookmarkBtn(a.id,15,'plain')+'</div>'
    +'<h3 class="vm-hl" style="font-family:var(--font-display);font-size:30px;line-height:1.2;font-weight:800;letter-spacing:-.025em;margin:0 0 10px;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</h3>'
    +'<p style="font-size:15px;line-height:1.7;color:var(--color-label-neutral);margin:0 0 12px;max-width:64ch;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;">'+e(a.dek)+'</p>'
    // 자리가 남으면 본문 첫 문단까지 펼쳐 '해설' 기사답게 만든다
    + ((a.body||[])[0]?'<p class="vm-fill" style="display:none;font-size:14.5px;line-height:1.75;color:var(--color-label-neutral);margin:0 0 12px;max-width:64ch;-webkit-line-clamp:6;-webkit-box-orient:vertical;overflow:hidden;">'+e(a.body[0])+'</p>':'')
    + (r.clinical?'<div style="margin:0 0 12px;padding-left:12px;border-left:2px solid var(--color-primary-normal);font-size:13px;line-height:1.6;color:var(--color-label-neutral);max-width:62ch;"><b style="color:var(--color-primary-normal);font-weight:700;">진료 포인트</b> '+e(r.clinical)+'</div>':'')
    +'<div style="font-size:11.5px;letter-spacing:.03em;text-transform:uppercase;color:var(--color-label-alternative);">'+metaShort(a)+'</div></article>';
  }
  function railCard(a){
    return '<article class="vm-rail'+readCls(a.id)+'" data-open="'+a.id+'" style="padding:20px 0;border-top:1px solid var(--color-line-normal);cursor:pointer;">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-primary-normal);">'+e(a.kicker)+'</span>'+tag(a.isToday,16,10)+'</div>'+bookmarkBtn(a.id,15,'plain')+'</div>'
    +'<h3 class="vm-hl" style="font-family:var(--font-display);font-size:21px;line-height:1.28;font-weight:700;letter-spacing:-.017em;margin:0 0 8px;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</h3>'
    +'<p style="font-size:14px;line-height:1.6;color:var(--color-label-neutral);margin:0 0 10px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;">'+e(a.dek)+'</p>'
    +'<div style="font-size:11.5px;letter-spacing:.02em;text-transform:uppercase;color:var(--color-label-alternative);">'+metaShort(a)+'</div></article>';
  }
  function mostRead(list){
    return '<div style="margin-top:14px;border-top:2px solid var(--color-label-strong);padding-top:14px;"><div style="font-family:var(--font-display);font-size:15px;font-weight:800;letter-spacing:.02em;color:var(--color-label-strong);margin-bottom:6px;">주목 브리핑 TOP 5</div>'
    + list.map(function(a,i){ return '<div class="vm-mr'+readCls(a.id)+'" data-open="'+a.id+'" style="display:flex;gap:12px;align-items:baseline;padding:11px 0;border-top:1px solid var(--color-line-normal);cursor:pointer;"><span style="flex:none;font-family:var(--font-display);font-size:20px;font-weight:800;color:var(--color-primary-normal);width:20px;line-height:1;">'+(i+1)+'</span><div><div class="vm-mrt" style="font-size:14px;font-weight:700;line-height:1.35;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</div><div style="margin-top:3px;font-size:11px;text-transform:uppercase;letter-spacing:.02em;color:var(--color-label-alternative);">'+[a.source,a.country].filter(Boolean).map(e).join(' · ')+'</div></div></div>'; }).join('')+'</div>';
  }
  function bandCard(a){
    return '<article class="vm-card'+readCls(a.id)+'" data-open="'+a.id+'" style="background:var(--color-background-normal);padding:24px 22px 26px;display:flex;flex-direction:column;cursor:pointer;">'
    +'<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px;"><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-primary-normal);">'+e(a.kicker)+'</span>'+tag(a.isToday,16,10)+'</div>'+bookmarkBtn(a.id,15,'plain')+'</div>'
    +'<h3 class="vm-hl" style="font-family:var(--font-display);font-size:19px;line-height:1.32;font-weight:700;letter-spacing:-.015em;margin:0 0 10px;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</h3>'
    +'<p style="font-size:13.5px;line-height:1.6;color:var(--color-label-neutral);margin:0 0 10px;display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden;">'+e(a.dek)+'</p>'
    +'<div style="margin-top:auto;font-size:11.5px;letter-spacing:.02em;text-transform:uppercase;color:var(--color-label-alternative);">'+metaShort(a)+'</div></article>';
  }
  function rowCard(a){
    var ideaBtn = '<button data-idea="'+a.id+'" title="글감 담기" style="flex:none;width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--color-line-normal);background:var(--color-background-normal);border-radius:9px;cursor:pointer;color:'+(isIdea(a.id)?'var(--color-primary-normal)':'var(--color-label-assistive)')+';">'+IDEA.replace(/W/g,16)+'</button>';
    return '<article class="vm-row'+readCls(a.id)+'" data-open="'+a.id+'" style="display:flex;gap:20px;padding:24px 0;border-bottom:1px solid var(--color-line-normal);cursor:pointer;">'
    +'<div style="flex:1;min-width:0;"><div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;flex-wrap:wrap;"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-primary-normal);">'+e(a.kicker)+'</span>'+tag(a.isToday,16,10)+'</div>'
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

  // 프런트페이지 편집 칼럼 "진료실 문답" — 보호자 질문을 신문 Q&A 지면처럼.
  function qaColumn(arr){
    if(S.cat!=='all'||S.unreadOnly||S.query.trim()||DATA.weekly) return '';
    var soon=arr.filter(function(a){return a.radar&&a.radar.owner&&a.radar.owner.q;}).slice(0,6);
    if(soon.length<3) return '';
    var items=soon.map(function(a){
      return '<div class="vm-qa-i'+readCls(a.id)+'" data-open="'+a.id+'" style="cursor:pointer;padding:15px 0;border-top:1px solid var(--color-line-normal);">'
      +'<div style="font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--color-label-alternative);margin-bottom:6px;">'+[a.source,a.country].filter(Boolean).map(e).join(' · ')+'</div>'
      +'<div class="vm-hl" style="font-family:var(--font-display);font-size:17px;line-height:1.42;font-weight:700;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.radar.owner.q)+'</div></div>';
    }).join('');
    return '<div style="margin-top:6px;"><div style="border-top:2px solid var(--color-label-strong);padding:16px 0 4px;display:flex;align-items:baseline;gap:10px;"><span style="font-family:var(--font-display);font-size:19px;font-weight:800;letter-spacing:-.01em;color:var(--color-label-strong);">진료실 문답</span><span style="font-size:12.5px;color:var(--color-label-alternative);">이번 주, 보호자가 묻는 것</span></div>'
    +'<div class="vm-qa-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:0 44px;">'+items+'</div></div>';
  }

  // 3열 밴드 그리드. 마지막 줄이 안 차면 빈 칸에 배경색이 드러나므로 채움 셀을 넣는다
  // (모바일 1열에서는 채움 셀을 숨긴다).
  function bandGrid(list){
    var pad=(3-(list.length%3))%3, fill='';
    for(var i=0;i<pad;i++) fill+='<div class="vm-band-fill" style="background:var(--color-background-normal);"></div>';
    return '<div class="vm-band" style="display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--color-line-normal);">'+list.map(bandCard).join('')+fill+'</div>';
  }

  // "최근 브리핑" — 오늘 발행분이 적은 날에도 1면이 허전하지 않도록 지난 며칠 기사를 함께.
  function recentSection(){
    if(S.cat!=='all'||S.unreadOnly||S.query.trim()||DATA.weekly) return '';
    var list=DATA.recent||[]; if(!list.length) return '';
    return '<div style="margin-top:32px;"><div style="border-top:2px solid var(--color-label-strong);padding:16px 0 13px;display:flex;align-items:baseline;gap:10px;"><span style="font-family:var(--font-display);font-size:19px;font-weight:800;letter-spacing:-.01em;color:var(--color-label-strong);">최근 브리핑</span><span style="font-size:12.5px;color:var(--color-label-alternative);">지난 며칠 사이 주요 기사</span></div>'
    +bandGrid(list)+'</div>';
  }

  // "진료실 밖 이야기" — 네이트판식 화제글 보드(신뢰 뉴스와 분리, 캐주얼)
  function storyBoard(){
    if(S.cat!=='all'||S.unreadOnly||S.query.trim()||DATA.weekly) return '';
    var list=DATA.stories||[]; if(!list.length) return '';
    var rows=list.map(function(a,i){
      return '<div class="vm-story'+readCls(a.id)+'" data-open="'+a.id+'" style="display:flex;gap:14px;align-items:baseline;padding:14px 2px;border-top:1px solid var(--color-line-normal);cursor:pointer;">'
      +'<span style="flex:none;width:20px;font-family:var(--font-display);font-size:17px;font-weight:800;color:var(--color-label-assistive);text-align:center;">'+(i+1)+'</span>'
      +'<div style="min-width:0;flex:1;">'
      +'<div class="vm-hl" style="font-size:15.5px;font-weight:700;line-height:1.45;color:var(--color-label-strong);text-wrap:pretty;">'+(a.tag?'<span style="color:var(--color-primary-normal);font-weight:800;">['+e(a.tag)+']</span> ':'')+e(a.title)+'</div>'
      +'<div style="margin-top:4px;font-size:11.5px;color:var(--color-label-alternative);">'+[a.source,a.country].filter(Boolean).map(e).join(' · ')+'</div>'
      +'</div><span style="flex:none;color:var(--color-label-assistive);align-self:center;">'+ARR+'</span></div>';
    }).join('');
    return '<div style="margin-top:32px;padding:22px 24px 24px;background:var(--color-background-alternative);border-radius:16px;">'
    +'<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:2px;"><span style="font-family:var(--font-display);font-size:20px;font-weight:800;letter-spacing:-.01em;color:var(--color-label-strong);">진료실 밖 이야기</span><span style="font-size:12.5px;color:var(--color-label-alternative);">해외에서 화제가 된 반려동물·병원 썰</span></div>'
    +'<div>'+rows+'</div></div>';
  }

  // 폴드 3단 맞춤기 — 톱기사 높이를 기준선으로 삼아, 왼쪽 브리프 개수와 오른쪽
  // 카드 수를 조정해 세 단이 같은 지점에서 끝나게 한다. 브리프 행(약 60px)이
  // 잘게 나뉘어 있어 미세 조정은 왼쪽이 담당한다.
  var FP={brief:7,side:2,busy:false,steps:0};
  function fitFold(){
    if(FP.busy||S.view!=='home'||S.openId||innerWidth<=900) return;
    var C=document.getElementById('vm-leadcell'), B=document.getElementById('vm-brief'), R=document.getElementById('vm-side');
    if(!C||!B||!R||!B.lastElementChild||!R.lastElementChild) return;
    var target=C.getBoundingClientRect().height;
    function used(el){ return el.lastElementChild.getBoundingClientRect().bottom-el.getBoundingClientRect().top; }
    var bUnit=B.lastElementChild.getBoundingClientRect().height||60;
    var rUnit=R.lastElementChild.getBoundingClientRect().height||260;
    var wantB=Math.max(3,Math.min(14,FP.brief+Math.round((target-used(B))/bUnit)));
    var wantR=Math.max(1,Math.min(4,FP.side+Math.round((target-used(R))/rUnit)));
    if((wantB!==FP.brief||wantR!==FP.side)&&FP.steps<5){
      FP.brief=wantB; FP.side=wantR; FP.steps++;
      FP.busy=true; render(); FP.busy=false;
      setTimeout(fitFold,16);
      return;
    }
    fillSlack();
  }
  // 남는 여백은 빈칸으로 두지 않고, 짧은 단의 말줄임(line-clamp)을 풀어 글로 채운다.
  function fillSlack(){
    if(innerWidth<=900) return;
    var C=document.getElementById('vm-leadcell');
    if(!C) return;
    var pairs=[[C.getBoundingClientRect().height,['vm-brief','vm-side']]];
    var FL=document.getElementById('vm-feat-l'), FR=document.getElementById('vm-feat-r');
    // 피처 구역도 같은 방식으로 — 짧은 쪽(보통 해설 기사)을 TOP 5 높이까지 늘린다
    if(FL&&FR) pairs.push([Math.max(FL.getBoundingClientRect().height,FR.getBoundingClientRect().height)-56,['vm-feat-l','vm-feat-r']]);
    pairs.forEach(function(pr){ var target=pr[0]; pr[1].forEach(function(id){
      var el=document.getElementById(id);
      if(!el||!el.lastElementChild) return;
      function slack(){ return target-(el.lastElementChild.getBoundingClientRect().bottom-el.getBoundingClientRect().top); }
      // ① 숨겨둔 블록(진료 포인트 등)을 먼저 편다. 넘치면 되돌린다
      [].slice.call(el.querySelectorAll('.vm-fill')).forEach(function(x){
        if(slack()<40) return;
        x.style.display=x.tagName==='P'?'-webkit-box':'block';
        if(slack()<0) x.style.display='none';
      });
      // ② 그래도 남으면 마지막 카드의 말줄임을 한 줄씩 푼다
      var ps=el.querySelectorAll('p[style*="line-clamp"]');
      if(!ps.length) return;
      var p=ps[ps.length-1], guard=0;
      while(guard++<20){
        if(slack()<26) break;                            // 한 줄 넣을 자리도 없다
        if(p.scrollHeight<=p.clientHeight+2) break;       // 더 보여줄 문장이 없다
        p.style.webkitLineClamp=(parseInt(getComputedStyle(p).webkitLineClamp)||3)+1;
      }
    }); });
  }
  var balTimer;
  addEventListener('resize',function(){ clearTimeout(balTimer); balTimer=setTimeout(function(){ FP.steps=0; fitFold(); },160); });
  // 본문 서체는 CDN에서 늦게 온다. 폴백 서체 기준으로 맞춰놓으면 서체가 바뀌는
  // 순간 글자 높이가 달라져 세 단이 어긋나는데, 다시 맞출 계기가 없다.
  if(document.fonts&&document.fonts.ready){ document.fonts.ready.then(function(){ FP.steps=0; fitFold(); }); }

  function homeView(){
    var arr=activeList();
    if(!arr.length){ return '<div style="text-align:center;padding:64px 0;color:var(--color-label-alternative);"><div style="font-family:var(--font-display);font-size:19px;font-weight:700;color:var(--color-label-neutral);">해당 조건의 글이 없습니다</div><p style="margin:8px 0 0;font-size:14px;">필터를 바꿔보세요.</p></div>'; }
    // 기사가 적은 필터에서는 2단을 쓰지 않는다. 오른쪽 단(카드 4 + TOP 5)이
    // 목록 전체보다 길어 어떻게 나눠도 한쪽에 수백 px 빈칸이 남기 때문이다.
    if(arr.length<14){
      var h1='<div><div style="padding:28px 0 34px;border-bottom:2px solid var(--color-label-strong);">'
      +leadCard(arr[0])+arr.slice(1).map(leadFollow).join('')+'</div>'
      +mostRead(arr.slice(0,5));
      h1+=qaColumn(arr);
      h1+=recentSection();
      h1+=storyBoard();
      return h1+'</div>';
    }
    // ── 1면 구성 ──
    // 신문 1면은 아래로 갈수록 단 수와 비중이 바뀐다. 같은 2단이 끝까지 반복되면
    // 리듬이 죽는다. 구역마다 폭을 달리하되, 구역 안에서는 행을 공유해 선을 맞춘다.
    //   폴드   3단(1 : 2.3 : 1.15) — 브리프 리스트 | 톱기사(본문 2단 조판) | 사이드
    //   쿼드   4단 — 같은 무게의 카드 4장
    //   피처   2단(1.7 : 1) 비대칭 — 해설 기사 | TOP 5
    var i=1, lead=arr[0];
    var side=arr.slice(i,i+FP.side); i+=FP.side;
    var brief=arr.slice(i,i+FP.brief); i+=FP.brief;
    var quad=arr.slice(i,i+4); i+=quad.length>=2?quad.length:0;
    if(quad.length<2) quad=[];
    var feat=arr[i++];
    var bandAll=arr.slice(i);
    var band=S.showAll?bandAll:bandAll.slice(0,12);
    var top5=arr.slice(0,5), more=bandAll.length-band.length;

    var h='<div>'
    // ① 폴드 — 3단 비대칭
    +'<div id="vm-fold" class="vm-fold" style="display:grid;grid-template-columns:1fr 2.3fr 1.15fr;gap:0;border-bottom:3px solid var(--color-label-strong);padding-bottom:30px;">'
      +'<div id="vm-leadcell" style="grid-column:2;padding:26px 34px 0;border-left:1px solid var(--color-line-normal);border-right:1px solid var(--color-line-normal);">'+fpLead(lead)+'</div>'
      +'<div id="vm-brief" style="grid-column:1;grid-row:1;padding:26px 26px 0 0;">'
        +'<div style="font-family:var(--font-display);font-size:12px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--color-label-strong);padding-bottom:10px;border-bottom:2px solid var(--color-label-strong);">한눈에</div>'
        +brief.map(briefRow).join('')+'</div>'
      +'<div id="vm-side" style="grid-column:3;grid-row:1;padding:26px 0 0 26px;">'+side.map(railCard).join('')+sponsorBlock(slotAt('fold'))+'</div>'
    +'</div>'
    // ② 광고/제휴 띠 — 폴드와 쿼드 사이. 슬롯이 비면 아무것도 나오지 않는다
    +sponsorBlock(slotAt('mid'),true)
    // ③ 쿼드 — 같은 무게 4단
    // 칸이 다 차지 않으면 빈 셀이 생긴다 → 카드 수에 맞춰 단 수를 줄이고, 2장 미만이면 생략
    +(quad.length>=2?'<div class="vm-quadzone" style="display:grid;grid-template-columns:repeat('+quad.length+',1fr);gap:0;border-bottom:2px solid var(--color-label-strong);">'
      +quad.map(function(a,qi){ return '<div class="vm-quad" style="padding:22px 20px 26px;'+(qi?'border-left:1px solid var(--color-line-normal);':'padding-left:0;')+(qi===quad.length-1?'padding-right:0;':'')+'">'+quadCard(a,qi)+'</div>'; }).join('')
    +'</div>':'')
    // ③ 피처 — 비대칭 2단
    +(feat?'<div class="vm-featzone" style="display:grid;grid-template-columns:1.7fr 1fr;gap:0;border-bottom:2px solid var(--color-label-strong);">'
      +'<div id="vm-feat-l" style="padding:26px 40px 30px 0;">'+featureCard(feat)+'</div>'
      +'<div id="vm-feat-r" style="padding:26px 0 30px 40px;border-left:1px solid var(--color-line-normal);">'+mostRead(top5)+'</div>'
    +'</div>':'');
    if(bandAll.length){
      h+='<div style="padding:16px 0 13px;border-bottom:1px solid var(--color-line-normal);"><span style="font-family:var(--font-display);font-size:19px;font-weight:800;letter-spacing:-.01em;color:var(--color-label-strong);">오늘의 다른 소식</span></div>'
      +bandGrid(band);
      if(more>0){ h+='<div style="display:flex;justify-content:center;padding:28px 0 0;"><button data-act="more" style="display:inline-flex;align-items:center;gap:8px;border:1px solid var(--color-line-strong);background:var(--color-background-normal);color:var(--color-label-strong);cursor:pointer;font-family:inherit;font-size:14px;font-weight:700;padding:12px 24px;border-radius:10px;">기사 '+more+'건 더 보기</button></div>'; }
    }
    h+=qaColumn(arr);
    h+=recentSection();
    h+=storyBoard();
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
    +'<button data-act="prev" class="vm-dt-hide" '+(prev?'':'disabled')+' title="이전 기사" style="width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--color-line-normal);background:var(--color-background-normal);border-radius:8px;cursor:'+(prev?'pointer':'default')+';color:'+(prev?'var(--color-label-neutral)':'var(--color-label-assistive)')+';">'+ARL+'</button>'
    +'<button data-act="next" class="vm-dt-hide" '+(next?'':'disabled')+' title="다음 기사" style="width:32px;height:32px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--color-line-normal);background:var(--color-background-normal);border-radius:8px;cursor:'+(next?'pointer':'default')+';color:'+(next?'var(--color-label-neutral)':'var(--color-label-assistive)')+';">'+ARR+'</button>'
    +'<span style="font-family:var(--font-display);font-size:12.5px;font-weight:700;color:var(--color-label-alternative);font-variant-numeric:tabular-nums;padding-left:4px;">'+pos+'</span>'
    +'</div>'
    +'<div style="display:flex;align-items:center;gap:6px;">'
    +'<div class="vm-dt-hide" style="display:inline-flex;border:1px solid var(--color-line-normal);border-radius:8px;overflow:hidden;margin-right:2px;"><button data-act="fs-" title="글자 작게" style="width:30px;height:32px;border:0;border-right:1px solid var(--color-line-normal);background:var(--color-background-normal);cursor:pointer;color:var(--color-label-neutral);font-family:inherit;font-size:12px;font-weight:700;">가−</button><button data-act="fs+" title="글자 크게" style="width:32px;height:32px;border:0;background:var(--color-background-normal);cursor:pointer;color:var(--color-label-neutral);font-family:inherit;font-size:15px;font-weight:700;">가＋</button></div>'
    +'<button data-idea="'+a.id+'" class="vm-dt-hide" title="글감 담기" style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--color-line-normal);background:var(--color-background-normal);border-radius:8px;cursor:pointer;color:'+(isIdea(a.id)?'var(--color-primary-normal)':'var(--color-label-neutral)')+';">'+IDEA.replace(/W/g,16)+'</button>'
    +'<button data-act="share" data-id="'+a.id+'" title="공유" style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--color-line-normal);background:var(--color-background-normal);border-radius:8px;cursor:pointer;color:var(--color-label-neutral);">'+SHARE+'</button>'
    +'<button data-act="copylink" data-id="'+a.id+'" class="vm-dt-hide" title="링크 복사" style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--color-line-normal);background:var(--color-background-normal);border-radius:8px;cursor:pointer;color:var(--color-label-neutral);">'+COPY+'</button>'
    +'<button data-save="'+a.id+'" title="저장" style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--color-line-normal);background:var(--color-background-normal);border-radius:8px;cursor:pointer;color:'+saveColor(a.id)+';">'+BM.replace(/W/g,16)+'</button>'
    +'<button data-act="close" title="닫기" style="width:34px;height:34px;display:inline-flex;align-items:center;justify-content:center;border:0;background:var(--color-material-base);border-radius:8px;cursor:pointer;color:var(--color-label-neutral);"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>'
    +'</div></div>'
    // body
    +'<div class="vm-detail-body" id="vm-db" style="overflow-y:auto;padding:30px 44px 20px;">'
    +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;flex-wrap:wrap;"><span style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--color-primary-normal);">'+e(a.kicker)+'</span>'+(a.tag?'<span style="font-size:11px;font-weight:800;color:var(--color-primary-normal);">['+e(a.tag)+']</span>':'')+tag(a.isToday,17,10)+'</div>'
    +'<h1 style="font-family:var(--font-display);font-size:calc(34px*var(--fs));line-height:1.2;font-weight:800;letter-spacing:-.028em;margin:0 0 16px;color:var(--color-label-strong);text-wrap:pretty;">'+e(a.title)+'</h1>'
    +'<div style="padding-bottom:20px;border-bottom:1px solid var(--color-line-normal);"><div style="display:flex;align-items:center;gap:8px;font-size:12px;letter-spacing:.02em;text-transform:uppercase;color:var(--color-label-alternative);">'+meta(a)+'</div>'+evLine(a)+'</div>'
    // 실제 사진이 있을 때만 — 없을 때 띄우던 출처 플레이트는 지면만 잡아먹어 제거
    + (a.image ? '<div style="position:relative;overflow:hidden;height:240px;margin:22px 0;border-radius:6px;background:rgba(0,102,255,0.07);border:1px solid var(--color-line-normal);">'+plate(a,{label:true,big:26,pad:20})+'</div>' : '')
    +'<p style="font-size:calc(17px*var(--fs));line-height:1.75;color:var(--color-label-normal);margin:0 0 18px;font-weight:500;">'+e(a.dek)+'</p>'
    +body
    +radarBlock(a)
    +'<div style="margin:26px 0 4px;padding:16px 18px;background:var(--color-background-alternative);border-radius:12px;"><div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--color-label-alternative);margin-bottom:6px;">원문 출처</div><div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;"><div style="font-size:14px;color:var(--color-label-neutral);"><b style="color:var(--color-label-strong);font-weight:700;">'+e(a.source)+'</b>'+(a.country?' · '+e(a.country):'')+(a.date?' · '+e(a.date):'')+'</div><a href="'+e(a.sourceUrl)+'" target="_blank" rel="noopener nofollow" style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:var(--color-primary-normal);">원문 사이트로 이동 '+EXT+'</a></div><p style="margin:10px 0 0;font-size:11.5px;line-height:1.5;color:var(--color-label-alternative);">해외 공개 자료의 요약·번역이며 임상 정보는 참고용입니다. 적용 전 원문과 최신 문헌을 확인하세요.</p></div>'
    + (a.blog ? '<div style="margin:26px 0;padding-top:18px;border-top:1px solid var(--color-line-normal);">'
      +'<div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--color-label-alternative);margin-bottom:10px;">블로그 글감</div>'
      +'<p style="font-family:var(--font-display);font-size:calc(18px*var(--fs));line-height:1.45;font-weight:700;color:var(--color-label-strong);margin:0 0 '+(angle?'12px':'14px')+';text-wrap:pretty;">'+e(a.blog)+'</p>'
      +(angle?'<ul style="margin:0 0 16px;padding-left:18px;color:var(--color-label-neutral);font-size:calc(14px*var(--fs));line-height:1.8;">'+angle+'</ul>':'')
      +'<div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;">'
      +'<button data-act="makedraftone" data-id="'+a.id+'" style="border:0;background:transparent;padding:0;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;color:var(--color-primary-normal);">이 글감으로 초안 쓰기 →</button>'
      +'<button data-idea="'+a.id+'" style="border:0;background:transparent;padding:0;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;color:var(--color-label-neutral);">'+(isIdea(a.id)?'글감함에 담김':'글감함에 담기')+'</button>'
      +'<button data-act="copyblog" data-id="'+a.id+'" style="border:0;background:transparent;padding:0;cursor:pointer;font-family:inherit;font-size:13px;font-weight:600;color:var(--color-label-neutral);">복사</button>'
      +'</div></div>' : '')
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
    else {
      // 1면 전체 분량을 보여준다 — "오늘"만 세면 수확 적은 날 과도하게 작아 보인다
      var nRec=(DATA.recent||[]).length, nSto=(DATA.stories||[]).length;
      stripLabel='오늘의 브리핑';
      stripMeta=DATA.dateLabel+' · 오늘 '+DATA.count+'건'+(nRec?' · 최근 '+nRec+'건':'')+(nSto?' · 진료실 밖 '+nSto+'건':'');
    }
    var showSort = (S.view==='home' && !searching) || searching;

    var h='';
    h+='<div style="position:sticky;top:0;z-index:30;background:var(--color-background-normal);border-bottom:1px solid var(--color-line-normal);"><div class="vm-bar" style="max-width:1180px;margin:0 auto;padding:9px 40px;display:flex;align-items:center;gap:16px;">'
    +'<button data-nav="home" class="vm-tap" style="flex:none;border:0;background:transparent;cursor:pointer;display:inline-flex;align-items:center;font-family:var(--font-display);font-size:18px;font-weight:800;letter-spacing:-.02em;color:var(--color-label-strong);">VetMan 브리핑</button>'
    +'<div class="vm-search" style="flex:1;max-width:420px;display:flex;align-items:center;gap:8px;background:var(--color-material-thin);border-radius:9px;padding:9px 12px;color:var(--color-label-alternative);">'+search+'<input id="vm-q" value="'+e(S.query)+'" placeholder="기사 검색 — 제목·본문·출처" style="border:0;outline:0;background:transparent;font-family:inherit;font-size:13px;color:var(--color-label-normal);width:100%;"></div>'
    +'<div style="flex:none;display:flex;align-items:center;gap:14px;"><span class="vm-bar-label">'+navBtn('ideas','글감함',ideaCount)+'</span><span class="vm-bar-label">'+navBtn('saved','저장',savedCount)+'</span><span class="vm-bar-label">'+navBtn('archive','지난 브리핑')+'</span>'
    +'<button data-act="theme" class="vm-tap" title="테마 전환" style="flex:none;display:inline-flex;align-items:center;justify-content:center;width:34px;height:34px;border:1px solid var(--color-line-normal);background:var(--color-background-normal);color:var(--color-label-neutral);cursor:pointer;border-radius:9px;">'+(S.theme==='dark'?sun:moon)+'</button></div>'
    +'</div></div>';

    h+='<div class="vm-wrap" style="max-width:1180px;margin:0 auto;padding:0 40px 64px;">';
    h+='<div class="vm-dateline" style="display:flex;align-items:center;justify-content:space-between;padding:12px 0;font-size:12px;color:var(--color-label-alternative);"><span style="flex:1;text-align:left;">'+e(DATA.dateline)+'</span><span style="flex:1;text-align:center;letter-spacing:.06em;">해외 수의 소식을 한국 동물병원의 눈으로</span><span style="flex:1;text-align:right;">원문 출처 표기 · 번역 참고용</span></div>';
    h+='<div style="height:1px;background:var(--color-line-normal);"></div>';
    h+='<header class="vm-mast" style="text-align:center;padding:30px 0 22px;"><div style="font-size:11px;letter-spacing:.28em;text-transform:uppercase;color:var(--color-label-alternative);font-weight:700;">'+(DATA.weekly?'Weekly Digest · '+e(DATA.date):'Daily Edition · No. '+e(DATA.editionNo))+'</div><h1 style="font-family:var(--font-display);font-size:58px;font-weight:800;letter-spacing:-.032em;line-height:1.02;margin:12px 0 0;color:var(--color-label-strong);">VetMan 해외 브리핑</h1>'
    +'<p style="margin:14px auto 0;font-size:13.5px;font-style:italic;color:var(--color-label-alternative);font-family:var(--font-display);">베트맨랩이 만드는, 한국 동물병원을 위한 해외 수의 임상·연구·업계 브리핑</p>'
    +'</header>';
    h+='<div class="vm-strip" style="border-top:2px solid var(--color-label-strong);border-bottom:1px solid var(--color-line-normal);display:flex;align-items:center;justify-content:space-between;gap:16px;padding:11px 0;"><div style="display:flex;align-items:baseline;gap:10px;min-width:0;"><span style="font-family:var(--font-display);font-size:17px;font-weight:800;letter-spacing:-.01em;color:var(--color-label-strong);white-space:nowrap;">'+stripLabel+'</span><span style="font-size:12.5px;color:var(--color-label-alternative);">'+stripMeta+'</span></div>'
    + (showSort ? '<div style="display:inline-flex;padding:3px;background:var(--color-material-base);border-radius:8px;gap:2px;flex:none;"><button data-act="rel" class="vm-seg" style="border:0;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;padding:5px 11px;border-radius:6px;background:'+segBg(S.sort==='rel')+';color:'+segFg(S.sort==='rel')+';">관련성순</button><button data-act="latest" class="vm-seg" style="border:0;cursor:pointer;font-family:inherit;font-size:12px;font-weight:700;padding:5px 11px;border-radius:6px;background:'+segBg(S.sort==='latest')+';color:'+segFg(S.sort==='latest')+';">최신순</button></div>' : '')
    +'</div>';

    if(S.view==='saved'){ h+=listView(Object.keys(S.saved).map(function(k){return S.saved[k];}),'저장한 글이 없습니다','기사의 북마크 아이콘을 눌러 저장해 보세요.'); }
    else if(S.view==='ideas'){ h+=ideasView(); }
    else if(S.view==='archive'){ h+=archiveView(); }
    else if(searching){ h+=listView(activeList(),'검색 결과가 없습니다','다른 검색어를 입력해 보세요.'); }
    else { h+=catRow(); h+=homeView(); }

    h+='<footer style="margin-top:40px;border-top:2px solid var(--color-label-strong);padding-top:24px;display:flex;align-items:flex-start;justify-content:space-between;gap:24px;flex-wrap:wrap;">'
    +'<p style="margin:0;max-width:520px;font-size:11.5px;line-height:1.6;color:var(--color-label-alternative);">본 콘텐츠는 해외 공개 자료의 요약·번역이며, 임상 정보는 참고용입니다. 실제 적용 전 반드시 원문과 최신 문헌을 확인하세요. 모든 항목에 원문 출처가 표기됩니다.<br>단축키 — ←/→ 이전·다음 기사, S 저장, D 글감 담기, / 검색, Esc 닫기.<br><b style="color:var(--color-label-neutral);font-weight:700;">베트맨랩(VetManLab)</b> · 한국 동물병원을 위한 해외 수의 브리핑</p><div class="vm-foot-nav" style="width:100%;display:flex;gap:16px;flex-wrap:wrap;font-size:11.5px;font-weight:600;"><a href="/topic/" style="color:var(--color-label-neutral);">주제별 보기</a><a href="/about" style="color:var(--color-label-neutral);">서비스 소개</a><a href="/privacy" style="color:var(--color-label-neutral);">개인정보처리방침</a><a href="/terms" style="color:var(--color-label-neutral);">이용약관</a><a href="/rss.xml" style="color:var(--color-label-neutral);">RSS</a></div>'
    + (CFG.newsletter
      ? '<form id="vm-sub" style="flex:none;max-width:340px;"><div style="font-family:var(--font-display);font-size:14px;font-weight:800;color:var(--color-label-strong);margin-bottom:8px;">뉴스레터로 매일 아침 받기</div><div style="display:flex;gap:8px;"><input id="vm-email" type="email" required placeholder="이메일 주소" autocomplete="email" style="flex:1;min-width:0;border:1px solid var(--color-line-normal);background:var(--color-background-normal);color:var(--color-label-normal);border-radius:9px;padding:10px 12px;font-family:inherit;font-size:13px;outline:0;"><button type="submit" style="flex:none;border:0;background:var(--color-primary-normal);color:#fff;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;padding:10px 16px;border-radius:9px;white-space:nowrap;">구독</button></div>'
      // 봇 필터 — 사람 눈에는 보이지 않고 스크린리더도 건너뛴다
      +'<input id="vm-hp" type="text" name="website" tabindex="-1" autocomplete="off" aria-hidden="true" style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0;">'
      // 정보통신망법상 수신동의는 무엇에 동의하는지 알 수 있어야 한다
      +'<p style="margin:8px 0 0;font-size:11px;line-height:1.55;color:var(--color-label-alternative);">구독하면 매일 아침 브리핑 메일 수신에 동의하는 것으로 봅니다. 메일 하단 링크로 언제든 해지할 수 있고, 해지 시 저장된 주소도 삭제됩니다. <a href="/privacy" style="color:var(--color-label-neutral);text-decoration:underline;">개인정보처리방침</a></p></form>'
      // 저장소가 준비되기 전까지는 지금 실제로 동작하는 수단만 안내한다
      : '<div style="flex:none;max-width:340px;"><div style="font-family:var(--font-display);font-size:14px;font-weight:800;color:var(--color-label-strong);margin-bottom:6px;">매일 아침 새 브리핑</div><p style="margin:0 0 10px;font-size:11.5px;line-height:1.6;color:var(--color-label-alternative);">이메일 뉴스레터는 준비 중입니다. 그동안 RSS로 구독하시거나 홈 화면에 추가해 두시면 매일 자동으로 갱신됩니다.</p><a href="rss.xml" style="display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:700;color:var(--color-primary-normal);">RSS로 구독하기 →</a></div>')
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
    if(!FP.busy){ FP.steps=0; setTimeout(fitFold,16); }
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
    fetch('api/subscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:email,website:(document.getElementById('vm-hp')||{}).value||''})})
      .then(function(r){return r.json();})
      .then(function(res){ toast(res.ok?(res.already?'이미 구독 중입니다':'구독 신청 완료! 매일 아침 받아보세요'):(res.error||'잠시 후 다시 시도해 주세요')); })
      .catch(function(){ toast('네트워크 오류'); });
  }
  function markRead(id){ if(!S.read[id]){ S.read[id]=1; persist('read',S.read); } }
  // SPA라 기사를 열어도 페이지 이동이 없어 GA4가 조회를 못 잡는다 — 직접 보낸다
  function track(a){
    if(typeof gtag!=='function'||!a) return;
    try{
      gtag('event','article_view',{article_id:a.id,article_title:a.title,category:a.cat,source:a.source,issue_date:a.day});
    }catch(e){}
  }
  function openArticle(id){
    if(byId[id]){ S.openId=id; S.blogOpen=true; S.searchFocus=false; markRead(id); track(byId[id]); var db; render(); db=document.getElementById('vm-db'); if(db) db.scrollTop=0; }
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
      else if(act==='copyscript'){ var a=byId[el.getAttribute('data-id')]; var o=a&&a.radar&&a.radar.owner; if(o){ copy((o.q?'[보호자 예상 질문]\n'+o.q+'\n\n':'')+'[설명]\n'+(o.script||''),'보호자 설명을 복사했습니다'); } return; }
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

// 홈 지면이 비지 않도록 최근 다른 날짜의 기사를 함께 싣는다(오늘 지면과는 분리 표기).
// 일간 수확량은 날마다 들쭉날쭉하므로, 적게 나온 날에도 1면이 허전해지지 않게 한다.
function recentArticles(current, allIssues, limit = 12) {
  const curLabel = labelOf(current);
  const out = [];
  for (const iss of allIssues) {
    const d = labelOf(iss);
    if (d === curLabel || iss.weekly) continue;
    // 원본 인덱스를 유지해야 날짜별 페이지와 id가 일치한다
    out.push(
      ...iss.items
        .map((it, i) => toArticle(it, i, d))
        .filter((a) => a.cat !== "watercooler")
        // 지난 날짜 기사이므로 홈에서 "오늘" 뱃지가 붙으면 안 된다
        .map((a) => ({ ...a, isToday: false }))
    );
    if (out.length >= limit) break;
  }
  return out.slice(0, limit);
}

function renderPage(issue, allIssues, { isIndex = false, weekly = false } = {}) {
  const data = buildIssueData(issue);
  if (isIndex) data.recent = recentArticles(issue, allIssues, 12);
  // Cloudflare Pages는 /foo.html을 /foo로 308 리다이렉트한다.
  // canonical·사이트맵에 .html을 쓰면 실제 서빙 주소와 어긋나므로 확장자를 뺀다.
  const canonicalPath = isIndex ? "/" : weekly ? `/weekly/${labelOf(issue)}` : `/issues/${labelOf(issue)}`;
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${seoHead(issue, data, canonicalPath, isIndex)}
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/wanteddev/wanted-sans@v1.0.4/packages/wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.min.css">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable.css">
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0066ff">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icon.svg">
<meta name="apple-mobile-web-app-capable" content="yes">${gaSnippet()}
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="VetMan 브리핑">
<style>${TOKENS_CSS}${STATIC_CSS}</style>
<script>try{var t=JSON.parse(localStorage.getItem('vm_theme'))||((window.matchMedia&&matchMedia('(prefers-color-scheme:dark)').matches)?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){}</script>
</head>
<body>
<div class="vm-page" id="vm" data-theme="light" style="min-height:100vh;background:var(--color-background-normal);color:var(--color-label-normal);font-family:var(--font-sans);"></div>
${noscriptFallback(data)}
<script id="vm-issue" type="application/json">${json}</script>
<script id="vm-cfg" type="application/json">${JSON.stringify({
    newsletter: !!SITE.newsletterEnabled,
    slots: (SPONSOR?.slots || []).filter((s) => s.advertiser || s.headline),
  })}</script>
<script>${APP_JS}</script>
<script>if('serviceWorker' in navigator){addEventListener('load',function(){navigator.serviceWorker.register('/sw.js').catch(function(){});});}</script>
</body>
</html>`;
}

const ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#0066ff"/><text x="256" y="366" font-family="'Wanted Sans Variable',system-ui,sans-serif" font-size="300" font-weight="800" fill="#fff" text-anchor="middle">V</text></svg>`;

const MANIFEST = JSON.stringify({
  name: "베트맨랩 VetMan 해외 브리핑",
  short_name: "베트맨랩 브리핑",
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

// ── 기사별 개별 페이지 ──
// 기존엔 기사가 날짜 페이지 안의 #앵커라 검색엔진이 개별 기사를 색인할 수 없었다.
// 각 기사에 고유 URL과 서버 렌더 본문을 주어 롱테일 검색 유입을 연다.
// (SPA 셸을 넣지 않고 가볍게 — 네이버 크롤러는 JS 렌더링이 약하다)
function articleSlug(a) {
  const s = String(a.title || "")
    .replace(/[^가-힣a-zA-Z0-9\s]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40)
    .replace(/-+$/, "");
  return `${a.id}${s ? "-" + s : ""}`;
}
const articlePath = (a) => `/article/${articleSlug(a)}`;

// 우리가 만든 판단(진료 포인트·보호자 문답·근거 등급)이 하나도 없으면 그 페이지에
// 남는 건 해외 기사의 한국어 요약뿐이다. 사이트에는 남기되 색인 대상에서는 뺀다 —
// 이런 페이지가 쌓이면 사이트 전체가 재작성 콘텐츠로 평가된다.
function isIndexable(a) {
  const r = a.radar || {};
  return !!(r.clinical || r.owner || r.evidence);
}

function renderArticlePage(a, data, prev, next) {
  const canonical = `${SITE.baseUrl}${articlePath(a)}`;
  const brand = `${SITE.brandKo}(${SITE.brandEn})`;
  const title = `${a.title} | ${SITE.name} · ${SITE.brandKo}`;
  const desc = `${a.dek}`.slice(0, 200);
  const ev = a.radar?.evidence;
  const para = (t) => `<p>${esc(t)}</p>`;
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: a.title,
    description: a.dek,
    url: canonical,
    inLanguage: "ko",
    ...(a.image ? { image: a.image } : {}),
    ...(a.ts ? { datePublished: new Date(a.ts).toISOString() } : {}),
    isBasedOn: a.sourceUrl,
    articleSection: a.kicker,
    publisher: { "@type": "Organization", name: SITE.brandKo, alternateName: SITE.brandEn, url: SITE.baseUrl },
    mainEntityOfPage: canonical,
    // 원문 요약이 아니라 '한국 동물병원 관점의 편집물'임을 구조화 데이터로도 밝힌다.
    // 번역 요약은 isBasedOn(원문)으로, 우리가 만든 판단은 아래 필드로 구분된다.
    ...(a.radar?.clinical ? { abstract: a.radar.clinical } : {}),
    ...(a.radar?.owner?.q
      ? {
          // 보호자 문답은 그 자체가 검색 질의와 겹친다 — FAQPage로 별도 노출된다
          mentions: { "@type": "Question", name: a.radar.owner.q },
        }
      : {}),
    ...(ev
      ? {
          // 근거 등급은 우리가 부여한 평가다. Review로 표현해야 성격이 정확하다
          review: {
            "@type": "Review",
            reviewBody: [ev.design, ev.n, ev.note].filter(Boolean).join(" · "),
            reviewRating: { "@type": "Rating", ratingValue: ev.stars, bestRating: 4, worstRating: 1 },
            author: { "@type": "Organization", name: SITE.brandKo },
          },
        }
      : {}),
    ...(a.source ? { citation: { "@type": "CreativeWork", name: a.source, url: a.sourceUrl } } : {}),
  };
  // 보호자 문답은 검색 질의와 직접 겹치는 자산이다. FAQPage를 따로 내보내면
  // 리치 결과·AI 개요 인용 대상이 된다(NewsArticle 안에 묻히면 잡히지 않는다).
  const faqLd =
    a.radar?.owner?.q && a.radar?.owner?.script
      ? {
          "@context": "https://schema.org",
          "@type": "FAQPage",
          mainEntity: [
            {
              "@type": "Question",
              name: a.radar.owner.q,
              acceptedAnswer: { "@type": "Answer", text: a.radar.owner.script },
            },
          ],
        }
      : null;
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="${isIndexable(a) ? "index, follow" : "noindex, follow"}">
<link rel="canonical" href="${esc(canonical)}">${
    SITE.verification?.google ? `\n<meta name="google-site-verification" content="${esc(SITE.verification.google)}">` : ""
  }${SITE.verification?.naver ? `\n<meta name="naver-site-verification" content="${esc(SITE.verification.naver)}">` : ""}
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(a.title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:site_name" content="${esc(SITE.brandKo)} ${esc(SITE.name)}">${
    a.image ? `\n<meta property="og:image" content="${esc(a.image)}">` : ""
  }
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/wanteddev/wanted-sans@v1.0.4/packages/wanted-sans/fonts/webfonts/variable/split/WantedSansVariable.min.css">
<style>
:root{color-scheme:light dark;--ink:#171719;--sub:#5a5c63;--line:#e3e5e8;--bg:#fff;--pri:#0066ff}
@media (prefers-color-scheme:dark){:root{--ink:#fff;--sub:rgba(255,255,255,.62);--line:rgba(255,255,255,.2);--bg:#171719;--pri:#4f95ff}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);
 font-family:"Wanted Sans Variable","Pretendard Variable","Apple SD Gothic Neo",system-ui,sans-serif;
 -webkit-font-smoothing:antialiased;line-height:1.7}
.wrap{max-width:720px;margin:0 auto;padding:22px 20px 64px}
.top{display:flex;align-items:center;justify-content:space-between;padding-bottom:14px;border-bottom:1px solid var(--line);font-size:13px}
.top a{color:var(--ink);text-decoration:none;font-weight:800}
.kick{margin-top:26px;font-size:11px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;color:var(--pri)}
h1{font-size:33px;line-height:1.25;letter-spacing:-.025em;margin:12px 0 14px;font-weight:800;text-wrap:pretty}
.by{font-size:12px;color:var(--sub);text-transform:uppercase;letter-spacing:.02em;padding-bottom:18px;border-bottom:1px solid var(--line)}
.ev{margin-top:8px;font-style:italic;text-transform:none;letter-spacing:0}
.lead{font-size:17.5px;font-weight:500;margin:20px 0 18px}
p{margin:0 0 16px;font-size:16px;color:var(--sub)}
.note{margin:26px 0;padding:2px 0 2px 18px;border-left:2px solid var(--ink)}
.note .lb,.qa .lb{font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:var(--sub);margin-bottom:5px}
.note .tx{font-size:15px;color:var(--ink)}
.qa{margin:26px 0;padding-top:18px;border-top:1px solid var(--line)}
.qa .q{font-size:19px;font-weight:800;margin:0 0 12px;line-height:1.45;text-wrap:pretty}
.src{margin:26px 0;padding:16px 18px;background:rgba(127,127,127,.08);border-radius:12px;font-size:14px}
.src a{color:var(--pri);font-weight:700;text-decoration:none}
.src .dis{margin-top:10px;font-size:11.5px;color:var(--sub)}
.nav{display:flex;gap:10px;margin-top:28px;flex-wrap:wrap}
  .tpc{margin:22px 0 0;font-size:13px;color:var(--dim)}
  .tpc b{font-weight:700;margin-right:8px}
  .tpc a{display:inline-block;margin-right:8px;color:var(--pri);text-decoration:none;font-weight:600}
.nav a{flex:1;min-width:200px;border:1px solid var(--line);border-radius:12px;padding:14px 16px;text-decoration:none;color:var(--ink)}
.nav .l{font-size:11px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--pri)}
.nav .t{font-size:15px;font-weight:700;margin-top:4px;line-height:1.4}
.home{display:inline-block;margin-top:26px;background:var(--pri);color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px}
</style>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>${
    faqLd ? `
<script type="application/ld+json">${JSON.stringify(faqLd)}</script>` : ""
  }${gaSnippet()}
</head><body><div class="wrap">
<div class="top"><a href="/">${esc(SITE.brandKo)} ${esc(SITE.name)}</a><span style="color:var(--sub)">${esc(data.dateLabel || data.date)}</span></div>
<div class="kick">${esc(a.kicker)}</div>
<h1>${esc(a.title)}</h1>
<div class="by">${[a.source, a.country, a.date, a.read].filter(Boolean).map(esc).join(" · ")}${
    ev ? `<div class="ev">근거 · ${[ev.design, ev.n].filter(Boolean).map(esc).join(" · ")}${ev.note ? ` — ${esc(ev.note)}` : ""}</div>` : ""
  }</div>
<div class="lead">${esc(a.dek)}</div>
${(a.body || []).map(para).join("\n")}
${a.radar?.clinical ? `<div class="note"><div class="lb">임상 메모</div><div class="tx">${esc(a.radar.clinical)}</div></div>` : ""}
${
    a.radar?.owner && (a.radar.owner.q || a.radar.owner.script)
      ? `<div class="qa"><div class="lb">진료실 문답</div>${a.radar.owner.q ? `<p class="q">${esc(a.radar.owner.q)}</p>` : ""}${
          a.radar.owner.script ? `<p>${esc(a.radar.owner.script)}</p>` : ""
        }</div>`
      : ""
  }
${a.blog ? `<div class="qa"><div class="lb">블로그 글감</div><p class="q">${esc(a.blog)}</p>${(a.blogAngle || []).length ? `<ul>${a.blogAngle.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}</div>` : ""}
${
    (() => {
      // 기사 → 허브 링크. 허브가 기사로만 링크하면 단방향이라 클러스터가 되지 않는다.
      const ts = topicsOf(a);
      return ts.length
        ? `<div class="tpc"><b>주제</b> ${ts
            .map((t) => `<a href="${topicPath(t)}">${esc(t.name)}</a>`)
            .join("")}</div>`
        : "";
    })()
  }
<div class="src"><b>원문 출처</b> · ${esc(a.source)}${a.country ? ` · ${esc(a.country)}` : ""}<br>
<a href="${esc(a.sourceUrl)}" target="_blank" rel="noopener nofollow">원문 사이트로 이동 ↗</a>
<div class="dis">${esc(brand)}이 해외 공개 자료를 요약·번역한 콘텐츠이며 임상 정보는 참고용입니다. 적용 전 원문과 최신 문헌을 확인하세요.</div></div>
<div class="nav">${
    prev ? `<a href="${esc(articlePath(prev))}"><div class="l">이전 기사</div><div class="t">${esc(prev.title)}</div></a>` : ""
  }${next ? `<a href="${esc(articlePath(next))}"><div class="l">다음 기사</div><div class="t">${esc(next.title)}</div></a>` : ""}</div>
<a class="home" href="/">${esc(data.dateLabel || data.date)} 브리핑 전체 보기 →</a>
</div></body></html>`;
}

const NOT_FOUND_HTML = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, follow">
<title>페이지를 찾을 수 없습니다 | ${esc(SITE.brandKo)} ${esc(SITE.name)}</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>
  :root{color-scheme:light dark}
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
    font-family:"Pretendard Variable","Apple SD Gothic Neo",system-ui,sans-serif;
    background:#fff;color:#171719;padding:24px;}
  @media (prefers-color-scheme:dark){body{background:#171719;color:#fff}}
  .box{max-width:520px;text-align:center}
  .code{font-size:13px;font-weight:700;letter-spacing:.18em;color:#0066ff;text-transform:uppercase}
  h1{font-size:32px;font-weight:800;letter-spacing:-.02em;margin:14px 0 10px;line-height:1.25}
  p{margin:0 0 24px;font-size:15px;line-height:1.7;opacity:.7}
  a{display:inline-block;background:#0066ff;color:#fff;text-decoration:none;font-weight:700;
    font-size:14px;padding:12px 22px;border-radius:10px}
</style></head>
<body><div class="box">
  <div class="code">404 Not Found</div>
  <h1>페이지를 찾을 수 없습니다</h1>
  <p>주소가 바뀌었거나 삭제된 페이지입니다.<br>오늘의 브리핑에서 최신 소식을 확인해 보세요.</p>
  <a href="/">오늘의 브리핑 보기</a>
</div></body></html>`;

// ── 정책·안내 페이지 ──
// 개인정보처리방침·이용약관은 GA4를 돌리는 시점부터 법적으로 필요하고,
// 광고·제휴 심사에서도 필수 항목이다. 사업자 정보는 LEGAL에 실제 값이
// 들어온 항목만 표기한다(빈 값을 그럴듯하게 채우면 허위표시가 된다).
const legalRow = (label, value) =>
  value ? `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>` : "";

function renderLegalPage({ slug, title, lede, body }) {
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} | ${esc(SITE.name)} · ${esc(SITE.brandKo)}(${esc(SITE.brandEn)})</title>
<meta name="description" content="${esc(lede)}">
<link rel="canonical" href="${SITE.baseUrl}/${slug}">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>
  :root{--bg:#fff;--ink:#171719;--dim:#5c5c61;--line:#e6e6ea;--pri:#0066ff;color-scheme:light dark}
  @media (prefers-color-scheme:dark){:root{--bg:#171719;--ink:#f7f7f8;--dim:#a0a0a8;--line:#2e2e33}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);padding:0 20px 80px;
    font-family:"Pretendard Variable","Apple SD Gothic Neo",system-ui,sans-serif;line-height:1.75;}
  .wrap{max-width:760px;margin:0 auto}
  header{border-bottom:2px solid var(--ink);padding:26px 0 18px;margin-bottom:34px}
  header a{color:var(--ink);text-decoration:none;font-weight:800;font-size:17px;letter-spacing:-.02em}
  h1{font-size:31px;font-weight:800;letter-spacing:-.03em;line-height:1.2;margin:0 0 12px}
  .lede{color:var(--dim);font-size:15px;margin:0 0 8px}
  .date{color:var(--dim);font-size:12.5px;letter-spacing:.03em;margin:0 0 36px}
  h2{font-size:19px;font-weight:800;letter-spacing:-.02em;margin:38px 0 12px;padding-top:18px;border-top:1px solid var(--line)}
  h3{font-size:15.5px;font-weight:700;margin:22px 0 8px}
  p,li{font-size:15px;color:var(--ink)}
  ul{padding-left:20px;margin:10px 0}
  li{margin-bottom:6px}
  table{border-collapse:collapse;width:100%;margin:14px 0;font-size:14.5px}
  th,td{border:1px solid var(--line);padding:10px 12px;text-align:left;vertical-align:top}
  th{width:34%;background:rgba(128,128,128,.07);font-weight:700}
  a{color:var(--pri)}
  .note{border-left:3px solid var(--pri);padding:2px 0 2px 14px;margin:16px 0;color:var(--dim);font-size:14.5px}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);font-size:13px;color:var(--dim)}
  footer a{margin-right:14px}
</style>${gaSnippet()}</head>
<body><div class="wrap">
<header><a href="/">${esc(SITE.name)}</a></header>
<h1>${esc(title)}</h1>
<p class="lede">${esc(lede)}</p>
<p class="date">시행일 ${esc(LEGAL.effectiveDate)}</p>
${body}
<footer>
  <a href="/">오늘의 브리핑</a><a href="/about">서비스 소개</a><a href="/privacy">개인정보처리방침</a><a href="/terms">이용약관</a>
  <div style="margin-top:10px">© ${new Date(LEGAL.effectiveDate).getFullYear()} ${esc(SITE.brandKo)}(${esc(SITE.brandEn)})</div>
</footer>
</div></body></html>`;
}

const LEGAL_TABLE = `<table>
${legalRow("상호 / 운영자", LEGAL.operator)}
${legalRow("대표자", LEGAL.representative)}
${legalRow("사업자등록번호", LEGAL.bizNumber)}
${legalRow("주소", LEGAL.address)}
${legalRow("개인정보 보호책임자", LEGAL.privacyOfficer)}
${legalRow("문의", LEGAL.email)}
</table>`;

const PRIVACY_BODY = `
<p>${esc(SITE.brandKo)}(${esc(SITE.brandEn)})은 «${esc(SITE.name)}»(이하 “서비스”)를 운영하며,
이용자의 개인정보를 개인정보 보호법 등 관계 법령에 따라 보호합니다. 이 방침은 서비스가 어떤 정보를
어떤 목적으로 처리하는지 설명합니다.</p>

<div class="note">이 서비스는 회원가입이 없습니다. 이름·연락처·결제정보를 받지 않으며,
이용자가 직접 입력하는 정보는 (뉴스레터를 신청하는 경우의) 이메일 주소가 유일합니다.</div>

<h2>1. 수집하는 개인정보 항목과 방법</h2>
<h3>가. 자동으로 수집되는 정보</h3>
<p>서비스는 방문 통계 분석을 위해 Google Analytics 4를 사용합니다. 이 과정에서 아래 정보가
쿠키 및 유사 기술을 통해 자동으로 수집됩니다.</p>
<ul>
  <li>접속 기기·브라우저·운영체제 정보, 화면 크기</li>
  <li>접속 국가·지역(도시 단위까지의 대략적 위치)</li>
  <li>방문 일시, 열람한 페이지와 기사, 체류 시간, 유입 경로(검색어·참조 사이트)</li>
  <li>IP 주소 — Google Analytics 4는 IP 주소를 저장하지 않고 위치 추정에만 사용한 뒤 폐기합니다.</li>
</ul>
<h3>나. 이용자가 직접 제공하는 정보</h3>
<ul>
  <li>뉴스레터 신청 시: 이메일 주소 (신청 시점에 별도로 동의를 받습니다)</li>
  <li>문의 메일 발송 시: 이용자가 메일에 기재한 내용</li>
</ul>
<h3>다. 브라우저에만 저장되고 서버로 전송되지 않는 정보</h3>
<p>읽은 기사 표시, 저장한 기사, 글감함, 다크 모드·글자 크기 설정은 이용자의 브라우저
로컬 스토리지에만 저장됩니다. 서비스 운영자는 이 값을 수집하거나 열람할 수 없으며,
브라우저 데이터를 삭제하면 함께 지워집니다.</p>

<h2>2. 개인정보의 처리 목적</h2>
<ul>
  <li>서비스 이용 현황 분석 및 콘텐츠 개선</li>
  <li>오류·장애 원인 파악과 대응</li>
  <li>뉴스레터 발송 (신청자에 한함)</li>
  <li>문의에 대한 회신</li>
</ul>
<p>수집한 정보는 위 목적 외의 용도로 이용하지 않으며, 목적이 변경되는 경우 별도의 동의를 받습니다.</p>

<h2>3. 보유 및 이용 기간</h2>
<table>
<tr><th>항목</th><td>보유 기간</td></tr>
<tr><th>Google Analytics 4 방문 데이터</th><td>수집일로부터 14개월 (경과 후 자동 삭제)</td></tr>
<tr><th>뉴스레터 이메일 주소</th><td>구독 해지 요청 시 지체 없이 파기</td></tr>
<tr><th>문의 메일</th><td>처리 완료 후 1년</td></tr>
</table>

<h2>4. 개인정보의 제3자 제공</h2>
<p>서비스는 이용자의 개인정보를 제3자에게 판매하거나 제공하지 않습니다.
다만 법령에 근거한 수사기관의 적법한 요청이 있는 경우에는 예외로 합니다.</p>

<h2>5. 개인정보 처리의 위탁 및 국외 이전</h2>
<p>서비스 운영을 위해 아래 사업자의 인프라를 이용하며, 이 과정에서 정보가 국외에 저장·처리됩니다.</p>
<table>
<tr><th>수탁자</th><td>위탁 업무 / 이전 항목 / 보관 국가</td></tr>
<tr><th>Google LLC</th><td>방문 통계 분석(Google Analytics 4) / 쿠키 식별자·기기 정보·이용 기록 / 미국</td></tr>
<tr><th>Cloudflare, Inc.</th><td>웹사이트 호스팅 및 콘텐츠 전송 / 접속 IP·요청 기록 / 미국 등 글로벌 엣지 노드</td></tr>
</table>
<p>이용자는 국외 이전을 거부할 수 있으며, 거부하려면 아래 6항의 방법으로 분석 쿠키 수집을 차단하시면 됩니다.
다만 이 경우에도 사이트 열람 자체는 정상적으로 가능합니다.</p>

<h2>6. 쿠키의 사용과 거부 방법</h2>
<p>서비스는 방문 통계를 위한 분석 쿠키를 사용합니다. 광고 목적의 쿠키는 사용하지 않습니다.</p>
<ul>
  <li>브라우저 설정에서 쿠키 저장을 거부하거나 삭제할 수 있습니다.
    (Chrome: 설정 → 개인정보 보호 및 보안 → 서드파티 쿠키)</li>
  <li>Google이 제공하는
    <a href="https://tools.google.com/dlpage/gaoptout" rel="nofollow noopener" target="_blank">Google Analytics 차단 브라우저 부가기능</a>을
    설치하면 분석 데이터 수집을 차단할 수 있습니다.</li>
</ul>

<h2>7. 정보주체의 권리와 행사 방법</h2>
<p>이용자는 언제든지 자신의 개인정보에 대해 열람·정정·삭제·처리정지를 요구할 수 있습니다.
아래 문의처로 요청하시면 지체 없이 조치하고 결과를 알려드립니다.
법정대리인이나 위임을 받은 자를 통해서도 요구할 수 있습니다.</p>

<h2>8. 개인정보의 파기</h2>
<p>보유 기간이 지나거나 처리 목적이 달성된 개인정보는 지체 없이 파기합니다.
전자적 파일은 복구할 수 없는 방법으로 영구 삭제하고, 출력물은 분쇄하거나 소각합니다.</p>

<h2>9. 안전성 확보 조치</h2>
<ul>
  <li>전 구간 HTTPS 암호화 통신</li>
  <li>개인정보 처리 시스템에 대한 접근 권한 최소화</li>
  <li>수집 항목 자체를 최소화하는 설계(회원가입·결제 기능 없음)</li>
</ul>

<h2>10. 개인정보 보호책임자 및 문의처</h2>
${LEGAL_TABLE}
<p>개인정보 침해로 인한 신고·상담이 필요하면 아래 기관에 문의할 수 있습니다.</p>
<ul>
  <li>개인정보침해신고센터 (privacy.kisa.or.kr / 국번없이 118)</li>
  <li>개인정보 분쟁조정위원회 (kopico.go.kr / 1833-6972)</li>
  <li>대검찰청 사이버수사과 (spo.go.kr / 1301)</li>
  <li>경찰청 사이버수사국 (ecrm.police.go.kr / 국번없이 182)</li>
</ul>

<h2>11. 방침의 변경</h2>
<p>법령이나 서비스 내용의 변경에 따라 이 방침이 개정될 수 있습니다.
변경 시 시행일과 변경 내용을 이 페이지에 게시합니다.</p>`;

const TERMS_BODY = `
<p>이 약관은 ${esc(SITE.brandKo)}(${esc(SITE.brandEn)})이 제공하는 «${esc(SITE.name)}»(이하 “서비스”)의
이용 조건을 정합니다.</p>

<h2>1. 서비스의 성격</h2>
<p>서비스는 해외에 공개된 수의학 관련 뉴스·학술 자료를 수집해 한국어로 요약·정리하고,
한국 동물병원 관점의 참고 정보를 덧붙여 매일 제공하는 무료 정보 서비스입니다.
회원가입 없이 누구나 열람할 수 있습니다.</p>

<h2>2. 콘텐츠 생성 방식의 고지</h2>
<p>서비스의 기사 요약과 번역에는 인공지능 언어모델이 사용되며, 발행 전 자동 검증과
편집자 검수를 거칩니다. 그럼에도 원문의 의미가 축약·변형되거나 오역이 포함될 수 있으므로,
<strong>모든 기사에는 원문 출처와 링크를 함께 표기합니다.</strong>
정확한 내용은 반드시 원문을 확인하시기 바랍니다.</p>

<h2>3. 임상 정보에 관한 면책</h2>
<div class="note">서비스가 제공하는 내용은 <strong>정보 제공을 목적으로 한 참고 자료이며,
수의학적 진단·처방·치료 지침이 아닙니다.</strong> 특정 환자에 대한 진료 판단은 담당 수의사의
책임 아래 이루어져야 하며, 서비스는 그 판단의 근거로 사용될 수 없습니다.</div>
<p>서비스는 게재된 정보의 정확성·완전성·최신성을 보증하지 않으며,
이용자가 서비스의 내용을 근거로 내린 판단이나 그로 인해 발생한 결과에 대해 책임을 지지 않습니다.
약물의 용법·용량, 국내 허가 사항, 관련 법령은 반드시 국내 공식 자료로 확인하시기 바랍니다.</p>

<h2>4. 저작권</h2>
<h3>가. 원문 저작물</h3>
<p>각 기사에 표기된 원문의 저작권은 해당 매체·저자에게 있습니다. 서비스는 원문을 전재하지 않고
요약·인용의 범위에서 다루며, 언제나 출처와 원문 링크를 함께 제공합니다.
원문 권리자가 게재 중단을 요청하는 경우 확인 후 지체 없이 삭제합니다.</p>
<h3>나. 서비스가 생산한 저작물</h3>
<p>기사 요약문, 진료 점검 포인트, 보호자 설명 대본, 근거 등급 평가 등 서비스가 직접 작성한
편집 저작물의 권리는 ${esc(SITE.brandKo)}에 있습니다. 출처를 밝힌 인용은 허용하나,
무단 복제·배포·크롤링을 통한 대량 수집 및 상업적 재판매는 금지합니다.</p>

<h2>5. 금지 행위</h2>
<ul>
  <li>자동화된 수단으로 서비스에 과도한 부하를 유발하는 행위</li>
  <li>콘텐츠를 무단으로 대량 복제해 재배포하거나 재판매하는 행위</li>
  <li>서비스의 내용을 왜곡해 인용하거나, 서비스가 보증한 것처럼 표시하는 행위</li>
  <li>서비스의 정상적인 운영을 방해하는 일체의 행위</li>
</ul>

<h2>6. 서비스의 변경 및 중단</h2>
<p>서비스는 운영상·기술상의 필요에 따라 제공 내용을 변경하거나 중단할 수 있습니다.
무료로 제공되는 서비스의 변경·중단으로 발생한 손해에 대해서는 책임을 지지 않습니다.</p>

<h2>7. 광고 및 제휴</h2>
<p>향후 서비스에 광고나 유료 제휴 콘텐츠가 게재될 수 있습니다. 이 경우
<strong>해당 콘텐츠에는 “광고” 또는 “제휴”임을 명확히 표기</strong>하며,
편집 기사와 시각적으로 구분합니다. 광고주는 편집 내용에 관여하지 않습니다.</p>

<h2>8. 정정 요청</h2>
<p>사실관계 오류나 오역을 발견하신 경우 아래 문의처로 알려주시면 확인 후 정정하고,
정정 사실을 해당 기사에 표기합니다.</p>

<h2>9. 준거법 및 관할</h2>
<p>이 약관은 대한민국 법령에 따라 해석되며, 서비스 이용과 관련한 분쟁은
민사소송법에 따른 관할 법원에 제기합니다.</p>

<h2>10. 문의</h2>
${LEGAL_TABLE}`;

const ABOUT_BODY = `
<p>«${esc(SITE.name)}»은 ${esc(SITE.brandKo)}(${esc(SITE.brandEn)})이 만드는
한국 동물병원 대상 해외 수의 정보 브리핑입니다. 매일 아침 발행합니다.</p>

<h2>왜 만들었나</h2>
<p>해외에서는 새 진단법·치료 프로토콜·보호자 트렌드가 매일 쏟아지지만, 한국 임상의가
그것을 따라 읽을 시간은 없습니다. 그 사이 보호자는 이미 유튜브와 해외 커뮤니티에서 그 소식을
접하고 진료실에서 질문합니다. 이 서비스는 <strong>그 시차를 메우는 조기경보 레이더</strong>를
목표로 합니다.</p>

<h2>어떻게 만드나</h2>
<h3>1. 수집</h3>
<p>해외 수의 전문 매체와 동료심사 저널의 공개 피드, 그리고 PubMed의 수의학 분야
문헌을 매일 자동으로 수집합니다. 현재 수의 전문 미디어·학술지 15곳의 직접 피드,
주제별 뉴스 검색 46종, PubMed 세부 분과 22종을 훑습니다.</p>
<h3>2. 선별</h3>
<p>수집된 후보 중 한국 동물병원의 진료·경영과 관련성이 높은 것만 남깁니다.
광고성 보도자료, 특정 제품 홍보, 국내 적용 가능성이 없는 지역 뉴스는 제외합니다.</p>
<h3>3. 정리와 검증</h3>
<p>선별된 자료를 한국어로 요약하고, 아래 항목을 덧붙입니다. 이 부분이 단순 번역과
다른 이 서비스의 본체입니다.</p>
<ul>
  <li><strong>진료 포인트</strong> — 이 소식을 진료·병원 운영에 어떻게 반영할지 한 줄</li>
  <li><strong>보호자 레이더</strong> — 곧 진료실에서 나올 질문과, 거기에 답하는 설명 대본</li>
  <li><strong>근거 등급</strong> — 논문의 연구 설계·표본 수와 임상 적용 시 한계</li>
</ul>
<h3>4. 발행</h3>
<p>모든 기사에 원문 매체·발행일·원문 링크를 표기합니다. 원문을 전재하지 않습니다.</p>

<h2>인공지능 사용에 대하여</h2>
<p>번역과 요약 과정에 인공지능 언어모델을 사용합니다. 이를 숨기지 않고 밝히는 이유는,
독자가 정보의 성격을 알고 판단해야 한다고 보기 때문입니다.
자동 검증(외국어 혼입·문체·용어 검사)과 편집자 검수를 거치지만
오역이나 축약이 있을 수 있으므로, 임상 판단에 사용하실 내용은 반드시 원문을 확인해 주십시오.</p>

<h2>정정과 삭제 요청</h2>
<p>사실관계 오류, 오역, 원문 권리자의 게재 중단 요청은 아래 문의처로 접수합니다.
확인 후 지체 없이 조치하고 그 사실을 기사에 표기합니다.</p>

<h2>운영 정보</h2>
${LEGAL_TABLE}
<p><a href="/privacy">개인정보처리방침</a> · <a href="/terms">이용약관</a></p>`;

const LEGAL_PAGES = [
  {
    slug: "privacy",
    title: "개인정보처리방침",
    lede: `${SITE.name}가 어떤 정보를 어떤 목적으로 처리하고 언제 파기하는지 안내합니다.`,
    body: PRIVACY_BODY,
  },
  {
    slug: "terms",
    title: "이용약관",
    lede: "서비스의 성격, 콘텐츠 생성 방식, 임상 정보 면책, 저작권 원칙을 정합니다.",
    body: TERMS_BODY,
  },
  {
    slug: "about",
    title: "서비스 소개",
    lede: "무엇을 어떻게 수집하고 검증해 발행하는지, 인공지능을 어디에 쓰는지 밝힙니다.",
    body: ABOUT_BODY,
  },
];

// ── 주제 허브 ──
// 날짜 축으로만 쌓인 기사에 주제 축을 하나 더 얹는다. 검색은 "고양이 신장병 식이"로
// 들어오지 "07-21 브리핑"으로 들어오지 않는다.
//
// 허브에 싣는 것은 전부 이미 검증된 자료의 재배열이다 — 진료 포인트·보호자 문답·
// 근거 등급을 주제별로 모을 뿐, 새 임상 주장을 만들어내지 않는다.
const topicPath = (t) => `/topic/${t.slug}`;

// 본문 전체를 매칭하면 오탐이 쏟아진다 — 광견병 예방접종 기사가 본문에 '급여'가
// 한 번 나왔다고 영양 주제로 분류되는 식이다. 제목·리드·진료 포인트를 1차로 쓰고,
// 거기서 하나도 안 걸린 기사만 본문으로 폴백하되 한 주제만 준다.
function topicsOf(a) {
  const meta = [a.title, a.dek, a.radar?.clinical].filter(Boolean).join(" ");
  const hit = TOPICS.filter((t) => t.match.test(meta));
  if (hit.length) return hit.slice(0, 3);
  const body = (a.body || []).join(" ");
  return TOPICS.filter((t) => t.match.test(body)).slice(0, 1);
}

// 같은 문장이 여러 기사에 반복되면 목록이 지저분해진다. 앞 24자로 중복을 거른다.
function dedupeBy(arr, keyFn, limit) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = keyFn(x);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    if (limit && out.length >= limit) break;
  }
  return out;
}

function renderTopicPage(topic, arts) {
  const canonical = `${SITE.baseUrl}${topicPath(topic)}`;
  const brand = `${SITE.brandKo}(${SITE.brandEn})`;
  const title = `${topic.name} — 해외 수의 소식 모음 | ${SITE.name} · ${SITE.brandKo}`;
  const desc = `${topic.lede} ${brand}이 정리한 ${arts.length}건.`.slice(0, 200);

  const clinical = dedupeBy(
    arts.filter((a) => a.radar?.clinical),
    (a) => a.radar.clinical.slice(0, 24),
    12
  );
  const qas = dedupeBy(
    arts.filter((a) => a.radar?.owner?.q && a.radar?.owner?.script),
    (a) => a.radar.owner.q.slice(0, 24),
    8
  );
  const papers = arts.filter((a) => a.radar?.evidence);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: `${topic.name} — 해외 수의 소식 모음`,
    description: topic.lede,
    url: canonical,
    inLanguage: "ko",
    isPartOf: { "@type": "WebSite", name: SITE.name, url: SITE.baseUrl },
    publisher: { "@type": "Organization", name: SITE.brandKo, alternateName: SITE.brandEn, url: SITE.baseUrl },
    mainEntity: {
      "@type": "ItemList",
      numberOfItems: arts.length,
      itemListElement: arts.slice(0, 50).map((a, i) => ({
        "@type": "ListItem",
        position: i + 1,
        url: `${SITE.baseUrl}${articlePath(a)}`,
        name: a.title,
      })),
    },
  };
  const faqLd = qas.length
    ? {
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: qas.map((a) => ({
          "@type": "Question",
          name: a.radar.owner.q,
          acceptedAnswer: { "@type": "Answer", text: a.radar.owner.script },
        })),
      }
    : null;

  const sec = (t, inner) =>
    inner
      ? `<h2>${esc(t)}</h2>${inner}`
      : "";

  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${canonical}">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<meta property="og:type" content="website">
<meta property="og:title" content="${esc(topic.name)} — 해외 수의 소식 모음">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="${esc(SITE.name)}">
<style>
  :root{--bg:#fff;--ink:#171719;--dim:#5c5c61;--line:#e6e6ea;--pri:#0066ff;--tint:#f5f6f8;color-scheme:light dark}
  @media (prefers-color-scheme:dark){:root{--bg:#171719;--ink:#f7f7f8;--dim:#a0a0a8;--line:#2e2e33;--tint:#1f1f23}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);padding:0 20px 80px;
    font-family:"Pretendard Variable","Apple SD Gothic Neo",system-ui,sans-serif;line-height:1.7}
  .wrap{max-width:860px;margin:0 auto}
  header{border-bottom:2px solid var(--ink);padding:24px 0 16px;margin-bottom:30px;
    display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
  header a.brand{color:var(--ink);text-decoration:none;font-weight:800;font-size:17px;letter-spacing:-.02em}
  header nav a{color:var(--dim);text-decoration:none;font-size:13px;font-weight:600;margin-left:14px}
  h1{font-size:34px;font-weight:800;letter-spacing:-.03em;line-height:1.18;margin:0 0 10px}
  .lede{color:var(--dim);font-size:16px;margin:0 0 6px}
  .meta{color:var(--dim);font-size:12.5px;letter-spacing:.03em;margin:0 0 34px}
  h2{font-size:19px;font-weight:800;letter-spacing:-.02em;margin:38px 0 14px;padding-top:18px;border-top:1px solid var(--line)}
  ul{padding-left:0;list-style:none;margin:0}
  li{margin-bottom:14px}
  .pt{background:var(--tint);border-left:3px solid var(--pri);padding:12px 14px;border-radius:0 8px 8px 0;font-size:14.5px}
  .pt a{color:var(--dim);text-decoration:none;font-size:12px;display:block;margin-top:6px}
  .qa{border:1px solid var(--line);border-radius:10px;padding:14px 16px}
  .qa .q{font-weight:700;font-size:15px;margin:0 0 6px}
  .qa .a{font-size:14px;color:var(--dim);margin:0}
  .art a{color:var(--ink);text-decoration:none;font-weight:700;font-size:16px;line-height:1.4}
  .art a:hover{color:var(--pri)}
  .art .sub{color:var(--dim);font-size:12.5px;margin-top:3px}
  .stars{color:var(--pri);font-size:12px;font-weight:700}
  .topics{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
  .topics a{font-size:13px;font-weight:600;color:var(--dim);text-decoration:none;
    border:1px solid var(--line);border-radius:999px;padding:6px 13px}
  footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line);font-size:13px;color:var(--dim)}
  footer a{color:var(--dim);margin-right:14px}
</style>
<script type="application/ld+json">${JSON.stringify(jsonLd)}</script>${
    faqLd ? `\n<script type="application/ld+json">${JSON.stringify(faqLd)}</script>` : ""
  }${gaSnippet()}</head>
<body><div class="wrap">
<header><a class="brand" href="/">${esc(SITE.name)}</a>
<nav><a href="/topic/">주제별 보기</a><a href="/about">서비스 소개</a></nav></header>
<h1>${esc(topic.name)}</h1>
<p class="lede">${esc(topic.lede)}</p>
<p class="meta">기사 ${arts.length}건${papers.length ? ` · 근거 있는 연구 ${papers.length}건` : ""}${
    qas.length ? ` · 보호자 문답 ${qas.length}건` : ""
  }</p>

${sec(
  "진료 포인트 모음",
  clinical.length
    ? `<ul>${clinical
        .map(
          (a) =>
            `<li class="pt">${esc(a.radar.clinical)}<a href="${esc(articlePath(a))}">→ ${esc(a.title)}</a></li>`
        )
        .join("")}</ul>`
    : ""
)}

${sec(
  "보호자가 묻는 것",
  qas.length
    ? `<ul>${qas
        .map(
          (a) =>
            `<li class="qa"><p class="q">${esc(a.radar.owner.q)}</p><p class="a">${esc(
              a.radar.owner.script
            )}</p></li>`
        )
        .join("")}</ul>`
    : ""
)}

${sec(
  "근거 있는 연구",
  papers.length
    ? `<ul>${papers
        .map(
          (a) =>
            `<li class="art"><a href="${esc(articlePath(a))}">${esc(a.title)}</a>
<div class="sub"><span class="stars">${"★".repeat(a.radar.evidence.stars)}${"☆".repeat(
              4 - a.radar.evidence.stars
            )}</span> ${esc([a.radar.evidence.design, a.radar.evidence.n].filter(Boolean).join(" · "))} — ${esc(
              a.source
            )}</div></li>`
        )
        .join("")}</ul>`
    : ""
)}

<h2>전체 기사 ${arts.length}건</h2>
<ul>${arts
    .map(
      (a) =>
        `<li class="art"><a href="${esc(articlePath(a))}">${esc(a.title)}</a>
<div class="sub">${esc([a.date, a.source, a.country].filter(Boolean).join(" · "))}</div></li>`
    )
    .join("")}</ul>

<h2>다른 주제</h2>
<div class="topics">${TOPICS.filter((t) => t.slug !== topic.slug)
    .map((t) => `<a href="${topicPath(t)}">${esc(t.name)}</a>`)
    .join("")}</div>

<footer>
  <a href="/">오늘의 브리핑</a><a href="/topic/">주제별 보기</a><a href="/about">서비스 소개</a><a href="/privacy">개인정보처리방침</a><a href="/terms">이용약관</a>
  <div style="margin-top:10px">© ${new Date(LEGAL.effectiveDate).getFullYear()} ${esc(SITE.brandKo)}(${esc(
    SITE.brandEn
  )})</div>
</footer>
</div></body></html>`;
}

function renderTopicIndex(counts) {
  const canonical = `${SITE.baseUrl}/topic/`;
  const rows = TOPICS.filter((t) => counts[t.slug])
    .sort((a, b) => counts[b.slug] - counts[a.slug])
    .map(
      (t) =>
        `<li><a href="${topicPath(t)}"><b>${esc(t.name)}</b> <span>${counts[t.slug]}건</span></a>
<div>${esc(t.lede)}</div></li>`
    )
    .join("");
  return `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>주제별 보기 | ${esc(SITE.name)} · ${esc(SITE.brandKo)}</title>
<meta name="description" content="${esc(SITE.brandKo)}이 정리한 해외 수의 소식을 임상 주제별로 모아 봅니다.">
<link rel="canonical" href="${canonical}">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>
  :root{--bg:#fff;--ink:#171719;--dim:#5c5c61;--line:#e6e6ea;--pri:#0066ff;color-scheme:light dark}
  @media (prefers-color-scheme:dark){:root{--bg:#171719;--ink:#f7f7f8;--dim:#a0a0a8;--line:#2e2e33}}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);padding:0 20px 80px;
    font-family:"Pretendard Variable","Apple SD Gothic Neo",system-ui,sans-serif;line-height:1.7}
  .wrap{max-width:800px;margin:0 auto}
  header{border-bottom:2px solid var(--ink);padding:24px 0 16px;margin-bottom:30px}
  header a{color:var(--ink);text-decoration:none;font-weight:800;font-size:17px;letter-spacing:-.02em}
  h1{font-size:32px;font-weight:800;letter-spacing:-.03em;margin:0 0 10px}
  .lede{color:var(--dim);font-size:15px;margin:0 0 34px}
  ul{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
  li{border:1px solid var(--line);border-radius:12px;padding:16px 18px}
  li a{text-decoration:none;color:var(--ink);font-size:17px}
  li a span{color:var(--pri);font-size:13px;font-weight:700;margin-left:6px}
  li div{color:var(--dim);font-size:13.5px;margin-top:6px}
  footer{margin-top:48px;padding-top:20px;border-top:1px solid var(--line);font-size:13px;color:var(--dim)}
  footer a{color:var(--dim);margin-right:14px}
</style>${gaSnippet()}</head>
<body><div class="wrap">
<header><a href="/">${esc(SITE.name)}</a></header>
<h1>주제별 보기</h1>
<p class="lede">해외 수의 소식을 임상 주제로 묶었습니다. 각 주제마다 진료 포인트, 보호자가 묻는 것, 근거 있는 연구를 함께 정리했습니다.</p>
<ul>${rows}</ul>
<footer><a href="/">오늘의 브리핑</a><a href="/about">서비스 소개</a><a href="/privacy">개인정보처리방침</a><a href="/terms">이용약관</a></footer>
</div></body></html>`;
}

function buildSitemap(issues, weeklies = [], extraUrls = [], extraTopics = []) {
  // 확장자 없는 주소로 — .html은 308 리다이렉트라 색인 신호가 분산된다
  const urls = [
    `${SITE.baseUrl}/`,
    ...issues.map((i) => `${SITE.baseUrl}/issues/${labelOf(i)}`),
    // 주간 다이제스트가 색인에서 통째로 빠져 있었다
    ...weeklies.map((w) => `${SITE.baseUrl}/weekly/${labelOf(w)}`),
    ...LEGAL_PAGES.map((p) => `${SITE.baseUrl}/${p.slug}`),
    `${SITE.baseUrl}/topic/`,
    ...(extraTopics || []),
    ...extraUrls,
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
    <link>${SITE.baseUrl}/issues/${labelOf(i)}</link>
    <guid>${SITE.baseUrl}/issues/${labelOf(i)}</guid>
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
  const articleUrls = [];
  const topicBuckets = {};
  fs.mkdirSync(path.join(SITE_DIR, "article"), { recursive: true });
  for (const issue of issues) {
    const data = buildIssueData(issue);
    fs.writeFileSync(path.join(SITE_DIR, "issues", `${labelOf(issue)}.html`), renderPage(issue, issues));
    fs.writeFileSync(path.join(SITE_DIR, "data", `${labelOf(issue)}.json`), JSON.stringify(data));
    archive.push({ date: data.date, dateLabel: data.dateLabel, count: data.count, titles: data.articles.slice(0, 3).map((a) => a.title) });

    // 기사별 개별 페이지 — 색인 면적을 날짜 단위에서 기사 단위로 넓힌다
    const all = [...data.articles, ...(data.stories || [])];
    all.forEach((a, i) => {
      fs.writeFileSync(
        path.join(SITE_DIR, "article", `${articleSlug(a)}.html`),
        renderArticlePage(a, data, all[i - 1] || null, all[i + 1] || null)
      );
      if (isIndexable(a)) {
        articleUrls.push(`${SITE.baseUrl}${articlePath(a)}`);
        // 색인 대상 기사만 허브에 싣는다 — 허브가 저품질 페이지로 가는 통로가 되면
        // 어렵게 뺀 noindex 처리가 무의미해진다
        for (const t of topicsOf(a)) (topicBuckets[t.slug] ||= []).push(a);
      }
    });
  }

  // ── 주제 허브 ──
  fs.mkdirSync(path.join(SITE_DIR, "topic"), { recursive: true });
  const topicCounts = {};
  const topicUrls = [];
  for (const t of TOPICS) {
    const arts = topicBuckets[t.slug] || [];
    // 3건 미만이면 페이지를 만들지 않는다. 얇은 허브는 그 자체가 저품질 신호다
    if (arts.length < 3) continue;
    arts.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
    topicCounts[t.slug] = arts.length;
    fs.writeFileSync(path.join(SITE_DIR, "topic", `${t.slug}.html`), renderTopicPage(t, arts));
    topicUrls.push(`${SITE.baseUrl}${topicPath(t)}`);
  }
  fs.writeFileSync(path.join(SITE_DIR, "topic", "index.html"), renderTopicIndex(topicCounts));
  console.log(`  주제 허브 ${topicUrls.length}개 생성`);

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
  fs.writeFileSync(path.join(SITE_DIR, "sitemap.xml"), buildSitemap(issues, weeklies, articleUrls, topicUrls));
  fs.writeFileSync(path.join(SITE_DIR, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${SITE.baseUrl}/sitemap.xml\n`);
  // 404.html이 없으면 Cloudflare Pages가 없는 경로에도 200을 반환해(soft 404)
  // 검색엔진이 빈 페이지를 색인한다. 실제 404 상태로 응답하도록 페이지를 둔다.
  fs.writeFileSync(path.join(SITE_DIR, "404.html"), NOT_FOUND_HTML);
  // 정책·안내 페이지 — GA4를 돌리는 이상 개인정보처리방침은 선택이 아니다
  for (const pg of LEGAL_PAGES) {
    fs.writeFileSync(path.join(SITE_DIR, `${pg.slug}.html`), renderLegalPage(pg));
  }
  // IndexNow 소유 증명 키 파일 — 매 빌드마다 유지되어야 제출이 계속 유효하다
  if (SITE.indexNowKey) {
    fs.writeFileSync(path.join(SITE_DIR, `${SITE.indexNowKey}.txt`), SITE.indexNowKey);
  }
  // 네이버 소유확인 'HTML 파일 업로드' 방식 대응 — 메타태그와 병행 가능하다.
  // Cloudflare Pages가 /foo.html을 /foo로 308 리다이렉트하는데, 검증 봇이
  // 리다이렉트를 따라가지 않을 수 있어 _redirects의 200 rewrite로 원본 주소에서
  // 바로 200이 나오게 한다(확장자 없는 파일에 내용을 두고 rewrite).
  if (SITE.verification?.naver) {
    const code = SITE.verification.naver;
    const body = `naver-site-verification: naver${code}.html`;
    fs.writeFileSync(path.join(SITE_DIR, "_nv.txt"), body);
    fs.writeFileSync(path.join(SITE_DIR, `naver${code}.html`), body); // 폴백
    fs.writeFileSync(path.join(SITE_DIR, "_redirects"), `/naver${code}.html /_nv.txt 200\n`);
  }
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
