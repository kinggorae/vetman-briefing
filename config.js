// ── 사이트 메타 (SEO/GEO) ──
export const SITE = {
  baseUrl: "https://news.vetmanlab.com",
  name: "VetManLab 해외 브리핑",
  // 한글 브랜드명 — 검색엔진은 페이지에 실제로 있는 문자열을 매칭한다.
  // 영문만 있으면 "베트맨랩"으로 검색해도 잡히지 않아 별도로 노출·표기한다.
  brandKo: "베트맨랩",
  brandEn: "VetManLab",
  // Google Analytics 4 측정 ID(G-XXXXXXXXXX). 값이 있을 때만 gtag를 로드한다.
  // 애널리틱스 → 관리 → 데이터 스트림 → 웹에서 발급.
  // 환경변수가 아니라 기본값으로 둔다 — 매일 자동발행 CI가 재빌드할 때 값이 비면 추적이 끊긴다
  ga4: process.env.GA4_MEASUREMENT_ID || "G-XW6BM1B4SH",
  // 뉴스레터 구독 폼 노출 여부.
  // 저장소(KV SUBS)와 수신거부는 이미 붙어 동작한다. 남은 건 발송 수단뿐이다.
  // 보낼 수단이 없는데 이메일을 받아두면 구독한 줄 알고 기다리게 되므로 폼을 내려둔다.
  // 발송(SES 등)이 붙는 날 이 값만 true로 바꾸면 된다.
  newsletterEnabled: false,
  description:
    "해외 수의 미디어·논문 수백 곳을 매일 대신 읽고 한국 동물병원이 오늘 알아야 할 것만 골라 전하는 조기경보 레이더. 진료 점검 포인트, 보호자가 곧 물어볼 질문과 설명 대본, 논문 근거등급, 블로그 선점 글감을 함께 제공합니다.",
  // 검색엔진 소유확인 코드(메타태그 방식). 발급받은 content 값만 넣고 빌드하면 된다.
  // 구글 서치콘솔: 속성 추가 → HTML 태그 → content 값
  // 네이버 서치어드바이저: 사이트 등록 → HTML 태그 → content 값
  verification: {
    // 구글 소유확인은 계정 단위 토큰이라 같은 구글 계정의 모든 속성이 같은 값을 쓴다.
    // news URL 접두어 속성용(도메인 속성 DNS 인증과 별개로, 사이트별 리포트를 따로 본다).
    // CI 재빌드에서도 유지되어야 인증이 풀리지 않으므로 기본값으로 둔다.
    google: process.env.GOOGLE_SITE_VERIFICATION || "xFfA8wuDdok6daUxYf78lKECaDWrZLHdny1hXnod9eI",
    // 네이버 서치어드바이저 소유확인. CI 재빌드에서도 유지되어야 인증이 풀리지 않는다.
    // 메타태그 방식과 HTML 파일 방식(naver{코드}.html) 양쪽에 같은 코드를 쓴다.
    naver: process.env.NAVER_SITE_VERIFICATION || "6199ead62bda2ec9e75dae83b6b5a60d1e2bd435",
  },
  // IndexNow: 네이버·빙 등이 지원하는 색인 요청 프로토콜(계정 로그인 불필요).
  // 사이트 루트에 {key}.txt를 두고 소유를 증명한 뒤 URL을 제출한다.
  indexNowKey: "9713ac9a291bbe9c87d85626cd739fe0",
};

// ── 광고·제휴 슬롯 ──
// 나중에 끼워 넣으면 1면 판짜기가 깨지므로 자리를 미리 잡아둔다.
// enabled:false면 아무것도 렌더링하지 않는다(빈칸이 생기지 않는다).
// 실제 내용 없이 켜지 않는다 — 확인되지 않은 문구를 노출하면 허위광고가 된다.
//
//   at    "mid"  폴드와 쿼드 사이 전면 띠 (신문 1면 하단 스트립)
//         "fold" 폴드 오른쪽 사이드 레일 하단 박스
//   kind  "sponsor" → "광고" 표기 | "partner" → "제휴" 표기 | "house" → "베트맨랩 안내"
//         이용약관 7조에 따라 어떤 경우든 표기와 시각적 구분은 생략할 수 없다.
//
// 미리보기: 주소에 ?slot=preview 를 붙이면 꺼진 슬롯도 화면에서만 보인다.
export const SPONSOR = {
  slots: [
    {
      at: "mid",
      kind: "sponsor",
      enabled: false,
      advertiser: "",   // 광고주명 — 표기 의무 항목
      headline: "",
      body: "",
      cta: "자세히 보기",
      url: "",
    },
    {
      at: "fold",
      kind: "house",
      enabled: false,
      advertiser: "VetMan",
      headline: "",
      body: "",
      cta: "",
      url: "",
    },
  ],
};

// ── 주제 허브(토픽 페이지) ──
// 기사를 날짜 축으로만 쌓으면 롱테일 검색에 착지할 페이지가 없다. 검색하는 사람은
// "고양이 신장병 식이"로 찾지 "2026-07-21 브리핑"으로 찾지 않는다.
// 각 허브는 그 주제의 진료 포인트·보호자 질문·근거 있는 연구를 한곳에 모은다.
//
//   slug  URL(/topic/{slug})   match  제목·리드·본문에 대한 정규식
//   lede  허브 상단 한 줄 설명. 임상적 주장이 아니라 '무엇을 모아둔 곳인지'만 쓴다.
export const TOPICS = [
  { slug: "영양-비만", name: "영양·비만·식이", match: /영양|사료|비만|체중|식이|다이어트|급여/,
    lede: "체중 관리와 처방식, 영양 보조제에 관한 해외 소식을 모았습니다." },
  { slug: "행동", name: "행동·정신 건강", match: /행동|불안|스트레스|사회화|공격성|분리불안/,
    lede: "문제 행동, 분리불안, 사회화에 관한 해외 소식을 모았습니다." },
  { slug: "감염-백신", name: "감염병·백신", match: /백신|감염|바이러스|세균|기생충|예방접종|전염/,
    lede: "감염병 발생 동향과 백신·예방 프로토콜 소식을 모았습니다." },
  { slug: "마취-통증", name: "마취·통증 관리", match: /마취|진통|통증|NSAID|진정/,
    lede: "마취 프로토콜과 통증 관리에 관한 해외 소식을 모았습니다." },
  { slug: "피부-귀", name: "피부·귀", match: /피부|아토피|외이염|귀염|가려움|알레르기|탈모/,
    lede: "아토피, 외이염 등 피부·귀 질환에 관한 해외 소식을 모았습니다." },
  { slug: "종양", name: "종양·항암", match: /종양|림프종|비만세포종|항암|육종|악성|전이/,
    lede: "종양 진단과 항암 치료에 관한 해외 소식을 모았습니다." },
  { slug: "신장-비뇨", name: "신장·비뇨기", match: /신장|신부전|방광|요로|결석|배뇨|만성신장/,
    lede: "만성 신장질환과 비뇨기 문제에 관한 해외 소식을 모았습니다." },
  { slug: "항생제-내성", name: "항생제·내성", match: /항생제|내성|항균|antimicrobial/i,
    lede: "항생제 사용 지침과 내성 문제에 관한 해외 소식을 모았습니다." },
  { slug: "안과", name: "안과", match: /각막|망막|녹내장|백내장|결막|안과|안구/,
    lede: "각막·망막 질환 등 안과 소식을 모았습니다." },
  { slug: "정형-관절", name: "정형외과·관절", match: /관절염|슬개골|십자인대|TPLO|고관절|골절|정형|파행/,
    lede: "관절염과 정형외과 수술에 관한 해외 소식을 모았습니다." },
  { slug: "신경", name: "신경계", match: /신경|발작|디스크|척수|근무력|간질|마비/,
    lede: "발작, 척수 질환 등 신경계 소식을 모았습니다." },
  { slug: "내분비", name: "내분비", match: /갑상선|당뇨|쿠싱|부신|인슐린|호르몬/,
    lede: "갑상선·당뇨 등 내분비 질환 소식을 모았습니다." },
  { slug: "응급-중환자", name: "응급·중환자", match: /응급|중환자|쇼크|수혈|심폐소생|위급/,
    lede: "응급 처치와 중환자 관리에 관한 해외 소식을 모았습니다." },
  { slug: "치과", name: "치과·구강", match: /치과|치아|발치|치주|구강|스케일링/,
    lede: "치주 질환과 발치 등 치과 소식을 모았습니다." },
  { slug: "심장", name: "심장", match: /심장|승모판|심부전|심근|부정맥/,
    lede: "심장 질환 진단과 치료에 관한 해외 소식을 모았습니다." },
  { slug: "병원경영", name: "병원 경영·인력", match: /경영|채용|인력|매출|마케팅|리더십|번아웃|수가|인수/,
    lede: "동물병원 운영, 채용, 번아웃에 관한 해외 소식을 모았습니다." },
];

// ── 법적 고지 페이지(/privacy · /terms · /about)에 들어갈 사업자·연락처 정보 ──
// 빈 값은 페이지에 아예 표기하지 않는다. 확인되지 않은 값을 임의로 채우면
// 그 자체가 허위표시가 되므로, 실제 등록 정보를 받은 뒤에만 채운다.
export const LEGAL = {
  operator: "주식회사 비전인피플",   // 법인명(사업자등록증 기준)
  representative: "이보령",          // 대표자
  bizNumber: "170-81-03853",         // 사업자등록번호
  address: "대구광역시 중구 명덕로 179, 2층 202-제이139호(남산동)",
  email: "vetmanlab@gmail.com",      // 공개 문의처
  // 개인정보 보호책임자를 따로 지정하지 않아 개인정보보호법상 대표가 겸한다.
  // 별도 담당자가 있으면 "이름 (직위)" 형태로 교체.
  privacyOfficer: "이보령 (대표이사)",
  // 업무제휴·광고 문의 창구. 일반 문의(email)와 목적이 달라 담당자를 따로 둔다.
  // 스폰서·제휴 제안이 여기로 오도록 소개/푸터에 노출한다.
  partnerName: "신현규",
  partnerEmail: "vetmanlab@gmail.com",
  effectiveDate: "2026-07-22",       // 시행일
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
  // ── 아래는 후보 77개를 실측해 최근 7일 2건 이상 잡힌 것만 채택 ──
  // (임상 세부 분과는 구글 뉴스에 거의 안 잡혀 제외했고, PUBMED_TOPICS가 담당한다)
  '"animal shelter" OR "pet adoption trends"',
  '"pet insurance" OR "pet health insurance claims"',
  '"point-of-care testing" OR "veterinary diagnostics"',
  '"veterinary school" OR "veterinary students" OR "veterinary education"',
  '"avian influenza in cats" OR "rabies outbreak" OR "H5N1 in animals"',
  '"pet poisoning" OR "veterinary toxicology" OR "toxic to dogs"',
  '"pet food recall" OR "veterinary drug recall"',
  '"atopic dermatitis in dogs" OR "veterinary dermatology" OR "otitis externa"',
  '"canine parvovirus" OR "feline leukemia" OR "veterinary infectious disease"',
  '"veterinary behavior" OR "separation anxiety in dogs" OR "feline behavior problems"',
  '"veterinary telemedicine" OR "virtual vet visit"',
  '"zoonotic disease" OR "one health approach"',
  '"heat stroke in dogs" OR "climate change animal health"',
  '"veterinary radiology" OR "veterinary ultrasound" OR "veterinary imaging"',
  '"veterinary oncology" OR "canine lymphoma" OR "mast cell tumor"',
  '"neonatal puppy" OR "kitten care" OR "pediatric veterinary"',
  '"senior pet care" OR "geriatric dogs" OR "aging in cats"',
  '"veterinary workforce shortage" OR "veterinarian shortage"',
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

// 임상 분과별 PubMed 쿼리.
// 구글 뉴스로 임상 세부 분과를 덮으려 77개 쿼리를 실측했으나 대부분 0건이었다
// ("canine epilepsy" 같은 주제로 매일 뉴스가 나오지 않는다). 임상 깊이는 PubMed에 있고,
// 아래 22개 분과는 최근 30일 기준 581편이 확인됐다. 분과별로 조금씩 뽑아
// 특정 분과만 계속 노출되는 편중을 막는다.
const DC = '("dogs"[MeSH Terms] OR "cats"[MeSH Terms])';
export const PUBMED_TOPICS = [
  { name: "임상 일반", term: `${DC} AND veterinary[Title/Abstract]` },
  { name: "종양", term: `${DC} AND (neoplasm*[Title/Abstract] OR oncolog*[Title/Abstract] OR lymphoma[Title/Abstract])` },
  { name: "심장", term: `${DC} AND (cardiolog*[Title/Abstract] OR "heart disease"[Title/Abstract] OR cardiomyopath*[Title/Abstract])` },
  { name: "신경", term: `${DC} AND (neurolog*[Title/Abstract] OR epilep*[Title/Abstract] OR "intervertebral disc"[Title/Abstract])` },
  { name: "정형·외과", term: `${DC} AND (orthopedic*[Title/Abstract] OR "cruciate ligament"[Title/Abstract] OR arthroplast*[Title/Abstract])` },
  { name: "피부", term: `${DC} AND (dermatolog*[Title/Abstract] OR "atopic dermatitis"[Title/Abstract] OR pruritus[Title/Abstract])` },
  { name: "안과", term: `${DC} AND (ophthalm*[Title/Abstract] OR cornea*[Title/Abstract] OR glaucoma[Title/Abstract])` },
  { name: "치과", term: `${DC} AND (dental[Title/Abstract] OR periodontal[Title/Abstract] OR "tooth resorption"[Title/Abstract])` },
  { name: "신장·비뇨", term: `${DC} AND ("kidney disease"[Title/Abstract] OR renal[Title/Abstract] OR urolith*[Title/Abstract])` },
  { name: "내분비", term: `${DC} AND (diabetes[Title/Abstract] OR hyperthyroid*[Title/Abstract] OR hyperadrenocorticism[Title/Abstract])` },
  { name: "소화기", term: `${DC} AND (gastrointestinal[Title/Abstract] OR enteropath*[Title/Abstract] OR pancreatit*[Title/Abstract])` },
  { name: "감염·기생충", term: `${DC} AND (infectio*[Title/Abstract] OR parasit*[Title/Abstract] OR "tick-borne"[Title/Abstract])` },
  { name: "마취·통증", term: `${DC} AND (anesthes*[Title/Abstract] OR analges*[Title/Abstract] OR "pain management"[Title/Abstract])` },
  { name: "영상", term: `${DC} AND (ultrasonograph*[Title/Abstract] OR "computed tomography"[Title/Abstract] OR radiograph*[Title/Abstract])` },
  { name: "응급·중환자", term: `${DC} AND (emergency[Title/Abstract] OR "critical care"[Title/Abstract] OR sepsis[Title/Abstract])` },
  { name: "행동·복지", term: `${DC} AND (behavio*[Title/Abstract] OR anxiety[Title/Abstract] OR welfare[Title/Abstract])` },
  { name: "영양", term: `${DC} AND (nutrition[Title/Abstract] OR diet[Title/Abstract] OR obesity[Title/Abstract])` },
  { name: "재활", term: `${DC} AND (rehabilitation[Title/Abstract] OR physiotherap*[Title/Abstract])` },
  { name: "번식", term: `${DC} AND (reproduct*[Title/Abstract] OR pregnan*[Title/Abstract] OR semen[Title/Abstract])` },
  { name: "노령", term: `${DC} AND (geriatric[Title/Abstract] OR aging[Title/Abstract] OR "cognitive dysfunction"[Title/Abstract])` },
  { name: "이그조틱", term: '(rabbits[MeSH Terms] OR ferrets[MeSH Terms] OR birds[MeSH Terms] OR reptiles[MeSH Terms]) AND veterinary[Title/Abstract]' },
  { name: "말", term: 'horses[MeSH Terms] AND (lameness[Title/Abstract] OR colic[Title/Abstract] OR equine[Title/Abstract])' },
];
export const PUBMED_PER_TOPIC = 4; // 분과당 후보 수(스코어링 전)
export const PAPERS_PER_ISSUE = 12; // 분과 확장으로 후보가 79편까지 늘어 비중을 높인다

// ── Reddit API 직접 수집 (키가 생기면 자동 활성화) ──
export const SUBREDDITS = [
  // minScore: 주간 top에서 후보로 올리는 최소 업보트 수
  { name: "Veterinary", minScore: 15 },          // 수의사·업계 종사자 — 메인 소스
  { name: "VetTech", minScore: 30 },             // 테크니션 — 인력·운영 이슈
  { name: "AskVet", minScore: 80 },              // 보호자 질문 — 시그널용으로 소량만
  { name: "veterinaryprofession", minScore: 5 }, // 소규모 보조 소스
];

export const CANDIDATES_MAX = 200;  // 소스 확장분이 스코어링 전에 잘리지 않도록
export const ITEMS_PER_ISSUE = 40;  // 일간 발행 상한 — 실제 발행 수는 MIN_RELEVANCE 통과분 전부
export const SCORE_BATCH = 30;      // 스코어링 배치 크기 (한 번에 너무 많이 넣으면 평가 품질 저하)
export const MIN_RELEVANCE = 6;     // 관련성 점수 하한 (0~10)
export const TOP_COMMENTS = 8;      // 요약에 참고할 상위 댓글 수

// 스펙 합의대로 sonnet-5 기본. CLAUDE_MODEL 환경변수로 교체 가능 (예: claude-opus-4-8)
export const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

export const USER_AGENT =
  process.env.REDDIT_USER_AGENT || "macos:vetman-briefing:v0.1 (by /u/vetman)";
