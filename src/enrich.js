// 레이더(조기경보) 메타 생성기.
// 이미 번역·생성된 기사에 "한국 동물병원이 지금 알아야 할 것"을 3층으로 덧붙인다.
//  ① 보호자 레이더 — 곧 한국 보호자가 물어볼 주제인가 + 진료실 설명 스크립트
//  ② 진료 레이더 — 임상의가 진료에서 점검·적용할 포인트 한 줄
//  ③ 근거 등급 — (논문) 연구설계·표본수·신뢰도 별점
// 다른 수의 매체가 주지 않는 "실행형 인텔리전스"가 이 서비스의 차별점이다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { jsonCall } from "./llm.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES_DIR = path.join(ROOT, "data", "issues");

const RADAR_SCHEMA = {
  type: "object",
  properties: {
    ownerSoon: { type: "boolean" },
    ownerQ: { type: "string" },
    ownerScript: { type: "string" },
    clinical: { type: "string" },
    evidenceDesign: { type: "string" },
    evidenceN: { type: "string" },
    evidenceStars: { type: "integer" },
    evidenceNote: { type: "string" },
  },
  required: [
    "ownerSoon",
    "ownerQ",
    "ownerScript",
    "clinical",
    "evidenceDesign",
    "evidenceN",
    "evidenceStars",
    "evidenceNote",
  ],
  additionalProperties: false,
};

// 오염 감지 — ① 한자·가나·키릴 ② 영어 단어(소문자 2자+). 의학 약어(대문자)와
// 학명은 통과. MiniMax가 종종 "alongside" 같은 영어를 섞거나 한국어를 뭉갠다.
const CJK = /[一-鿿぀-ヿЀ-ӿ]+/g;
// 라틴 문자 토큰(2자+). 이 중 대문자로만 이뤄진 건 의학 약어(NSAID·RCT·SGLT)로 보고 통과,
// 소문자가 섞인 건 영어 산문 단어(Alongside·alongside·coli)로 보고 오염 처리.
const LATIN = /[A-Za-z]{2,}/g;
const isBadLatin = (t) => /[a-z]/.test(t); // 소문자 포함 = 약어 아님
function contaminationIn(fields) {
  const text = fields.join(" ");
  const bad = [
    ...(text.match(CJK) || []),
    ...(text.match(LATIN) || []).filter(isBadLatin),
  ];
  return bad.length ? [...new Set(bad)].join(", ") : null;
}
const stripForeign = (s) =>
  String(s == null ? "" : s)
    .replace(CJK, "")
    .replace(LATIN, (t) => (isBadLatin(t) ? "" : t))
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.?!·])/g, "$1")
    .trim();

// 오염된 radar 필드만 순수 한국어로 교정하는 전용 패스
async function fixRadarKorean(out, bad) {
  return jsonCall({
    system: [
      "당신은 한국어 교정자입니다. JSON 값에 섞인 외국어(중국어·일본어·러시아어)와 어색한 영어 단어, 뭉개진 한국어를 자연스러운 존댓말 한국어로 고쳐주세요.",
      "의미·구조는 유지하고, 인명·기관명·의학 약어(NSAID 등)·학명의 영어/라틴어는 그대로 둡니다. 순수 한국어 JSON만 출력.",
    ].join("\n"),
    user: `특히 이 조각들이 문제입니다: "${bad}"\n\n${JSON.stringify(out)}`,
    schema: RADAR_SCHEMA,
  });
}

function buildPrompt(item) {
  const isPaper = item.sourceType === "paper" || item.category === "research";
  const body = (item.bodyKo || []).join("\n");
  const system = [
    "당신은 한국 동물병원 원장·수의사를 위한 '해외 조기경보 레이더'의 에디터입니다.",
    "이미 한국어로 정리된 해외 수의 소식 하나를 읽고, 한국 병원이 '지금 알아야 할 것'을 아래 항목으로 뽑아냅니다.",
    "",
    "항목 설명:",
    "- ownerSoon(boolean): 이 소식이 '한국 반려동물 보호자가 병원에서 곧 물어볼 만한 주제'인가. 신제품·식이·행동·바이럴 건강이슈·예방·품종 등 보호자 관심사면 true. 순수 병원경영·업계 M&A·수의사 커리어·행정처럼 보호자와 무관하면 false.",
    "- ownerQ: 보호자가 진료실에서 실제로 할 법한 질문 1문장(구어체). ownerSoon이 false여도 억지로라도 관련 질문을 하나 만들되, 무리하면 빈 문자열.",
    "- ownerScript: 그 질문에 수의사가 보호자에게 답하는 2~3문장 대본. 쉬운 말, 과장·불안 조장 금지, 단정적 효능 주장 금지, 약물 용량 언급 금지, '정확한 건 진료로 확인' 톤. ownerSoon이 false면 빈 문자열 허용.",
    "- clinical: 임상의(원장) 관점에서 이 소식을 진료·병원 운영에 어떻게 반영·점검할지 실행형 1문장. 예: 'OO 검사 프로토콜 재점검', '고령묘 문진에 OO 항목 추가 고려'.",
    isPaper
      ? "- evidenceDesign: 이 연구의 설계를 한국어로(예: 무작위대조시험, 전향적 코호트, 후향적 분석, 단면조사, 증례보고, 메타분석, 체계적 문헌고찰). 초록에서 판단 어려우면 '설계 불명확'."
      : "- evidenceDesign: 논문이 아니므로 빈 문자열.",
    isPaper
      ? "- evidenceN: 표본수나 대상 규모를 'n=412', '개 88마리' 같이. 알 수 없으면 빈 문자열."
      : "- evidenceN: 빈 문자열.",
    isPaper
      ? "- evidenceStars(1~4): 근거 수준. 메타분석·체계적고찰·대규모 RCT=4, 전향적 코호트·중간규모 RCT=3, 후향적·단면·소규모=2, 증례보고·전문가의견=1."
      : "- evidenceStars: 0.",
    isPaper
      ? "- evidenceNote: 이 근거를 임상 적용할 때의 한계 1문장(예: '단일기관 후향적이라 일반화 주의')."
      : "- evidenceNote: 빈 문자열.",
    "",
    "규칙: 반드시 순수 한국어. 중국어(한자)·일본어(가나)·러시아어 절대 금지. 의학 약어(NSAID 등)·학명·인명의 영어/라틴어만 허용. 존댓말.",
  ].join("\n");
  const user = [
    `분류: ${item.category || "기타"}${isPaper ? " (논문)" : ""}`,
    `출처: ${item.sourceLabel || ""}`,
    `제목: ${item.titleKo || ""}`,
    `리드: ${item.leadKo || ""}`,
    ``,
    `본문:\n${body}`,
  ].join("\n");
  return { system, user, isPaper };
}

// 한 기사에 대한 radar 객체 생성
export async function radarFor(item, attempt = 1) {
  const { system, user, isPaper } = buildPrompt(item);
  const fb = attempt > 1 ? `\n\n⚠️ 이전 시도에서 외국어/어색한 표현이 섞여 반려되었습니다. 이번엔 반드시 자연스러운 순수 한국어로만.` : "";
  let out = await jsonCall({ system, user: user + fb, schema: RADAR_SCHEMA, maxTokens: 2000 });

  // 한국어 순수성 가드: 사람이 읽는 필드만 검사 → 재생성(최대 2회) → 교정 패스 → 최종 스트립
  const readable = (o) => [o.ownerQ, o.ownerScript, o.clinical, o.evidenceDesign, o.evidenceNote];
  let bad = contaminationIn(readable(out));
  if (bad && attempt < 3) {
    console.warn(`  ↻ 레이더 오염("${bad.slice(0, 24)}") — 재생성 ${attempt}/2`);
    return radarFor(item, attempt + 1);
  }
  if (bad) {
    console.warn(`  ✎ 레이더 교정 패스("${bad.slice(0, 24)}")`);
    try {
      out = { ...out, ...(await fixRadarKorean(out, bad)) };
    } catch {}
    if (contaminationIn(readable(out))) {
      out = {
        ...out,
        ownerQ: stripForeign(out.ownerQ),
        ownerScript: stripForeign(out.ownerScript),
        clinical: stripForeign(out.clinical),
        evidenceDesign: stripForeign(out.evidenceDesign),
        evidenceNote: stripForeign(out.evidenceNote),
      };
    }
  }
  const owner = out.ownerSoon && (out.ownerScript || "").trim()
    ? { soon: true, q: out.ownerQ || "", script: out.ownerScript || "" }
    : out.ownerQ && (out.ownerScript || "").trim()
    ? { soon: false, q: out.ownerQ, script: out.ownerScript }
    : null;
  const evidence = isPaper && out.evidenceStars
    ? {
        design: out.evidenceDesign || "",
        n: out.evidenceN || "",
        stars: Math.max(1, Math.min(4, out.evidenceStars || 1)),
        note: out.evidenceNote || "",
      }
    : null;
  return {
    owner,
    clinical: (out.clinical || "").trim() || null,
    evidence,
  };
}

// items 배열에 radar를 in-place로 채운다(이미 있으면 건너뜀). run.js 파이프라인에서 사용.
export async function enrichItems(items, { force = false } = {}) {
  let done = 0;
  for (const it of items) {
    if (it.radar && !force) continue;
    try {
      it.radar = await radarFor(it);
      done++;
      const tags = [
        it.radar.owner?.soon ? "보호자⚑" : it.radar.owner ? "보호자" : "",
        it.radar.clinical ? "진료" : "",
        it.radar.evidence ? "근거" + "★".repeat(it.radar.evidence.stars) : "",
      ].filter(Boolean).join(" ");
      console.log(`  ✦ [레이더] ${(it.titleKo || "").slice(0, 34)} — ${tags}`);
    } catch (err) {
      console.error(`  ✗ 레이더 생성 실패: ${err.message}`);
    }
  }
  return done;
}

// ── CLI: node --env-file=.env src/enrich.js [YYYY-MM-DD | --all] [--force] ──
async function main() {
  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const all = args.includes("--all");
  const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const files = all
    ? fs.readdirSync(ISSUES_DIR).filter((f) => f.endsWith(".json") && !f.includes("draft"))
    : [`${date || new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date())}.json`];

  for (const f of files) {
    const p = path.join(ISSUES_DIR, f);
    if (!fs.existsSync(p)) {
      console.error(`건너뜀(없음): ${f}`);
      continue;
    }
    const issue = JSON.parse(fs.readFileSync(p, "utf8"));
    const todo = issue.items.filter((it) => force || !it.radar).length;
    console.log(`\n▶ ${f} — ${issue.items.length}건 중 ${todo}건 레이더 생성`);
    const n = await enrichItems(issue.items, { force });
    fs.writeFileSync(p, JSON.stringify(issue, null, 2));
    console.log(`  저장: ${f} (${n}건 갱신)`);
  }
}

// 직접 실행 시에만 CLI 동작 (import 시엔 함수만 노출)
// pathToFileURL로 비교 — 경로에 공백이 있으면 단순 문자열 접합은 인코딩 불일치로 실패한다.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
