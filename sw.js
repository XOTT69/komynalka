// Назву кешу більше не треба міняти вручну!
const CACHE_NAME = 'utility-dynamic-cache';

const urlsToCache = [
  './',
  './index.html',
  './manifest.json',
  './icon.png'
];

// Встановлення
self.addEventListener('install', event => {
  self.skipWaiting(); // Одразу активуємо новий SW
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
  );
});

// Активація (очищення старих версій кешу, якщо вони ще лишились)
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cache => {
          if (cache !== CACHE_NAME) {
            return caches.delete(cache);
          }
        })
      );
    }).then(() => self.clients.claim()) // Перехоплюємо контроль над сторінкою
  );
});

// Стратегія: Завжди тягнемо з мережі. Якщо успішно - оновлюємо кеш. Якщо мережі нема - беремо з кешу.
self.addEventListener('fetch', event => {
  // Ігноруємо запити до Firebase, бо вони мають свою логіку (onSnapshot)
  if (event.request.url.includes('firestore.googleapis.com') || event.request.url.includes('identitytoolkit')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(networkResponse => {
        // Якщо завантажили успішно, кладемо копію в кеш
        if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then(cache => {
            cache.put(event.request, responseToCache);
          });
        }
        return networkResponse;
      })
      .catch(() => {
        // Якщо інтернету немає, шукаємо в кеші
        return caches.match(event.request);
      })
  );
});
