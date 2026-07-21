// 생성물에 남은 영어 잔여물 중 "확실한 것만" 한국어로 교정한다.
// 원칙: 약물명(enrofloxacin)·학명(Crenosoma vulpis)·의학용어(lactate, microbiome)·
//       단위(kcal, AUC)·고유명사는 절대 건드리지 않는다. 일괄 제거는 학명을 깨뜨린다.
// 대상은 (1) 생성 중 단어가 깨진 조각, (2) 문맥과 무관하게 한국어가 맞는 일반 영어뿐.
//
// 영어를 한국어로 바꾸면 받침이 달라져 뒤 조사가 틀어진다("문헌가", "어조과").
// 그래서 치환 시 뒤따르는 조사도 함께 교정한다.

// 치환 대상(조사 제외) → 한국어
const FIXES = [
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

const COMPILED = FIXES.map(([re, to]) => [new RegExp(re.source + "(" + PARTICLE_ALT + ")?", "g"), to]);

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
export function koreanizeItem(item) {
  let n = 0;
  const fix = (v) => {
    const out = koreanizeText(v);
    if (out !== v) n++;
    return out;
  };
  if (item.titleKo) item.titleKo = fix(item.titleKo);
  if (item.leadKo) item.leadKo = fix(item.leadKo);
  if (Array.isArray(item.bodyKo)) item.bodyKo = item.bodyKo.map(fix);
  if (Array.isArray(item.keyPointsKo)) item.keyPointsKo = item.keyPointsKo.map(fix);
  if (item.angleKo) item.angleKo = fix(item.angleKo);
  return n;
}
