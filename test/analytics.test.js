import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const BUILD = fs.readFileSync(path.join(ROOT, "src", "build.js"), "utf8");

test("GA4 disables the implicit page view and sends an explicit initial page view", () => {
  assert.match(BUILD, /gtag\('config','\$\{esc\(id\)\}',\{send_page_view:false\}\)/);
  assert.match(BUILD, /gtag\('event','page_view',\{page_title:document\.title,page_location:window\.location\.href\}\)/);
});

test("SPA article navigation sends virtual page views and article events", () => {
  assert.match(BUILD, /function trackPageView\(a,href\)/);
  assert.match(BUILD, /var lastVirtualPage=location\.href\+'\|'\+BASE_PAGE_TITLE/);
  assert.match(BUILD, /page_location:url\.href/);
  assert.match(BUILD, /gtag\('event','article_view'/);
  assert.match(BUILD, /trackPageView\(article,article\.href\)/);
});
