/* Network-first app shell with an offline cache owned only by this app. */
var CACHE_PREFIX = 'sf-calc-';
var CACHE = CACHE_PREFIX + 'v8';
var ASSETS = [
  './index.html',
  './core.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png'
];

self.addEventListener('install', function (event) {
  event.waitUntil(
    caches.open(CACHE)
      .then(function (cache) { return cache.addAll(ASSETS); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (key) {
        return key.indexOf(CACHE_PREFIX) === 0 && key !== CACHE;
      }).map(function (key) { return caches.delete(key); }));
    }).then(function () { return self.clients.claim(); })
  );
});

function isCacheable(response) {
  return !!response && response.ok && response.type === 'basic';
}

function cachedFallback(cache, request, error) {
  var fallbackRequest = request.mode === 'navigate' ? './index.html' : request;
  return cache.match(fallbackRequest).then(function (hit) {
    if (hit) return hit;
    throw error;
  });
}

self.addEventListener('fetch', function (event) {
  if (event.request.method !== 'GET') return;
  var requestUrl = new URL(event.request.url);
  var scopePath = new URL(self.registration.scope).pathname;
  if (requestUrl.origin !== self.location.origin || requestUrl.pathname.indexOf(scopePath) !== 0) return;

  // Fetch starts independently of CacheStorage so a cache outage can never
  // block an otherwise healthy online response.
  var networkPromise = Promise.resolve().then(function () {
    return fetch(event.request);
  });

  // Cache writes stay in the service worker lifetime but not in the response
  // path. Navigations refresh one canonical app-shell key for reliable offline
  // fallback instead of accumulating route-specific HTML entries.
  var cacheUpdatePromise = networkPromise.then(function (response) {
    if (!isCacheable(response)) return;
    return caches.open(CACHE).then(function (cache) {
      var target = event.request.mode === 'navigate' ? './index.html' : event.request;
      return cache.put(target, response.clone()).catch(function () {});
    }).catch(function () {});
  }, function () {});

  var responsePromise = networkPromise.catch(function (networkError) {
    return caches.open(CACHE).then(function (cache) {
      return cachedFallback(cache, event.request, networkError);
    }).catch(function () {
      throw networkError;
    });
  });

  event.respondWith(responsePromise);
  event.waitUntil(cacheUpdatePromise);
});
