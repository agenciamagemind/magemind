const CACHE_NAME='magemind-shell-launch-20261019-4';
const SHELL=['./privacy.html','./data-deletion.html','./legal.css?v=20261019-4','./tracking-pilot-access.js?v=20261019-4','./app-scrollbars.css?v=20261019-4','./tracking-revenue-chart.js?v=20261019-4','./filter-ui.js?v=20261019-4','./filter-ui.css?v=20261019-4','./desktop-sidebar.js?v=20261019-4','./desktop-sidebar.css?v=20261019-4','./tracking-dashboard.js?v=20261019-4','./tracking-dashboard.css?v=20261019-4','./mobile-shell.js?v=20261019-4','./mobile-shell.css?v=20261019-4','./support-whatsapp.js','./tracking-admin.js','./','./index.html','./partner-workspace.js','./partners.js','./partners.css','./product-ui.css','./product-ui.js','./mobile.css','./auth.css','./goals.css','./goals.js','./tasks.js','./firewall-sessions.js','./security-rich-text.css','./security-rich-text.js','./mobile-app.js','./app-core.js','./app-accessibility.js','./push-notifications.js','./manifest.webmanifest','./magemind-logo-transparent.png','./magemind-logo-192.png','./magemind-logo-512.png','./magemind-auth-creatives.webp'];

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
    const key=url.pathname==='/'||url.pathname==='/index.html'?'./index.html':request;
    event.respondWith(fetch(request).then(async response=>{
      if(response.ok){const cache=await caches.open(CACHE_NAME);await cache.put(key,response.clone());}
      return response;
    }).catch(async()=>await caches.match(key)||Response.error()));
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
  const compact=(value,max,fallback='')=>{
    const normalized=String(value||fallback).replace(/\s+/g,' ').trim();
    if(normalized.length<=max) return normalized;
    const sentences=normalized.match(/[^.!?]+[.!?]+/g)||[];
    let complete='';
    for(const sentence of sentences){
      const candidate=(complete+' '+sentence.trim()).trim();
      if(candidate.length>max) break;
      complete=candidate;
    }
    if(complete.length>=Math.floor(max*.4)) return complete;
    const slice=normalized.slice(0,max-1).trimEnd();
    const boundary=slice.lastIndexOf(' ');
    const cut=boundary>=Math.floor(max*.58)?slice.slice(0,boundary):slice;
    return cut.replace(/[\s.,;:!?-]+$/,'')+'…';
  };
  const title=compact(payload.title,28,'Magemind');
  const body=compact(payload.body,72);
  const options={
    body,icon:'./magemind-logo-192.png',badge:'./magemind-logo-192.png',
    tag:payload.notificationId?`magemind-${payload.notificationId}`:'magemind-general',
    renotify:false,data:{url:payload.url||'./',demandId:payload.demandId||null,workspaceId:payload.workspaceId||null,orderId:payload.orderId||null,integrationId:payload.integrationId||null},
  };
  event.waitUntil(self.registration.showNotification(title,options));
});

self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const data=event.notification.data||{};
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async clients=>{
    for(const client of clients){
      if('focus' in client){
        await client.focus();
        if(data.workspaceId) client.postMessage({type:'OPEN_TRACKING_ORDER',workspaceId:data.workspaceId,orderId:data.orderId,integrationId:data.integrationId});
        else if(data.demandId) client.postMessage({type:'OPEN_DEMAND',demandId:data.demandId});
        return;
      }
    }
    return self.clients.openWindow(data.url||'./');
  }));
});
