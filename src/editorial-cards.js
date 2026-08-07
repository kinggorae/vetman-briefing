import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const CATEGORY_LABELS = {
  research: "최신 연구",
  clinical: "임상",
  practice_management: "병원 경영",
  career: "커리어",
  client_communication: "보호자 소통",
  industry: "업계",
  watercooler: "진료실 밖 이야기",
  other: "기타",
};

const COLORS = {
  research: ["#172554", "#2563eb", "#dbeafe"],
  clinical: ["#102a43", "#0f766e", "#ccfbf1"],
  practice_management: ["#312e81", "#7c3aed", "#ede9fe"],
  career: ["#3f1d38", "#be185d", "#fce7f3"],
  client_communication: ["#422006", "#c2410c", "#ffedd5"],
  industry: ["#1f2937", "#475569", "#e2e8f0"],
  other: ["#1f2937", "#2563eb", "#dbeafe"],
};

export const EDITORIAL_CARD_WIDTH = 1200;
export const EDITORIAL_CARD_HEIGHT = 630;
export const EDITORIAL_CARD_DIR = "media/editorial";

export function cardFileName(id, hash) {
  const safe = String(id || "article").replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 80);
  const base = safe || "article";
  return hash ? `${base}-${hash}` : base;
}

export function cardRelativePath(id, extension = "webp", hash) {
  return `/${EDITORIAL_CARD_DIR}/${cardFileName(id, hash)}.${extension}`;
}

export function cardAssetPath(root, id, extension = "webp", hash) {
  return path.join(root, EDITORIAL_CARD_DIR, `${cardFileName(id, hash)}.${extension}`);
}

// 카드 URL에 콘텐츠 해시를 넣어 /media/editorial/*의 1년 immutable 캐시를
// 안전하게 만든다. id만으로 파일명을 정하면, 카테고리 재분류나 폰트 수정처럼
// 내용이 바뀌어도 URL이 그대로라 CDN 엣지가 예전(깨진) 바이트를 계속 서빙한다
// (2026-08 tofu 카드 사고). 내용이 바뀌면 해시가 바뀌고, 해시가 바뀌면 URL도
// 바뀌어 캐시가 저절로 무효화된다 — 수동 퍼지에 기대지 않는다.
export function cardContentHash(svg) {
  return createHash("sha256").update(svg).digest("hex").slice(0, 10);
}

let cachedCardDir = null;
let cachedCardHashes = null;
function cardHashIndex(assetsRoot) {
  const dir = path.join(assetsRoot, EDITORIAL_CARD_DIR);
  if (cachedCardDir === dir) return cachedCardHashes;
  const map = new Map();
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch { entries = []; }
  for (const file of entries) {
    const match = file.match(/^(.+)-([0-9a-f]{10})\.webp$/);
    if (match) map.set(match[1], match[2]);
  }
  cachedCardDir = dir;
  cachedCardHashes = map;
  return map;
}

// id에 대해 실제로 생성된 카드 파일의 해시를 디스크에서 찾는다. 생성기
// (scripts/generate-editorial-cards.js)만 해시를 계산하고, 소비자(build.js)는
// 그 결과를 여기서 그대로 읽기만 한다 — 두 스크립트가 해시 알고리즘을
// 따로 유지하다 어긋나는 일이 없다.
export function findCardHash(assetsRoot, id) {
  return cardHashIndex(assetsRoot).get(cardFileName(id)) || null;
}

function xml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function titleLines(title, max = 22) {
  const words = String(title || "기사 제목").trim().split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    if ((line + (line ? " " : "") + word).length > max && line) {
      lines.push(line);
      line = word;
    } else {
      line += (line ? " " : "") + word;
    }
    if (lines.length === 2) break;
  }
  if (lines.length < 3 && line) lines.push(line);
  return lines.slice(0, 3);
}

export function editorialCardSvg({ title, category, topic, id }) {
  const [bg, accent, tint] = COLORS[category] || COLORS.other;
  const lines = titleLines(title);
  const titleSvg = lines
    .map((line, index) => `<text x="88" y="${306 + index * 52}" fill="#ffffff" font-family="'NanumGothic', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" font-size="42" font-weight="700">${xml(line)}</text>`)
    .join("");
  const label = CATEGORY_LABELS[category] || "VetManLab 편집 카드";
  const topicLabel = topic || "수의학 전문 브리핑";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${EDITORIAL_CARD_WIDTH}" height="${EDITORIAL_CARD_HEIGHT}" viewBox="0 0 ${EDITORIAL_CARD_WIDTH} ${EDITORIAL_CARD_HEIGHT}" role="img" aria-labelledby="card-title card-desc">
<title id="card-title">VetManLab 편집용 정보 카드: ${xml(title)}</title>
<desc id="card-desc">실제 환자나 검사 사진이 아닌 기사 주제 안내용 편집 그래픽입니다.</desc>
<rect width="1200" height="630" fill="${bg}"/>
<circle cx="1040" cy="102" r="170" fill="${accent}" opacity=".42"/>
<circle cx="1070" cy="500" r="250" fill="${accent}" opacity=".2"/>
<path d="M760 0h440v630H760z" fill="${tint}" opacity=".08"/>
<path d="M820 126h250M820 152h170M820 178h210" stroke="#fff" stroke-opacity=".32" stroke-width="3" stroke-linecap="round"/>
<g transform="translate(810 250)" fill="none" stroke="${accent}" stroke-width="12" opacity=".9">
  <rect x="0" y="0" width="92" height="92" rx="22"/>
  <rect x="122" y="0" width="92" height="92" rx="22" opacity=".62"/>
  <rect x="0" y="122" width="92" height="92" rx="22" opacity=".62"/>
  <rect x="122" y="122" width="92" height="92" rx="22"/>
</g>
<text x="88" y="108" fill="${tint}" font-family="'NanumGothic', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" font-size="20" font-weight="700" letter-spacing="3">VETMANLAB · EDITORIAL SIGNAL</text>
<text x="88" y="166" fill="#ffffff" font-family="'NanumGothic', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" font-size="22" font-weight="700">${xml(label)} · ${xml(topicLabel)}</text>
${titleSvg}
<text x="88" y="558" fill="#ffffff" fill-opacity=".68" font-family="'NanumGothic', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif" font-size="18">기사 ID ${xml(id)} · 실제 환자·검사 이미지 아님</text>
</svg>`;
}

export function generatedImageMeta(id, title, hash) {
  return {
    image: `${"https://news.vetmanlab.com"}${cardRelativePath(id, "webp", hash)}`,
    imageAlt: `VetManLab 편집용 정보 카드: ${title}. 실제 환자나 검사 사진이 아닌 기사 주제 안내 그래픽입니다.`,
    imageCaption: "VetManLab 편집용 정보 카드입니다. 실제 환자·검사 사진이 아닙니다.",
    imageCredit: "베트맨랩 자체 제작",
    imageLicense: "VetManLab 자체 제작",
    imageLicenseUrl: null,
    imageWidth: EDITORIAL_CARD_WIDTH,
    imageHeight: EDITORIAL_CARD_HEIGHT,
    imageOrigin: "editorial-card",
    imageOwnership: "owned",
    imageSourceUrl: null,
  };
}
