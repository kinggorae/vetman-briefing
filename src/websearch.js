// Plan B (보조): Claude 웹 검색 서버 도구로 레딧 커뮤니티 시그널 수집
// Reddit API 키 없이 ANTHROPIC_API_KEY만으로 동작한다.
// 주의: 웹 검색은 Anthropic 서버 도구라 호환 게이트웨이(MiniMax 등)에서는 동작하지 않음.
// run.js에서 IS_COMPAT일 때 이 모듈을 호출하지 않는다.
import crypto from "node:crypto";
import { MODEL, WEBSEARCH_SUBREDDITS } from "../config.js";
import { client } from "./llm.js";

export async function searchRedditSignals() {
  const subs = WEBSEARCH_SUBREDDITS.map((s) => `r/${s}`).join(", ");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    tools: [
      { type: "web_search_20260209", name: "web_search", max_uses: 8, allowed_domains: ["reddit.com"] },
    ],
    system: [
      "당신은 수의사 대상 뉴스레터의 리서처입니다.",
      "웹 검색으로 최근 일주일 사이 해외 수의사 커뮤니티에서 화제가 된 레딧 글을 찾습니다.",
      "개인 반려동물 의료상담 글은 제외하고, 임상 토론·병원 경영·인력·번아웃·보호자 커뮤니케이션·업계 이슈 위주로 고릅니다.",
    ].join("\n"),
    messages: [
      {
        role: "user",
        content: [
          `${subs} 서브레딧에서 최근 일주일 내 화제가 된 글을 5~8개 찾아주세요.`,
          "",
          "검색을 마친 뒤, 마지막에 반드시 아래 형식의 JSON 배열만 담긴 코드블록 하나로 정리해주세요:",
          "```json",
          '[{"title": "원문 제목", "url": "레딧 글 URL", "subreddit": "Veterinary", "gist": "글과 반응 내용을 3~4문장 한국어로"}]',
          "```",
        ].join("\n"),
      },
    ],
  });

  // 마지막 텍스트 블록에서 JSON 코드블록 추출
  const texts = response.content.filter((b) => b.type === "text").map((b) => b.text);
  const all = texts.join("\n");
  const match = all.match(/```json\s*([\s\S]*?)```/) ?? all.match(/(\[[\s\S]*\])/);
  if (!match) return [];

  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return [];
  }

  return parsed
    .filter((it) => it.url && it.title)
    .map((it) => ({
      id: crypto.createHash("md5").update(it.url).digest("hex").slice(0, 10),
      sourceType: "reddit_search",
      sourceLabel: `r/${it.subreddit || "reddit"}`,
      title: it.title,
      body: it.gist || "",
      url: it.url,
      publishedAt: null,
    }));
}
