// PubMed E-utilities로 반려동물 임상 관련 최신 논문(초록)을 수집한다.
// 저작권: 초록 전문을 재게시하지 않고 요약·번역 + DOI/PubMed 링크만 제공.
import crypto from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { PUBMED } from "../config.js";

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

export async function fetchPubmed() {
  // 1) 최근 논문 PMID 검색
  const search = await eget("esearch.fcgi", {
    db: "pubmed",
    term: PUBMED.term,
    retmax: String(PUBMED.max),
    sort: "date",
    datetype: "pdat",
    reldate: String(PUBMED.recentDays),
    retmode: "json",
  });
  const ids = (await search.json())?.esearchresult?.idlist ?? [];
  if (!ids.length) return [];

  // 2) 초록·메타 가져오기
  const fetchRes = await eget("efetch.fcgi", { db: "pubmed", id: ids.join(","), retmode: "xml" });
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
      const year =
        artNode.Journal?.JournalIssue?.PubDate?.Year ||
        (art.PubmedData?.History && "");
      const url = doi ? `https://doi.org/${doi}` : `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
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
        publishedAt: null,
      };
    })
    .filter((p) => p.title && p.abstract && p.abstract.length > 150);
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
