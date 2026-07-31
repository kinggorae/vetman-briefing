// 로컬 검수 UI. 기사 본문·원문·자동 대조 결과를 한 화면에 놓는다.
//
// 자동 대조는 판정이 아니라 '먼저 볼 곳' 표시다. 수치가 원문에 없다고 해서
// 틀린 것은 아니고(단위 환산·서술형 표기), 반대로 표시가 없다고 맞는 것도
// 아니다. 사람이 확인하는 시간을 줄이는 용도이며 체크는 사람이 켠다.
//
// 승인·반려는 이 서버가 직접 파일을 고치지 않고 scripts/review-cli.js를
// 그대로 실행한다. 승인 규칙(reviewBlockers)과 감사 로그(reviews.jsonl)가
// CLI와 어긋나면 안 되기 때문이다.
//
// 실행: npm run review:ui   →  http://127.0.0.1:8899
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { CHECKLIST_KEYS, requiredReviewRole, reviewPriority, workflowLabel } from "../src/lib/editorial-operations.js";
import { inferClinicalRisk } from "../src/lib/editorial-review.js";
import { normalizeContentTier } from "../src/lib/quality.js";
import { fetchArticleMeta, articleTextQuality } from "../src/article.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES = path.join(ROOT, "data", "issues");
const PEOPLE = path.join(ROOT, "data", "editorial", "people.json");
const PORT = Number(process.env.REVIEW_UI_PORT) || 8899;

const CHECK_LABELS = {
  sourceConfirmed: "원문 확인 — 같은 기사인지",
  titleLeadBodyChecked: "제목·리드·본문이 원문과 어긋나지 않는지",
  numbersChecked: "수치가 원문과 일치하는지",
  speciesAndStudyChecked: "대상 종과 연구 설계",
  limitationsChecked: "한계·불확실성을 뭉개지 않았는지",
  clinicalLanguageChecked: "임상 단정·처방 지시로 읽히지 않는지",
};

// 한국어 표기 → 원문에서 찾을 영어 표현
const SPECIES = {
  "개": ["dog", "canine", "puppy"], "강아지": ["dog", "puppy", "canine"],
  "고양이": ["cat", "feline", "kitten"], "말": ["horse", "equine", "foal"],
  "소": ["cattle", "bovine", "cow", "calf"], "돼지": ["pig", "swine", "porcine"],
  "가금": ["poultry", "chicken", "avian"], "조류": ["avian", "bird", "poultry"],
  "토끼": ["rabbit"], "페럿": ["ferret"],
};
const DIRECTIVE = /(권고|권장|투여|용량|처방|처치|치료해야|진단해야|응급 처치|반드시 .{0,12}해야)/g;

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } };
const people = () => { const v = readJson(PEOPLE, { people: [] }); return Array.isArray(v) ? v : v.people || []; };
const QUEUE_STATUSES = new Set(["legacy-published", "draft", "automated", "editor-review-required", "vet-review-required", "correction-required"]);

function articleRows() {
  const rows = [];
  const files = fs.existsSync(ISSUES) ? fs.readdirSync(ISSUES).filter((f) => /^\d{4}-\d{2}-\d{2}(?:\.draft)?\.json$/.test(f)).sort() : [];
  for (const file of files) {
    const issue = readJson(path.join(ISSUES, file), null);
    if (!issue || !Array.isArray(issue.items)) continue;
    issue.items.forEach((item, index) => rows.push({ item, file, index, date: issue.date || file.slice(0, 10), published: issue.status === "published" && !file.endsWith(".draft.json") }));
  }
  return rows;
}

function loadQueue() {
  const out = [];
  for (const row of articleRows()) {
    const { item } = row;
    const status = item.workflowStatus || (row.published ? "legacy-published" : "draft");
    if (!QUEUE_STATUSES.has(status)) continue;
    const risk = item.clinicalRisk || inferClinicalRisk(item);
    out.push({
      id: item.id || `${row.date}_${row.index + 1}`, date: row.date,
      status, statusLabel: workflowLabel(status), risk,
      requiredRole: requiredReviewRole({ ...item, clinicalRisk: risk }),
      tier: normalizeContentTier(item),
      priority: reviewPriority({ ...item, clinicalRisk: risk, workflowStatus: status }, { legacyIndex: status === "legacy-published" }),
      sourceLabel: item.sourceLabel || "", sourceUrl: item.sourceUrl || item.sourceUrlRaw || null,
      titleKo: item.titleKo || "", leadKo: item.leadKo || "",
      bodyKo: Array.isArray(item.bodyKo) ? item.bodyKo : [],
      keyPointsKo: Array.isArray(item.keyPointsKo) ? item.keyPointsKo : [],
      sourceTitle: item.sourceTitle || "",
    });
  }
  return out.sort((a, b) => b.priority - a.priority || String(b.date).localeCompare(String(a.date)));
}

const numerals = (text) => new Set((String(text).match(/\d+(?:[.,]\d+)?/g) || []).map((n) => n.replace(/,/g, "")));

// 한국어 본문의 수치 중 원문에서 같은 숫자를 찾지 못한 것 — 먼저 볼 곳 표시
function numberFindings(korean, source) {
  const src = numerals(source);
  const seen = new Set();
  const out = [];
  const re = /\d+(?:[.,]\d+)?/g;
  let m;
  while ((m = re.exec(korean))) {
    const value = m[0].replace(/,/g, "");
    if (src.has(value) || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, context: korean.slice(Math.max(0, m.index - 28), m.index + m[0].length + 28).replace(/\s+/g, " ") });
  }
  return out.slice(0, 12);
}

function speciesFindings(korean, source) {
  const lower = source.toLowerCase();
  const out = [];
  for (const [ko, terms] of Object.entries(SPECIES)) {
    if (!korean.includes(ko)) continue;
    if (!terms.some((t) => lower.includes(t))) out.push({ ko, expected: terms.join(", ") });
  }
  return out;
}

function directiveFindings(korean) {
  const out = [];
  const seen = new Set();
  let m;
  DIRECTIVE.lastIndex = 0;
  while ((m = DIRECTIVE.exec(korean))) {
    if (seen.has(m[0])) continue;
    seen.add(m[0]);
    out.push({ term: m[0], context: korean.slice(Math.max(0, m.index - 30), m.index + m[0].length + 30).replace(/\s+/g, " ") });
  }
  return out.slice(0, 8);
}

// 한국어 본문에 등장하는 라틴 문자 고유명사 중 원문에 없는 것
function latinFindings(korean, source) {
  const lower = source.toLowerCase();
  const seen = new Set();
  const out = [];
  for (const t of korean.match(/[A-Z][A-Za-z.\-]{2,}/g) || []) {
    const key = t.toLowerCase().replace(/[.\-]+$/, "");
    if (seen.has(key) || key.length < 3) continue;
    seen.add(key);
    if (!lower.includes(key)) out.push(t);
  }
  return out.slice(0, 10);
}

const REASON_NOTE = {
  "too-short": "원문 본문을 가져오지 못했습니다(차단 또는 짧은 페이지).",
  "looks-like-code": "추출된 것이 기사 본문이 아니라 스크립트입니다.",
  "looks-like-navigation": "추출된 것이 기사 본문이 아니라 사이트 메뉴입니다.",
  "title-mismatch": "추출된 텍스트가 이 기사와 맞지 않습니다(다른 페이지일 수 있음).",
};
const sourceCache = new Map();
async function sourceTextFor(url, title) {
  if (!url) return { text: "", note: "원문 URL이 없습니다" };
  const key = `${url}`;
  if (sourceCache.has(key)) return sourceCache.get(key);
  let result;
  try {
    const meta = await fetchArticleMeta(url);
    const quality = articleTextQuality(meta.fullText, title);
    // 엉뚱한 텍스트를 원문이라 내놓고 대조하면, 대조하지 않은 것을 통과한 것처럼
    // 보여주게 된다. 품질 판정에 걸리면 원문 없음으로 처리한다.
    result = quality.ok
      ? { text: meta.fullText, note: "" }
      : { text: "", note: `${REASON_NOTE[quality.reason] || "원문을 확인할 수 없습니다."} 링크를 직접 열어 확인하세요.` };
  } catch (e) {
    result = { text: "", note: `원문 가져오기 실패: ${String(e.message).slice(0, 60)}` };
  }
  sourceCache.set(key, result);
  return result;
}

function runCli(command, id, reviewerId, checks, notes) {
  const args = [path.join(ROOT, "scripts", "review-cli.js"), command, id, `--reviewer-id=${reviewerId}`, "--apply"];
  if (command === "approve") args.push(`--checklist=${checks.join(",")}`);
  if (notes) args.push(`--notes=${notes}`);
  const res = spawnSync(process.execPath, args, { cwd: ROOT, encoding: "utf8" });
  return { ok: res.status === 0, out: `${res.stdout || ""}${res.stderr || ""}`.trim() };
}

const page = () => `<!doctype html><meta charset="utf-8"><title>검수</title>
<style>
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{font:14px/1.6 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;margin:0;display:grid;grid-template-columns:250px 1fr 1fr;height:100vh}
#list{border-right:1px solid #8884;overflow:auto}
#list .row{padding:8px 11px;border-bottom:1px solid #8882;cursor:pointer;font-size:12.5px}
#list .row.on{background:#7772}
#mid,#right{overflow:auto;padding:18px 22px}
#right{border-left:1px solid #8884;background:#8881}
h2{margin:.2em 0 .5em;font-size:18px;line-height:1.4}
h3{font-size:13px;text-transform:uppercase;letter-spacing:.04em;opacity:.65;margin:18px 0 7px}
.meta{font-size:12px;opacity:.7;margin-bottom:12px}
.badge{display:inline-block;padding:1px 7px;border:1px solid #8886;border-radius:9px;margin-right:4px;font-size:11px}
.lead{font-weight:600;margin:11px 0}
p.body{margin:9px 0}
label{display:block;padding:4px 0;cursor:pointer}
label.hit{color:#e70;font-weight:600}
.acts{margin:16px 0 60px;display:flex;gap:7px;flex-wrap:wrap}
button{padding:8px 14px;font-size:14px;border-radius:7px;border:1px solid #8886;background:#7771;cursor:pointer}
button:disabled{opacity:.4;cursor:not-allowed}
#msg{position:fixed;right:14px;bottom:14px;padding:9px 14px;border-radius:7px;background:#000c;color:#fff;font-size:13px;display:none}
.f{border-left:3px solid #e70;padding:5px 0 5px 9px;margin:7px 0;font-size:12.5px}
.f.ok{border-color:#3a3;opacity:.75}
.f b{font-family:ui-monospace,monospace}
.warn{border-left:3px solid #d80;padding-left:10px;font-size:13px;opacity:.85;margin:11px 0}
pre{white-space:pre-wrap;font:12px/1.6 ui-monospace,monospace;opacity:.85;max-height:44vh;overflow:auto;margin:0}
a{color:inherit}
</style>
<div id=list></div><div id=mid>불러오는 중…</div><div id=right></div><div id=msg></div>
<script>
const CHECKS=${JSON.stringify(CHECK_LABELS)};
let all=[],rows=[],cur=0,me="",mineOnly=true,ana=null;
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function toast(t){const m=$("#msg");m.textContent=t;m.style.display="block";clearTimeout(m._t);m._t=setTimeout(()=>m.style.display="none",3500)}
async function load(){const j=await(await fetch("/api/queue")).json();all=j.rows;me=j.reviewerId||"";
 if(!me){$("#mid").innerHTML="<p>등록된 editor가 없습니다.</p>";return}
 apply()}
function apply(){rows=mineOnly?all.filter(r=>r.requiredRole==="editor"):all;
 cur=Math.min(cur,Math.max(0,rows.length-1));draw()}
function toggle(){mineOnly=!mineOnly;cur=0;apply()}
function draw(){
 const n=all.filter(r=>r.requiredRole==="editor").length;
 $("#list").innerHTML='<div class=row style="opacity:.8" onclick="toggle()">'+
  (mineOnly?"▣ 승인 가능한 것만 ("+n+")":"▢ 전체 ("+all.length+")")+'</div>'+
  rows.map((r,i)=>'<div class="row'+(i===cur?" on":"")+'" onclick="cur='+i+';draw()">'+
   '<b>'+r.risk+'</b> · '+r.date+'<br>'+esc(r.titleKo||r.sourceTitle).slice(0,44)+'</div>').join("");
 if(!rows.length){$("#mid").innerHTML="<p>승인 가능한 기사가 없습니다.</p>";$("#right").innerHTML="";return}
 const r=rows[cur];
 $("#mid").innerHTML='<div class=meta><span class=badge>'+r.risk+'</span><span class=badge>'+r.tier+'</span>'+
  '<span class=badge>'+esc(r.statusLabel)+'</span>'+esc(r.sourceLabel)+' · '+r.date+'</div>'+
  '<h2>'+esc(r.titleKo)+'</h2>'+
  (r.sourceUrl?'<p><a href="'+esc(r.sourceUrl)+'" target="_blank" rel="noopener">원문 열기 ↗</a></p>':'<p class=warn>원문 URL이 없어 승인할 수 없습니다.</p>')+
  '<p class=lead>'+esc(r.leadKo)+'</p>'+
  r.bodyKo.map(p=>'<p class=body>'+esc(p)+'</p>').join("")+
  (r.keyPointsKo.length?'<ul>'+r.keyPointsKo.map(k=>'<li>'+esc(k)+'</li>').join("")+'</ul>':'')+
  (r.requiredRole==="vet"?'<p class=warn>수의사 감수가 필요한 기사입니다. editor 권한으로는 승인할 수 없습니다.</p>':'')+
  '<h3>확인 항목</h3>'+Object.entries(CHECKS).map(([k,l],i)=>
    '<label id="lb-'+k+'"><input type=checkbox class=ck data-k="'+k+'" onchange="sync()"> <b>'+(i+1)+'.</b> '+esc(l)+'</label>').join("")+
  '<div class=acts><button id=ok onclick="act(\\'approve\\')" disabled>승인 (a)</button>'+
  '<button onclick="act(\\'request-vet\\')">수의사에게 (v)</button>'+
  '<button onclick="act(\\'reject\\')">반려 (r)</button></div>';
 $("#right").innerHTML="<p>원문 불러오는 중…</p>";ana=null;sync();
 fetch("/api/analyze?id="+encodeURIComponent(r.id)).then(x=>x.json()).then(a=>{if(rows[cur].id!==r.id)return;ana=a;paint()})}
function paint(){const a=ana;if(!a)return;
 // 원문을 못 가져온 항목은 "이상 없음"으로 표시하지 않는다. 대조하지 않은 것을
 // 통과한 것처럼 보여주면 검수자가 잘못 안심한다.
 const box=(t,items,render,okmsg,needsSource)=>'<h3>'+t+'</h3>'+(
   (needsSource&&!a.compared)?'<div class=f>대조 불가 — 원문을 직접 열어 확인하세요</div>'
   :items.length?items.map(render).join(""):'<div class="f ok">'+okmsg+'</div>');
 $("#right").innerHTML=
  (a.note?'<div class=warn>'+esc(a.note)+'</div>':'')+
  box("원문에 없는 수치",a.numbers,f=>'<div class=f><b>'+esc(f.value)+'</b> — '+esc(f.context)+'</div>',"본문 수치가 모두 원문에 있습니다",true)+
  box("대상 종",a.species,f=>'<div class=f>본문에 <b>'+esc(f.ko)+'</b> — 원문에서 '+esc(f.expected)+' 못 찾음</div>',"종 표기가 원문과 맞습니다",true)+
  box("임상 지시 표현",a.directives,f=>'<div class=f><b>'+esc(f.term)+'</b> — '+esc(f.context)+'</div>',"임상 지시 표현이 없습니다",false)+
  box("원문에 없는 고유명사",a.latin,t=>'<div class=f><b>'+esc(t)+'</b></div>',"라틴 문자 표기가 모두 원문에 있습니다",true)+
  '<h3>원문 본문 '+(a.sourceChars?'('+a.sourceChars+'자)':'')+'</h3><pre>'+esc(a.sourceText||"(없음)")+'</pre>';
 for(const [k,hit] of Object.entries(a.flag||{})){const el=document.getElementById("lb-"+k);if(el)el.classList.toggle("hit",!!hit)}}
function sync(){const r=rows[cur];const all=[...document.querySelectorAll(".ck")].every(c=>c.checked);
 const b=$("#ok");if(b)b.disabled=!all||r.requiredRole==="vet"||!r.sourceUrl}
async function act(cmd){const r=rows[cur];
 const checks=[...document.querySelectorAll(".ck")].filter(c=>c.checked).map(c=>c.dataset.k);
 let notes=null;
 if(cmd!=="approve"){notes=prompt(cmd==="reject"?"반려 사유":"수의사 검수 요청 사유")||"";if(!notes)return}
 const j=await(await fetch("/api/act",{method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({cmd,id:r.id,checks,notes})})).json();
 if(!j.ok){toast("실패: "+(j.out||"").split("\\n").slice(0,2).join(" "));return}
 toast(cmd+" 완료 · "+r.id);await load()}
addEventListener("keydown",e=>{
 if(e.target.tagName==="INPUT")return;
 if(e.key==="j"&&cur<rows.length-1){cur++;draw()}
 if(e.key==="k"&&cur>0){cur--;draw()}
 if(e.key>="1"&&e.key<="6"){const c=document.querySelectorAll(".ck")[+e.key-1];if(c){c.checked=!c.checked;sync()}}
 if(e.key==="a"&&!$("#ok").disabled)act("approve");
 if(e.key==="r")act("reject");
 if(e.key==="v")act("request-vet")});
load();
</script>`;

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://127.0.0.1");
  const json = (v) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(v)); };

  if (url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(page()); }

  if (url.pathname === "/api/queue") {
    const editor = people().find((p) => p.active !== false && ["editor", "admin"].includes(p.role));
    return json({ reviewerId: editor?.id || null, rows: loadQueue() });
  }

  if (url.pathname === "/api/analyze") {
    const id = url.searchParams.get("id");
    const row = articleRows().find((r) => (r.item.id || `${r.date}_${r.index + 1}`) === id);
    if (!row) return json({ note: "기사를 찾을 수 없습니다", numbers: [], species: [], directives: [], latin: [] });
    const item = row.item;
    const korean = [item.titleKo, item.leadKo, ...(item.bodyKo || []), ...(item.keyPointsKo || [])].filter(Boolean).join("\n");
    const { text, note } = await sourceTextFor(item.sourceUrl || item.sourceUrlRaw, item.sourceTitle || "");
    const numbers = text ? numberFindings(korean, text) : [];
    const species = text ? speciesFindings(korean, text) : [];
    const directives = directiveFindings(korean);
    const latin = text ? latinFindings(korean, text) : [];
    return json({
      // compared=false면 원문 대조를 하지 못한 것이다. UI가 "이상 없음"을
      // 띄우지 않고 "대조 불가"로 표시하는 근거가 된다.
      compared: text.length > 0,
      note, sourceText: text.slice(0, 12000), sourceChars: text.length,
      numbers, species, directives, latin,
      // 대조에서 걸린 항목의 체크박스를 강조해 어디를 먼저 볼지 알려준다
      flag: { numbersChecked: numbers.length > 0, speciesAndStudyChecked: species.length > 0, clinicalLanguageChecked: directives.length > 0, titleLeadBodyChecked: latin.length > 0 },
    });
  }

  if (url.pathname === "/api/act" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    return req.on("end", () => {
      let payload;
      try { payload = JSON.parse(body); } catch { res.writeHead(400); return res.end("{}"); }
      const editor = people().find((p) => p.active !== false && ["editor", "admin"].includes(p.role));
      if (!editor) return json({ ok: false, out: "등록된 editor가 없습니다" });
      const checks = (payload.checks || []).filter((k) => CHECKLIST_KEYS.includes(k));
      return json(runCli(payload.cmd, payload.id, editor.id, checks, payload.notes));
    });
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, "127.0.0.1", () => {
  const rows = loadQueue();
  const editorOk = rows.filter((r) => r.requiredRole === "editor").length;
  console.log(`검수 UI: http://127.0.0.1:${PORT}`);
  console.log(`큐 ${rows.length}건 · editor 승인 가능 ${editorOk}건 · 수의사 필요 ${rows.length - editorOk}건`);
  console.log("단축키: j/k 이동 · 1~6 체크 · a 승인 · v 수의사 · r 반려");
});
