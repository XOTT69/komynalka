const CACHE_NAME = 'komunalka-v6.0.1';
const PRECACHE_URLS = [
  './', './index.html', './dist/tailwind.css?v=6.0.1', './styles/fonts.css?v=6.0.1', './styles/app-shell.css?v=6.0.1', './styles/quiet-ui.css?v=6.0.1', './app.js?v=6.0.1', './ui-dialogs.js?v=6.0.1', './export-tools.js?v=6.0.1', './record-card.js?v=6.0.1', './year-report-image.js?v=6.0.1', './ai-chat.js?v=6.0.1',
  './vendor/firebase/firebase-app-compat.js', './vendor/firebase/firebase-auth-compat.js',
  './vendor/jspdf/jspdf.umd.min.js', './vendor/jspdf/jspdf.plugin.autotable.min.js',
  './vendor/fonts/Roboto-Regular.ttf',
  './vendor/fonts/inter/inter-cyrillic-wght-normal.woff2', './vendor/fonts/inter/inter-latin-wght-normal.woff2',
  './vendor/fonts/inter-tight/inter-tight-cyrillic-wght-normal.woff2', './vendor/fonts/inter-tight/inter-tight-latin-wght-normal.woff2',
  './vendor/fontawesome/css/all.min.css',
  './vendor/fontawesome/webfonts/fa-brands-400.woff2', './vendor/fontawesome/webfonts/fa-regular-400.woff2',
  './vendor/fontawesome/webfonts/fa-solid-900.woff2', './vendor/fontawesome/webfonts/fa-v4compatibility.woff2',
  './manifest.json', './icon.png', './icon-192.png', './icon-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(PRECACHE_URLS))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(names => Promise.all(names.filter(n => n !== CACHE_NAME).map(n => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!url.protocol.startsWith('http')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('./index.html').then(cached => cached || caches.match('./')))
    );
    return;
  }
  if (
    url.hostname.includes('workers.dev') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('gstatic.com') ||
    url.hostname.includes('firebaseapp.com') ||
    url.hostname.includes('google-analytics.com') ||
    url.hostname.includes('googletagmanager.com')
  ) return;
  if (
    url.hostname.includes('cdnjs.cloudflare.com') ||
    url.hostname.includes('cdn.tailwindcss.com') ||
    url.hostname.includes('cdn.jsdelivr.net')
  ) {
    event.respondWith(
      fetch(event.request).then(response => {
        if (response && response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => { try { cache.put(event.request, clone); } catch(e) {} });
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }
  event.respondWith(
    fetch(event.request).then(response => {
      if (response && response.status === 200 && response.type === 'basic') {
        const clone = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone)).catch(() => {});
      }
      return response;
    }).catch(() => caches.match(event.request))
  );
});

self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : { title: 'Комуналка 🏠', body: 'Час передати показники!' };
  event.waitUntil(self.registration.showNotification(data.title, {
    body: data.body, icon: 'icon.png', badge: 'icon.png', vibrate: [100, 50, 100],
    actions: [{ action: 'open', title: 'Відкрити' }]
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) return client.focus();
      }
      return clients.openWindow('/');
    })
  );
});
