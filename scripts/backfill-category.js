import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsonCall } from "../src/llm.js";

// 2026-07-30부터 daily.yml이 scripts/ingest.js 경로로 바뀌면서(src/generate.js의
// ITEM_SCHEMA에 category가 없던 시절) 발행된 항목은 category가 비어 있다.
// 그 결과 홈 카테고리 칩이 "전체/기타"뿐이었다. src/generate.js는 이미 고쳤고
// (신규 발행분은 생성 시점에 분류됨), 이 스크립트는 그 이전에 이미 발행된
// 과거 이슈만 한 번 소급 분류한다 — 반복 실행되는 파이프라인 스크립트가 아니다.
const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ISSUES_DIR = path.join(ROOT, "data", "issues");
const DRY_RUN = process.argv.includes("--dry-run");

// src/generate.js의 CATEGORY_ENUM과 반드시 같아야 한다.
const CATEGORY_ENUM = ["clinical", "practice_management", "career", "client_communication", "industry", "other"];
const SCHEMA = {
  type: "object",
  properties: { category: { type: "string", enum: CATEGORY_ENUM } },
  required: ["category"],
  additionalProperties: false,
};

async function classify(item) {
  const { category } = await jsonCall({
    system: [
      "한국 동물병원 원장·수의사를 위한 뉴스 기사 하나를 다음 중 하나로 분류하세요.",
      "clinical(임상 지견·증례·진단·치료법), practice_management(병원 경영·인력·번아웃·운영),",
      "career(수의사 커리어·진로·전문의), client_communication(진료비·보호자 소통·설명),",
      "industry(산업·정책·기업·인수합병·학회), other(위 어디에도 뚜렷이 안 맞으면).",
      "카테고리 이름만 답하세요.",
    ].join("\n"),
    user: `제목: ${item.titleKo}\n\n리드: ${item.leadKo || ""}`,
    schema: SCHEMA,
    // 200으로 뒀더니 MiniMax가 답 앞에 붙이는 thinking 블록만으로 예산을 다 써서
    // 실제 텍스트(JSON)가 하나도 안 나와 128/157이 "JSON을 찾지 못했습니다"로
    // 실패했다(첫 실행 실측). thinking이 끝나고 답할 여유를 넉넉히 준다.
    maxTokens: 2000,
  });
  // IS_COMPAT 모드는 스키마를 강제하지 않고 프롬프트로만 안내한다 — JSON은
  // 파싱됐지만 category 키 자체가 없는 응답이 실제로 나왔다(v1_60890dc7c2ff9d41
  // 실측: 예외 없이 category=undefined로 "성공" 처리되어 미분류로 남았다).
  // 여기서 걸러 호출부의 catch가 실패로 잡고 재시도하게 한다.
  if (!CATEGORY_ENUM.includes(category)) {
    throw new Error(`category 값이 비었거나 목록에 없음: ${JSON.stringify(category)}`);
  }
  return category;
}

async function main() {
  const files = fs
    .readdirSync(ISSUES_DIR)
    .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();

  let totalMissing = 0;
  let totalFixed = 0;
  let totalFailed = 0;

  for (const file of files) {
    const full = path.join(ISSUES_DIR, file);
    const issue = JSON.parse(fs.readFileSync(full, "utf8"));
    let changed = false;

    for (const item of issue.items || []) {
      if (item.category) continue; // 이미 있으면 건드리지 않는다(연구/화제글 등 기존 정상분).
      if (!item.titleKo) continue; // 제목조차 없는 항목은 분류 대상이 아니다.
      totalMissing++;
      try {
        const category = await classify(item);
        item.category = category;
        changed = true;
        totalFixed++;
        console.log(`  ${file} ${item.id}: → ${category} (${item.titleKo.slice(0, 30)})`);
      } catch (err) {
        totalFailed++;
        console.error(`  ${file} ${item.id}: 분류 실패 — ${err.message}`);
      }
    }

    if (changed && !DRY_RUN) {
      fs.writeFileSync(full, JSON.stringify(issue, null, 2) + "\n");
    }
  }

  console.log(
    `완료: 대상 ${totalMissing}건 · 분류 ${totalFixed}건 · 실패 ${totalFailed}건${DRY_RUN ? " (dry-run, 저장 안 함)" : ""}`
  );
  if (totalFailed > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
