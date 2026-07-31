// 로컬 검수 UI. 기사 본문과 원문을 나란히 놓고 체크리스트를 눌러 승인한다.
//
// 승인·반려는 이 서버가 직접 파일을 고치지 않고 scripts/review-cli.js를
// 그대로 실행한다. 승인 규칙(reviewBlockers)과 감사 로그(reviews.jsonl)가
// CLI와 어긋나면 안 되기 때문이다. 이 파일은 읽기와 화면만 담당한다.
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

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES = path.join(ROOT, "data", "issues");
const PEOPLE = path.join(ROOT, "data", "editorial", "people.json");
const PORT = Number(process.env.REVIEW_UI_PORT) || 8899;

const CHECK_LABELS = {
  sourceConfirmed: "원문 확인 — 링크를 열어 같은 기사인지",
  titleLeadBodyChecked: "제목·리드·본문이 원문과 어긋나지 않는지",
  numbersChecked: "수치(용량·비율·기간)가 원문과 일치하는지",
  speciesAndStudyChecked: "대상 종과 연구 설계를 잘못 옮기지 않았는지",
  limitationsChecked: "한계·불확실성을 뭉개지 않았는지",
  clinicalLanguageChecked: "임상 단정·처방 지시로 읽히지 않는지",
};

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } };
const people = () => { const v = readJson(PEOPLE, { people: [] }); return Array.isArray(v) ? v : v.people || []; };

const QUEUE_STATUSES = new Set(["legacy-published", "draft", "automated", "editor-review-required", "vet-review-required", "correction-required"]);

function loadQueue() {
  const rows = [];
  const files = fs.existsSync(ISSUES) ? fs.readdirSync(ISSUES).filter((f) => /^\d{4}-\d{2}-\d{2}(?:\.draft)?\.json$/.test(f)).sort() : [];
  for (const file of files) {
    const issue = readJson(path.join(ISSUES, file), null);
    if (!issue || !Array.isArray(issue.items)) continue;
    issue.items.forEach((item, index) => {
      const published = issue.status === "published" && !file.endsWith(".draft.json");
      const status = item.workflowStatus || (published ? "legacy-published" : "draft");
      if (!QUEUE_STATUSES.has(status)) return;
      const risk = item.clinicalRisk || inferClinicalRisk(item);
      const role = requiredReviewRole({ ...item, clinicalRisk: risk });
      rows.push({
        id: item.id || `${issue.date || file.slice(0, 10)}_${index + 1}`,
        date: issue.date || file.slice(0, 10),
        status, statusLabel: workflowLabel(status),
        risk, requiredRole: role,
        tier: normalizeContentTier(item),
        priority: reviewPriority({ ...item, clinicalRisk: risk, workflowStatus: status }, { legacyIndex: status === "legacy-published" }),
        sourceLabel: item.sourceLabel || "", sourceUrl: item.sourceUrl || item.sourceUrlRaw || null,
        titleKo: item.titleKo || "", leadKo: item.leadKo || "",
        bodyKo: Array.isArray(item.bodyKo) ? item.bodyKo : [],
        keyPointsKo: Array.isArray(item.keyPointsKo) ? item.keyPointsKo : [],
        sourceTitle: item.sourceTitle || "", description: item.description || "",
      });
    });
  }
  return rows.sort((a, b) => b.priority - a.priority || String(b.date).localeCompare(String(a.date)));
}

// 승인·반려는 CLI에 위임한다. 규칙과 감사 로그를 한 곳에 둔다.
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
body{font:15px/1.65 -apple-system,BlinkMacSystemFont,"Apple SD Gothic Neo",sans-serif;margin:0;display:grid;grid-template-columns:300px 1fr;height:100vh}
#list{border-right:1px solid #8884;overflow:auto}
#list div{padding:9px 12px;border-bottom:1px solid #8882;cursor:pointer;font-size:13px}
#list div.on{background:#7772}
#list div.vet{opacity:.5}
#main{overflow:auto;padding:22px 26px;max-width:820px}
h2{margin:.2em 0 .5em;font-size:19px;line-height:1.4}
.meta{font-size:12px;opacity:.7;margin-bottom:14px}
.badge{display:inline-block;padding:1px 7px;border:1px solid #8886;border-radius:9px;margin-right:5px;font-size:11px}
.lead{font-weight:600;margin:12px 0}
p.body{margin:10px 0}
ul{padding-left:18px}
label{display:block;padding:5px 0;cursor:pointer;font-size:14px}
.acts{margin:18px 0 60px;display:flex;gap:8px;flex-wrap:wrap}
button{padding:8px 15px;font-size:14px;border-radius:7px;border:1px solid #8886;background:#7771;cursor:pointer}
button:disabled{opacity:.4;cursor:not-allowed}
#msg{position:fixed;right:16px;bottom:16px;padding:9px 14px;border-radius:7px;background:#000c;color:#fff;font-size:13px;display:none}
a{color:inherit}
.warn{border-left:3px solid #d80;padding-left:10px;font-size:13px;opacity:.85;margin:12px 0}
</style>
<div id=list><div id=filter></div></div><div id=main>불러오는 중…</div><div id=msg></div>
<script>
const CHECKS=${JSON.stringify(CHECK_LABELS)};
let all=[],rows=[],cur=0,me="",mineOnly=true;
const $=s=>document.querySelector(s);
function toast(t){const m=$("#msg");m.textContent=t;m.style.display="block";clearTimeout(m._t);m._t=setTimeout(()=>m.style.display="none",3200)}
async function load(){const r=await fetch("/api/queue");const j=await r.json();all=j.rows;me=j.reviewerId||"";if(!me){$("#main").innerHTML="<p>등록된 editor가 없습니다. <code>npm run people:add</code>로 먼저 등록하세요.</p>";return}
 apply()}
// 기본은 editor가 실제로 승인할 수 있는 것만 보여준다. 우선순위 정렬은
// high-risk를 앞에 두는데 그건 전부 수의사 전용이라, 그대로 두면 editor가
// 손댈 수 없는 기사만 화면에 깔린다.
function apply(){rows=mineOnly?all.filter(r=>r.requiredRole==="editor"):all;
 if(!rows.length){$("#main").innerHTML="<p>승인 가능한 기사가 없습니다.</p>"}
 cur=Math.min(cur,Math.max(0,rows.length-1));draw()}
function toggle(){mineOnly=!mineOnly;cur=0;apply()}
function draw(){
 const n=all.filter(r=>r.requiredRole==="editor").length;
 $("#list").innerHTML='<div id=filter style="padding:10px 12px;border-bottom:1px solid #8884;font-size:12px;cursor:pointer" onclick="toggle()">'+
   (mineOnly?"▣ 내가 승인 가능한 것만 ("+n+")":"▢ 전체 ("+all.length+"), 수의사 전용 포함")+' — 클릭해 전환</div>'+
  rows.map((r,i)=>'<div class="'+(i===cur?"on ":"")+(r.requiredRole==="vet"?"vet":"")+'" onclick="cur='+i+';draw()">'+
   '<b>'+r.risk+'</b> · '+r.date+'<br>'+esc(r.titleKo||r.sourceTitle).slice(0,46)+'</div>').join("");
 if(!rows.length)return;
 const r=rows[cur];
 const vetOnly=r.requiredRole==="vet";
 $("#main").innerHTML='<div class=meta><span class=badge>'+r.risk+'</span><span class=badge>'+r.tier+'</span>'+
  '<span class=badge>'+esc(r.statusLabel)+'</span>'+esc(r.sourceLabel)+' · '+r.date+'</div>'+
  '<h2>'+esc(r.titleKo)+'</h2>'+
  (r.sourceUrl?'<p><a href="'+esc(r.sourceUrl)+'" target="_blank" rel="noopener">원문 열기 ↗</a></p>':'<p class=warn>원문 URL이 없어 승인할 수 없습니다.</p>')+
  '<p class=lead>'+esc(r.leadKo)+'</p>'+
  r.bodyKo.map(p=>'<p class=body>'+esc(p)+'</p>').join("")+
  (r.keyPointsKo.length?'<ul>'+r.keyPointsKo.map(k=>'<li>'+esc(k)+'</li>').join("")+'</ul>':'')+
  (vetOnly?'<p class=warn>이 기사는 수의사 감수가 필요합니다(high-risk 또는 임상 행위 표현). editor 권한으로는 승인할 수 없습니다. 수의사에게 넘기거나 반려하세요.</p>':'')+
  '<h3>확인 항목</h3>'+Object.entries(CHECKS).map(([k,l],i)=>
    '<label><input type=checkbox class=ck data-k="'+k+'" onchange="sync()"> <b>'+(i+1)+'.</b> '+esc(l)+'</label>').join("")+
  '<div class=acts><button id=ok onclick="act(\\'approve\\')" disabled>승인 (a)</button>'+
  '<button onclick="act(\\'request-vet\\')">수의사에게 (v)</button>'+
  '<button onclick="act(\\'reject\\')">반려 (r)</button></div>';
 sync()}
function esc(s){return String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function sync(){const r=rows[cur];const all=[...document.querySelectorAll(".ck")].every(c=>c.checked);
 const b=$("#ok");if(b)b.disabled=!all||r.requiredRole==="vet"||!r.sourceUrl}
async function act(cmd){const r=rows[cur];
 const checks=[...document.querySelectorAll(".ck")].filter(c=>c.checked).map(c=>c.dataset.k);
 let notes=null;
 if(cmd!=="approve"){notes=prompt(cmd==="reject"?"반려 사유":"수의사 검수 요청 사유")||"";if(!notes)return}
 const res=await fetch("/api/act",{method:"POST",headers:{"content-type":"application/json"},
  body:JSON.stringify({cmd,id:r.id,checks,notes})});
 const j=await res.json();
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

const server = http.createServer((req, res) => {
  if (req.url === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(page()); }
  if (req.url === "/api/queue") {
    const editor = people().find((p) => p.active !== false && ["editor", "admin"].includes(p.role));
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ reviewerId: editor?.id || null, rows: loadQueue() }));
  }
  if (req.url === "/api/act" && req.method === "POST") {
    let body = "";
    req.on("data", (c) => { body += c; });
    return req.on("end", () => {
      let payload;
      try { payload = JSON.parse(body); } catch { res.writeHead(400); return res.end("{}"); }
      const editor = people().find((p) => p.active !== false && ["editor", "admin"].includes(p.role));
      if (!editor) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: false, out: "등록된 editor가 없습니다" })); }
      const checks = (payload.checks || []).filter((k) => CHECKLIST_KEYS.includes(k));
      const result = runCli(payload.cmd, payload.id, editor.id, checks, payload.notes);
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify(result));
    });
  }
  res.writeHead(404); res.end();
});

server.listen(PORT, "127.0.0.1", () => {
  const rows = loadQueue();
  const editorOk = rows.filter((r) => r.requiredRole === "editor").length;
  console.log(`검수 UI: http://127.0.0.1:${PORT}`);
  console.log(`큐 ${rows.length}건 · editor로 승인 가능 ${editorOk}건 · 수의사 필요 ${rows.length - editorOk}건`);
  console.log("단축키: j/k 이동 · 1~6 체크 · a 승인 · v 수의사 · r 반려");
});
