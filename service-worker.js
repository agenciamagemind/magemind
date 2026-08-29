const CACHE_NAME='magemind-shell-20260829-16';
const SHELL=['./','./index.html','./mobile.css','./mobile-app.js','./push-notifications.js','./manifest.webmanifest','./magemind-logo-transparent.png','./magemind-logo-192.png','./magemind-logo-512.png'];

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting()));
});

self.addEventListener('activate',event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener('fetch',event=>{
  const request=event.request;
  if(request.method!=='GET') return;
  const url=new URL(request.url);
  if(url.origin!==self.location.origin) return;
  if(request.mode==='navigate'){
    event.respondWith(fetch(request).then(response=>{
      const copy=response.clone(); caches.open(CACHE_NAME).then(cache=>cache.put('./index.html',copy)); return response;
    }).catch(()=>caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{
    if(response.ok) caches.open(CACHE_NAME).then(cache=>cache.put(request,response.clone()));
    return response;
  })));
});

self.addEventListener('push',event=>{
  let payload={};
  try{ payload=event.data?.json()||{}; }catch(_){ payload={body:event.data?.text()||''}; }
  const options={
    body:payload.body||'',icon:'./magemind-logo-192.png',badge:'./magemind-logo-192.png',
    tag:payload.notificationId?`magemind-${payload.notificationId}`:'magemind-general',
    renotify:false,data:{url:payload.url||'./',demandId:payload.demandId||null},
  };
  event.waitUntil(self.registration.showNotification(payload.title||'Magemind',options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const data=event.notification.data||{};
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    for(const client of clients){
      if('focus' in client){
        await client.focus();
        if(data.demandId) client.postMessage({type:'OPEN_DEMAND',demandId:data.demandId});
        return;
      }
    }
    return self.clients.openWindow(data.url||'./');
  }));
});
