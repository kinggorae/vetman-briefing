import fs from "node:fs/promises";
import { compareDeploymentPayload, inspectDeploymentPayload, inspectNewsSitemap } from "../src/lib/production-monitor.js";

const base = (process.env.VERIFY_BASE_URL || "https://news.vetmanlab.com").replace(/\/$/, "");
const attempts = Math.max(1, Number(process.env.VERIFY_ATTEMPTS || 6));
const delayMs = Math.max(0, Number(process.env.VERIFY_DELAY_MS || 5000));
const expected = JSON.parse(await fs.readFile("site/deployment.json", "utf8"));
const headers = { "user-agent": "VetManLab-deployment-verifier/1.0 (+https://news.vetmanlab.com/about)" };

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getJson(pathname) {
  const response = await fetch(`${base}${pathname}`, { redirect: "follow", signal: AbortSignal.timeout(15000), headers });
  const body = await response.text();
  let payload = null;
  try { payload = JSON.parse(body); } catch { /* included in the structured failure below */ }
  return { response, payload };
}

async function getText(pathname) {
  const response = await fetch(`${base}${pathname}`, { redirect: "follow", signal: AbortSignal.timeout(15000), headers });
  return { response, body: await response.text() };
}

function check(liveDeployment, liveLatest, liveRobots, liveNewsSitemap) {
  const critical = [];
  critical.push(...inspectDeploymentPayload(liveDeployment).critical.map((item) => ({ pathname: "/deployment.json", ...item })));
  critical.push(...compareDeploymentPayload(liveDeployment, expected).critical.map((item) => ({ pathname: "/deployment.json", ...item })));
  if (!liveLatest?.date || !/^\d{4}-\d{2}-\d{2}$/.test(String(liveLatest.date))) critical.push({ pathname: "/latest.json", reason: "latest-date-invalid" });
  if (String(liveLatest?.date || "") !== String(expected.latestDate || "")) critical.push({ pathname: "/latest.json", reason: "latest-date-mismatch", expected: expected.latestDate ?? null, actual: liveLatest?.date ?? null });
  for (const rule of ["Disallow: /admin", "Disallow: /raw"]) if (!String(liveRobots || "").includes(rule)) critical.push({ pathname: "/robots.txt", reason: `robots-rule-missing:${rule}` });
  critical.push(...inspectNewsSitemap(liveNewsSitemap, Number.isInteger(liveDeployment?.newsSitemapCount) ? liveDeployment.newsSitemapCount : null).critical.map((item) => ({ pathname: "/news-sitemap.xml", ...item })));
  return critical;
}

let last = [];
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const [deployment, latest, robots, newsSitemap] = await Promise.all([
      getJson("/deployment.json"),
      getJson("/latest.json"),
      fetch(`${base}/robots.txt`, { redirect: "follow", signal: AbortSignal.timeout(15000), headers }).then(async (response) => ({ response, body: await response.text() })),
      getText("/news-sitemap.xml"),
    ]);
    last = [];
    if (!deployment.response.ok || !deployment.payload) last.push({ pathname: "/deployment.json", reason: `http-${deployment.response.status}` });
    if (!latest.response.ok || !latest.payload) last.push({ pathname: "/latest.json", reason: `http-${latest.response.status}` });
    if (!robots.response.ok) last.push({ pathname: "/robots.txt", reason: `http-${robots.response.status}` });
    if (!newsSitemap.response.ok) last.push({ pathname: "/news-sitemap.xml", reason: `http-${newsSitemap.response.status}` });
    if (!last.length) last.push(...check(deployment.payload, latest.payload, robots.body, newsSitemap.body));
    if (!last.length) {
      console.log(`deployment verified: ${base} · source ${deployment.payload.sourceCommit} · latest ${deployment.payload.latestDate}`);
      process.exit(0);
    }
  } catch (error) {
    last = [{ reason: error.name === "TimeoutError" ? "timeout" : error.message }];
  }
  if (attempt < attempts && delayMs) await wait(delayMs);
}

console.error(`deployment verification failed after ${attempts} attempts`);
console.error(JSON.stringify({ base, expected, critical: last }, null, 2));
process.exit(1);
