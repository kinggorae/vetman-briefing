const fs = require("node:fs");
const firstArticle = JSON.parse(fs.readFileSync("site/search.json", "utf8")).items?.[0]?.url;
const topicFile = fs.readdirSync("site/topic").find((file) => file.endsWith(".html") && file !== "index.html");
const origin = "http://127.0.0.1:8788";
module.exports = {
  ci: {
    collect: {
      numberOfRuns: 3,
      startServerCommand: "npm run dev",
      startServerReadyPattern: "Ready|Listening|http://",
      startServerReadyTimeout: 120000,
      url: [origin + "/", firstArticle ? origin + new URL(firstArticle).pathname : origin + "/", topicFile ? origin + "/topic/" + encodeURIComponent(topicFile.replace(/\.html$/, "")) : origin + "/topic/"],
    },
    assert: {
      assertions: {
        "categories:performance": ["warn", { minScore: 0.8 }],
        "categories:accessibility": ["error", { minScore: 0.95 }],
        "categories:best-practices": ["error", { minScore: 0.9 }],
        "categories:seo": ["error", { minScore: 0.95 }],
        "cumulative-layout-shift": ["warn", { maxNumericValue: 0.1 }],
        "largest-contentful-paint": ["warn", { maxNumericValue: 2500 }],
      },
    },
    upload: { target: "filesystem", outputDir: "reports/lighthouse" },
  },
};
