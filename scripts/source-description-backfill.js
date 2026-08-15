// LLM이 없는 수집 실행에서 출처 설명·초록이 확보된 후보를 위한 보강기.
// 원문에 없는 사실을 추가하지 않고, 공개된 source description만 번역해
// noindex public brief 후보로 만든다. 실제 발행은 brief:release-ready가 담당한다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { atomicWrite, contentHash, readJson } from "../src/lib/source-first.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DRAFT_DIR = path.join(ROOT, "data", "drafts");
const REPORT = path.join(ROOT, "reports", "source-description-backfill.json");
const PAUSE_MS = Math.max(0, Number(process.env.TRANSLATE_PAUSE_MS) || 160);

function flags() {
  const raw = process.argv.slice(2);
  const out = { date: null, max: 200, apply: false, excludeHighRisk: false };
  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    if (token === "--apply") out.apply = true;
    else if (token === "--exclude-high-risk") out.excludeHighRisk = true;
    else if (token.startsWith("--date=")) out.date = token.slice(7);
    else if (token === "--date" && raw[i + 1]) out.date = raw[++i];
    else if (token.startsWith("--max=")) out.max = Math.max(1, Number(token.slice(6)) || out.max);
    else if (token === "--max" && raw[i + 1]) out.max = Math.max(1, Number(raw[++i]) || out.max);
  }
  return out;
}

function clean(value) {
  return String(value || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#160;|&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/\s+/g, " ")
    .trim();
}

function sourceText(item) {
  return clean(item.description || item.sourceEvidence?.description || item.abstract || "").slice(0, 5000);
}

function bibliographicOnly(value) {
  const text = clean(value);
  if (!text) return true;
  if (/(?:external news link|외부 뉴스 링크)\s*https?:\/\//i.test(text)) return true;
  const markers = [
    /\bIn:\s*/i,
    /Research output|연구 성과/i,
    /peer[- ]reviewed|동료 검토/i,
    /›/,
  ].filter((pattern) => pattern.test(text)).length;
  if (markers < 2) return false;
  const beforeJournal = text.split(/\bIn:\s*/i)[0];
  const hasNarrative = /(?:\b(?:when|however|because|researchers|developed|helps|found|shows|suggests|is|are|was|were)\b[^.?!]{20,}[.?!])/i.test(beforeJournal);
  return !hasNarrative && beforeJournal.length < 700;
}

function sleep(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

async function translate(text) {
  const value = clean(text);
  if (!value) return "";
  const url = new URL("https://translate.googleapis.com/translate_a/single");
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", "en");
  url.searchParams.set("tl", "ko");
  url.searchParams.set("dt", "t");
  url.searchParams.set("q", value);
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`번역 응답 ${response.status}`);
  const data = await response.json();
  const translated = Array.isArray(data?.[0])
    ? data[0].map((segment) => segment?.[0] || "").join("")
    : "";
  if (!translated.trim()) throw new Error("번역 결과가 비어 있음");
  await sleep(PAUSE_MS);
  return clean(translated);
}

function titleFor(item, translated) {
  const title = fixKorean(clean(translated) || clean(item.sourceTitle));
  return title.length >= 10 && /[가-힣]/.test(title) ? title : `해외 수의 소식: ${title}`;
}

function fixKorean(value) {
  return clean(value)
    .replace(/새 집사/g, "새 수련의")
    .replace(/하우스 임원/g, "수련의")
    .replace(/새로운 직원을 환영합니다/g, "새 수련의를 맞이합니다")
    .replace(/사이즈 코트/g, "체격·털")
    .replace(/가구\(와이어\) 코트/g, "와이어형 털")
    .replace(/조기에 예방/g, "조기에 진단")
    .replace(/,\s*rega\b/gi, "");
}

function summaryFor(item, titleKo, translated) {
  const label = clean(item.sourceLabel) || "공식 출처";
  const source = sourceText(item);
  const body = fixKorean(translated).replace(source.length >= 1190 ? /\s+[A-Za-z]{1,4}\s*$/ : /$^/, "").trim();
  const prefix = `이 내용은 ${label}에서 소개한 수의학 소식입니다.`;
  const caution = "출처에 공개된 설명의 범위 안에서 정리했으며, 개별 동물의 진단이나 치료를 대신하지 않습니다.";
  const context = "세부 내용과 최신 정보는 원문 출처에서 확인해야 합니다.";
  const summary = [prefix, body ? `원문은 다음과 같은 내용을 전합니다. ${body}` : "현재 확보된 공개 설명이 제한적이므로 자세한 내용은 원문에서 확인할 수 있습니다.", caution, context]
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return summary.replace(/[^습니다요다]$/, ".");
}

function draftFiles(date) {
  const files = fs.readdirSync(DRAFT_DIR).filter((name) => name.endsWith(".json"));
  return date ? files.filter((name) => name === `source-first-${date}.json`) : files;
}

function missingKorean(item) {
  const body = Array.isArray(item.bodyKo) ? item.bodyKo.join(" ").replace(/\s/g, "") : "";
  return !item.titleKo || !item.leadKo || !body || body.length < 250;
}

async function enrich(item) {
  const titleKo = titleFor(item, await translate(item.sourceTitle || ""));
  const translated = await translate(sourceText(item));
  const leadKo = summaryFor(item, titleKo, translated);
  const bodyKo = [leadKo];
  const outputHash = contentHash(JSON.stringify({ titleKo, leadKo, bodyKo }));
  return {
    ...item,
    titleKo,
    leadKo,
    bodyKo,
    keyPointsKo: [],
    angleKo: "",
    contentTier: "brief",
    tier: "brief",
    generationMode: "source-description-translation",
    generationRequested: false,
    aiAssisted: true,
    generation: {
      ...(item.generation || {}),
      model: "Google Translate source-description fallback",
      promptVersion: "source-description-translation-v1",
      generatedAt: new Date().toISOString(),
      outputHash,
      generationWarnings: ["source-description-translation", "human-review-required"],
    },
    contentHash: outputHash,
    workflowStatus: "draft",
    editorialStatus: "editor-review-required",
    publicationStatus: null,
    reviewedAt: null,
    reviewedBy: null,
    reviewerId: null,
  };
}

async function main() {
  const options = flags();
  const files = draftFiles(options.date);
  const candidates = [];
  const skipped = [];
  const seen = new Set();
  for (const file of files.sort().reverse()) {
    const data = readJson(path.join(DRAFT_DIR, file), { items: [] });
    for (const item of data.items || []) {
      if (!item.id || seen.has(item.id) || !missingKorean(item)) continue;
      if (options.excludeHighRisk && String(item.clinicalRisk || "").toLowerCase() === "high") continue;
      if (bibliographicOnly(sourceText(item))) {
        skipped.push({ id: item.id, reason: "bibliographic-only-source-description" });
        seen.add(item.id);
        continue;
      }
      seen.add(item.id);
      candidates.push({ file, item });
      if (candidates.length >= options.max) break;
    }
    if (candidates.length >= options.max) break;
  }
  const report = { generatedAt: new Date().toISOString(), apply: options.apply, date: options.date, candidateCount: candidates.length, updated: 0, failed: 0, ids: [], failures: [], skipped, preview: [] };
  const replacements = new Map();
  for (const candidate of candidates) {
    try {
      const replacement = await enrich(candidate.item);
      replacements.set(candidate.item.id, replacement);
      report.ids.push(candidate.item.id);
      report.updated += 1;
      if (!options.apply) report.preview.push({ id: replacement.id, titleKo: replacement.titleKo, leadKo: replacement.leadKo });
      console.log(`보강 완료: ${candidate.item.id}`);
    } catch (error) {
      report.failed += 1;
      report.failures.push({ id: candidate.item.id, error: String(error.message || error) });
      console.warn(`보강 실패: ${candidate.item.id} · ${error.message || error}`);
    }
  }
  if (options.apply && replacements.size) {
    for (const file of files) {
      const filePath = path.join(DRAFT_DIR, file);
      const data = readJson(filePath, { items: [] });
      let changed = false;
      data.items = (data.items || []).map((item) => {
        const replacement = replacements.get(item.id);
        if (!replacement) return item;
        changed = true;
        return replacement;
      });
      if (changed) atomicWrite(filePath, JSON.stringify(data, null, 2) + "\n");
    }
  } else if (!options.apply) {
    report.note = "dry-run: --apply 없이는 초안을 저장하지 않습니다.";
  }
  atomicWrite(REPORT, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
}
