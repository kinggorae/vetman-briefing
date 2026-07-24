import {
  MIN_RELEVANCE,
  ITEMS_PER_ISSUE,
  SCORE_BATCH,
  BRIEF_MIN_RELEVANCE,
  BRIEFS_PER_ISSUE,
} from "../config.js";
import { jsonCall } from "./llm.js";

// Reddit 직접 수집분에만 적용하는 규칙 필터:
// NSFW, 공지, 본문 없는 링크/이미지 글, 업보트 하한 미달 제외
export function redditRuleFilter(posts, minScore) {
  return posts.filter(
    (p) =>
      !p.over18 &&
      !p.stickied &&
      p.score >= minScore &&
      p.isSelf &&
      p.body.length >= 100
  );
}

const SCORE_SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          relevance: { type: "integer" },
          category: {
            type: "string",
            enum: ["clinical", "practice_management", "career", "client_communication", "industry", "other"],
          },
          reason: { type: "string" },
        },
        required: ["id", "relevance", "category", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["scores"],
  additionalProperties: false,
};

// 후보가 많으면 배치로 나눠 평가 (한 프롬프트에 너무 많으면 평가 품질이 떨어짐)
async function scoreBatch(posts) {
  const list = posts
    .map((p) => {
      const meta = p.score != null ? ` | ▲${p.score} 💬${p.numComments}` : "";
      return `[id: ${p.id}] ${p.sourceLabel}${meta}\n제목: ${p.title}\n내용 앞부분: ${p.body.slice(0, 500)}`;
    })
    .join("\n\n---\n\n");

  const { scores } = await jsonCall({
    system: [
      "당신은 한국 동물병원 원장·수의사를 위한 주간 뉴스레터 '해외 브리핑'의 큐레이션 에디터입니다.",
      "후보는 해외 수의 전문 미디어의 기사와 수의사 커뮤니티(레딧) 글이 섞여 있습니다.",
      "각 글이 한국 수의사 독자에게 얼마나 가치 있는지 relevance 0~10점으로 평가하세요.",
      "높은 점수: 임상 지견·케이스 토론, 병원 경영·인력 문제, 번아웃·커리어, 진료비/보호자 커뮤니케이션, 새 치료법·장비, 업계 트렌드.",
      "낮은 점수: 특정 보호자의 개인 의료상담, 미국·영국 제도에만 해당하는 행정 이슈, 제품 홍보·웨비나 안내, 단순 잡담, 특정 인물·병원 비방.",
      "같은 주제가 겹치면 더 구체적인 쪽에만 높은 점수를 주세요.",
      "reason은 한국어 한 문장으로 쓰세요.",
    ].join("\n"),
    user: `다음 후보들을 평가해주세요:\n\n${list}`,
    schema: SCORE_SCHEMA,
  });
  return scores;
}

// 관련성 통과분 전체를 점수순으로 반환 (상한 없음). limit 지정 시 슬라이스.
export async function scoreAll(posts, limit = Infinity) {
  const allScores = [];
  for (let i = 0; i < posts.length; i += SCORE_BATCH) {
    const batch = posts.slice(i, i + SCORE_BATCH);
    console.log(`  배치 ${Math.floor(i / SCORE_BATCH) + 1}/${Math.ceil(posts.length / SCORE_BATCH)} (${batch.length}개) 평가 중...`);
    try {
      allScores.push(...(await scoreBatch(batch)));
    } catch (err) {
      console.error(`  배치 평가 실패, 건너뜀: ${err.message}`);
    }
  }
  const byId = new Map(allScores.map((s) => [s.id, s]));
  return posts
    .map((p) => ({ ...p, ...byId.get(p.id) }))
    .filter((p) => (p.relevance ?? 0) >= MIN_RELEVANCE)
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, limit);
}

export async function scoreCandidates(posts) {
  return scoreAll(posts, ITEMS_PER_ISSUE);
}

// 한 번의 스코어링으로 두 계층을 나눈다(스코어링이 비싼 공유 단계라 중복하지 않는다).
//   deep : relevance ≥ MIN_RELEVANCE → 풀treatment(생성+레이더), 개별 페이지·색인
//   brief: BRIEF_MIN_RELEVANCE ≤ relevance < MIN_RELEVANCE → 짧은 요약, noindex
export async function scoreTiered(posts) {
  const allScores = [];
  for (let i = 0; i < posts.length; i += SCORE_BATCH) {
    const batch = posts.slice(i, i + SCORE_BATCH);
    console.log(`  배치 ${Math.floor(i / SCORE_BATCH) + 1}/${Math.ceil(posts.length / SCORE_BATCH)} (${batch.length}개) 평가 중...`);
    try {
      allScores.push(...(await scoreBatch(batch)));
    } catch (err) {
      console.error(`  배치 평가 실패, 건너뜀: ${err.message}`);
    }
  }
  const byId = new Map(allScores.map((s) => [s.id, s]));
  const scored = posts
    .map((p) => ({ ...p, ...byId.get(p.id) }))
    .sort((a, b) => (b.relevance ?? 0) - (a.relevance ?? 0));
  const deep = scored.filter((p) => (p.relevance ?? 0) >= MIN_RELEVANCE).slice(0, ITEMS_PER_ISSUE);
  const deepUrls = new Set(deep.map((p) => p.url));
  const brief = scored
    .filter(
      (p) =>
        !deepUrls.has(p.url) &&
        (p.relevance ?? 0) >= BRIEF_MIN_RELEVANCE &&
        (p.relevance ?? 0) < MIN_RELEVANCE
    )
    .slice(0, BRIEFS_PER_ISSUE);
  return { deep, brief };
}
