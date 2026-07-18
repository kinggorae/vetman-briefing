// ── Plan C (기본): 해외 수의 미디어 RSS ──
// maxAgeDays: 피드별 수집 기간(일), max: 피드별 최대 후보 수
export const FEEDS = [
  { name: "Veterinary Practice News", url: "https://www.veterinarypracticenews.com/feed/" },
  { name: "Today's Veterinary Business", url: "https://todaysveterinarybusiness.com/feed/" },
  { name: "Today's Veterinary Practice", url: "https://todaysveterinarypractice.com/feed/" },
  { name: "Dr. Andy Roark", url: "https://drandyroark.com/feed/" },
  { name: "VetGirl", url: "https://vetgirlontherun.com/feed/" },
  // 구글 뉴스 애그리게이터 — 직접 수집이 막힌 dvm360, AVMA 등도 우회 확보
  {
    name: "Google News",
    type: "gnews",
    max: 20,
    maxAgeDays: 2,
    url: "https://news.google.com/rss/search?q=veterinary+medicine&hl=en-US&gl=US&ceid=US:en",
  },
  {
    name: "Google News",
    type: "gnews",
    max: 20,
    maxAgeDays: 2,
    url: "https://news.google.com/rss/search?q=%22veterinary+practice%22+OR+%22animal+hospital%22&hl=en-US&gl=US&ceid=US:en",
  },
  {
    name: "ScienceDaily",
    max: 10,
    maxAgeDays: 3,
    url: "https://www.sciencedaily.com/rss/plants_animals/veterinary_medicine.xml",
  },
];
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

export const CANDIDATES_MAX = 50;   // 스코어링에 넘길 최대 후보 수
export const ITEMS_PER_ISSUE = 5;   // 일간 이슈당 최종 아이템 수
export const MIN_RELEVANCE = 6;     // 관련성 점수 하한 (0~10)
export const TOP_COMMENTS = 8;      // 요약에 참고할 상위 댓글 수

// 스펙 합의대로 sonnet-5 기본. CLAUDE_MODEL 환경변수로 교체 가능 (예: claude-opus-4-8)
export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

export const USER_AGENT =
  process.env.REDDIT_USER_AGENT || "macos:vetman-briefing:v0.1 (by /u/vetman)";
