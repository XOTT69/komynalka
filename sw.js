const CACHE_NAME = 'komunalka-v4';
const PRECACHE = ['./', './index.html', './styles.css', './js/app.js', './js/config.js', './js/state.js', './js/auth.js', './js/ui.js', './js/sync.js', './js/tabs.js', './js/pwa.js', './js/dashboard.js', './js/calc.js', './js/charts.js', './manifest.json', './icon.png'];

self.addEventListener('install', (e) => {
    self.skipWaiting();
    e.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE)));
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (e) => {
    const url = new URL(e.request.url);

    // Skip API and external
    if (url.hostname.includes('workers.dev') || url.hostname.includes('googleapis.com') || url.hostname.includes('gstatic.com') || url.hostname.includes('google-analytics.com') || url.hostname.includes('googletagmanager.com')) return;

    // CDN — cache first
    if (url.hostname.includes('cdnjs.cloudflare.com') || url.hostname.includes('cdn.jsdelivr.net')) {
        e.respondWith(caches.match(e.request).then(cached => {
            if (cached) return cached;
            return fetch(e.request).then(res => {
                if (res.ok) { const clone = res.clone(); caches.open(CACHE_NAME).then(c => c.put(e.request, clone)); }
                return res;
            }).catch(() => cached);
        }));
        return;
    }

    // App files — stale-while-revalidate
    e.respondWith(caches.match(e.request).then(cached => {
        const fetching = fetch(e.request).then(res => {
            if (res && res.status === 200 && res.type === 'basic') {
                const clone = res.clone();
                caches.open(CACHE_NAME).then(c => c.put(e.request, clone));
            }
            return res;
        }).catch(() => cached);
        return cached || fetching;
    }));
});

// Push
self.addEventListener('push', (e) => {
    const data = e.data ? e.data.json() : { title: 'Комуналка 🏠', body: 'Час передати показники!' };
    e.waitUntil(self.registration.showNotification(data.title, { body: data.body, icon: 'icon.png', badge: 'icon.png', vibrate: [100, 50, 100] }));
});

self.addEventListener('notificationclick', (e) => { e.notification.close(); e.waitUntil(clients.openWindow('/')); });
