import { jsonCall } from "./llm.js";

const ITEM_SCHEMA = {
  type: "object",
  properties: {
    titleKo: { type: "string" },
    summaryKo: { type: "string" },
    angleKo: { type: "string" },
  },
  required: ["titleKo", "summaryKo", "angleKo"],
  additionalProperties: false,
};

// 한자·가나·키릴 문자 혼입 감지 (MiniMax 등 다국어 모델의 언어 혼입 대응)
function foreignScriptIn(item) {
  const text = `${item.titleKo} ${item.summaryKo} ${item.angleKo}`;
  const m = text.match(/[一-鿿぀-ヿЀ-ӿ]+/g);
  return m ? m.join(", ") : null;
}

// 오염된 텍스트만 순수 한국어로 교정하는 전용 패스
async function fixKorean(item, foreign) {
  return jsonCall({
    system: [
      "당신은 한국어 교정자입니다. 주어진 JSON의 텍스트에 섞인 외국어(중국어·일본어·러시아어·불필요한 영어)를 자연스러운 한국어로 바꿔주세요.",
      "의미는 그대로 유지하고, 이미 자연스러운 한국어 부분은 건드리지 마세요.",
      "존댓말(~합니다체)을 유지하고, 인명·기관명·의학 약어(NSAID 등)의 영어는 그대로 둡니다.",
    ].join("\n"),
    user: `다음 JSON에서 특히 이 조각들이 문제입니다: "${foreign}"\n\n${JSON.stringify(
      { titleKo: item.titleKo, summaryKo: item.summaryKo, angleKo: item.angleKo },
      null,
      2
    )}`,
    schema: ITEM_SCHEMA,
  });
}

export async function generateItem(post, comments = [], attempt = 1, prevFeedback = null) {
  const isCommunity = post.sourceType !== "rss";
  const commentsText = comments.length
    ? `\n\n상위 댓글:\n${comments.map((c, i) => `${i + 1}. (▲${c.score}) ${c.body}`).join("\n")}`
    : "";
  const meta =
    post.score != null ? ` (▲${post.score}, 댓글 ${post.numComments}개)` : "";

  const item = await jsonCall({
    system: [
      "당신은 한국 동물병원 원장·수의사를 위한 주간 뉴스레터 '해외 브리핑'의 에디터입니다.",
      "해외 수의 미디어 기사 또는 커뮤니티 글 하나를 한국 독자용 아이템으로 작성합니다.",
      "",
      "작성 규칙:",
      "- titleKo: 직역이 아닌 재작성. 낚시성 금지, 내용이 드러나게. 40자 이내.",
      "- summaryKo: 3~4문장. 핵심 내용을 재서술하고, 커뮤니티 글이면 댓글의 주목할 만한 반응도 담기. 원문 문장을 그대로 옮기지 말 것.",
      "- angleKo: '이걸 한국 병원 블로그 글감으로 쓴다면' 관점의 제안 1문장.",
      "- 약물 용량·구체적 처치법은 그대로 옮기지 말고 '원문 참고' 수준으로만 언급.",
      "- 존댓말(~합니다체) 사용. 가벼운 구어체·반말·이모티콘 금지.",
      "- 출력은 반드시 순수 한국어로만 작성. 중국어(한자)·러시아어·일본어를 절대 섞지 말 것.",
      "- 영어는 인명·기관명·약어(NSAID, SGLT2 등)에만 허용하고 일반 단어는 반드시 한국어로.",
    ].join("\n"),
    user: [
      `출처: ${post.sourceLabel}${meta} — ${isCommunity ? "커뮤니티 글" : "전문 미디어 기사"}`,
      `제목: ${post.title}`,
      ``,
      `내용:\n${post.body}${commentsText}`,
      prevFeedback
        ? `\n⚠️ 이전 시도에서 외국어("${prevFeedback}")가 섞여 반려되었습니다. 이번에는 반드시 순수 한국어로만 작성하세요.`
        : "",
    ].join("\n"),
    schema: ITEM_SCHEMA,
  });

  // 외국 문자가 섞였으면 피드백을 담아 재생성 → 그래도 실패하면 교정 패스
  let foreign = foreignScriptIn(item);
  if (foreign && attempt < 3) {
    console.warn(`  ↻ 외국어 혼입 감지("${foreign.slice(0, 30)}") — 재생성 ${attempt}/2`);
    return generateItem(post, comments, attempt + 1, foreign);
  }
  let needsReview = false;
  if (foreign) {
    console.warn(`  ✎ 교정 패스 실행("${foreign.slice(0, 30)}")`);
    const fixed = await fixKorean(item, foreign);
    Object.assign(item, fixed);
    foreign = foreignScriptIn(item);
    if (foreign) {
      needsReview = true;
      console.warn(`  ⚠ 교정 후에도 잔존("${foreign.slice(0, 30)}") — 검수 필요 표시`);
    }
  }

  return {
    ...(needsReview ? { needsReview: true } : {}),
    ...item,
    sourceType: post.sourceType,
    sourceLabel: post.sourceLabel,
    upvotes: post.score ?? null,
    numComments: post.numComments ?? null,
    category: post.category,
    relevance: post.relevance,
    sourceUrl: post.url,
    sourceTitle: post.title,
    publishedAt: post.publishedAt ?? null,
  };
}
