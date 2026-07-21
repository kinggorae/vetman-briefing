// 소규모 동시 실행 풀.
// 생성·레이더 호출이 전부 순차라 일간 실행이 100분을 넘겼다(비공개 저장소는
// GitHub Actions 무료 한도가 월 2,000분이라 과금으로 이어진다).
// 결과물은 그대로 두고 대기 시간만 줄이기 위해 소수 동시 실행을 쓴다.
// 게이트웨이 레이트리밋을 감안해 기본 3으로 낮게 잡는다.
export const CONCURRENCY = Number(process.env.LLM_CONCURRENCY || 3);

// items를 worker로 처리한다. 입력 순서대로 결과를 돌려주고,
// 실패한 항목은 null이 되어 호출부가 걸러낼 수 있다.
export async function mapPool(items, worker, limit = CONCURRENCY) {
  const out = new Array(items.length).fill(null);
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await worker(items[i], i);
      } catch (err) {
        out[i] = null;
        console.error(`  ✗ ${err.message}`);
      }
    }
  });
  await Promise.all(runners);
  return out;
}

// 목표 개수를 채울 때까지만 돌린다(가십처럼 "N건 성공하면 중단"인 경우).
// 이미 목표를 채웠으면 남은 항목은 시작하지 않는다.
export async function mapPoolUntil(items, worker, need, limit = CONCURRENCY) {
  const got = [];
  let next = 0;
  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (got.length < need) {
      const i = next++;
      if (i >= items.length) return;
      try {
        const r = await worker(items[i], i);
        if (r) got.push(r);
      } catch (err) {
        console.error(`  ✗ ${err.message}`);
      }
    }
  });
  await Promise.all(runners);
  return got.slice(0, need);
}
