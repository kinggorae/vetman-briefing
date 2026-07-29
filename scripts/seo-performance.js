import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, "data", "seo", "performance.json");
const REPORTS = path.join(ROOT, "reports");
const ISSUES = path.join(ROOT, "data", "issues");

function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return fallback; } }
function atomic(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.tmp-${process.pid}-${crypto.randomBytes(3).toString("hex")}`; fs.writeFileSync(tmp, value); fs.renameSync(tmp, file); }
function parseCsv(value) {
  const rows = []; let row = []; let cell = ""; let quote = false;
  for (let i = 0; i < value.replace(/^\uFEFF/, "").length; i++) { const ch = value.replace(/^\uFEFF/, "")[i]; const next = value.replace(/^\uFEFF/, "")[i + 1]; if (ch === '"' && quote && next === '"') { cell += '"'; i++; } else if (ch === '"') quote = !quote; else if (ch === "," && !quote) { row.push(cell); cell = ""; } else if ((ch === "\n" || ch === "\r") && !quote) { if (ch === "\r" && next === "\n") i++; row.push(cell); if (row.some((x) => x.trim())) rows.push(row); row = []; cell = ""; } else cell += ch; }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const headers = (rows.shift() || []).map((x) => x.trim());
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, (values[index] || "").trim()])));
}
function number(value) { const n = Number(String(value || "").replace(/[% ,]/g, "")); return Number.isFinite(n) ? n : null; }
function first(row, keys) { const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(row, candidate)); return key ? row[key] : ""; }
function articleMap() {
  const map = new Map();
  for (const file of fs.readdirSync(ISSUES).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) { const issue = readJson(path.join(ISSUES, file), {}); for (const [index, item] of (issue.items || []).entries()) map.set(item.id || `${issue.date}_${index + 1}`, item); }
  return map;
}
function normalizeRow(raw, provider, articles) {
  const page = first(raw, ["page", "Page", "페이지", "URL"]);
  const id = page.match(/article\/([^/.?#]+)/)?.[1] || "";
  const item = articles.get(id);
  const impressions = number(first(raw, ["impressions", "Impressions", "노출수", "노출"]));
  const clicks = number(first(raw, ["clicks", "Clicks", "클릭수", "클릭"]));
  let ctr = number(first(raw, ["ctr", "CTR", "클릭률"])); if (ctr !== null && ctr > 1) ctr /= 100;
  return { provider, date: first(raw, ["date", "Date", "날짜"]), query: first(raw, ["query", "Query", "검색어"]), page, country: first(raw, ["country", "Country", "국가"]), device: first(raw, ["device", "Device", "기기"]), impressions, clicks, ctr: ctr ?? (impressions ? clicks / impressions : null), position: number(first(raw, ["position", "Position", "평균순위"])), articleId: id || null, indexStatus: item ? "index-unknown" : page ? "unmapped" : "unknown", contentTier: item?.contentTier || null, category: item?.category || null, clinicalRisk: item?.clinicalRisk || null, imagePresent: Boolean(item?.imageUrl || item?.imageOwnership === "owned"), source: item?.sourceLabel || null };
}
function report(data) {
  const rows = data.rows || [];
  const group = (fn) => Object.values(rows.reduce((result, row) => { const key = fn(row) || "미분류"; (result[key] ||= []).push(row); return result; }, {})).map((values) => ({ key: fn(values[0]) || "미분류", impressions: values.reduce((n, row) => n + (row.impressions || 0), 0), clicks: values.reduce((n, row) => n + (row.clicks || 0), 0), ctr: values.reduce((n, row) => n + (row.clicks || 0), 0) / Math.max(1, values.reduce((n, row) => n + (row.impressions || 0), 0)), rows: values.length })).sort((a, b) => b.impressions - a.impressions);
  const result = { generatedAt: new Date().toISOString(), rowCount: rows.length, providers: [...new Set(rows.map((row) => row.provider))], highImpressionLowCtr: rows.filter((row) => (row.impressions || 0) >= 20 && (row.ctr || 0) < 0.02).sort((a, b) => b.impressions - a.impressions).slice(0, 100), positions5to20: rows.filter((row) => row.position >= 5 && row.position <= 20).sort((a, b) => b.impressions - a.impressions).slice(0, 100), unmappedPages: rows.filter((row) => row.indexStatus === "unmapped").slice(0, 100), byProvider: group((row) => row.provider), byCategory: group((row) => row.category), byTier: group((row) => row.contentTier), byRisk: group((row) => row.clinicalRisk), note: "검색 성과는 색인·품질 기준을 자동 완화하지 않습니다." };
  atomic(path.join(REPORTS, "seo-performance.json"), JSON.stringify(result, null, 2) + "\n");
  atomic(path.join(REPORTS, "seo-performance.md"), `# 검색 성과 분석\n\n- 행: ${result.rowCount}\n- 제공자: ${result.providers.join(", ") || "없음"}\n- 고노출·저CTR: ${result.highImpressionLowCtr.length}\n- 5~20위: ${result.positions5to20.length}\n\n## 주제별\n\n${result.byCategory.map((row) => `- ${row.key}: 노출 ${row.impressions} · 클릭 ${row.clicks} · CTR ${(row.ctr * 100).toFixed(2)}%`).join("\n") || "데이터가 없습니다."}\n\n> 검색 성과만으로 품질 게이트를 완화하지 않습니다.\n`);
  return result;
}
function importCsv(provider, file) {
  if (!file || !fs.existsSync(file)) throw new Error(`CSV를 찾을 수 없습니다: ${file || "경로 없음"}`);
  const articles = articleMap(); const old = readJson(DATA, { version: 1, providers: { gsc: [], naver: [] }, rows: [] }); const rows = parseCsv(fs.readFileSync(file, "utf8")).map((row) => normalizeRow(row, provider, articles));
  old.providers ||= { gsc: [], naver: [] }; old.providers[provider] = rows; old.rows = [...(old.providers.gsc || []), ...(old.providers.naver || [])]; old.updatedAt = new Date().toISOString(); atomic(DATA, JSON.stringify(old, null, 2) + "\n"); const result = report(old); console.log(`${provider} CSV ${rows.length}행을 가져왔습니다.`); console.log(JSON.stringify(result, null, 2));
}
const [command, file] = process.argv.slice(2);
try { if (command === "import" && ["gsc", "naver"].includes(file)) importCsv(file, process.argv[3]); else if (command === "performance") console.log(JSON.stringify(report(readJson(DATA, { rows: [] })), null, 2)); else throw new Error("사용법: import gsc|naver <csv> 또는 performance"); } catch (error) { console.error(error.message); process.exit(1); }
