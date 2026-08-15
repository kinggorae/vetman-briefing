import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BRIEF_MIN_CHARS, MODEL } from "../config.js";
import { generateBrief } from "../src/generate.js";
import { mapPool } from "../src/pool.js";
import { bodyCharCount } from "../src/lib/quality.js";
import { atomicWrite, contentHash, readJson } from "../src/lib/source-first.js";
import { normalizeSourceUrl } from "../src/identity.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DRAFT_DIR = path.join(ROOT, "data", "drafts");
const ISSUE_DIR = path.join(ROOT, "data", "issues");
const REPORT = path.join(ROOT, "reports", "brief-backfill.json");

function flags() {
  const out = { max: 200, apply: false };
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i += 1) {
    const token = raw[i];
    if (token === "--apply") out.apply = true;
    else if (token.startsWith("--max=")) out.max = Math.max(1, Number(token.slice(6)) || out.max);
    else if (token === "--max" && raw[i + 1]) out.max = Math.max(1, Number(raw[++i]) || out.max);
  }
  return out;
}

function draftFiles() {
  return fs.readdirSync(DRAFT_DIR).filter((name) => name.endsWith(".json")).sort().reverse();
}

function allDraftRows() {
  return draftFiles().flatMap((file) => {
    const data = readJson(path.join(DRAFT_DIR, file), { items: [] });
    return (data.items || []).map((item, index) => ({ file, index, item }));
  });
}

function publishedUrls() {
  const urls = new Set();
  for (const file of fs.readdirSync(ISSUE_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))) {
    const data = readJson(path.join(ISSUE_DIR, file), { items: [] });
    for (const item of data.items || []) {
      const url = normalizeSourceUrl(item.sourceUrl || item.sourceUrlRaw || "");
      if (url) urls.add(url);
    }
  }
  return urls;
}

export function needsBriefBackfill(item = {}, alreadyPublished = new Set()) {
  if (item.workflowStatus === "published") return false;
  if (String(item.contentTier || item.tier || "").toLowerCase() !== "brief") return false;
  if (String(item.clinicalRisk || "").toLowerCase() === "high") return false;
  if (item.sourceStatus !== "verified" || item.duplicateStatus !== "unique") return false;
  const url = normalizeSourceUrl(item.sourceUrl || item.sourceUrlRaw || "");
  if (!url || alreadyPublished.has(url)) return false;
  return bodyCharCount(item) < BRIEF_MIN_CHARS || !item.titleKo || !item.leadKo;
}

function generationInput(item) {
  const content = item.fullText || item.body || item.description || item.sourceEvidence?.description || item.sourceTitle || item.title || "";
  return {
    ...item,
    title: item.sourceTitle || item.title || item.titleKo || "",
    sourceLabel: item.sourceLabel || "공식 수의학 매체",
    sourceType: "rss",
    url: item.sourceUrlRaw || item.sourceUrl,
    finalUrl: item.sourceUrl,
    fullText: content,
    body: content,
  };
}

function applyGenerated(item, generated) {
  const outputHash = contentHash(JSON.stringify({ titleKo: generated.titleKo, leadKo: generated.leadKo, bodyKo: generated.bodyKo }));
  return {
    ...item,
    ...generated,
    id: item.id,
    sourceUrl: item.sourceUrl,
    sourceUrlRaw: item.sourceUrlRaw,
    sourceStatus: item.sourceStatus,
    sourceEvidence: item.sourceEvidence,
    workflowStatus: "draft",
    editorialStatus: "editor-review-required",
    contentTier: "brief",
    tier: "brief",
    generationMode: "brief",
    generation: {
      ...(item.generation || {}),
      model: MODEL,
      promptVersion: "source-first-brief-v2-backfill",
      generatedAt: new Date().toISOString(),
      outputHash,
      generationWarnings: [],
    },
    contentHash: outputHash,
    reviewedAt: null,
    reviewedBy: null,
    reviewerId: null,
    publicationStatus: null,
  };
}

async function main() {
  const options = flags();
  const published = publishedUrls();
  const seen = new Set();
  const candidates = allDraftRows().filter(({ item }) => {
    if (!item.id || seen.has(item.id) || !needsBriefBackfill(item, published)) return false;
    seen.add(item.id);
    return true;
  }).slice(0, options.max);

  const report = {
    generatedAt: new Date().toISOString(),
    apply: options.apply,
    minimumChars: BRIEF_MIN_CHARS,
    candidateCount: candidates.length,
    updated: 0,
    failed: 0,
    skipped: 0,
    ids: [],
    failures: [],
  };
  if (!candidates.length) {
    atomicWrite(REPORT, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (!process.env.LLM_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    report.skipped = candidates.length;
    report.note = "LLM_API_KEY 또는 ANTHROPIC_API_KEY가 없어 dry-run으로 후보만 계산했습니다.";
    atomicWrite(REPORT, JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const results = await mapPool(candidates, async ({ item }) => {
    const generated = await generateBrief(generationInput(item));
    if (bodyCharCount(generated) < BRIEF_MIN_CHARS) throw new Error(`brief 분량 미달: ${item.id}`);
    return { id: item.id, item: applyGenerated(item, generated) };
  });
  const replacements = new Map();
  for (const result of results) {
    if (!result) continue;
    replacements.set(result.id, result.item);
    report.ids.push(result.id);
  }
  report.updated = replacements.size;
  report.failed = candidates.length - report.updated;
  report.failures = candidates.filter(({ item }) => !replacements.has(item.id)).map(({ item }) => item.id);

  if (options.apply && replacements.size) {
    for (const file of draftFiles()) {
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
