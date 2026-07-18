// ── 사이트 메타 (SEO/GEO) ──
export const SITE = {
  baseUrl: "https://vetman-briefing.pages.dev",
  name: "VetMan 해외 브리핑",
  description:
    "해외 수의 전문 미디어의 주요 소식을 매일 선별·번역해 한국 동물병원 원장과 수의사에게 전하는 데일리 브리핑. 임상 지견, 병원 경영, 보호자 소통, 업계 트렌드를 다룹니다.",
};

// ── Plan C (기본): 해외 수의 미디어·저널 RSS ──
// maxAgeDays: 피드별 수집 기간(일), max: 피드별 최대 후보 수
const DIRECT_FEEDS = [
  // 수의 전문 미디어
  { name: "Veterinary Practice News", url: "https://www.veterinarypracticenews.com/feed/" },
  { name: "Today's Veterinary Business", url: "https://todaysveterinarybusiness.com/feed/" },
  { name: "Today's Veterinary Practice", url: "https://todaysveterinarypractice.com/feed/" },
  { name: "Dr. Andy Roark", url: "https://drandyroark.com/feed/" },
  { name: "VetGirl", url: "https://vetgirlontherun.com/feed/" },
  { name: "Vet Candy", url: "https://www.myvetcandy.com/news?format=rss", max: 10, maxAgeDays: 2 },
  { name: "IVC Journal", url: "https://ivcjournal.com/feed/", max: 6 },
  { name: "Today's Veterinary Nurse", url: "https://todaysveterinarynurse.com/feed/", max: 6 },
  { name: "Vet Practice Magazine", url: "https://vetpracticemag.com.au/feed/", max: 6, maxAgeDays: 7 },
  // 학술·연구
  {
    name: "Veterinary Record",
    url: "https://bvajournals.onlinelibrary.wiley.com/feed/20427670/most-recent",
    max: 8,
    maxAgeDays: 3,
  },
  {
    name: "ScienceDaily",
    max: 10,
    maxAgeDays: 3,
    url: "https://www.sciencedaily.com/rss/plants_animals/veterinary_medicine.xml",
  },
];

// 구글 뉴스 토픽 쿼리 — 쿼리 하나가 수천 개 매체를 커버하는 애그리게이터.
// 직접 수집이 막힌 dvm360, AVMA, AAHA 등의 기사도 여기로 우회 확보된다.
const GNEWS_TOPICS = [
  "veterinary medicine",
  '"veterinary practice" OR "animal hospital"',
  '"animal hospital" merger OR acquisition OR "private equity" veterinary',
  "veterinarian burnout OR shortage OR salary",
  '"pet insurance"',
  '"pet food" recall OR nutrition',
  '"veterinary oncology" OR "cancer in dogs" OR "cancer in cats"',
  '"feline medicine" OR "cat health" veterinarian',
  '"canine health" OR "dog disease" veterinarian',
  '"veterinary dentistry" OR "veterinary dermatology"',
  '"veterinary school" OR "veterinary students"',
  "veterinary AI OR telemedicine OR technology",
  "heartworm OR tick OR flea prevention pets",
  '"pet obesity" OR "pet nutrition" veterinary',
  "rabies OR zoonotic OR \"avian influenza\" pets",
  'FDA "animal drug" OR "veterinary drug" approval',
  '"equine veterinary" OR "equine medicine"',
  '"exotic pets" OR avian OR reptile veterinarian',
  '"pet industry" market OR trends',
  '"animal behavior" OR "separation anxiety" veterinary',
];

const GNEWS_FEEDS = GNEWS_TOPICS.map((q) => ({
  name: "Google News",
  type: "gnews",
  max: 12,
  maxAgeDays: 2,
  url: `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`,
}));

export const FEEDS = [...DIRECT_FEEDS, ...GNEWS_FEEDS];
export const FEED_MAX_AGE_DAYS = 10; // maxAgeDays 미지정 피드의 기본 수집 기간

// ── Plan B (보조): Claude 웹 검색으로 레딧 커뮤니티 시그널 수집 ──
export const WEBSEARCH_SUBREDDITS = ["Veterinary", "VetTech", "AskVet"];

// ── Reddit API 직접 수집 (키가 생기면 자동 활성화) ──
export const SUBREDDITS = [
  // minScore: 주간 top에서 후보로 올리는 최소 업보트 수
  { name: "Veterinary", minScore: 15 },          // 수의사·업계 종사자 — 메인 소스
  { name: "VetTech", minScore: 30 },             // 테크니션 — 인력·운영 이슈
  { name: "AskVet", minScore: 80 },              // 보호자 질문 — 시그널용으로 소량만
  { name: "veterinaryprofession", minScore: 5 }, // 소규모 보조 소스
];

export const CANDIDATES_MAX = 150;  // 스코어링에 넘길 최대 후보 수
export const ITEMS_PER_ISSUE = 40;  // 일간 발행 상한 — 실제 발행 수는 MIN_RELEVANCE 통과분 전부
export const SCORE_BATCH = 30;      // 스코어링 배치 크기 (한 번에 너무 많이 넣으면 평가 품질 저하)
export const MIN_RELEVANCE = 6;     // 관련성 점수 하한 (0~10)
export const TOP_COMMENTS = 8;      // 요약에 참고할 상위 댓글 수

// 스펙 합의대로 sonnet-5 기본. CLAUDE_MODEL 환경변수로 교체 가능 (예: claude-opus-4-8)
export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

export const USER_AGENT =
  process.env.REDDIT_USER_AGENT || "macos:vetman-briefing:v0.1 (by /u/vetman)";
