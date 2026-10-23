"use strict";
(function(root){
  // Dados permanecem no navegador; nunca são enviados a outro servidor.
  const DATABASE="feirabus-local-v1", SNAPSHOT="current", VERSION=1;
  const MAX_VEHICLE_AGE=7*24*60*60*1000;
  let writes=Promise.resolve();
  function open(){
    return new Promise((resolve,reject)=>{
      if(!root.indexedDB) return reject(new Error("IndexedDB indisponível neste navegador"));
      const req=root.indexedDB.open(DATABASE,VERSION);
      req.onupgradeneeded=()=>{
        const db=req.result;
        if(!db.objectStoreNames.contains("snapshots"))db.createObjectStore("snapshots");
        if(!db.objectStoreNames.contains("geometries"))db.createObjectStore("geometries");
      };
      req.onsuccess=()=>resolve(req.result);
      req.onerror=()=>reject(req.error||new Error("Não foi possível abrir a memória"));
      req.onblocked=()=>reject(new Error("Outra aba está bloqueando a memória"));
    });
  }
  async function request(store,mode,op){
    const db=await open();
    return new Promise((resolve,reject)=>{
      let output,settled=false;
      const tx=db.transaction(store,mode);
      tx.oncomplete=()=>{db.close();if(!settled){settled=true;resolve(output);}};
      tx.onerror=()=>{db.close();if(!settled){settled=true;reject(tx.error||new Error("Falha de gravação"));}};
      tx.onabort=()=>{db.close();if(!settled){settled=true;reject(tx.error||new Error("Gravação interrompida"));}};
      try {
        const req=op(tx.objectStore(store));
        if(req)req.onsuccess=()=>{output=req.result;};
      }catch(e){try{tx.abort();}catch{}if(!settled){settled=true;db.close();reject(e);}}
    });
  }
  function queue(op){
    const next=writes.catch(()=>{}).then(op);
    writes=next;
    return next;
  }
  function sanitize(snapshot){
    if(!snapshot||snapshot.version!==1||!Array.isArray(snapshot.lines))return null;
    const now=Date.now();
    return {...snapshot,
      buses:Array.isArray(snapshot.buses)?snapshot.buses.filter(v=>v&&typeof v.id==="string"&&Number.isFinite(v.lastSeen)&&v.lastSeen>now-MAX_VEHICLE_AGE&&v.lastSeen<=now+60000):[],
      savedAt:Number(snapshot.savedAt)||0
    };
  }
  async function load(){
    await writes.catch(()=>{});
    const snapshot=await request("snapshots","readonly",s=>s.get(SNAPSHOT));
    return sanitize(snapshot);
  }
  function save(snapshot){
    const data={...snapshot,version:1,savedAt:Date.now()};
    // Uma gravação serializada evita que uma atualização antiga sobreponha outra.
    return queue(()=>request("snapshots","readwrite",s=>s.put(data,SNAPSHOT)));
  }
  async function loadGeometry(route){
    await writes.catch(()=>{});
    return request("geometries","readonly",s=>s.get(String(route)));
  }
  function saveGeometry(route,data){
    return queue(()=>request("geometries","readwrite",s=>s.put(data,String(route))));
  }
  function clear(){
    return queue(async()=>{
      await request("snapshots","readwrite",s=>s.clear());
      await request("geometries","readwrite",s=>s.clear());
    });
  }
  root.FeiraBusMemory=Object.freeze({load,save,loadGeometry,saveGeometry,clear,sanitize});
})(globalThis);
