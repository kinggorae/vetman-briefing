// 발행 기사에 연결된 외부 대표 이미지의 실제 응답 상태를 점검한다.
// 이미지 서버가 HEAD를 막는 경우를 고려해 1바이트 Range GET으로 재시도한다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, "data", "issues");
const args = process.argv.slice(2);
const jsonIndex = args.indexOf("--json");
const jsonPath = jsonIndex >= 0 ? args[jsonIndex + 1] : null;
const maxBrokenIndex = args.indexOf("--max-broken");
const maxBroken = maxBrokenIndex >= 0 ? Number(args[maxBrokenIndex + 1]) : Infinity;
const timeoutMs = 10000;

function loadImageTargets() {
  const files = fs.readdirSync(DATA_DIR).filter((name) => /^\d{4}-\d{2}-\d{2}\.json$/.test(name)).sort().reverse();
  const seen = new Set();
  const targets = [];
  for (const file of files) {
    const issue = JSON.parse(fs.readFileSync(path.join(DATA_DIR, file), "utf8"));
    for (const item of issue.items || []) {
      const url = String(item.imageUrl || "").trim();
      if (!/^https?:\/\//i.test(url) || seen.has(url)) continue;
      seen.add(url);
      targets.push({ url, date: issue.date, title: item.titleKo || "" });
    }
  }
  return targets;
}

async function readResponse(url, method, headers = {}) {
  const response = await fetch(url, {
    method,
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const contentType = response.headers.get("content-type") || "";
  if (response.body) await response.body.cancel().catch(() => {});
  return { status: response.status, contentType, finalUrl: response.url || url };
}

function looksLikeImage(contentType, url) {
  if (/^image\//i.test(contentType)) return true;
  return /\.(?:avif|gif|jpe?g|png|svg|webp)(?:$|[?#])/i.test(url);
}

async function probe(target) {
  let head;
  try {
    head = await readResponse(target.url, "HEAD");
    if (head.status >= 200 && head.status < 400 && looksLikeImage(head.contentType, head.finalUrl)) {
      return { ...target, ok: true, status: head.status, contentType: head.contentType, finalUrl: head.finalUrl };
    }
  } catch (error) {
    head = { status: 0, contentType: "", error: error.message };
  }

  try {
    const get = await readResponse(target.url, "GET", { Range: "bytes=0-0", Accept: "image/avif,image/webp,image/*,*/*;q=0.1" });
    const ok = get.status >= 200 && get.status < 400 && looksLikeImage(get.contentType, get.finalUrl);
    return { ...target, ok, status: get.status, contentType: get.contentType, finalUrl: get.finalUrl, headStatus: head.status || null };
  } catch (error) {
    return { ...target, ok: false, status: head.status || 0, contentType: head.contentType || "", error: error.message };
  }
}

async function mapPool(items, worker, concurrency = 8) {
  const out = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      out[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return out;
}

const targets = loadImageTargets();
const results = await mapPool(targets, probe);
const broken = results.filter((result) => !result.ok);
const report = {
  checkedAt: new Date().toISOString(),
  total: results.length,
  ok: results.length - broken.length,
  broken: broken.length,
  brokenRate: results.length ? Number((broken.length / results.length).toFixed(4)) : 0,
  items: broken.map(({ url, date, title, status, contentType, finalUrl, headStatus, error }) => ({ url, date, title, status, contentType, finalUrl, headStatus, error })),
};

if (jsonPath) {
  fs.mkdirSync(path.dirname(path.resolve(jsonPath)), { recursive: true });
  fs.writeFileSync(path.resolve(jsonPath), JSON.stringify(report, null, 2) + "\n");
}

console.log(`이미지 점검: 전체 ${report.total}개 · 정상 ${report.ok}개 · 실패 ${report.broken}개 (${Math.round(report.brokenRate * 100)}%)`);
for (const item of broken.slice(0, 20)) console.warn(`  실패 ${item.status || "ERR"} ${item.url} — ${item.error || item.contentType || "이미지 응답 아님"}`);
if (broken.length > maxBroken) {
  console.error(`이미지 실패 ${broken.length}개가 허용치 ${maxBroken}개를 초과했습니다.`);
  process.exitCode = 1;
}
