// IndexNow 색인 요청. 네이버·빙·얀덱스 등이 지원하는 프로토콜로, 계정 로그인 없이
// "새 URL이 생겼다"고 알릴 수 있다. (구글은 IndexNow에 참여하지 않는다)
// 사이트 루트의 {key}.txt로 소유를 증명하므로 build.js가 그 파일을 항상 내보내야 한다.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SITE } from "../config.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ENDPOINTS = ["https://api.indexnow.org/indexnow", "https://www.bing.com/indexnow"];

// 사이트맵에서 제출할 URL을 읽는다(빌드 결과 기준이라 항상 최신)
function urlsFromSitemap() {
  const p = path.join(ROOT, "site", "sitemap.xml");
  if (!fs.existsSync(p)) return [];
  return [...fs.readFileSync(p, "utf8").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
}

export async function submitIndexNow(urls = urlsFromSitemap()) {
  const key = SITE.indexNowKey;
  if (!key) return { skipped: "indexNowKey 미설정" };
  if (!urls.length) return { skipped: "제출할 URL 없음" };
  const host = new URL(SITE.baseUrl).hostname;
  const body = JSON.stringify({
    host,
    key,
    keyLocation: `${SITE.baseUrl}/${key}.txt`,
    urlList: urls.slice(0, 10000), // IndexNow 1회 상한
  });

  const results = [];
  for (const ep of ENDPOINTS) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body,
        signal: AbortSignal.timeout(30000),
      });
      results.push(`${new URL(ep).hostname}: ${res.status}`);
    } catch (err) {
      results.push(`${new URL(ep).hostname}: 실패(${err.message})`);
    }
  }
  return { count: urls.length, results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  submitIndexNow()
    .then((r) => console.log("IndexNow:", JSON.stringify(r, null, 1)))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
