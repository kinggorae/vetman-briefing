// 백필: 수집 기간을 넓혀(기본 40일) 관련성 통과분을 실제 발행일 기준으로
// 날짜별 이슈에 나눠 담아 누적 아카이브를 채운다.
// 사용: node --env-file=.env src/backfill.js [목표건수]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FEEDS, CANDIDATES_MAX } from "../config.js";
import { fetchFeed } from "./rss.js";
import { scoreAll } from "./select.js";
import { generateItem } from "./generate.js";
import { fetchArticleMeta } from "./article.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES_DIR = path.join(ROOT, "data", "issues");
const SEEN_PATH = path.join(ROOT, "data", "seen.json");
const TARGET = parseInt(process.argv[2] || "100", 10);
const MAX_AGE = 40;

function loadSeen() {
  try {
    return new Set(JSON.parse(fs.readFileSync(SEEN_PATH, "utf8")).urls);
  } catch {
    return new Set();
  }
}
function saveSeen(seen) {
  fs.writeFileSync(SEEN_PATH, JSON.stringify({ urls: [...seen].slice(-4000) }, null, 2));
}
function currentTotal() {
  if (!fs.existsSync(ISSUES_DIR)) return 0;
  return fs
    .readdirSync(ISSUES_DIR)
    .filter((f) => f.endsWith(".json"))
    .reduce((n, f) => n + (JSON.parse(fs.readFileSync(path.join(ISSUES_DIR, f), "utf8")).items?.length || 0), 0);
}
function dateOf(item) {
  const d = item.publishedAt ? new Date(item.publishedAt) : new Date();
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(d);
}

async function main() {
  const have = currentTotal();
  const need = Math.max(0, TARGET - have);
  console.log(`현재 누적 ${have}건, 목표 ${TARGET}건 → ${need}건 추가 수집`);
  if (need === 0) return;

  const seen = loadSeen();

  // 1) 넓은 기간으로 수집
  console.log("1/3 수집 중 (기간 " + MAX_AGE + "일)...");
  const collected = [];
  for (const feed of FEEDS) {
    try {
      const items = await fetchFeed({ ...feed, maxAgeDays: MAX_AGE, max: (feed.max || 12) * 2 });
      collected.push(...items);
    } catch (err) {
      console.error(`  ${feed.name}: ${err.message}`);
    }
  }
  const seenT = new Set();
  const candidates = collected.filter((c) => {
    const tk = c.title.toLowerCase().replace(/[^a-z0-9가-힣]/g, "").slice(0, 60);
    if (seen.has(c.url) || seenT.has(c.url) || seenT.has(tk)) return false;
    seenT.add(c.url);
    seenT.add(tk);
    return true;
  });
  console.log(`  후보 ${candidates.length}건 (기수집 제외)`);

  // 2) 관련성 스코어링 — 필요 개수의 1.4배까지 확보(생성 실패 버퍼)
  console.log("2/3 관련성 스코어링...");
  const pool = candidates.slice(0, Math.min(candidates.length, Math.ceil(need * 1.6), CANDIDATES_MAX * 4));
  const selected = await scoreAll(pool, Math.ceil(need * 1.4));
  console.log(`  통과 ${selected.length}건`);

  // 3) 생성 → 날짜 버킷
  console.log("3/3 기사 생성 중...");
  const buckets = {}; // date → [items]
  let made = 0;
  for (const post of selected) {
    if (made >= need) break;
    try {
      const meta = await fetchArticleMeta(post.url);
      post.fullText = meta.fullText ?? null;
      post.imageUrl = meta.imageUrl ?? null;
      post.finalUrl = meta.finalUrl ?? null;
      const item = await generateItem(post);
      if (item.needsReview) {
        console.warn(`  · 검수필요 스킵: ${post.title.slice(0, 40)}`);
        continue;
      }
      const dk = dateOf(post);
      (buckets[dk] = buckets[dk] || []).push(item);
      seen.add(item.sourceUrl);
      made++;
      console.log(`  ✓ [${dk}] ${item.titleKo}`);
    } catch (err) {
      console.error(`  ✗ 스킵: ${err.message}`);
    }
  }

  // 4) 날짜별 이슈에 병합 저장
  fs.mkdirSync(ISSUES_DIR, { recursive: true });
  for (const [date, items] of Object.entries(buckets)) {
    const p = path.join(ISSUES_DIR, `${date}.json`);
    let issue;
    if (fs.existsSync(p)) {
      issue = JSON.parse(fs.readFileSync(p, "utf8"));
      const urls = new Set(issue.items.map((it) => it.sourceUrl));
      issue.items.push(...items.filter((it) => !urls.has(it.sourceUrl)));
    } else {
      issue = { date, status: "published", generatedAt: new Date().toISOString(), publishedAt: new Date().toISOString(), items };
    }
    // 관련성 높은 순
    issue.items.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
    fs.writeFileSync(p, JSON.stringify(issue, null, 2));
    console.log(`  저장 ${date}: 총 ${issue.items.length}건`);
  }
  saveSeen(seen);
  console.log(`백필 완료 — ${made}건 추가, 누적 ${currentTotal()}건`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
