// "진료실 밖 이야기" 수집기.
// 레딧이 전 경로에서 차단돼, 레딧·틱톡발 화제글을 기사화하는 매체를 구글 뉴스로 우회 수집한다.
// 신뢰 뉴스 그리드와 섞지 않고 별도 섹션(category: "watercooler")으로만 붙인다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GOSSIP_FEEDS, GOSSIP_PER_ISSUE } from "../config.js";
import { fetchFeed } from "./rss.js";
import { fetchArticleMeta } from "./article.js";
import { generateStory } from "./generate.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES_DIR = path.join(ROOT, "data", "issues");
const SEEN_PATH = path.join(ROOT, "data", "seen.json");

function loadSeen() {
  try {
    return new Set(JSON.parse(fs.readFileSync(SEEN_PATH, "utf8")).urls);
  } catch {
    return new Set();
  }
}
function saveSeen(seen) {
  fs.mkdirSync(path.dirname(SEEN_PATH), { recursive: true });
  fs.writeFileSync(SEEN_PATH, JSON.stringify({ urls: [...seen].slice(-2000) }, null, 2));
}

// 쿼리별로 번갈아 뽑아 한 쿼리가 독식하지 않게
function roundRobin(groups) {
  const out = [];
  const q = groups.map((g) => [...g]);
  while (q.some((x) => x.length)) for (const x of q) if (x.length) out.push(x.shift());
  return out;
}

// 화제성 썰 후보 수집(중복 제거)
export async function collectGossip(exclude = new Set()) {
  const groups = [];
  for (const feed of GOSSIP_FEEDS) {
    try {
      groups.push(await fetchFeed(feed));
    } catch (err) {
      console.error(`  [가십] ${feed.name}: ${err.message}`);
    }
  }
  const seenKey = new Set();
  return roundRobin(groups).filter((c) => {
    const tk = c.title.toLowerCase().replace(/[^a-z0-9가-힣]/g, "").slice(0, 60);
    if (exclude.has(c.url) || seenKey.has(c.url) || seenKey.has(tk)) return false;
    seenKey.add(c.url);
    seenKey.add(tk);
    return true;
  });
}

// 이슈 items에 story 아이템을 채운다(부족분만 생성). run.js/CLI 공용.
export async function addStories(items, seen, limit = GOSSIP_PER_ISSUE) {
  const have = items.filter((it) => it.category === "watercooler").length;
  const need = Math.max(0, limit - have);
  if (need === 0) return 0;
  const existing = new Set(items.map((it) => it.sourceUrl));
  const cands = await collectGossip(new Set([...seen, ...existing]));
  console.log(`  [가십] 후보 ${cands.length}건 → ${need}건 생성 목표`);
  let made = 0;
  for (const post of cands) {
    if (made >= need) break;
    try {
      const meta = await fetchArticleMeta(post.url);
      post.fullText = meta.fullText ?? null;
      post.imageUrl = meta.imageUrl ?? null;
      post.finalUrl = meta.finalUrl ?? null;
      const story = await generateStory(post);
      if (story.needsReview) continue;
      items.push(story);
      seen.add(story.sourceUrl);
      made++;
      console.log(`  ✓ [썰·${story.tagKo}] ${story.titleKo}`);
    } catch (err) {
      console.error(`  ✗ 썰 스킵: ${err.message}`);
    }
  }
  return made;
}

// ── CLI: node --env-file=.env src/gossip.js [YYYY-MM-DD] ──
async function main() {
  const date = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) ||
    new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(new Date());
  const p = path.join(ISSUES_DIR, `${date}.json`);
  if (!fs.existsSync(p)) {
    console.error(`이슈 없음: ${date}.json`);
    process.exit(1);
  }
  const issue = JSON.parse(fs.readFileSync(p, "utf8"));
  const seen = loadSeen();
  console.log(`▶ ${date} — 진료실 밖 이야기 수집·생성`);
  const made = await addStories(issue.items, seen);
  fs.writeFileSync(p, JSON.stringify(issue, null, 2));
  saveSeen(seen);
  console.log(`완료 — ${made}건 추가 (총 ${issue.items.length}건)`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
