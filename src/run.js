import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FEEDS, SUBREDDITS, CANDIDATES_MAX, TOP_COMMENTS, PAPERS_PER_ISSUE } from "../config.js";
import { fetchFeed } from "./rss.js";
import { fetchWeeklyTop, fetchTopComments } from "./reddit.js";
import { redditRuleFilter, scoreCandidates, scoreAll, scoreTiered } from "./select.js";
import { generateItem, generatePaper, generateBrief } from "./generate.js";
import { fetchArticleMeta } from "./article.js";
import { fetchPubmed } from "./pubmed.js";
import { searchRedditSignals } from "./websearch.js";
import { IS_COMPAT } from "./llm.js";
import { enrichItems } from "./enrich.js";
import { addStories } from "./gossip.js";
import { mapPool } from "./pool.js";
import { addSourceKeys, sourceKeys, stableItemId, titleKey } from "./identity.js";
import { markQuality, publishQualityIssues } from "./quality.js";
import { removeRepeatedImages } from "./images.js";

const noPapers = process.argv.includes("--no-papers");
const papersOnly = process.argv.includes("--papers-only"); // 오늘 이슈에 논문만 추가 병합

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
    const set = new Set();
    for (const url of JSON.parse(fs.readFileSync(SEEN_PATH, "utf8")).urls || []) addSourceKeys(set, url);
    return set;
  } catch {
    return new Set();
  }
}

function saveSeen(seen) {
  // 전세계 권역별 피드가 하루 수백 건을 공급하므로 2,000건만 남기면 며칠 전
  // 기사가 다른 국가판 Google News를 통해 다시 들어온다. 충분한 기간을 보존해
  // 후보·LLM 비용과 중복 발행을 함께 줄인다.
  const urls = [...seen].slice(-20000);
  fs.mkdirSync(path.dirname(SEEN_PATH), { recursive: true });
  fs.writeFileSync(SEEN_PATH, JSON.stringify({ urls }, null, 2));
}

function withIdentity(item, post, fallback = "item") {
  return markQuality({
    ...item,
    market: item.market || post.market || null,
    id: item.id || stableItemId({ ...post, ...item }, fallback),
    sourceUrl: item.sourceUrl || post.finalUrl || post.url,
    sourceUrlRaw: item.sourceUrlRaw || post.url || null,
  });
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
    const keys = [...sourceKeys(c), titleKey(c.title)];
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

async function papersOnlyRun() {
  const seen = loadSeen();
  const label = dateLabel();
  const issuePath = path.join(ROOT, "data", "issues", `${label}.json`);
  const issue = fs.existsSync(issuePath)
    ? JSON.parse(fs.readFileSync(issuePath, "utf8"))
    : { date: label, status: "published", generatedAt: new Date().toISOString(), publishedAt: new Date().toISOString(), items: [] };
  const existing = new Set();
  issue.items.forEach((it) => addSourceKeys(existing, it));
  console.log("최신 연구(PubMed) 수집·생성 중...");
  const papersRaw = (await fetchPubmed()).filter((p) => !sourceKeys(p).some((key) => seen.has(key) || existing.has(key)));
  console.log(`  논문 후보 ${papersRaw.length}편`);
  const top = await scoreAll(papersRaw, PAPERS_PER_ISSUE);
  console.log(`  선별 ${top.length}편`);
  const made = (
    await mapPool(top, async (post) => {
      const paper = withIdentity(await generatePaper(post), post, `paper-${post.id || post.url}`);
      if (publishQualityIssues(paper).length) return null;
      console.log(`  ✓ [논문] ${paper.titleKo}`);
      return paper;
    })
  ).filter(Boolean);
  made.forEach((paper) => {
    issue.items.push(paper);
    addSourceKeys(seen, paper);
  });
  const added = made.length;
  try {
    await enrichItems(issue.items); // radar 없는 항목만 채움
  } catch (err) {
    console.error(`  레이더 생성 실패, 건너뜀: ${err.message}`);
  }
  removeRepeatedImages(issue.items);
  fs.mkdirSync(path.dirname(issuePath), { recursive: true });
  fs.writeFileSync(issuePath, JSON.stringify(issue, null, 2));
  saveSeen(seen);
  console.log(`논문 ${added}편 병합 → ${issuePath} (총 ${issue.items.length}건)`);
}

async function main() {
  if (papersOnly) return papersOnlyRun();
  console.log("1/4 수집 중...");
  console.log(
    `  소스: RSS ${FEEDS.length}개${hasRedditCreds ? " + Reddit API" : ""}${!hasRedditCreds && useWebsearch && !noWebsearch && !collectOnly ? " + 웹 검색(레딧)" : ""}`
  );
  const seen = loadSeen();
  const collected = await collect();
  const candidates = collected.filter((c) => !sourceKeys(c).some((key) => seen.has(key)));
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
  // 한 번 스코어링해 심층/브리프 두 계층으로 나눈다(스코어링 중복 방지).
  const { deep: selected, brief: briefCandidates } = await scoreTiered(candidates);
  console.log(`  심층 선별 ${selected.length}개 / 브리프 후보 ${briefCandidates.length}개`);
  for (const p of selected)
    console.log(`  [${p.relevance}] ${p.sourceLabel} — ${p.title.slice(0, 60)}`);

  console.log("3/4 원문 수집 + 기사 생성 중...");
  // 순차 처리하면 일간 실행이 100분을 넘겨 Actions 무료 한도를 잠식한다.
  // 결과물은 그대로 두고 대기 시간만 줄이려 소수 동시 실행을 쓴다.
  const items = (
    await mapPool(selected, async (post) => {
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
      }
      const item = withIdentity(await generateItem(post, comments), post, `article-${post.id || post.url}`);
      console.log(`  ✓ ${item.titleKo}`);
      return item;
    })
  ).filter(Boolean);

  if (items.length === 0) {
    console.error("생성된 아이템이 없습니다. 종료합니다.");
    process.exit(1);
  }

  // ── 최신 연구: PubMed 논문 ──
  if (!noPapers) {
    try {
      console.log("+ 최신 연구(PubMed) 수집·생성 중...");
    const papersRaw = (await fetchPubmed()).filter((p) => !sourceKeys(p).some((key) => seen.has(key)));
      console.log(`  논문 후보 ${papersRaw.length}편`);
      if (papersRaw.length) {
        const topPapers = await scoreAll(papersRaw, PAPERS_PER_ISSUE);
        console.log(`  논문 선별 ${topPapers.length}편`);
        const papers = (
          await mapPool(topPapers, async (post) => {
            const paper = withIdentity(await generatePaper(post), post, `paper-${post.id || post.url}`);
            console.log(`  ✓ [논문] ${paper.titleKo}`);
            return paper;
          })
        ).filter(Boolean);
        items.push(...papers);
      }
    } catch (err) {
      console.error(`  최신 연구 수집 실패, 건너뜀: ${err.message}`);
    }
  }

  // ── 레이더(조기경보): 보호자·진료 레이더 + 논문 근거등급 ──
  // 다른 수의 매체가 주지 않는 실행형 인텔리전스. 실패해도 발행은 계속한다.
  try {
    console.log("+ 레이더(보호자·진료·근거) 생성 중...");
    await enrichItems(items);
  } catch (err) {
    console.error(`  레이더 생성 실패, 건너뜀: ${err.message}`);
  }

  // ── 진료실 밖 이야기(가십·화제성 썰) — 신뢰 뉴스와 분리된 별도 섹션 ──
  try {
    console.log("+ 진료실 밖 이야기(가십) 수집·생성 중...");
    await addStories(items, seen);
  } catch (err) {
    console.error(`  진료실 밖 이야기 생성 실패, 건너뜀: ${err.message}`);
  }

  // ── 브리프(간추린 소식) — 심층 탈락분을 짧은 소식으로. 개별 페이지 없음, 색인 X ──
  // 레이더 없이 1콜만 쓰므로 심층 대비 시간·비용이 훨씬 적다(무료 예산 안에서 볼륨 확보).
  if (briefCandidates.length) {
    try {
      console.log(`+ 브리프(간추린 소식) 생성 중... (후보 ${briefCandidates.length}개)`);
      const briefs = (
        await mapPool(briefCandidates, async (post) => {
          if (post.sourceType === "rss") {
            try {
              const meta = await fetchArticleMeta(post.url);
              post.fullText = meta.fullText ?? null;
            } catch {}
          }
          const b = withIdentity(await generateBrief(post), post, `brief-${post.id || post.url}`);
          addSourceKeys(seen, b);
          return b;
        })
      ).filter(Boolean);
      console.log(`  브리프 ${briefs.length}건 생성`);
      items.push(...briefs);
    } catch (err) {
      console.error(`  브리프 생성 실패, 건너뜀: ${err.message}`);
    }
  }

  const label = dateLabel();
  // 자동 발행 시 공개 차단 품질 플래그가 남은 아이템만 제외한다.
  // paragraphs-too-few 같은 편집 경고까지 needsReview 전체로 막으면
  // 공급량이 불필요하게 줄어든다. 실제 차단 기준은 quality.js 한 곳을 따른다.
  let newItems = autoPublish ? items.filter((it) => publishQualityIssues(it).length === 0) : items;

  // ── 발행 게이트 ──
  // 본문이 짧고 레이더 3블록이 모두 비면, 그 페이지에 남는 건 남의 기사 요약뿐이다.
  // 검색엔진에는 재작성 콘텐츠로, 독자에게는 빈 페이지로 보인다. 발행하지 않는다.
  if (autoPublish) {
    const before = newItems.length;
    newItems = newItems.filter((it) => {
      if (it.category === "watercooler") return true; // 별도 섹션 — 레이더 대상 아님
      if (it.tier === "brief") return true; // 브리프 — 짧은 게 정상, 색인 안 함(게이트 예외)
      const r = it.radar || {};
      const hasValue = r.clinical || r.owner || r.evidence;
      const len = (it.bodyKo || []).join("").length;
      if (!hasValue && len < 600) {
        console.log(`  ✕ [게이트] 부가가치 없음(${len}자) — ${(it.titleKo || "").slice(0, 34)}`);
        return false;
      }
      return true;
    });
    if (before !== newItems.length) console.log(`  게이트 통과 ${newItems.length}/${before}건`);
  }
  const removedRepeatedImages = removeRepeatedImages(newItems);
  if (removedRepeatedImages) console.log(`  이미지 정리 ${removedRepeatedImages}건 — 공통 대표 이미지 제거`);
  const out = path.join(
    ROOT,
    "data",
    "issues",
    autoPublish ? `${label}.json` : `${label}.draft.json`
  );
  fs.mkdirSync(path.dirname(out), { recursive: true });

  // 같은 날짜 이슈가 이미 있으면 덮어쓰지 말고 병합(기존 유지 + 신규 비중복 추가).
  // 하루에 여러 번 실행되어도 기존 발행분이 사라지지 않도록 방어한다.
  let issue;
  if (fs.existsSync(out)) {
    issue = JSON.parse(fs.readFileSync(out, "utf8"));
    const existingUrls = new Set();
    (issue.items || []).forEach((it) => addSourceKeys(existingUrls, it));
    const added = newItems.filter((it) => !sourceKeys(it).some((key) => existingUrls.has(key)));
    issue.items = [...(issue.items || []), ...added];
    issue.generatedAt = new Date().toISOString();
    if (autoPublish) issue.status = "published";
    issue.items.sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
    console.log(`  기존 이슈 병합: 기존 ${existingUrls.size}건 + 신규 ${added.length}건 = ${issue.items.length}건`);
  } else {
    issue = {
      date: label,
      status: autoPublish ? "published" : "draft",
      generatedAt: new Date().toISOString(),
      ...(autoPublish ? { publishedAt: new Date().toISOString() } : {}),
      items: newItems,
    };
  }
  fs.writeFileSync(out, JSON.stringify(issue, null, 2));

  // 소개한 글을 seen 저장소에 기록 (다음 실행에서 중복 방지)
  for (const it of newItems) addSourceKeys(seen, it);
  saveSeen(seen);

  console.log(`4/4 완료 — ${autoPublish ? "발행" : "draft 저장"}: ${out} (총 ${issue.items.length}건)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
