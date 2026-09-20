// build.mjs replaces these with the complete, content-addressed release manifest.
const CACHE_NAME = 'komunalka-dev';
const PRECACHE_URLS = ['./index.html','./app.js','./sync-queue.js','./data-store.js','./styles/modern.css','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(PRECACHE_URLS.map(url=>new Request(url,{cache:'reload'})))));
});
self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(names=>Promise.all(names.filter(name=>name.startsWith('komunalka-')&&name!==CACHE_NAME).map(name=>caches.delete(name)))).then(()=>self.clients.claim()));
});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  const path=url.pathname;
  const isApp=event.request.mode === 'navigate' && (path.endsWith('/')||path.endsWith('/index.html'));
  if(isApp){event.respondWith(caches.open(CACHE_NAME).then(cache=>cache.match('./index.html')).then(cached=>cached||fetch(event.request)));return;}
  event.respondWith(caches.open(CACHE_NAME).then(cache=>cache.match(event.request,{ignoreSearch:true})).then(cached=>cached||fetch(event.request)));
});
self.addEventListener('message',event=>{if(event.data?.type==='GET_VERSION')event.ports?.[0]?.postMessage({version:CACHE_NAME});if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('push',event=>{
  let data={title:'Комуналка',body:'Перевірте нагадування у застосунку.'};
  try{if(event.data)data={...data,...event.data.json()};}catch{}
  event.waitUntil(self.registration.showNotification(String(data.title).slice(0,100),{body:String(data.body).slice(0,500),icon:'icon-192.png',badge:'icon-192.png',tag:String(data.tag||'komunalka-reminder'),renotify:false,data:{url:'./index.html'},actions:[{action:'open',title:'Відкрити'}]}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{const current=windows.find(client=>{const url=new URL(client.url);return url.origin===self.location.origin&&!url.searchParams.has('share');});return current?current.focus():self.clients.openWindow('./index.html');}));
});
