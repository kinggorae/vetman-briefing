import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const search = JSON.parse(fs.readFileSync("site/search.json", "utf8"));
const audit = JSON.parse(fs.readFileSync("site/admin-review.json", "utf8"));
const indexPath = new URL(search.items[0].url).pathname;
const noindexPath = new URL(audit.rows.find((row) => !row.indexable).generatedUrl).pathname;
const topicFile = fs.readdirSync("site/topic").find((file) => file !== "index.html" && file.endsWith(".html"));
const topicPath = `/topic/${topicFile?.replace(/\.html$/, "") || ""}`;

async function inspect(page, url) {
  const consoleErrors = [];
  const requestFailures = [];
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("requestfailed", (request) => requestFailures.push({ url: request.url(), error: request.failure()?.errorText }));
  const response = await page.goto(url, { waitUntil: "networkidle" });
  expect(response?.status(), url).toBe(200);
  await expect(page.locator("h1").first()).toBeVisible();
  expect(await page.locator("h1").count(), url).toBeGreaterThanOrEqual(1);
  expect(await page.locator("body").evaluate((body) => body.scrollWidth <= window.innerWidth + 1), `horizontal overflow: ${url}`).toBe(true);
  for (const image of await page.locator("img").all()) {
    const src = await image.getAttribute("src");
    expect(await image.getAttribute("alt"), `image alt: ${url} ${src}`).not.toBeNull();
    // 정적 로컬 preview의 절대 production URL은 브라우저가 운영 호스트를
    // 직접 요청하므로, 로컬에 대응 파일이 있는지로 대표 이미지 존재를 검증한다.
    const localAsset = src?.startsWith("https://news.vetmanlab.com/") ? path.join("site", new URL(src).pathname.replace(/^\//, "")) : null;
    const valid = localAsset && fs.existsSync(localAsset) ? true : await image.evaluate((node) => node.complete && node.naturalWidth > 0);
    expect(valid, `broken image: ${url} ${src}`).toBe(true);
  }
  expect(consoleErrors, `console errors: ${url}`).toEqual([]);
  expect(requestFailures.filter((item) => item.url.startsWith("http://127.0.0.1:8788")), `local request failures: ${url}`).toEqual([]);
  return { url, status: response?.status(), consoleErrors, requestFailures };
}

test("core public pages render without browser regressions", async ({ page }) => {
  for (const url of ["/", indexPath, noindexPath, topicPath, "/archive/", "/weekly/2026-W30.html"]) {
    await inspect(page, url);
  }
  const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonical).toContain("news.vetmanlab.com");
});

test("index and noindex policy is visible in browser", async ({ page }) => {
  await page.goto(indexPath, { waitUntil: "networkidle" });
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /index/);
  await page.goto(noindexPath, { waitUntil: "networkidle" });
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
});

test("feeds and administrator remain available and protected", async ({ page, request }) => {
  for (const pathName of ["/rss.xml", "/sitemap.xml", "/news-sitemap.xml", "/robots.txt"]) expect((await request.get(pathName)).status()).toBe(200);
  await page.goto("/admin-ui.html", { waitUntil: "domcontentloaded" });
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", /noindex/);
  await expect(page.locator("input[type=password]")).toBeVisible();
  expect((await request.get("/admin-review.json")).status()).toBe(401);
});

test("public pages pass axe critical checks and keyboard focus is visible", async ({ page }) => {
  await page.goto(indexPath, { waitUntil: "networkidle" });
  const results = await new AxeBuilder({ page }).analyze();
  const critical = results.violations.filter((item) => item.impact === "critical");
  expect(critical, JSON.stringify(critical)).toEqual([]);
  await page.keyboard.press("Tab");
  expect(await page.locator(":focus").count()).toBeGreaterThan(0);
});

test("homepage lead is complete and compact article opens before hydration", async ({ page }) => {
  const dataRequests = [];
  await page.route("**/data/*.json", async (route) => {
    dataRequests.push(route.request().url());
    await new Promise((resolve) => setTimeout(resolve, 2_000));
    await route.continue();
  });
  await page.goto("/", { waitUntil: "domcontentloaded" });

  const payload = await page.locator("#vm-issue").evaluate((node) => JSON.parse(node.textContent || "{}"));
  expect(payload.articles[0].body?.length).toBeGreaterThan(0);
  expect(payload.articles[1].body?.length).toBeGreaterThan(0);
  expect(payload.articles[1].readReady).toBe(true);
  await expect(page.locator(".vm-fp-body")).not.toBeEmpty();

  await page.locator("article[data-open]").nth(1).click();
  await expect(page.locator('.vm-detail[role="dialog"]')).toBeVisible({ timeout: 1_000 });
  await expect(page.getByText("기사 본문을 불러오는 중…")).toHaveCount(0);
  await expect(page.locator("#vm-detail-title")).toBeVisible();
  await expect(page.locator(".vm-detail-body")).toContainText(payload.articles[1].body[0].slice(0, 30));
  expect(dataRequests).toEqual([]);
});

test("article detail has a shareable URL and browser history closes the panel", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const homeUrl = page.url();
  await page.locator("article[data-open]").nth(1).click();
  await expect(page.locator('.vm-detail[role="dialog"]')).toBeVisible();
  await expect(page).toHaveURL(/\/article\//);

  await page.goBack();
  await expect(page).toHaveURL(homeUrl);
  await expect(page.locator('.vm-detail[role="dialog"]')).toHaveCount(0);

  await page.locator("article[data-open]").nth(1).click();
  await expect(page.locator('.vm-detail[role="dialog"]')).toBeVisible();
  await page.locator('.vm-detail[role="dialog"] button[title="닫기"]').click();
  await expect(page).toHaveURL(homeUrl);
  await expect(page.locator('.vm-detail[role="dialog"]')).toHaveCount(0);
});

test("search can be cleared and mobile navigation keeps personal views reachable", async ({ page }) => {
  await page.goto("/", { waitUntil: "domcontentloaded" });
  const searchInput = page.locator("#vm-q");
  await searchInput.fill("고양이");
  await expect(page.getByRole("button", { name: "검색어 지우기" })).toBeVisible();
  await page.getByRole("button", { name: "검색어 지우기" }).click();
  await expect(searchInput).toHaveValue("");

  const mobileNav = page.getByRole("navigation", { name: "모바일 빠른 메뉴" });
  if ((page.viewportSize()?.width || 0) <= 900) {
    await expect(mobileNav).toBeVisible();
    for (const label of ["글감함", "저장", "지난 브리핑"]) await expect(mobileNav.getByRole("button", { name: new RegExp(label) })).toBeVisible();
  } else {
    await expect(mobileNav).toBeHidden();
  }
});
