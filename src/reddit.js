import { USER_AGENT } from "../config.js";

// OAuth 크리덴셜이 있으면 oauth.reddit.com, 없으면 공개 JSON endpoint 사용
let cachedToken = null;

async function getToken() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const res = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${id}:${secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`Reddit token request failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + (data.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

async function redditGet(path, params = {}) {
  const token = await getToken();
  const base = token ? "https://oauth.reddit.com" : "https://www.reddit.com";
  const suffix = token ? "" : ".json";
  const url = new URL(base + path + suffix);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const headers = { "User-Agent": USER_AGENT };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`Reddit GET ${url.pathname} failed: ${res.status}`);
  return res.json();
}

export async function fetchWeeklyTop(subreddit, limit = 50) {
  const data = await redditGet(`/r/${subreddit}/top`, { t: "week", limit });
  return data.data.children.map(({ data: p }) => ({
    id: p.id,
    sourceType: "reddit",
    sourceLabel: `r/${p.subreddit}`,
    subreddit: p.subreddit,
    title: p.title,
    body: (p.selftext || "").slice(0, 4000),
    score: p.score,
    numComments: p.num_comments,
    url: `https://www.reddit.com${p.permalink}`,
    publishedAt: new Date(p.created_utc * 1000).toISOString(),
    over18: p.over_18,
    stickied: p.stickied,
    isSelf: p.is_self,
  }));
}

export async function fetchTopComments(subreddit, postId, limit = 8) {
  const data = await redditGet(`/r/${subreddit}/comments/${postId}`, {
    sort: "top",
    limit,
    depth: 1,
  });
  const comments = data[1]?.data?.children ?? [];
  return comments
    .filter((c) => c.kind === "t1" && c.data.body && !c.data.stickied)
    .slice(0, limit)
    .map((c) => ({ score: c.data.score, body: c.data.body.slice(0, 1500) }));
}
