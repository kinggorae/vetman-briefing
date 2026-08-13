import test from "node:test";
import assert from "node:assert/strict";
import { validateSeoContract } from "../src/lib/seo-contract.js";

const articleUrl = "https://news.vetmanlab.com/article/demo";
const article = `<!doctype html><html><head><title>기사 제목 | VetManLab</title><meta name="description" content="수의사가 읽을 수 있는 충분히 긴 기사 설명입니다. 원문과 편집 정보를 함께 제공합니다."><meta name="robots" content="index, follow"><meta property="og:url" content="${articleUrl}"><meta property="og:title" content="기사 제목"><meta property="og:description" content="기사 설명"><meta property="og:image" content="https://news.vetmanlab.com/card.webp"><link rel="canonical" href="${articleUrl}"><script type="application/ld+json">${JSON.stringify({ "@type": "NewsArticle", headline: "기사 제목", url: articleUrl, image: "https://news.vetmanlab.com/card.webp" })}</script></head><body><h1>기사 제목</h1></body></html>`;

test("SEO contract accepts a complete indexable article", () => {
  const result = validateSeoContract({ url: articleUrl, html: article });
  assert.deepEqual(result.critical, []);
  assert.equal(result.kind, "article");
});

test("SEO contract rejects noindex and mismatched canonical signals", () => {
  const result = validateSeoContract({
    url: articleUrl,
    html: article
      .replace(`<link rel="canonical" href="${articleUrl}">`, `<link rel="canonical" href="https://news.vetmanlab.com/article/other">`)
      .replace("index, follow", "noindex, follow"),
  });
  assert.ok(result.critical.some((item) => item.reason === "canonical-mismatch"));
  assert.ok(result.critical.some((item) => item.reason === "sitemap-page-noindex"));
});

test("SEO contract accepts a collection page with CollectionPage JSON-LD", () => {
  const url = "https://news.vetmanlab.com/topic/";
  const html = `<title>주제별 보기 | VetManLab</title><meta name="description" content="해외 수의 소식을 주제별로 모은 페이지입니다. 기사와 연구를 함께 확인할 수 있습니다."><meta name="robots" content="index, follow"><meta property="og:url" content="${url}"><meta property="og:title" content="주제별 보기"><meta property="og:description" content="주제별 모음"><link rel="canonical" href="${url}"><script type="application/ld+json">${JSON.stringify({ "@type": "CollectionPage", url })}</script><h1>주제별 보기</h1>`;
  assert.deepEqual(validateSeoContract({ url, html }).critical, []);
});
