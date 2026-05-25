const CACHE_NAME = 'komunalka-RESET';
const PRECACHE_URLS = ['./', './index.html', './app.js', './manifest.json', './icon.png'];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(names => Promise.all(names.map(n => caches.delete(n))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', event => {
    // Поки що — завжди network first, без кешу
    return;
});

self.addEventListener('push', event => {
    const data = event.data ? event.data.json() : { title: 'Комуналка 🏠', body: 'Час передати показники!' };
    event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: 'icon.png', badge: 'icon.png', vibrate: [100, 50, 100] }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(clients.openWindow('/'));
});
