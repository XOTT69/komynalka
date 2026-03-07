const CACHE_NAME = 'utility-cache-v3'; // Версію змінено на v3
const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon.png'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // Змушує новий Service Worker активуватися одразу
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  // Видаляємо старий кеш при оновленні
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  // Стратегія "Network First" - завжди тягне свіжу версію
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
