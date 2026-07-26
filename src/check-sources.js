// 수집 소스의 HTTP 응답·RSS 형식·항목 수를 점검한다.
// 일일 발행이 우연히 성공해도 특정 소스군이 며칠째 죽어 있으면 발견이 늦으므로,
// 파이프라인과 별도의 운영 리포트로 남긴다.
import fs from "node:fs";
import path from "node:path";
import { FEEDS } from "../config.js";

const args = process.argv.slice(2);
const jsonIndex = args.indexOf("--json");
const jsonPath = jsonIndex >= 0 ? args[jsonIndex + 1] : null;
const maxFailedIndex = args.indexOf("--max-failed");
const maxFailed = maxFailedIndex >= 0 ? Number(args[maxFailedIndex + 1]) : 12;
const timeoutMs = 20000;
const UA = "VetManLab Source Health/1.0 (+https://news.vetmanlab.com/about)";

function itemCount(xml) {
  return (xml.match(/<(?:item|entry)(?:\s|>)/gi) || []).length;
}

function looksLikeFeed(xml, contentType) {
  return /xml|rss|atom/i.test(contentType) || /<(?:rss|feed|rdf:RDF)\b/i.test(xml.slice(0, 5000));
}

function latestPublishedAt(xml) {
  const values = [...xml.matchAll(/<(?:pubDate|published|updated|dc:date)[^>]*>([\s\S]*?)<\/(?:pubDate|published|updated|dc:date)>/gi)]
    .map((match) => match[1].replace(/<!\[CDATA\[|\]\]>/g, "").replace(/<[^>]+>/g, "").trim())
    .map((value) => new Date(value))
    .filter((date) => !Number.isNaN(date.getTime()));
  if (!values.length) return null;
  return new Date(Math.max(...values.map((date) => date.getTime()))).toISOString();
}

async function check(feed, index) {
  const started = Date.now();
  try {
    const response = await fetch(feed.url, {
      headers: { "User-Agent": UA, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" },
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
    });
    const contentType = response.headers.get("content-type") || "";
    const xml = await response.text();
    const items = itemCount(xml);
    const formatOk = looksLikeFeed(xml, contentType);
    const ok = response.ok && formatOk;
    const latest = latestPublishedAt(xml);
    const ageHours = latest ? Number(((Date.now() - new Date(latest).getTime()) / 3600000).toFixed(1)) : null;
    const allowedAgeHours = ((feed.maxAgeDays ?? 10) + 2) * 24;
    return {
      index,
      name: feed.name,
      type: feed.type || "rss",
      group: feed.type === "gnews" ? "gnews" : "direct",
      market: feed.market || (feed.type === "gnews" ? "GLOBAL" : "DIRECT"),
      host: new URL(feed.url).hostname,
      status: response.status,
      ok,
      formatOk,
      items,
      latestPublishedAt: latest,
      ageHours,
      stale: Boolean(ageHours != null && ageHours > allowedAgeHours),
      contentType,
      finalUrl: response.url || feed.url,
      elapsedMs: Date.now() - started,
      error: ok ? null : response.ok ? "RSS/XML 형식이 아닙니다" : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      index,
      name: feed.name,
      type: feed.type || "rss",
      group: feed.type === "gnews" ? "gnews" : "direct",
      market: feed.market || (feed.type === "gnews" ? "GLOBAL" : "DIRECT"),
      host: (() => { try { return new URL(feed.url).hostname; } catch { return ""; } })(),
      status: 0,
      ok: false,
      formatOk: false,
      items: 0,
      latestPublishedAt: null,
      ageHours: null,
      stale: false,
      contentType: "",
      finalUrl: feed.url,
      elapsedMs: Date.now() - started,
      error: error.message,
    };
  }
}

async function mapPool(items, worker, concurrency = 8) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await worker(items[index], index);
    }
  });
  await Promise.all(runners);
  return out;
}

const results = await mapPool(FEEDS, check);
const failed = results.filter((result) => !result.ok);
const gnews = results.filter((result) => result.group === "gnews");
const direct = results.filter((result) => result.group === "direct");
const markets = Object.fromEntries(
  [...new Set(results.map((result) => result.market))].sort().map((market) => {
    const rows = results.filter((result) => result.market === market);
    return [market, { total: rows.length, ok: rows.filter((result) => result.ok).length, items: rows.reduce((sum, result) => sum + result.items, 0) }];
  })
);
const report = {
  checkedAt: new Date().toISOString(),
  total: results.length,
  ok: results.length - failed.length,
  failed: failed.length,
  direct: { total: direct.length, ok: direct.filter((result) => result.ok).length, failed: direct.filter((result) => !result.ok).length },
  gnews: { total: gnews.length, ok: gnews.filter((result) => result.ok).length, failed: gnews.filter((result) => !result.ok).length },
  markets,
  stale: results.filter((result) => result.stale).length,
  items: results,
};

if (jsonPath) {
  fs.mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true });
  fs.writeFileSync(path.resolve(jsonPath), JSON.stringify(report, null, 2) + "\n");
}

const summary = `소스 점검: 전체 ${report.total}개 · 정상 ${report.ok}개 · 실패 ${report.failed}개 · 지연 ${report.stale}개 (직접 ${report.direct.ok}/${report.direct.total}, Google News ${report.gnews.ok}/${report.gnews.total})`;
console.log(summary);
for (const result of failed) console.warn(`  실패 ${result.name} · ${result.host} · ${result.error}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  const rows = results
    .map((result) => `| ${result.name} | ${result.market} | ${result.ok ? (result.stale ? "지연" : "정상") : "실패"} | ${result.status || "-"} | ${result.items} | ${result.latestPublishedAt || "-"} | ${result.elapsedMs}ms |`)
    .join("\n");
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Source health\n\n${summary}\n\n| 소스 | 시장 | 상태 | HTTP | 항목 | 마지막 발행 | 시간 |\n|---|---|---|---:|---:|---|---:|\n${rows}\n`);
}

// 개별 소스 하나의 일시 장애는 허용한다. 다만 소스군 전체가 죽었거나
// 실패 수가 임계치를 넘으면 발행을 진행하지 않아 빈약한 하루를 막는다.
if (failed.length > maxFailed || (gnews.length > 0 && gnews.every((result) => !result.ok))) {
  console.error(`소스 장애 ${failed.length}개가 허용 범위를 넘었습니다.`);
  process.exitCode = 1;
}
