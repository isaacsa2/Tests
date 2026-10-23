import assert from "node:assert/strict";
const stores=new Map();
let initialized=false;
const has={contains(name){return stores.has(name);}};
const database={
 objectStoreNames:has,
 createObjectStore(name){stores.set(name,new Map());},
 close(){},
 transaction(name){
  const tx={oncomplete:null,onerror:null,onabort:null,error:null};
  tx.objectStore=()=>({
   get(key){const req={result:undefined};queueMicrotask(()=>{req.result=stores.get(name).get(key);req.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());});return req;},
   put(value,key){const req={result:key};queueMicrotask(()=>{stores.get(name).set(key,value);req.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());});return req;},
   clear(){const req={result:undefined};queueMicrotask(()=>{stores.get(name).clear();req.onsuccess?.();queueMicrotask(()=>tx.oncomplete?.());});return req;}
  });
  return tx;
 }
};
globalThis.indexedDB={open(){
 const r={result:database};
 queueMicrotask(()=>{if(!initialized){r.onupgradeneeded?.();initialized=true;}r.onsuccess?.();});
 return r;
}};
await import("./public/assets/memory.js");
const m=globalThis.FeiraBusMemory;
assert.equal(await m.load(),null);
const now=Date.now();
const snapshot={version:1,phase:"quick",lines:[{id:"001",nome:"Centro"}],routes:["42"],scanned:["10"],nextLineIndex:9,done:9,secondary:["20","30"],secondaryIndex:0,wide:true,buses:[
 {id:"400",lat:-12.26,lon:-38.96,lastSeen:now-1000},
 {id:"OLD",lat:-12.26,lon:-38.96,lastSeen:now-9*86400000}
]};
await m.save(snapshot);
const value=await m.load();
assert.equal(value.phase,"quick");assert.equal(value.done,9);
assert.equal(value.secondary.length,2);assert.equal(value.buses.length,1);
assert.equal(value.buses[0].id,"400");
await m.saveGeometry("42",{geometry:{type:"LineString",coordinates:[[1,2],[2,3]]}});
assert.equal((await m.loadGeometry("42")).geometry.coordinates.length,2);
await m.clear();
assert.equal(await m.load(),null);assert.equal(await m.loadGeometry("42"),undefined);
await m.save(snapshot); // memória pode ser reusada depois da limpeza
assert.equal((await m.load()).lines.length,1);
console.log("OK: memória IndexedDB, checkpoint, expiração, geometrias e limpeza.");
