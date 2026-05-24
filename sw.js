const CACHE_NAME = 'komunalka-v3';
const PRECACHE_URLS = ['./', './index.html', './app.js', './manifest.json', './icon.png'];

self.addEventListener('install', event => {
    self.skipWaiting();
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (url.hostname.includes('workers.dev') || url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com') || url.hostname.includes('firebaseapp.com') || url.hostname.includes('cdnjs.cloudflare.com')) return;
    event.respondWith(fetch(event.request).then(response => { if (response && response.status === 200 && response.type === 'basic') { const clone = response.clone(); caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)); } return response; }).catch(() => caches.match(event.request)));
});

// Push notification handler
self.addEventListener('push', event => {
    const data = event.data ? event.data.json() : { title: 'Комуналка 🏠', body: 'Час передати показники!' };
    event.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: 'icon.png', badge: 'icon.png', vibrate: [100, 50, 100] }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(clients.openWindow('/'));
});
