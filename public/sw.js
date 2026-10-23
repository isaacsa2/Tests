"use strict";
const VERSION="feirabus-passenger-v4";
const STATIC=[
  "/passageiro.html","/manifest.webmanifest","/assets/passenger.css",
  "/assets/passenger.js","/assets/fleet.js","/favicon.svg",
  "/assets/pwa-192.png","/assets/pwa-512.png"
];
self.addEventListener("install",event=>{
 event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(STATIC)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("feirabus-passenger-")&&k!==VERSION).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=="GET"||url.origin!==self.location.origin)return;
 if(url.pathname.startsWith("/api/"))return; // Nunca devolver previsões/GPS antigos como ao vivo.
 if(!STATIC.includes(url.pathname))return;
 event.respondWith(fetch(event.request).then(response=>{
  if(response.ok){const copy=response.clone();event.waitUntil(caches.open(VERSION).then(cache=>cache.put(event.request,copy)));}
  return response;
 }).catch(()=>caches.match(event.request)));
});
