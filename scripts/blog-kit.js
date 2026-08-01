// 원장이 자기 병원 블로그에 쓸 글감을, 실제 보호자 검색어와 묶어 내놓는다.
//
// 이 사이트의 고객은 수의사인데 수의사 대상 검색 수요는 거의 없다(동물병원경영·
// PIMS는 월 10회 미만). 반면 보호자 검색은 강아지사료 하나가 월 4.4만 회다.
// 그래서 원장에게 "이 기사로 블로그를 쓰면 월 N회 검색어를 노린다"를 준다.
//
// 사용법:
//   npm run blog:kit                 (기본: 검색량 500 이상)
//   npm run blog:kit -- --min=2000
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES = path.join(ROOT, "data", "issues");
const GAP = path.join(ROOT, "reports", "keyword-gap.json");

const minVolume = Number((process.argv.find((a) => a.startsWith("--min=")) || "").split("=")[1]) || 500;

// 네이버 키워드는 붙여쓰기가 많다(강아지스케일링비용). 아는 낱말로 쪼갠다.
const TERMS = /(강아지|고양이|반려동물|반려견|반려묘|동물병원|수의사|사료|백신|예방접종|중성화|스케일링|치석|건강검진|심장사상충|슬개골|탈구|피부병|귀염증|알러지|알레르기|진드기|구충|췌장염|폐수종|신장|방광|결막|백내장|치매|비만|다이어트|호텔|미용|영양제|보험|비용|가격|사상충|기생충|중이염|관절)/g;

// 종이 어긋나면 붙이지 않는다. 고양이 검색어에 개 기사를 물리면 쓸모가 없다.
const CAT = /고양이|반려묘|냥/;
const DOG = /강아지|반려견|개\b|견/;
function speciesOk(keyword, text) {
  if (CAT.test(keyword) && !CAT.test(text)) return false;
  if (DOG.test(keyword) && !CAT.test(keyword) && !DOG.test(text)) return false;
  return true;
}

function loadArticles() {
  const out = [];
  if (!fs.existsSync(ISSUES)) return out;
  for (const f of fs.readdirSync(ISSUES).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
    for (const it of JSON.parse(fs.readFileSync(path.join(ISSUES, f), "utf8")).items || []) {
      if (!it.titleKo) continue;
      out.push({
        id: it.id || null,
        day: f.slice(0, 10),
        title: it.titleKo,
        angle: String(it.angleKo || "").trim(),
        ownerQ: it.radar?.owner?.q || "",
        ownerScript: it.radar?.owner?.script || "",
        sourceUrl: it.sourceUrl || it.sourceUrlRaw || null,
        sourceLabel: it.sourceLabel || "",
        haystack: [it.titleKo, it.leadKo, (it.bodyKo || []).join(" "), it.angleKo, it.radar?.owner?.q, it.radar?.owner?.script]
          .filter(Boolean).join(" "),
        // 원장에게 실제로 보여지는 부분. 종 판정은 여기서 해야 한다.
        // 본문 어딘가에 '고양이'가 한 번 스쳤다고 고양이 글감이 되지는 않는다.
        shown: [it.titleKo, it.angleKo, it.radar?.owner?.q, it.radar?.owner?.script].filter(Boolean).join(" "),
      });
    }
  }
  return out;
}

if (!fs.existsSync(GAP)) {
  console.error("reports/keyword-gap.json이 없습니다. 먼저 npm run keyword:gap -- <csv>를 돌리세요.");
  process.exit(1);
}
const keywords = (JSON.parse(fs.readFileSync(GAP, "utf8")).rows || []).filter((r) => r.volume >= minVolume);
const articles = loadArticles();

const kit = [];
for (const k of keywords) {
  const tokens = [...new Set(k.keyword.match(TERMS) || [])].filter((t) => t.length >= 2);
  if (tokens.length < 2) continue; // 낱말 하나로는 너무 헐겁게 붙는다
  const hits = articles
    .filter((a) => tokens.every((t) => a.haystack.includes(t)))
    .filter((a) => speciesOk(k.keyword, a.shown))
    // 글감이나 보호자 문답이 있어야 원장이 바로 쓸 수 있다
    .filter((a) => a.angle || a.ownerQ)
    .slice(0, 5);
  if (hits.length) kit.push({ keyword: k.keyword, volume: k.volume, competition: k.competition, topic: k.topic, articles: hits });
}
kit.sort((a, b) => b.volume - a.volume);

const totalVolume = kit.reduce((n, r) => n + r.volume, 0);
const report = { generatedAt: new Date().toISOString(), minVolume, counts: { keywords: kit.length, monthlyVolume: totalVolume }, rows: kit };
fs.mkdirSync(path.join(ROOT, "reports"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "reports", "blog-kit.json"), JSON.stringify(report, null, 2) + "\n");

const md = [
  `# 병원 블로그 글감 (검색량 ${minVolume.toLocaleString()}회 이상)`,
  "",
  `- 생성 ${report.generatedAt}`,
  `- 키워드 ${kit.length}개 · 월 검색량 합계 ${totalVolume.toLocaleString()}회`,
  "",
  ...kit.flatMap((r) => {
    const a = r.articles[0];
    return [
      `## ${r.keyword} — 월 ${r.volume.toLocaleString()}회 (경쟁 ${r.competition || "-"})`,
      "",
      `- 근거 기사: ${a.title}${a.sourceUrl ? ` ([원문](${a.sourceUrl}))` : ""} · ${a.sourceLabel} · ${a.day}`,
      a.angle ? `- 글감: ${a.angle}` : "",
      a.ownerQ ? `- 보호자 질문: ${a.ownerQ}` : "",
      a.ownerScript ? `- 설명 대본: ${a.ownerScript}` : "",
      r.articles.length > 1 ? `- 참고 기사 ${r.articles.length - 1}건 더` : "",
      "",
    ].filter(Boolean);
  }),
].join("\n");
fs.writeFileSync(path.join(ROOT, "reports", "blog-kit.md"), md + "\n");

console.log(`키워드 ${kit.length}개 · 월 검색량 합계 ${totalVolume.toLocaleString()}회`);
console.log("검색량   경쟁   기사  키워드");
for (const r of kit.slice(0, 20)) {
  console.log(`${String(r.volume).padStart(6)}  ${(r.competition || "-").padEnd(5)} ${String(r.articles.length).padStart(3)}건  ${r.keyword}`);
}
console.log("\n저장: reports/blog-kit.json · reports/blog-kit.md");
