// PubMed E-utilities로 반려동물 임상 관련 최신 논문(초록)을 수집한다.
// 저작권: 초록 전문을 재게시하지 않고 요약·번역 + DOI/PubMed 링크만 제공.
import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { PUBMED, PUBMED_TOPICS, PUBMED_PER_TOPIC } from "../config.js";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const UA = "vetman-briefing/0.1 (mailto:seovenceo@gmail.com)";
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

function asArray(x) {
  return Array.isArray(x) ? x : x == null ? [] : [x];
}

async function eget(path, params) {
  const url = new URL(`${EUTILS}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const key = process.env.NCBI_API_KEY;
  if (key) url.searchParams.set("api_key", key);
  const res = await fetch(url, { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(25000) });
  if (!res.ok) throw new Error(`PubMed ${path} ${res.status}`);
  return res;
}

// 분과별로 PMID를 조금씩 모은다. 단일 쿼리만 쓰면 논문이 많은 분과(감염·영상)에
// 편중되어 안과·재활 같은 분과가 계속 밀린다.
async function searchIds(term, retmax) {
  const res = await eget("esearch.fcgi", {
    db: "pubmed",
    term,
    retmax: String(retmax),
    sort: "date",
    datetype: "pdat",
    reldate: String(PUBMED.recentDays),
    retmode: "json",
  });
  return (await res.json())?.esearchresult?.idlist ?? [];
}

export async function fetchPubmed() {
  // 1) 분과별 최근 논문 PMID 수집 (중복 제거)
  const topics = PUBMED_TOPICS?.length ? PUBMED_TOPICS : [{ name: "임상 일반", term: PUBMED.term }];
  const seen = new Set();
  const ids = [];
  for (const t of topics) {
    try {
      for (const id of await searchIds(t.term, PUBMED_PER_TOPIC)) {
        if (!seen.has(id)) {
          seen.add(id);
          ids.push(id);
        }
      }
    } catch (err) {
      console.error(`  [PubMed] ${t.name}: ${err.message}`);
    }
    await new Promise((r) => setTimeout(r, 350)); // NCBI 요청 간격 예의
  }
  const candidateIds = ids.slice(0, Math.max(1, Number(PUBMED.max) || ids.length));
  if (!candidateIds.length) return [];

  // 2) 초록·메타 가져오기
  const fetchRes = await eget("efetch.fcgi", { db: "pubmed", id: candidateIds.join(","), retmode: "xml" });
  const xml = parser.parse(await fetchRes.text());
  const articles = asArray(xml?.PubmedArticleSet?.PubmedArticle);

  return articles
    .map((art) => {
      const cit = art.MedlineCitation ?? {};
      const artNode = cit.Article ?? {};
      const pmid = String(cit.PMID?.["#text"] ?? cit.PMID ?? "");
      const title = textOf(artNode.ArticleTitle);
      const journal = textOf(artNode.Journal?.Title);
      const absParts = asArray(artNode.Abstract?.AbstractText)
        .map((a) => (typeof a === "object" ? `${a["@_Label"] ? a["@_Label"] + ": " : ""}${textOf(a)}` : textOf(a)))
        .filter(Boolean);
      const abstract = absParts.join("\n").slice(0, 6000);
      let doi = "";
      for (const idn of asArray(art.PubmedData?.ArticleIdList?.ArticleId)) {
        if (idn?.["@_IdType"] === "doi") doi = textOf(idn);
      }
      const publishedAt = publishedDate(artNode.Journal?.JournalIssue?.PubDate);
      // DOI는 원문 식별자로 보존하되, canonical·출처 검증·본문 링크는
      // robots와 도메인 정책을 일관되게 적용할 수 있는 PubMed URL을 사용한다.
      const url = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
      return {
        id: crypto.createHash("md5").update(pmid || title).digest("hex").slice(0, 10),
        sourceType: "paper",
        sourceLabel: journal || "PubMed",
        title,
        body: abstract,
        abstract,
        journal,
        doi,
        pmid,
        url,
        canonicalUrl: url,
        publishedAt,
      };
    })
    .filter((p) => p.title && p.abstract && p.abstract.length > 150);
}

const MONTHS = new Map([
  ["jan", 1], ["feb", 2], ["mar", 3], ["apr", 4], ["may", 5], ["jun", 6],
  ["jul", 7], ["aug", 8], ["sep", 9], ["oct", 10], ["nov", 11], ["dec", 12],
]);

function publishedDate(pubDate = {}) {
  const year = Number(pubDate?.Year || String(pubDate?.MedlineDate || "").match(/\b(19|20)\d{2}\b/)?.[0]);
  if (!Number.isInteger(year) || year < 1900 || year > 2100) return null;
  const rawMonth = String(pubDate?.Month || String(pubDate?.MedlineDate || "").match(/[A-Za-z]{3,}/)?.[0] || "").slice(0, 3).toLowerCase();
  const month = MONTHS.get(rawMonth) || 1;
  const day = Math.min(28, Math.max(1, Number(pubDate?.Day) || 1));
  return new Date(Date.UTC(year, month - 1, day)).toISOString();
}

function textOf(node) {
  if (node == null) return "";
  if (typeof node === "string") return node;
  if (typeof node === "object") {
    if (node["#text"]) return String(node["#text"]);
    // mixed content (e.g. <i>, <sub>) — flatten values
    return Object.values(node)
      .filter((v) => typeof v === "string")
      .join(" ");
  }
  return String(node);
}
