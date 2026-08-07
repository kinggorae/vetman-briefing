// 생성물에 남은 영어 잔여물 중 "확실한 것만" 한국어로 교정한다.
// 원칙: 약물명(enrofloxacin)·학명(Crenosoma vulpis)·의학용어(lactate, microbiome)·
//       단위(kcal, AUC)·고유명사는 절대 건드리지 않는다. 일괄 제거는 학명을 깨뜨린다.
// 대상은 (1) 생성 중 단어가 깨진 조각, (2) 문맥과 무관하게 한국어가 맞는 일반 영어뿐.
//
// 영어를 한국어로 바꾸면 받침이 달라져 뒤 조사가 틀어진다("문헌가", "어조과").
// 그래서 치환 시 뒤따르는 조사도 함께 교정한다.

// 치환 대상(조사 제외) → 한국어
const FIXES = [
  // ── 번역 결과에 자주 남는 일반 영어 전문용어 ──
  [/\bHernia\b/gi, "탈장"],
  [/\bfleas\b/gi, "벼룩"],
  [/\bcorticosteroid\b/gi, "코르티코스테로이드"],
  [/\bOligodendroglioma\b/gi, "희소돌기아교종"],
  [/\bTaurine\b/gi, "타우린"],
  [/\bMicrobiome\b/gi, "미생물군집"],
  [/\befficacy\b/gi, "유효성"],
  [/\brefractory\b/gi, "난치성"],
  [/\bbacteriocin\b/gi, "박테리오신"],
  [/\bsite\b/gi, "부위"],
  [/\bgeneric\b/gi, "제네릭"],
  [/\bResponsible\b/gi, "책임 있는"],
  [/\borganism\b/gi, "생물"],
  [/\bendogenous\b/gi, "내인성"],
  [/\bexogenous\b/gi, "외인성"],
  [/\bprobiotic\b/gi, "프로바이오틱"],
  [/\bhospital\b/gi, "병원"],
  [/\bowner\b/gi, "보호자"],
  [/\bTrial\b/gi, "임상시험"],
  [/\bPilot\b/gi, "파일럿"],
  [/\bVeterinarian\b/gi, "수의사"],
  [/\bPractice\b/gi, "진료"],
  [/\bNutrition\b/gi, "영양"],
  [/\bphysiological demand\b/gi, "생리적 요구량"],
  [/\bdietary supplementation\b/gi, "식이 보충"],
  // ── (1) 깨진 조각 — 현재 뜻이 통하지 않는 것 ──
  [/에코\s*ogenicity/, "에코원성"],
  [/클\s*unky한/, "투박한"],
  [/모독\s*ectin/, "목시덱틴"],
  [/담\s*chol\s*산/, "담즙산"],

  // ── (2) 한국어가 맞는 일반 영어 ──
  [/에코\s*texture/, "에코 질감"],
  [/calming\s+음악/, "진정 음악"],
  [/litterbox/, "화장실"],
  [/tonality/, "어조"],
  [/안정성과\s*-?\s*efficacy/, "안전성과 유효성"],
  [/sick\s+pets/, "아픈 반려동물"],
  [/moderate에서\s*high\s*단백질/, "중등도에서 고단백"],
  [/_?peer-reviewed\s+literature/, "동료 심사 문헌"],
  [/literature\s+review/, "문헌 고찰"],
  [/종\s+donor의/, "종 공여자의"],
  [/whole-genome\s+sequencing/, "전장유전체 분석"],
  [/whole-genome/, "전장유전체"],
  [/\bversus\b/, "대"],

  // ── MiniMax가 지어낸 존재하지 않는 용어 ──
  // 영어 조각이 아니라 그럴듯해 보이는 한국어 신조어를 만들어내는 경우다.
  // 2026-08-07 "New World Screwworm" 기사에서 실제로 3가지 변형이 한 기사
  // 안에서 뒤섞여 나왔다(제목엔 광대어파리, 리드엔 대륙사면승충, 본문 곳곳엔
  // 사면승충) — 표준 용어는 나사벌레(신세계나사벌레, New World screwworm).
  // 길고 구체적인 패턴을 먼저 둬서 짧은 패턴이 먼저 매치해 어긋나지 않게 한다.
  [/신종\s*대륙사면승충/g, "신세계나사벌레"],
  [/대륙사면승충/g, "신세계나사벌레"],
  [/광대어파리/g, "신세계나사벌레"],
  [/사면승충/g, "나사벌레"],
  [/옥라톡신/g, "오크라톡신"], // Ochratoxin — "크라" 음절이 통째로 빠진 오역
  [/리휴수의/g, "대진수의사"], // relief vet — 업계 표준 용어는 "대진수의사"

  // ── 단어가 중간에 끊긴 것들(한글 + 영어 조각) ──
  [/피리도스트\s*igmine/, "피리도스티그민"],
  [/가바펜\s*entin/, "가바펜틴"],
  [/브라케시세\s*phalic\s*종/, "단두종"],
  [/브라케시세\s*falic/, "단두"],
  [/브라케시세\s*phalic/, "단두"],
  [/사프라\s*enus/, "복재신경"],
  [/나노\s*carrier/, "나노운반체"],
  [/모\s*aimer\s+fistulas/, "항문 주위 누공"],
  [/역\s*compression/, "압축"],
  [/빠르게\s*hire/, "빠르게 채용"],
  [/진료를\s*discuss/, "진료를 논의"],
  [/성격이나\s*appearance/, "성격이나 외모"],
  [/조상은\s*wolves/, "조상은 늑대"],
  [/\belectromyography\b/, "근전도검사"],
  [/종양-\s*free\s*변연/, "종양 음성 절제연"],
  [/집-\s*to\s*집/, "가가호호"],
  [/냉장\s*보관\s*Vaccine\s*보관/, "백신 냉장 보관"],
  [/진행\s+성의/, "진행성"],
  [/연관\s+성의/, "연관"],
];

// 받침 여부(한글 음절만 판단)
function hasBatchim(ch) {
  const code = (ch || "").charCodeAt(0);
  if (!(code >= 0xac00 && code <= 0xd7a3)) return null; // 한글이 아니면 판단 불가
  return (code - 0xac00) % 28 !== 0;
}

// [받침 있을 때, 받침 없을 때]
const PARTICLE_PAIRS = [
  ["은", "는"],
  ["이", "가"],
  ["을", "를"],
  ["과", "와"],
  ["으로", "로"],
  ["이나", "나"],
  ["이란", "란"],
  ["이라", "라"],
];
const PARTICLE_ALT = PARTICLE_PAIRS.flat().sort((a, b) => b.length - a.length).join("|");

function correctParticle(word, particle) {
  if (!particle) return "";
  const b = hasBatchim(word[word.length - 1]);
  if (b === null) return particle; // 끝이 한글이 아니면 그대로
  for (const [withB, noB] of PARTICLE_PAIRS) {
    if (particle === withB || particle === noB) return b ? withB : noB;
  }
  return particle;
}

const COMPILED = FIXES.map(([re, to]) => [new RegExp(re.source + "(" + PARTICLE_ALT + ")?", re.flags.includes("i") ? "gi" : "g"), to]);

// ── 문체 통일: 하다체 → 합니다체 ──
// 한 매체에서 기사마다 문체가 달라지면(89건 습니다체 vs 41건 하다체) 신뢰도가 떨어진다.
// 문장 끝(마침표 앞)에서만 변환하고, 규칙을 모르는 어미는 건드리지 않는다.
// ('~보다 더' 같은 비교 표현이 오변환되지 않도록 반드시 마침표를 요구한다)
function politeEnding(stem) {
  const last = stem[stem.length - 1];
  const code = last.charCodeAt(0) - 0xac00;
  if (code < 0 || code > 11171) return null;
  const jong = code % 28;
  if (jong === 20) return stem + "습니다"; // ㅆ 받침 = 과거형(했다·났다·었다·았다)
  if (stem.endsWith("있") || stem.endsWith("없")) return stem + "습니다";
  if (last === "하") return stem.slice(0, -1) + "합니다";
  if (last === "이") return stem.slice(0, -1) + "입니다";
  if (last === "는") return stem.slice(0, -1) + "습니다";
  if (jong === 4) {
    // ㄴ 받침 → ㅂ 받침 (한다→합니다, 된다→됩니다, 보여준다→보여줍니다)
    return stem.slice(0, -1) + String.fromCharCode(0xac00 + code - 4 + 17) + "니다";
  }
  if (jong === 8) {
    // ㄹ 받침 → ㅂ 받침 (드물다→드뭅니다, 만들다→만듭니다)
    return stem.slice(0, -1) + String.fromCharCode(0xac00 + code - 8 + 17) + "니다";
  }
  if (jong !== 0) return stem + "습니다"; // 그 밖의 자음 어간 (낫다→낫습니다, 좋다→좋습니다)
  return null; // 모음 어간은 오변환 위험이 있어 건드리지 않는다
}

export function toPolite(s) {
  return String(s == null ? "" : s).replace(/([가-힣]+)다(?=\.|$)/g, (m, stem) => politeEnding(stem) || m);
}

// 논문 기사 본문에 프롬프트 구조 라벨이 그대로 노출되던 것 제거
const RESEARCH_LABEL = /^(연구\s*배경\s*(및|과)\s*방법|연구\s*배경|배경\s*(및|과)\s*방법|주요\s*결과|임상\s*시사점|시사점|배경|방법|결과)\s*[:：]\s*/;

export function koreanizeText(s) {
  let t = String(s == null ? "" : s);
  // 생성 중 끼어든 밑줄이 단어를 붙여버린다("상당수가_peer-reviewed") → 공백으로
  t = t.replace(/([가-힣])_+(?=[A-Za-z가-힣])/g, "$1 ");
  for (const [re, to] of COMPILED) {
    t = t.replace(re, (_m, particle) => to + correctParticle(to, particle));
  }
  return t.replace(/[ \t]{2,}/g, " ");
}

// 기사 하나의 사람이 읽는 필드에 적용. 바뀐 필드 수를 반환한다.
export function koreanizeItem(item, { polite = true } = {}) {
  let n = 0;
  const fix = (v) => {
    let out = koreanizeText(v);
    // 논문 본문에 프롬프트 구조 라벨이 그대로 노출되던 것 제거
    out = out.replace(RESEARCH_LABEL, "");
    if (polite) out = toPolite(out);
    if (out !== v) n++;
    return out;
  };
  // 제목은 문체 통일에서 제외 — 신문 헤드라인은 "…보존한다"가 정상이고
  // "…보존합니다"로 바꾸면 오히려 어색해진다.
  if (item.titleKo) {
    const t0 = item.titleKo;
    const t1 = koreanizeText(t0).replace(RESEARCH_LABEL, "");
    if (t1 !== t0) n++;
    item.titleKo = t1;
  }
  if (item.leadKo) item.leadKo = fix(item.leadKo);
  if (Array.isArray(item.bodyKo)) item.bodyKo = item.bodyKo.map(fix);
  if (Array.isArray(item.keyPointsKo)) item.keyPointsKo = item.keyPointsKo.map(fix);
  if (item.angleKo) item.angleKo = fix(item.angleKo);
  return n;
}
