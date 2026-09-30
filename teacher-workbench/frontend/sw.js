/**
 * sw.js — 本地静态缓存 Service Worker
 *
 * 策略：
 * - 同源静态资源（assets/ vendor/ views/ *.js *.css *.svg *.png 等）：network-first，
 *   网络失败回缓存——保证部署更新即时生效，离线/弱网也有兜底
 * - 品牌图片等跨域图床（githubusercontent / github.io / jsDelivr / gitee 等的 png/jpg/
 *   gif/webp/svg/ico）：cache-first，跨域 opaque 响应同样缓存——校徽/icon/加载图标只拉一次
 * - /api/ 业务请求与非同源非图片请求：不拦截
 *
 * 缓存名带版本号；sw.js 内容变更即触发 activate 清理旧版缓存。
 */
const CACHE = 'wb-static-v16';
const UPDATE_BASE = 'https://fff.xmoj-script.uk';
const UPDATE_MANIFEST = `${UPDATE_BASE}/update-manifest.json`;

const STATIC_PREFIXES = ['/assets/', '/vendor/', '/views/'];
const STATIC_EXT = /\.(js|css|svg|png|jpe?g|gif|webp|ico|json|woff2?)(\?.*)?$/i;

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|svg|ico)(\?.*)?$/i;
const BRAND_HOSTS = ['githubusercontent.com', 'github.io', 'jsdelivr.net', 'gitee.com', 'rawcdn.githack.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('wb-static-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => updateRemoteCache())
      .then(() => self.clients.claim())
  );
});

async function updateRemoteCache() {
  try {
    const manifestResponse = await fetch(`${UPDATE_MANIFEST}?t=${Date.now()}`, { cache: 'no-store' });
    if (!manifestResponse.ok) return;
    const manifest = await manifestResponse.json();
    if (!manifest.version || !Array.isArray(manifest.files)) return;
    const cacheName = `wb-static-remote-${manifest.version}`;
    const cache = await caches.open(cacheName);
    await Promise.all(manifest.files.map(async (file) => {
      const remote = await fetch(`${UPDATE_BASE}/${file}`, { cache: 'no-store' });
      if (!remote.ok) throw new Error(`update failed: ${file}`);
      await cache.put(new URL(file, self.registration.scope).href, remote);
    }));
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((key) => key.startsWith('wb-static-remote-') && key !== cacheName)
      .map((key) => caches.delete(key)));
    return true;
  } catch (_) {
    // 云端不可用时继续使用 APK 内置资源和已有缓存。
    return false;
  }
}

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'UPDATE_REMOTE_CACHE') return;
  event.waitUntil(
    updateRemoteCache().then((updated) => {
      event.ports[0]?.postMessage({ updated });
    })
  );
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  // GitHub 品牌图床代理（同源 /api/ 下的图片字节）：cache-first
  // 文件名带随机前缀，替换图片即新 URL，天然免失效问题
  if (url.origin === self.location.origin && url.pathname === '/api/v1/brand-images/file') {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        const resp = await fetch(e.request);
        if (resp.ok) cache.put(e.request, resp.clone());
        return resp;
      })
    );
    return;
  }

  // 同源静态资源：stale-while-revalidate——缓存立即返回（秒开），后台向网络校验，
  // 有更新才替换缓存（「修改了才更新，否则保留缓存」）；缓存未命中时等网络。
  if (url.origin === self.location.origin && !url.pathname.startsWith('/api/')) {
    const isStatic =
      STATIC_PREFIXES.some((p) => url.pathname.startsWith(p)) ||
      STATIC_EXT.test(url.pathname) ||
      url.pathname === '/' ||
      url.pathname === '/index.html';
    if (!isStatic) return;
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const remoteCaches = (await caches.keys())
          .filter((key) => key.startsWith('wb-static-remote-'))
          .sort()
          .reverse();
        for (const remoteCacheName of remoteCaches) {
          const remoteHit = await caches.open(remoteCacheName).then((remoteCache) => remoteCache.match(e.request));
          if (remoteHit) return remoteHit;
        }
        const hit = await cache.match(e.request);
        const refresh = fetch(e.request)
          .then((resp) => {
            if (resp.ok) cache.put(e.request, resp.clone());
            return resp;
          })
          .catch(() => null);
        // 命中缓存：先返回本地，后台静默更新（下次访问即新版）
        if (hit) {
          refresh.catch(() => {});
          return hit;
        }
        const resp = await refresh;
        if (resp) return resp;
        throw new Error('offline and no cache');
      })
    );
    return;
  }

  // 品牌图片等跨域图床：cache-first（跨域 opaque 响应也缓存）
  if (IMAGE_EXT.test(url.pathname) && BRAND_HOSTS.some((h) => url.hostname.endsWith(h))) {
    e.respondWith(
      caches.open(CACHE).then(async (cache) => {
        const hit = await cache.match(e.request);
        if (hit) return hit;
        const resp = await fetch(e.request, { mode: 'no-cors' }).catch(() => null);
        if (resp && (resp.ok || resp.type === 'opaque')) {
          cache.put(e.request, resp.clone());
          return resp;
        }
        // 拉取失败时若缓存里有忽略查询串的版本也用上
        const loose = await cache.match(e.request, { ignoreSearch: true });
        if (loose) return loose;
        return resp || Response.error();
      })
    );
  }
});
