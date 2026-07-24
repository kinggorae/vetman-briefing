import { jsonCall } from "./llm.js";
import { koreanizeItem } from "./koreanize.js";

const ITEM_SCHEMA = {
  type: "object",
  properties: {
    titleKo: { type: "string" },
    leadKo: { type: "string" },
    bodyKo: { type: "array", items: { type: "string" } },
    keyPointsKo: { type: "array", items: { type: "string" } },
    angleKo: { type: "string" },
  },
  required: ["titleKo", "leadKo", "bodyKo", "keyPointsKo", "angleKo"],
  additionalProperties: false,
};

// 한자·가나·키릴 문자 혼입 감지 (MiniMax 등 다국어 모델의 언어 혼입 대응)
function foreignScriptIn(item) {
  const text = JSON.stringify([item.titleKo, item.leadKo, item.bodyKo, item.keyPointsKo, item.angleKo]);
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
      {
        titleKo: item.titleKo,
        leadKo: item.leadKo,
        bodyKo: item.bodyKo,
        keyPointsKo: item.keyPointsKo,
        angleKo: item.angleKo,
      },
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
  const content = post.fullText || post.body;

  const item = await jsonCall({
    system: [
      "당신은 한국 동물병원 원장·수의사를 위한 데일리 뉴스레터 '해외 브리핑'의 에디터입니다.",
      "해외 수의 미디어 기사 또는 커뮤니티 글 하나를, 한국 독자를 위한 짧은 기사 형태로 재작성합니다.",
      "",
      "작성 규칙:",
      "- titleKo: 직역이 아닌 재작성. 핵심 주제어(질병명·주제)가 제목에 들어가게. 낚시성 금지. 50자 이내.",
      "- leadKo: 기사 리드 1~2문장 — 무슨 일인지, 왜 중요한지.",
      "- bodyKo: 문단 3개 배열, 각 문단 3~5문장. 1문단: 배경과 맥락 / 2문단: 핵심 내용 상세 / 3문단: 한국 동물병원 관점의 시사점. 원문의 구체적 수치·사례를 살리되 문장은 재서술. 전체 500~800자.",
      "- keyPointsKo: 핵심 포인트 3~4개, 각각 완결된 한 문장.",
      "- angleKo: '이걸 한국 병원 블로그 글감으로 쓴다면' 관점의 제안 1문장.",
      "- 약물 용량·구체적 처치법은 그대로 옮기지 말고 '원문 참고' 수준으로만 언급.",
      "- 【문체 고정】 leadKo·bodyKo의 모든 문장은 예외 없이 '~습니다/~입니다'로 끝냅니다. "
      + "'~이다/~한다/~했다/~있다' 같은 평서체를 절대 섞지 마세요. 한 기사 안에서 문체가 섞이면 반려됩니다.",
      "  (예: '보고되었다'(X) → '보고되었습니다'(O) / '중요하다'(X) → '중요합니다'(O))",
      "- titleKo는 예외 — 신문 헤드라인이므로 명사형이나 '~한다'로 끝내도 됩니다.",
      "- 가벼운 구어체·반말·이모티콘 금지.",
      "- 출력은 반드시 순수 한국어로만 작성. 중국어(한자)·러시아어·일본어를 절대 섞지 말 것.",
      "- 영어는 인명·기관명·약어(NSAID, SGLT2 등)에만 허용하고 일반 단어는 반드시 한국어로.",
    ].join("\n"),
    user: [
      `출처: ${post.sourceLabel}${meta} — ${isCommunity ? "커뮤니티 글" : "전문 미디어 기사"}`,
      `제목: ${post.title}`,
      ``,
      `내용:\n${content}${commentsText}`,
      prevFeedback
        ? `\n⚠️ 이전 시도에서 외국어("${prevFeedback}")가 섞여 반려되었습니다. 이번에는 반드시 순수 한국어로만 작성하세요.`
        : "",
    ].join("\n"),
    schema: ITEM_SCHEMA,
  });

  // 생성 실패(빈 JSON)를 그대로 저장하면 제목·본문 없는 빈 카드가 노출된다 — 여기서 차단
  if (!String(item?.titleKo || "").trim() || !(Array.isArray(item?.bodyKo) && item.bodyKo.length)) {
    throw new Error("생성 결과가 비어 있음(제목/본문 누락)");
  }

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

  koreanizeItem(item); // 남은 영어 잔여물 교정(학명·약물명은 보존)
  return {
    ...(needsReview ? { needsReview: true } : {}),
    ...item,
    sourceType: post.sourceType,
    sourceLabel: post.sourceLabel,
    upvotes: post.score ?? null,
    numComments: post.numComments ?? null,
    category: post.category,
    relevance: post.relevance,
    imageUrl: post.imageUrl ?? null,
    sourceUrl: post.finalUrl || post.url,
    sourceTitle: post.title,
    publishedAt: post.publishedAt ?? null,
  };
}

// ── 브리프(간추린 소식) 전용 생성 ──
// 심층 기사와 달리 1콜, 짧은 요약만. 레이더·글감·본문문단 없음 → 비용/시간 최소.
// 개별 페이지를 만들지 않고 색인도 안 하므로(SEO 보호) 짧아도 문제없다.
const BRIEF_SCHEMA = {
  type: "object",
  properties: {
    titleKo: { type: "string" },
    summaryKo: { type: "string" },
  },
  required: ["titleKo", "summaryKo"],
  additionalProperties: false,
};

export async function generateBrief(post, attempt = 1) {
  const content = (post.fullText || post.body || post.title || "").slice(0, 2000);
  const item = await jsonCall({
    system: [
      "당신은 한국 동물병원 수의사를 위한 '해외 브리핑'의 에디터입니다.",
      "해외 수의 소식 하나를 '간추린 소식'용으로 아주 짧게 정리합니다.",
      "- titleKo: 핵심을 담은 재작성 제목(직역 금지, 낚시 금지, 45자 이내).",
      "- summaryKo: 2~3문장(150자 내외)으로 무슨 일이고 왜 알 만한지. 모든 문장 '~습니다/~입니다'체.",
      "- 순수 한국어만. 중국어(한자)·일본어·러시아어 금지. 영어는 인명·기관명·약어만.",
      "- 약물 용량·구체적 처치법은 옮기지 않습니다.",
    ].join("\n"),
    user: `출처: ${post.sourceLabel || ""}\n제목: ${post.title}\n\n내용:\n${content}`,
    schema: BRIEF_SCHEMA,
    maxTokens: 600,
  });

  if (!String(item?.titleKo || "").trim() || !String(item?.summaryKo || "").trim()) {
    throw new Error("브리프 생성 결과가 비어 있음");
  }
  // 외국어 혼입은 재생성 1회만(브리프는 저비용 유지). 그래도 남으면 스트립 후 통과
  let foreign = foreignScriptIn({ titleKo: item.titleKo, leadKo: item.summaryKo, bodyKo: [] });
  if (foreign && attempt < 2) return generateBrief(post, attempt + 1);
  if (foreign) {
    item.titleKo = item.titleKo.replace(/[一-鿿぀-ヿЀ-ӿ]+/g, "").replace(/\s{2,}/g, " ").trim();
    item.summaryKo = item.summaryKo.replace(/[一-鿿぀-ヿЀ-ӿ]+/g, "").replace(/\s{2,}/g, " ").trim();
  }
  return {
    tier: "brief",
    category: "brief",
    titleKo: item.titleKo,
    leadKo: item.summaryKo,
    bodyKo: [item.summaryKo],
    sourceType: post.sourceType,
    sourceLabel: post.sourceLabel,
    relevance: post.relevance,
    imageUrl: null,
    sourceUrl: post.finalUrl || post.url,
    sourceTitle: post.title,
    publishedAt: post.publishedAt ?? null,
  };
}

// ── 최신 연구(논문) 전용 생성 ──
async function generatePaper(post, attempt = 1, prevFeedback = null) {
  const item = await jsonCall({
    system: [
      "당신은 한국 동물병원 원장·수의사를 위한 '최신 연구' 코너의 에디터입니다.",
      "해외 수의 논문의 초록(abstract)을 바탕으로, 임상의가 30초 만에 핵심을 파악할 수 있는 한국어 요약을 작성합니다.",
      "",
      "작성 규칙:",
      "- titleKo: 연구의 핵심 발견이 드러나는 제목. 원제 직역 금지. 50자 이내.",
      "- leadKo: 이 연구가 무엇을 밝혔고 왜 중요한지 1~2문장.",
      "- bodyKo: 문단 3개 — 1) 연구 배경·목적과 방법(대상·표본수·설계), 2) 주요 결과(구체적 수치 포함), 3) 한국 동물병원 임상 관점의 시사점. 각 3~5문장.",
      "- keyPointsKo: '핵심 결과' 3~4개. 각 한 문장, 가능하면 수치 포함.",
      "- angleKo: 이 연구를 보호자용 블로그 글감으로 풀 때의 제안 1문장.",
      "- 반드시 근거 수준을 냉정하게: 표본이 작거나 단일기관·후향적이면 한계를 시사점 문단에 명시. 초록에 없는 내용을 지어내지 말 것.",
      "- 초록 문장을 그대로 번역해 옮기지 말고 재서술. 약물 용량은 옮기지 말 것.",
      "- 【문체 고정】 leadKo·bodyKo의 모든 문장을 '~습니다/~입니다'로 끝냅니다. 평서체(~이다/~한다/~했다)를 섞지 마세요.",
      "- 【라벨 금지】 본문에 '연구 배경 및 방법:', '주요 결과:', '임상 시사점:' 같은 소제목을 쓰지 마세요. "
      + "그 순서로 서술하되 라벨 없이 자연스러운 문단으로 씁니다.",
      "- 순수 한국어만. 중국어(한자)·일본어·러시아어 절대 금지. 의학 약어(NSAID 등)와 인명·균명 학명은 영어/라틴어 허용.",
    ].join("\n"),
    user: [
      `저널: ${post.journal || post.sourceLabel}`,
      `원제: ${post.title}`,
      ``,
      `초록(abstract):\n${post.abstract}`,
      prevFeedback ? `\n⚠️ 이전 시도에서 외국어("${prevFeedback}")가 섞여 반려되었습니다. 순수 한국어로만.` : "",
    ].join("\n"),
    schema: ITEM_SCHEMA,
  });

  // 생성 실패(빈 JSON)를 그대로 저장하면 제목·본문 없는 빈 카드가 노출된다 — 여기서 차단
  if (!String(item?.titleKo || "").trim() || !(Array.isArray(item?.bodyKo) && item.bodyKo.length)) {
    throw new Error("생성 결과가 비어 있음(제목/본문 누락)");
  }

  let foreign = foreignScriptIn(item);
  if (foreign && attempt < 3) {
    console.warn(`  ↻ 외국어 혼입("${foreign.slice(0, 24)}") — 재생성 ${attempt}/2`);
    return generatePaper(post, attempt + 1, foreign);
  }
  let needsReview = false;
  if (foreign) {
    const fixed = await fixKorean(item, foreign);
    Object.assign(item, fixed);
    if (foreignScriptIn(item)) needsReview = true;
  }

  koreanizeItem(item); // 남은 영어 잔여물 교정(학명·약물명은 보존)
  return {
    ...(needsReview ? { needsReview: true } : {}),
    ...item,
    sourceType: "paper",
    sourceLabel: post.sourceLabel,
    journal: post.journal || null,
    doi: post.doi || null,
    upvotes: null,
    numComments: null,
    category: "research",
    relevance: post.relevance,
    imageUrl: null,
    sourceUrl: post.url,
    sourceTitle: post.title,
    publishedAt: post.publishedAt ?? null,
  };
}

// ── "진료실 밖 이야기" (가십·화제성 썰) 전용 생성 ──
const STORY_SCHEMA = {
  type: "object",
  properties: {
    titleKo: { type: "string" },
    leadKo: { type: "string" },
    bodyKo: { type: "array", items: { type: "string" } },
    tagKo: { type: "string" },
  },
  required: ["titleKo", "leadKo", "bodyKo", "tagKo"],
  additionalProperties: false,
};

// 썰 전용 화이트리스트 오염 감지: 한글·영문·숫자·공백·일반 문장부호만 허용.
// 한자·가나·키릴·벵골·전각기호(、。) 등 그 외 문자는 전부 오염으로 본다(범위 나열보다 견고).
const STORY_OK = /[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9\s.,!?%&()/\-:;'"’‘“”…·~$@#\n\t]/;
function storyBadChars(item) {
  const t = [item.titleKo, item.leadKo, ...(item.bodyKo || [])].join(" ");
  return [...t].filter((ch) => ch.trim() && !STORY_OK.test(ch));
}
function storyContam(item) {
  const bad = storyBadChars(item);
  return bad.length ? [...new Set(bad)].join("") : null;
}
// 최종 안전망: 허용 외 문자는 공백으로(한글 붙음 방지) → 다중 공백 정리.
const stripStory = (s) =>
  [...String(s == null ? "" : s)]
    .map((ch) => (STORY_OK.test(ch) || !ch.trim() ? ch : " "))
    .join("")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.?!·~…)])/g, "$1")
    .trim();

async function generateStory(post, attempt = 1, prevFeedback = null) {
  const content = post.fullText || post.body || post.title;
  const item = await jsonCall({
    temperature: 0.2, // 다국어 모델 언어 혼입 억제
    system: [
      "당신은 한국 반려동물·수의 화제글 코너의 에디터입니다.",
      "해외에서 화제가 된 반려동물·동물병원 이야기(가십·감동·황당·반전) 하나를, 한국 독자가 재미있게 볼 수 있는 짧고 가벼운 글로 각색합니다.",
      "",
      "작성 규칙:",
      "- titleKo: 클릭하고 싶은 제목. 약간의 호기심 자극은 허용하되 거짓·과장 금지. 이모지·해시태그 없이. 45자 이내.",
      "- leadKo: 한 줄 요약. 가볍게.",
      "- bodyKo: 문단 2개. 편하고 친근한 존댓말(해요체)로 이야기를 풀되, 사실을 왜곡하지 마세요. 각 3~4문장. 마지막에 '진료실 밖에서 보면 이런 일도 있네요' 같은 가벼운 공감 한 마디.",
      "- tagKo: 이 글의 결을 한 단어로. 다음 중 하나만: 충격 / 반전 / 훈훈 / 웃김 / 황당 / 논란 / 감동.",
      "- 의학 정보를 단정적으로 옮기지 말고(참고 수준), 특정인 비방·혐오·선정성은 금지.",
      "- 【매우 중요】 모든 글자는 반드시 한글. 한자(中文)·일본어 가나·키릴 문자를 단 한 글자도 쓰지 마세요. 영어는 인명·기관명·통화($) 정도만 허용하고 일반 단어는 전부 한글로.",
    ].join("\n"),
    user: [
      `출처: ${post.sourceLabel}`,
      `원제: ${post.title}`,
      ``,
      `내용:\n${content}`,
      prevFeedback ? `\n⚠️ 이전 시도에서 외국 문자("${prevFeedback}")가 섞여 반려되었습니다. 이번엔 한글만 쓰세요.` : "",
    ].join("\n"),
    schema: STORY_SCHEMA,
  });

  // 생성 실패(빈 JSON)를 그대로 저장하면 제목·본문 없는 빈 카드가 노출된다 — 여기서 차단
  if (!String(item?.titleKo || "").trim() || !(Array.isArray(item?.bodyKo) && item.bodyKo.length)) {
    throw new Error("생성 결과가 비어 있음(제목/본문 누락)");
  }

  let foreign = storyContam(item);
  if (foreign && attempt < 4) {
    console.warn(`  ↻ 외국어 혼입("${foreign.slice(0, 24)}") — 재생성 ${attempt}/3`);
    return generateStory(post, attempt + 1, foreign);
  }
  let needsReview = false;
  if (foreign) {
    // 교정 패스 시도
    try {
      const fixed = await fixKorean(item, foreign);
      Object.assign(item, fixed);
    } catch {}
    foreign = storyContam(item);
    if (foreign) {
      // 품질 게이트: 교정 후에도 오염 문자가 많이 남으면(strip 시 뜻 손상) 드롭.
      const bad = storyBadChars(item).length;
      if (bad > 5) {
        needsReview = true;
        console.warn(`  ⚠ 품질 게이트 탈락(오염 ${bad}자 잔존: ${foreign.slice(0, 20)}) — 제외`);
      } else {
        item.titleKo = stripStory(item.titleKo);
        item.leadKo = stripStory(item.leadKo);
        item.bodyKo = (item.bodyKo || []).map(stripStory).filter(Boolean);
      }
    }
  }

  koreanizeItem(item); // 남은 영어 잔여물 교정(학명·약물명은 보존)
  return {
    ...(needsReview ? { needsReview: true } : {}),
    ...item,
    keyPointsKo: [],
    angleKo: "", // 가십 섹션은 블로그 글감 없음
    sourceType: "story",
    sourceLabel: post.sourceLabel,
    upvotes: null,
    numComments: null,
    category: "watercooler",
    relevance: post.relevance ?? 5,
    imageUrl: post.imageUrl ?? null,
    sourceUrl: post.finalUrl || post.url,
    sourceTitle: post.title,
    publishedAt: post.publishedAt ?? null,
    tagKo: item.tagKo || "",
  };
}

export { generatePaper, generateStory };
