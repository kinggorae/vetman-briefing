// ── 사이트 메타 (SEO/GEO) ──
export const SITE = {
  baseUrl: "https://news.vetmanlab.com",
  name: "VetMan 해외 브리핑",
  // 한글 브랜드명 — 검색엔진은 페이지에 실제로 있는 문자열을 매칭한다.
  // 영문만 있으면 "베트맨랩"으로 검색해도 잡히지 않아 별도로 노출·표기한다.
  brandKo: "베트맨랩",
  brandEn: "VetManLab",
  // Google Analytics 4 측정 ID(G-XXXXXXXXXX). 값이 있을 때만 gtag를 로드한다.
  // 애널리틱스 → 관리 → 데이터 스트림 → 웹에서 발급.
  ga4: process.env.GA4_MEASUREMENT_ID || "",
  // 뉴스레터: Cloudflare KV(SUBS 바인딩) + 발송 수단이 준비되면 true로.
  // false면 구독 폼 대신 지금 동작하는 수단(RSS)을 노출한다.
  // 저장이 안 되는데 이메일을 받아두면 구독한 줄 알고 기다리게 되므로 폼을 띄우지 않는다.
  newsletterEnabled: false,
  description:
    "해외 수의 미디어·논문 수백 곳을 매일 대신 읽고 한국 동물병원이 오늘 알아야 할 것만 골라 전하는 조기경보 레이더. 진료 점검 포인트, 보호자가 곧 물어볼 질문과 설명 대본, 논문 근거등급, 블로그 선점 글감을 함께 제공합니다.",
  // 검색엔진 소유확인 코드(메타태그 방식). 발급받은 content 값만 넣고 빌드하면 된다.
  // 구글 서치콘솔: 속성 추가 → HTML 태그 → content 값
  // 네이버 서치어드바이저: 사이트 등록 → HTML 태그 → content 값
  verification: {
    google: process.env.GOOGLE_SITE_VERIFICATION || "",
    // 네이버 서치어드바이저 소유확인. CI 재빌드에서도 유지되어야 인증이 풀리지 않는다.
    naver: process.env.NAVER_SITE_VERIFICATION || "fd6421aa3bfe682dd2be2d0d8d5d5b7016c8791a",
  },
  // IndexNow: 네이버·빙 등이 지원하는 색인 요청 프로토콜(계정 로그인 불필요).
  // 사이트 루트에 {key}.txt를 두고 소유를 증명한 뒤 URL을 제출한다.
  indexNowKey: "9713ac9a291bbe9c87d85626cd739fe0",
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
  { name: "Vet Candy", url: "https://www.myvetcandy.com/news?format=rss", max: 10, maxAgeDays: 5 },
  { name: "IVC Journal", url: "https://ivcjournal.com/feed/", max: 6 },
  { name: "Today's Veterinary Nurse", url: "https://todaysveterinarynurse.com/feed/", max: 6 },
  { name: "Vet Practice Magazine", url: "https://vetpracticemag.com.au/feed/", max: 6, maxAgeDays: 10 },
  // 학술·연구 — 갱신이 뜸해 수집 기간을 넓게 잡는다(짧으면 매일 0건이 된다)
  {
    name: "Veterinary Record",
    url: "https://bvajournals.onlinelibrary.wiley.com/feed/20427670/most-recent",
    max: 8,
    maxAgeDays: 14,
  },
  {
    name: "ScienceDaily",
    max: 10,
    maxAgeDays: 10,
    url: "https://www.sciencedaily.com/rss/plants_animals/veterinary_medicine.xml",
  },
  // 동료심사 저널 — RSS에 초록 전문(900~1800자)이 실려 생성 품질이 좋다.
  // (dvm360·VIN·AAHA·Vet Times 등은 403/404로 막혀 채택 불가)
  { name: "Veterinary Sciences", url: "https://www.mdpi.com/rss/journal/vetsci", max: 12, maxAgeDays: 14 },
  {
    name: "Frontiers in Veterinary Science",
    url: "https://www.frontiersin.org/journals/veterinary-science/rss",
    max: 12,
    maxAgeDays: 14,
  },
  {
    name: "Veterinary Evidence",
    url: "https://veterinaryevidence.org/index.php/ve/gateway/plugin/WebFeedGatewayPlugin/rss2",
    max: 6,
    maxAgeDays: 45, // 발행이 뜸한 저널
  },
  // 축산까지 포함해 범위가 넓다 — 관련성 스코어링이 반려동물 위주로 걸러낸다
  { name: "Animals", url: "https://www.mdpi.com/rss/journal/animals", max: 10, maxAgeDays: 7 },
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
  '"veterinary anesthesia" OR "pain management" pets',
  '"veterinary surgery" OR orthopedic dog OR cat',
  '"kidney disease" OR "heart disease" dog OR cat treatment',
  '"veterinary diagnostics" OR "blood test" OR imaging pets',
  '"senior pet" OR "geriatric" dog OR cat care',
  '"puppy" OR "kitten" vaccination OR socialization',
  '"veterinary staffing" OR "vet nurse" retention OR wages',
  '"one health" OR "antimicrobial resistance" veterinary',
];

const GNEWS_FEEDS = GNEWS_TOPICS.map((q) => ({
  name: "Google News",
  type: "gnews",
  max: 12,
  maxAgeDays: 3, // 2일은 일간 수확량이 너무 적었다
  url: `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`,
}));

export const FEEDS = [...DIRECT_FEEDS, ...GNEWS_FEEDS];
export const FEED_MAX_AGE_DAYS = 10; // maxAgeDays 미지정 피드의 기본 수집 기간

// ── "진료실 밖 이야기" (가십·화제성 썰) ──
// 레딧이 전 경로에서 차단돼, 레딧·틱톡발 화제글을 기사화하는 매체를 구글 뉴스로 우회 수집한다.
// 신뢰 있는 뉴스 그리드와 섞지 않고 별도 섹션(네이트판식 캐주얼 톤)으로만 노출한다.
const GOSSIP_TOPICS = [
  'veterinarian OR "vet clinic" viral OR shocking OR unbelievable',
  '"vet tech" OR veterinary funny OR drama OR "gone viral"',
  "pet owner vet visit surprising OR emotional OR unexpected OR bill",
  "dog OR cat rescue OR reunion OR miracle veterinary heartwarming",
  '"vet life" OR "veterinary clinic" behind the scenes OR confession',
  "cat OR dog viral vet OR clinic story reddit OR tiktok",
  "unusual OR strange OR rare animal vet case OR treatment",
  "puppy OR kitten OR pet emergency vet dramatic OR surprising",
  "pet insurance OR vet bill shocking OR expensive OR viral",
  "animal shelter OR rescue viral heartwarming OR reunion",
];
export const GOSSIP_FEEDS = GOSSIP_TOPICS.map((q) => ({
  name: "Google News",
  type: "gnews",
  max: 12,
  maxAgeDays: 30, // 화제글은 꼬리가 길다 — 넓게 잡고 seen으로 중복만 방지
  url: `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&hl=en-US&gl=US&ceid=US:en`,
}));
export const GOSSIP_PER_ISSUE = 5; // 이슈당 "진료실 밖 이야기" 최종 수

// ── Plan B (보조): Claude 웹 검색으로 레딧 커뮤니티 시그널 수집 ──
export const WEBSEARCH_SUBREDDITS = ["Veterinary", "VetTech", "AskVet"];

// ── 최신 연구: PubMed 논문 (반려동물 임상 관련) ──
export const PUBMED = {
  // 개·고양이 MeSH + 초록에 veterinary. 축산·실험동물 노이즈를 줄이기 위해 임상 위주.
  term: '("dogs"[MeSH Terms] OR "cats"[MeSH Terms]) AND veterinary[Title/Abstract]',
  recentDays: 30, // 최근 N일
  max: 40, // 후보 최대(스코어링 전)
};
export const PAPERS_PER_ISSUE = 8; // 이슈당 논문 최종 수(PubMed는 안정적이라 비중을 높인다)

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
