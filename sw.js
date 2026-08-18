// 羊毛衫管家 Service Worker
// 策略：网络优先 + 离线回退（确保线上更新后用户立即看到新版）
// 缓存版本号：每次发布新功能时递增，强制清理旧缓存
const CACHE = "knit-stock-v3.2";

self.addEventListener("install", (e) => {
  // 预缓存核心文件（加速首次加载）
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll([
        "./",
        "./index.html",
        "./manifest.json",
        "./css/style.css",
        "./js/db.js",
        "./js/app.js",
        "./js/qrcode.min.js",
        "./icons/icon-192.png",
        "./icons/icon-512.png",
        "./icons/icon-180.png"
      ]).catch(() => {})
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  // 只处理同源请求（不拦截 Supabase 等外部 API）
  if (url.origin !== self.location.origin) return;

  e.respondWith(
    // 网络优先：先尝试网络，拿到最新版
    fetch(e.request).then((res) => {
      // 成功则更新缓存（仅缓存核心静态资源）
      if (res && res.ok && (url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.endsWith(".html") || url.pathname.endsWith(".png") || url.pathname === "/" || url.pathname.endsWith("index.html") || url.pathname.endsWith("manifest.json"))) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
      }
      return res;
    }).catch(() => {
      // 网络失败：回退到缓存（离线可用）
      return caches.match(e.request).then((hit) => hit || caches.match("./index.html"));
    })
  );
});
