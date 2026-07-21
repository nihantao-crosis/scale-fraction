/* Offline app-shell cache. Only caches owned by this app are ever removed. */
var CACHE_PREFIX = 'sf-calc-';
var CACHE = CACHE_PREFIX + 'v6';
var ASSETS = [
  './',
  './index.html',
  './core.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(ASSETS); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) {
        return k.indexOf(CACHE_PREFIX) === 0 && k !== CACHE;
      }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var requestUrl = new URL(e.request.url);
  if (requestUrl.origin !== self.location.origin || requestUrl.pathname.indexOf(self.registration.scope.replace(self.location.origin, '')) !== 0) return;
  e.respondWith(
    caches.open(CACHE).then(function (cache) {
      return cache.match(e.request).then(function (hit) {
        if (hit) return hit;
        return fetch(e.request).then(function (resp) {
          if (!resp || !resp.ok || resp.type !== 'basic') return resp;
          var copy = resp.clone();
          return cache.put(e.request, copy).catch(function () {}).then(function () { return resp; });
        }).catch(function (err) {
          if (e.request.mode === 'navigate') {
            return cache.match('./index.html').then(function (fallback) {
              if (fallback) return fallback;
              throw err;
            });
          }
          throw err;
        });
      });
    })
  );
});
