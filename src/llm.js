// LLM 호출 공통 모듈.
// 기본은 Anthropic API. LLM_BASE_URL을 설정하면 Anthropic 호환 게이트웨이
// (예: MiniMax https://api.minimax.io/anthropic + CLAUDE_MODEL=MiniMax-M2)로 전환된다.
// 호환 모드에서는 Anthropic 전용 기능(structured outputs, 웹 검색 도구)을 쓰지 않고
// 프롬프트 기반 JSON 출력 + 관대한 파싱으로 대체한다.
// ANTHROPIC_* 변수명을 쓰지 않는 이유: 실행 환경(쉘, CI, Claude Code 등)에
// 이미 설정된 ANTHROPIC_BASE_URL이 --env-file 값보다 우선해 충돌하기 때문.
import Anthropic from "@anthropic-ai/sdk";
import { MODEL } from "../config.js";

const BASE_URL = process.env.LLM_BASE_URL || null;

export const client = new Anthropic({
  ...(BASE_URL ? { baseURL: BASE_URL } : {}),
  apiKey: process.env.LLM_API_KEY || process.env.ANTHROPIC_API_KEY,
});

// 전용 base URL이 설정되어 있으면 서드파티 호환 게이트웨이로 간주
export const IS_COMPAT = !!BASE_URL;

export function extractJson(text) {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fenced ? fenced[1] : text;
  const start = Math.min(
    ...["{", "["].map((c) => {
      const i = raw.indexOf(c);
      return i === -1 ? Infinity : i;
    })
  );
  if (start === Infinity) throw new Error("응답에서 JSON을 찾지 못했습니다");
  return JSON.parse(raw.slice(start).trim().replace(/```$/, ""));
}

// schema를 따르는 JSON 객체를 반환하는 단일 호출
export async function jsonCall({ system, user, schema, maxTokens = 16000 }) {
  if (!IS_COMPAT) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      output_config: { format: { type: "json_schema", schema } },
    });
    const text = response.content.find((b) => b.type === "text")?.text ?? "{}";
    return JSON.parse(text);
  }

  // 호환 모드: 스키마를 프롬프트에 넣고 JSON만 출력하도록 지시
  // temperature를 낮춰 다국어 모델의 언어 혼입 확률을 줄인다
  // JSON 없는 응답이 오면 최대 3회까지 재호출
  let lastErr;
  for (let i = 1; i <= 3; i++) {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: maxTokens,
      temperature: 0.3,
      system:
        system +
        "\n\n출력 형식: 아래 JSON 스키마를 따르는 JSON만 출력하세요. 설명·서문·코드블록 표시 없이 JSON 자체만 출력합니다.\n" +
        JSON.stringify(schema),
      messages: [{ role: "user", content: user }],
    });
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    try {
      return extractJson(text);
    } catch (err) {
      lastErr = err;
      console.warn(`  ↻ JSON 파싱 실패 (시도 ${i}/3) — 재호출`);
    }
  }
  throw lastErr;
}
