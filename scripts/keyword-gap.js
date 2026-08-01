// 네이버 검색광고 키워드도구 결과를 읽어 '검색 수요는 있는데 우리 페이지가 없는'
// 구간을 찾는다. 지금까지 주제 페이지를 추측으로 만들어 노출 1회에 그쳤기 때문에,
// 무엇을 만들지는 실제 검색량으로 정한다.
//
// 사용법:
//   npm run keyword:gap -- <csv|xlsx 경로> [...추가 파일]
//
// 키워드도구 CSV는 컬럼명이 판올림마다 조금씩 달라서 여러 표기를 함께 받는다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TOPICS } from "../config.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES = path.join(ROOT, "data", "issues");

const COLUMNS = {
  keyword: ["연관키워드", "키워드", "keyword", "Keyword"],
  pc: ["월간검색수(PC)", "월간검색수PC", "monthlyPcQcCnt", "PC검색량"],
  mobile: ["월간검색수(모바일)", "월간검색수모바일", "monthlyMobileQcCnt", "모바일검색량"],
  competition: ["경쟁정도", "competitionIndex", "경쟁강도"],
  clicks: ["월평균클릭수(PC)", "monthlyAvePcClkCnt"],
};

// "< 10" 이나 "1,230" 같은 표기를 숫자로. 미만 표기는 보수적으로 5로 본다.
function toNumber(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return 0;
  if (/^<\s*10$/.test(raw)) return 5;
  const n = Number(raw.replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function splitCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') { if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; } else quoted = !quoted; continue; }
    if (ch === "," && !quoted) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function readTable(file) {
  if (/\.xlsx?$/i.test(file)) {
    throw new Error(`xlsx는 바로 못 읽습니다. 엑셀에서 CSV로 저장한 뒤 다시 주세요: ${path.basename(file)}`);
  }
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const lines = text.split(/\r?\n/).filter((x) => x.trim());
  if (!lines.length) return [];
  // 키워드도구 파일은 앞에 안내 문구가 붙는 경우가 있어 헤더 줄을 찾아 시작한다
  const headerIndex = lines.findIndex((l) => COLUMNS.keyword.some((k) => l.includes(k)));
  if (headerIndex < 0) throw new Error(`키워드 컬럼을 찾지 못했습니다: ${path.basename(file)}`);
  // 헤더가 두 줄인 판이 있다. 첫 줄은 '월간검색수'로 묶고 둘째 줄에
  // '월간검색수(PC)' '월간검색수(모바일)'이 나뉘어 들어간다. 둘을 합쳐 쓴다.
  const first = splitCsvLine(lines[headerIndex]);
  const second = lines[headerIndex + 1] ? splitCsvLine(lines[headerIndex + 1]) : [];
  const twoRow = second.some((c) => /\((PC|모바일)\)/.test(c));
  const header = twoRow ? first.map((c, i) => (second[i] || "").trim() || c.trim()) : first.map((c) => c.trim());
  const dataStart = headerIndex + (twoRow ? 2 : 1);
  const pick = (row, names) => {
    for (const n of names) { const i = header.indexOf(n); if (i >= 0) return row[i]; }
    return "";
  };
  return lines.slice(dataStart).map(splitCsvLine).filter((r) => r.length > 1).map((r) => ({
    keyword: String(pick(r, COLUMNS.keyword) || "").trim(),
    volume: toNumber(pick(r, COLUMNS.pc)) + toNumber(pick(r, COLUMNS.mobile)),
    competition: String(pick(r, COLUMNS.competition) || "").trim(),
  })).filter((r) => r.keyword);
}

// 우리가 이미 그 말로 쓴 글이 있는가 — 제목·리드 기준
function existingCoverage() {
  const rows = [];
  if (!fs.existsSync(ISSUES)) return rows;
  for (const f of fs.readdirSync(ISSUES).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x))) {
    for (const it of JSON.parse(fs.readFileSync(path.join(ISSUES, f), "utf8")).items || []) {
      if (it.titleKo) rows.push(`${it.titleKo} ${it.leadKo || ""}`);
    }
  }
  return rows;
}

function topicFor(keyword) {
  const hit = TOPICS.map((t) => ({ t, n: (keyword.match(new RegExp(t.match.source, "gi")) || []).length }))
    .filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
  return hit.length ? hit[0].t : null;
}

const files = process.argv.slice(2).filter((x) => !x.startsWith("--"));
if (!files.length) {
  console.error("사용법: npm run keyword:gap -- <csv 경로> [...추가]");
  process.exit(1);
}

const seen = new Map();
for (const f of files) {
  for (const row of readTable(f)) {
    // 같은 키워드가 여러 회차에 나오면 큰 값을 쓴다
    const prev = seen.get(row.keyword);
    if (!prev || row.volume > prev.volume) seen.set(row.keyword, row);
  }
}
const rows = [...seen.values()].sort((a, b) => b.volume - a.volume);
const corpus = existingCoverage();
// 문구 그대로 찾으면 "심장사상충 예방"이 "심장사상충증 의심 강아지"를 놓친다.
// 키워드를 낱말로 쪼개 의미 있는 낱말이 모두 등장하는 기사를 다룬 것으로 본다.
// 조사·수식어가 붙어도 잡히도록 부분 문자열로 비교한다.
const STOPWORDS = new Set(["관리", "방법", "정보", "추천", "가격", "비용", "종류", "증상", "원인", "치료"]);
function coverageTokens(keyword) {
  return keyword.split(/[\s·,/]+/).map((w) => w.trim()).filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}
function covered(keyword) {
  const tokens = coverageTokens(keyword);
  if (!tokens.length) return 0;
  return corpus.filter((text) => tokens.every((tk) => text.includes(tk))).length;
}

// 네이버 연관키워드는 '동물병원 경영' 같은 씨앗에서도 이비인후과·대상포진 같은
// 사람 의료 키워드로 뻗는다. 수의 맥락이 있는 것만 남긴다.
const VET_CONTEXT = /강아지|고양이|반려|애완|동물병원|수의|펫|댕댕|냥이|견종|말티즈|푸들|포메|시츄|리트리버|비숑|치와와|진돗개|고냥|묘|犬/;
const vetOnly = process.argv.includes("--all") ? rows : rows.filter((r) => VET_CONTEXT.test(r.keyword));
if (vetOnly.length !== rows.length) {
  console.log(`수의 맥락 키워드만 남김: ${rows.length} → ${vetOnly.length}개 (--all 로 전체 보기)\n`);
}
const analysed = vetOnly.map((r) => ({ ...r, topic: topicFor(r.keyword)?.slug || null, articles: covered(r.keyword) }));

console.log(`키워드 ${analysed.length}개 · 기사 ${corpus.length}건과 대조\n`);

const gaps = analysed.filter((r) => r.volume >= 100 && r.articles === 0);
console.log(`검색량 100+ 인데 다룬 기사가 없는 키워드: ${gaps.length}개`);
console.log("검색량   경쟁   주제        키워드");
for (const r of gaps.slice(0, 30)) {
  console.log(`${String(r.volume).padStart(7)}  ${(r.competition || "-").padEnd(5)} ${(r.topic || "미분류").padEnd(11)} ${r.keyword}`);
}

const strong = analysed.filter((r) => r.volume >= 100 && r.articles > 0).slice(0, 15);
console.log(`\n이미 다룬 적 있는 키워드(페이지를 키울 후보): ${analysed.filter((r) => r.volume >= 100 && r.articles > 0).length}개`);
for (const r of strong) {
  console.log(`${String(r.volume).padStart(7)}  ${(r.competition || "-").padEnd(5)} 기사 ${String(r.articles).padStart(3)}건  ${r.keyword}`);
}

const out = path.join(ROOT, "reports", "keyword-gap.json");
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ generatedAt: new Date().toISOString(), files, counts: { keywords: analysed.length, gaps: gaps.length }, rows: analysed }, null, 2) + "\n");
console.log(`\n저장: reports/keyword-gap.json`);
