import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FEEDS, SUBREDDITS, CANDIDATES_MAX, TOP_COMMENTS } from "../config.js";
import { fetchFeed } from "./rss.js";
import { fetchWeeklyTop, fetchTopComments } from "./reddit.js";
import { redditRuleFilter, scoreCandidates } from "./select.js";
import { generateItem } from "./generate.js";
import { fetchArticleMeta } from "./article.js";
import { searchRedditSignals } from "./websearch.js";
import { IS_COMPAT } from "./llm.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const collectOnly = process.argv.includes("--collect-only");
const noWebsearch = process.argv.includes("--no-websearch");
const autoPublish = process.argv.includes("--publish"); // draft 없이 바로 발행
const SEEN_PATH = path.join(ROOT, "data", "seen.json");

const hasRedditCreds = !!(process.env.REDDIT_CLIENT_ID && process.env.REDDIT_CLIENT_SECRET);
const hasAnthropicKey = !!(process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY);
const useWebsearch = !IS_COMPAT && hasAnthropicKey; // 호환 게이트웨이에선 웹 검색 도구 미지원

// 오늘 날짜 (KST 기준) — 일간 이슈 라벨
function dateLabel(d = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul" }).format(d); // YYYY-MM-DD
}

// 이미 소개한 글 URL 저장소 — 일간 실행 시 중복 방지
function loadSeen() {
  try {
    return new Set(JSON.parse(fs.readFileSync(SEEN_PATH, "utf8")).urls);
  } catch {
    return new Set();
  }
}

function saveSeen(seen) {
  const urls = [...seen].slice(-2000); // 최근 2000건만 유지
  fs.mkdirSync(path.dirname(SEEN_PATH), { recursive: true });
  fs.writeFileSync(SEEN_PATH, JSON.stringify({ urls }, null, 2));
}

// 구글 뉴스 쿼리들이 후보 상한을 독식하지 않도록 쿼리별로 번갈아 뽑는다
function roundRobin(groups) {
  const out = [];
  const queues = groups.map((g) => [...g]);
  while (queues.some((q) => q.length)) {
    for (const q of queues) if (q.length) out.push(q.shift());
  }
  return out;
}

async function collect() {
  const candidates = [];
  const gnewsGroups = [];

  // 1) Plan C (기본): 수의 미디어·저널 RSS + 구글 뉴스 토픽 쿼리
  let gnewsTotal = 0;
  for (const feed of FEEDS) {
    try {
      const items = await fetchFeed(feed);
      if (feed.type === "gnews") {
        gnewsTotal += items.length;
        gnewsGroups.push(items);
      } else {
        console.log(`  [RSS] ${feed.name}: ${items.length}개`);
        candidates.push(...items);
      }
    } catch (err) {
      console.error(`  [RSS] ${feed.name}: 실패 — ${err.message}`);
    }
  }
  console.log(`  [Google News] 토픽 쿼리 ${gnewsGroups.length}개에서 ${gnewsTotal}개`);
  candidates.push(...roundRobin(gnewsGroups));

  // 2) Reddit API 직접 수집 (키가 있을 때만)
  if (hasRedditCreds) {
    for (const sub of SUBREDDITS) {
      try {
        const posts = await fetchWeeklyTop(sub.name);
        const filtered = redditRuleFilter(posts, sub.minScore);
        console.log(`  [Reddit] r/${sub.name}: ${posts.length}개 → 필터 후 ${filtered.length}개`);
        candidates.push(...filtered);
      } catch (err) {
        console.error(`  [Reddit] r/${sub.name}: 실패 — ${err.message}`);
      }
    }
  }

  // 3) Plan B (보조): Reddit 키가 없으면 Claude 웹 검색으로 레딧 시그널 수집
  if (!hasRedditCreds && useWebsearch && !noWebsearch && !collectOnly) {
    try {
      const signals = await searchRedditSignals();
      console.log(`  [웹 검색] 레딧 시그널: ${signals.length}개`);
      candidates.push(...signals);
    } catch (err) {
      console.error(`  [웹 검색] 실패 — ${err.message}`);
    }
  }

  // 중복 제거(URL + 제목 유사 기준) 후 상한 적용 — 같은 뉴스가 여러 쿼리·매체에 잡히는 것 대응
  const seen = new Set();
  const deduped = candidates.filter((c) => {
    const titleKey = c.title.toLowerCase().replace(/[^a-z0-9가-힣]/g, "").slice(0, 60);
    const keys = [c.url || c.id, titleKey];
    if (keys.some((k) => seen.has(k))) return false;
    keys.forEach((k) => seen.add(k));
    return true;
  });
  const nonReddit = deduped.filter((c) => c.sourceType !== "reddit");
  const reddit = deduped
    .filter((c) => c.sourceType === "reddit")
    .sort((a, b) => b.score - a.score);
  return [...nonReddit, ...reddit].slice(0, CANDIDATES_MAX);
}

async function main() {
  console.log("1/4 수집 중...");
  console.log(
    `  소스: RSS ${FEEDS.length}개${hasRedditCreds ? " + Reddit API" : ""}${!hasRedditCreds && useWebsearch && !noWebsearch && !collectOnly ? " + 웹 검색(레딧)" : ""}`
  );
  const seen = loadSeen();
  const collected = await collect();
  const candidates = collected.filter((c) => !seen.has(c.url));
  console.log(`  후보 총 ${collected.length}개 → 기소개분 제외 후 ${candidates.length}개`);

  if (collectOnly) {
    const out = path.join(ROOT, "data", "candidates.json");
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(candidates, null, 2));
    console.log(`수집 결과 저장: ${out}`);
    return;
  }

  if (candidates.length === 0) {
    console.error("후보가 없습니다. 종료합니다.");
    process.exit(1);
  }

  console.log("2/4 관련성 스코어링 중...");
  const selected = await scoreCandidates(candidates);
  console.log(`  선별 ${selected.length}개:`);
  for (const p of selected)
    console.log(`  [${p.relevance}] ${p.sourceLabel} — ${p.title.slice(0, 60)}`);

  console.log("3/4 원문 수집 + 기사 생성 중...");
  const items = [];
  for (const post of selected) {
    let comments = [];
    if (post.sourceType === "reddit") {
      try {
        comments = await fetchTopComments(post.subreddit, post.id, TOP_COMMENTS);
      } catch {
        console.warn(`  댓글 수집 실패 (${post.id}) — 본문만으로 진행`);
      }
    }
    // 원문 전문 + 대표 이미지 수집 (실패 시 RSS 요약으로 진행)
    if (post.sourceType === "rss") {
      const meta = await fetchArticleMeta(post.url);
      post.fullText = meta.fullText ?? null;
      post.imageUrl = meta.imageUrl ?? null;
      post.finalUrl = meta.finalUrl ?? null;
      console.log(
        `  · ${post.title.slice(0, 40)} — 전문 ${post.fullText ? "확보" : "없음(요약으로)"}, 이미지 ${post.imageUrl ? "○" : "×"}`
      );
    }
    try {
      const item = await generateItem(post, comments);
      items.push(item);
      console.log(`  ✓ ${item.titleKo}`);
    } catch (err) {
      console.error(`  ✗ 아이템 생성 실패, 건너뜀 (${post.title.slice(0, 40)}): ${err.message}`);
    }
  }

  if (items.length === 0) {
    console.error("생성된 아이템이 없습니다. 종료합니다.");
    process.exit(1);
  }

  const label = dateLabel();
  // 자동 발행 시 검수 필요 표시가 남은 아이템은 제외
  const finalItems = autoPublish ? items.filter((it) => !it.needsReview) : items;
  const issue = {
    date: label,
    status: autoPublish ? "published" : "draft",
    generatedAt: new Date().toISOString(),
    ...(autoPublish ? { publishedAt: new Date().toISOString() } : {}),
    items: finalItems,
  };
  const out = path.join(
    ROOT,
    "data",
    "issues",
    autoPublish ? `${label}.json` : `${label}.draft.json`
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(issue, null, 2));

  // 소개한 글을 seen 저장소에 기록 (다음 실행에서 중복 방지)
  for (const it of finalItems) seen.add(it.sourceUrl);
  saveSeen(seen);

  console.log(`4/4 완료 — ${autoPublish ? "발행" : "draft 저장"}: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
