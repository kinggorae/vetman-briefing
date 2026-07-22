const C='vmcache-v3';
const SHELL=['/','/latest.json','/archive.json','/icon.svg','/manifest.webmanifest'];
const OFFLINE='<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>연결 없음</title><style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;font-family:"Pretendard Variable","Apple SD Gothic Neo",system-ui,sans-serif;background:#fff;color:#171719}@media(prefers-color-scheme:dark){body{background:#171719;color:#f7f7f8}}.b{max-width:420px;text-align:center}h1{font-size:24px;font-weight:800;margin:0 0 10px}p{margin:0 0 22px;font-size:15px;line-height:1.7;opacity:.7}a{display:inline-block;background:#0066ff;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:12px 22px;border-radius:10px}</style></head><body><div class="b"><h1>연결이 끊겼습니다</h1><p>이 페이지는 아직 받아두지 않았습니다.<br>연결을 확인한 뒤 다시 시도해 주세요.</p><a href="/">오늘의 브리핑 보기</a></div></body></html>';
self.addEventListener('install',function(e){e.waitUntil(caches.open(C).then(function(c){return c.addAll(SHELL);}).then(function(){return self.skipWaiting();}));});
self.addEventListener('activate',function(e){e.waitUntil(caches.keys().then(function(ks){return Promise.all(ks.map(function(k){if(k!==C)return caches.delete(k);}));}).then(function(){return self.clients.claim();}));});
self.addEventListener('fetch',function(e){
  var r=e.request; if(r.method!=='GET')return;
  var u=new URL(r.url); if(u.origin!==location.origin)return;
  e.respondWith(fetch(r).then(function(res){var cp=res.clone();caches.open(C).then(function(c){c.put(r,cp);});return res;}).catch(function(){
    return caches.match(r,{ignoreSearch:true}).then(function(m){
      if(m)return m;
      // 요청한 주소가 캐시에 없다고 홈을 내주면 안 된다. 공유 링크로 들어온 사람이
      // 주소창은 기사인데 화면은 홈인 상태를 보게 된다. 문서 요청에만 안내를 준다.
      if(r.mode==='navigate')return new Response(OFFLINE,{status:503,headers:{'content-type':'text/html; charset=utf-8'}});
      return Response.error();
    });
  }));
});