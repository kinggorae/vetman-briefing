import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { TOPICS } from "../config.js";
import { normalizeSourceUrl } from "../src/identity.js";
import { isProfessionallyIndexable } from "../src/lib/quality.js";
import {
  EDITORIAL_CARD_DIR,
  cardAssetPath,
  cardRelativePath,
  editorialCardSvg,
} from "../src/editorial-cards.js";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA_DIR = path.join(ROOT, "data", "issues");
const ASSET_DIR = path.join(ROOT, "assets", EDITORIAL_CARD_DIR);
const DRY_RUN = process.argv.includes("--dry-run");

async function loadItems() {
  const files = (await fs.readdir(DATA_DIR))
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .sort()
    .reverse();
  const items = [];
  for (const file of files) {
    const issue = JSON.parse(await fs.readFile(path.join(DATA_DIR, file), "utf8"));
    for (const [index, item] of (issue.items || []).entries()) items.push({ file, index, item });
  }
  return items;
}

function topicFor(item) {
  const text = [item.titleKo, item.leadKo, item.radar?.clinical].filter(Boolean).join(" ");
  return TOPICS.find((topic) => topic.match.test(text))?.name || "수의학 전문 브리핑";
}

async function main() {
  const items = await loadItems();
  const seen = new Set();
  const targets = [];
  for (const { file, index, item } of items) {
    const source = normalizeSourceUrl(item.sourceUrl || item.finalUrl || item.sourceUrlRaw || "");
    const duplicate = Boolean(source && seen.has(source));
    if (source) seen.add(source);
    if (!isProfessionallyIndexable(item, { duplicate }) || item.imageUrl) continue;
    const id = item.id || `${file.slice(0, 10)}_${index + 1}`;
    targets.push({ id, title: item.titleKo || "수의학 기사", category: item.category, topic: topicFor(item) });
  }

  if (!DRY_RUN) {
    await fs.rm(ASSET_DIR, { recursive: true, force: true });
    await fs.mkdir(ASSET_DIR, { recursive: true });
  }
  let generated = 0;
  for (const target of targets) {
    const svg = editorialCardSvg(target);
    if (!DRY_RUN) {
      await fs.writeFile(cardAssetPath(path.join(ROOT, "assets"), target.id, "svg"), svg);
      const input = Buffer.from(svg);
      await sharp(input).png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(cardAssetPath(path.join(ROOT, "assets"), target.id, "png"));
      await sharp(input).webp({ quality: 86, effort: 6 }).toFile(cardAssetPath(path.join(ROOT, "assets"), target.id, "webp"));
    }
    generated++;
  }
  const result = { generated, sourceDir: `assets/${EDITORIAL_CARD_DIR}`, filesPerCard: 3, dryRun: DRY_RUN };
  console.log(`편집용 카드 ${DRY_RUN ? "예상" : "생성"}: ${generated}개 · SVG/WebP/PNG · ${cardRelativePath(targets[0]?.id || "sample")}`);
  if (process.env.MEDIA_CARD_REPORT) await fs.writeFile(process.env.MEDIA_CARD_REPORT, JSON.stringify(result, null, 2) + "\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
