import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#17181c"/><rect x="104" y="104" width="136" height="136" rx="36" fill="#fff" opacity=".34"/><rect x="272" y="104" width="136" height="136" rx="36" fill="#fff" opacity=".58"/><rect x="104" y="272" width="136" height="136" rx="36" fill="#fff" opacity=".82"/><rect x="272" y="272" width="136" height="136" rx="36" fill="#fff"/></svg>`;
for (const size of [48, 192, 512]) await sharp(Buffer.from(svg)).resize(size, size).png({ compressionLevel: 9 }).toFile(path.join(ROOT, "assets", `icon-${size}.png`));
console.log("브랜드 아이콘 생성: 48/192/512px");
