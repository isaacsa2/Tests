"use strict";
(function(){
const el=id=>document.getElementById(id), delay=ms=>new Promise(r=>setTimeout(r,ms));
const demo=[{id:"EX-101",linha:"Demonstração",lat:-12.260,lon:-38.966},{id:"EX-202",linha:"Demonstração",lat:-12.272,lon:-38.957},{id:"EX-303",linha:"Demonstração",lat:-12.251,lon:-38.978}];
const s={mode:"demo",running:false,stop:false,lines:[],buses:new Map(),routes:new Set(),scanned:new Set(),done:0,errors:0,poll:false,geometry:new Map(),phase:"new",nextLineIndex:0,secondary:[],secondaryIndex:0,wide:true};
const memory=globalThis.FeiraBusMemory;
const checkedThisVisit=new Set();
let memoryReady=false,memoryAvailable=false,saveTimer=null,previousRequest=0;
const map=L.map("map",{zoomControl:true}).setView([-12.265,-38.965],12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap contribuidores"}).addTo(map);
const pins=L.layerGroup().addTo(map), linesLayer=L.layerGroup().addTo(map);
const isResumable=()=>["quick","wide"].includes(s.phase)&&s.lines.length>0;
function snapshot(){
 return {
  version:1,phase:s.phase,lines:s.lines,buses:[...s.buses.values()].map(({checkedSession,...v})=>v),
  routes:[...s.routes],scanned:[...s.scanned],done:s.done,errors:s.errors,
  nextLineIndex:s.nextLineIndex,secondary:s.secondary,secondaryIndex:s.secondaryIndex,wide:s.wide,
  pollRequested:el("poll").checked
 };
}
function memoryLabel(label){el("memoryState").textContent=label;}
function buttonState(){
 el("start").textContent=isResumable()?"Retomar varredura":s.phase==="done"?"Nova varredura":"Varrer linhas da cidade";
 el("start").disabled=!memoryReady||s.running;
 el("stop").disabled=!s.running;
 el("clearMemory").disabled=!memoryReady||s.running;
}
async function checkpoint(){
 if(!memoryAvailable||!memory)return;
 if(saveTimer){clearTimeout(saveTimer);saveTimer=null;}
 try{
  await memory.save(snapshot());
  memoryLabel("Salva às "+new Date().toLocaleTimeString("pt-BR"));
 }catch(e){memoryLabel("Falha ao salvar: "+e.message);memoryAvailable=false;}
}
function scheduleSave(){
 if(!memoryAvailable||!memory)return;
 if(saveTimer)clearTimeout(saveTimer);
 saveTimer=setTimeout(()=>{saveTimer=null;checkpoint();},850);
}
async function restore(){
 try{
  if(!memory)throw new Error("Módulo de memória não carregou");
  const data=await memory.load();memoryAvailable=true;
  if(data){
   s.lines=data.lines.filter(x=>x&&x.id!=null);
   s.buses=new Map((data.buses||[]).filter(v=>v&&v.id).map(v=>[v.id,v]));
   s.routes=new Set((data.routes||[]).filter(x=>typeof x==="string"));
   s.scanned=new Set((data.scanned||[]).filter(x=>typeof x==="string"));
   s.done=Math.min(s.lines.length,Math.max(0,Number(data.done)||0));
   s.nextLineIndex=Math.min(s.lines.length,Math.max(0,Number(data.nextLineIndex)||0));
   s.secondary=(data.secondary||[]).filter(x=>typeof x==="string");
   s.secondaryIndex=Math.min(s.secondary.length,Math.max(0,Number(data.secondaryIndex)||0));
   s.wide=data.wide!==false;s.phase=["quick","wide","done"].includes(data.phase)?data.phase:"new";
   el("wide").checked=s.wide;el("poll").checked=data.pollRequested===true;
   if(s.lines.length||s.buses.size||s.routes.size){
    s.mode="memory";
    tag("MEMÓRIA LOCAL · NÃO É GPS AO VIVO");
    say((s.buses.size)+" veículos e "+s.routes.size+" itinerários recuperados do navegador. "+
      (isResumable()?"Clique em Retomar varredura para continuar de "+s.done+"/"+s.lines.length+".":"Clique em Nova varredura para atualizar o SIU.")+
      " As posições salvas são históricas.");
   }
   memoryLabel("Restaurada · "+new Date(data.savedAt).toLocaleString("pt-BR"));
  }else memoryLabel("Ativa · sem dados salvos");
 }catch(e){
  memoryAvailable=false;memoryLabel("Indisponível");
  say("O navegador não permite salvar memória local ("+e.message+"). O monitoramento continuará, mas recarregar a página perderá o progresso.",true);
 }finally{
  memoryReady=true;buttonState();paint();
 }
}
function say(t,error=false){el("notice").textContent=t;el("notice").classList.toggle("error",error);}
function tag(t){el("stateTag").textContent=t;el("mapInfo").textContent=t;}
function uniqueVehicle(v){
 if(!v||!v.id||!Number.isFinite(Number(v.lat))||!Number.isFinite(Number(v.lon)))return;
 const key=String(v.id).trim();if(!key)return;
 const old=s.buses.get(key);
 s.buses.set(key,Object.assign({},old||{},v,{id:key,lastSeen:Date.now()}));
 checkedThisVisit.add(key);scheduleSave();
}
function paint(){
 pins.clearLayers();
 const query=el("busSearch").value.trim().toLowerCase();
 const vehicles=[...s.buses.values()].filter(v=>[v.id,v.linha,v.itinerario].some(x=>String(x??"").toLowerCase().includes(query)));
 const all=s.mode==="demo"?demo:vehicles;
 if(s.mode==="demo")el("totalCars").textContent="3";
 else el("totalCars").textContent=s.buses.size;
 const recent=s.mode==="demo"?0:[...s.buses.values()].filter(v=>checkedThisVisit.has(v.id)&&v.lastSeen&&Date.now()-v.lastSeen<300000).length;
 el("freshCars").textContent=s.mode==="demo"?"Exemplos fictícios":recent+" consultados nesta sessão há menos de 5 min · "+s.buses.size+" conhecidos";
 el("totalLines").textContent=s.mode==="demo"?"—":s.lines.length;
 el("totalRoutes").textContent=s.mode==="demo"?"—":s.routes.size;
 el("coverage").textContent=s.mode==="demo"?"—":s.done+"/"+s.lines.length;
 el("stage").textContent=s.mode==="demo"?"Aguardando consulta real":s.errors+" falhas nas consultas";
 const list=el("vehicleList");list.replaceChildren();
 const visible=all.filter(v=>[v.id,v.linha,v.itinerario].some(x=>String(x??"").toLowerCase().includes(query)));
 el("listCount").textContent=visible.length;
 for(const v of all){
  const old=s.mode==="demo"?false:!checkedThisVisit.has(v.id)||!v.lastSeen||Date.now()-v.lastSeen>300000;
  const mark=L.circleMarker([v.lat,v.lon],{radius:8,color:old?"#64748b":"#006fbb",weight:2,fillColor:old?"#94a3b8":"#28a9fa",fillOpacity:.85});
  const popup=document.createElement("div");
  const name=document.createElement("strong");name.textContent="Carro "+v.id;popup.append(name);
  const info=document.createElement("p");info.textContent="Linha: "+(v.linha||"não informada")+(v.itinerario?" · itinerário "+v.itinerario:"");popup.append(info);
  const meta=document.createElement("small");meta.textContent=s.mode==="demo"?"POSIÇÃO FICTÍCIA":
    (old?"MEMÓRIA / CONSULTA ANTIGA: ":"Consulta nesta sessão: ")+
    (v.lastSeen?new Date(v.lastSeen).toLocaleString("pt-BR"):"sem registro");popup.append(meta);
  mark.bindPopup(popup).addTo(pins);
 }
 for(const v of visible.slice(0,300)){
  const b=document.createElement("button");b.className="busItem";
  const left=document.createElement("div"),title=document.createElement("b"),sub=document.createElement("span"),hint=document.createElement("small");
  title.textContent="Carro "+v.id;
  sub.textContent="Linha: "+(v.linha||"não informada");
  const fresh=checkedThisVisit.has(v.id)&&Date.now()-v.lastSeen<300000;
  hint.textContent=s.mode==="demo"?"Exemplo":fresh?"Consultado agora":"Histórico · "+(v.lastSeen?new Date(v.lastSeen).toLocaleString("pt-BR"):"sem data");
  left.append(title,sub);b.append(left,hint);
  b.addEventListener("click",()=>{map.setView([v.lat,v.lon],16);for(const layer of pins.getLayers()){if(layer.getLatLng().distanceTo(L.latLng(v.lat,v.lon))<2){layer.openPopup();break;}}});
  list.append(b);
 }
 if(!visible.length){const p=document.createElement("p");p.className="hint";p.textContent="Nenhum veículo corresponde à pesquisa.";list.append(p);}
}
function fit(){const vals=s.mode==="demo"?demo:[...s.buses.values()];if(!vals.length)return;map.fitBounds(L.latLngBounds(vals.map(v=>[v.lat,v.lon])).pad(.20),{maxZoom:14});}
async function api(path,urgent=false){
 if(!urgent){const wait=Math.max(0,2500-(Date.now()-previousRequest));if(wait)await delay(wait);}
 previousRequest=Date.now();
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);
 try {
  const response=await fetch(path,{signal:controller.signal,cache:"no-store"});
  const data=await response.json();
  if(!response.ok)throw new Error(data.erro||"HTTP "+response.status);
  return data;
 }finally{clearTimeout(timer);}
}
async function getVehicles(route){
 const d=await api("/api/vehicles?itinerary="+encodeURIComponent(route));
 for(const v of d.veiculos||[])uniqueVehicle(v);
 paint();
}
async function scanStop(id){
 if(s.stop||s.scanned.has(id))return;
 const d=await api("/api/predictions?stop="+encodeURIComponent(id));
 let complete=true;
 for(const p of d.previsoes||[]){
  if(s.stop){complete=false;break;}
  if(!p.itinerario||!(/^[\w-]{1,32}$/.test(p.itinerario)))continue;
  if(s.routes.has(p.itinerario))continue;
  try{
   await getVehicles(p.itinerario);
   s.routes.add(p.itinerario);
   scheduleSave();
  }catch(e){s.errors++;complete=false;}
 }
 if(complete)s.scanned.add(id);
 scheduleSave();
}
async function run(){
 if(s.running||!memoryReady)return;
 const resume=isResumable();
 // Só reiniciamos o checkpoint após obter um catálogo válido.
 // Um erro temporário na API não pode apagar rotas já descobertas.
 s.running=true;s.stop=false;s.poll=false;s.mode="live";buttonState();
 tag("CONSULTANDO SIU • POSIÇÕES RECÉM-CONSULTADAS");
 try{
  if(!resume){
   say("Inicializando comunicação como o SIU Mobile...");
   try {
    const initial=await api("/api/initialize",true);
    if(!initial.sucesso)say("Inicialização não confirmada; verificando catálogo diretamente.",true);
   }catch(e){say("Inicialização falhou ("+e.message+"). Tentando catálogo de linhas...",true);}
   if(s.stop)return;
   say("Consultando catálogo de linhas do SIU...");
   const d=await api("/api/lines",true);
   if(!d.linhas?.length){
     const x=d.diagnostico||{};
     say(x.catalogoVazioConfirmado?"O SIU devolveu um catálogo vazio nesta consulta; os veículos históricos foram preservados.":
       "Não houve linhas interpretáveis na resposta do SIU. Consulte /api/diagnostics/lines.",true);
     return;
   }
   s.done=0;s.errors=0;s.lines=d.linhas;s.routes.clear();s.scanned.clear();
   s.geometry.clear();s.phase="quick";s.nextLineIndex=0;s.secondary=[];s.secondaryIndex=0;
   s.wide=el("wide").checked;
   await checkpoint();
  } else {
   say("Retomando do checkpoint: "+s.done+"/"+s.lines.length+" linhas. Rotas e carros anteriores foram preservados.");
  }
  if(s.phase==="quick"){
   const secondIds=new Set(s.secondary);
   for(let idx=s.nextLineIndex;idx<s.lines.length;idx++){
    if(s.stop)break;
    const line=s.lines[idx];
    let variants=[line];
    if(s.wide){
     try{const v=await api("/api/sublines?line="+encodeURIComponent(line.id));variants.push(...(v.sublinhas||[]));}
     catch(e){s.errors++;}
    }
    for(const variant of variants){
     if(s.stop)break;
     try{
      const r=await api("/api/stops?line="+encodeURIComponent(variant.id));
      const groups=new Map();
      for(const p of r.paradas||[]){
       const name=String(p.sentido||"geral");
       if(!groups.has(name))groups.set(name,[]);
       groups.get(name).push(String(p.id));
      }
      for(const ids of groups.values()){
       if(s.stop)break;
       const uniq=[...new Set(ids)];
       for(const [i,id] of uniq.entries()){
        if(s.stop)break;
        if(i<2){try{await scanStop(id);}catch(e){s.errors++;}}
        else if(s.wide&&!secondIds.has(id)){secondIds.add(id);s.secondary.push(id);}
       }
      }
     }catch(e){s.errors++;}
    }
    if(s.stop)break;
    s.nextLineIndex=idx+1;s.done=idx+1;paint();
    say("Primeira passagem: "+s.done+"/"+s.lines.length+" linhas; "+s.buses.size+" carros conhecidos; "+s.routes.size+" itinerários. Memória local ativa.");
    await checkpoint();
   }
   if(!s.stop){s.phase="wide";await checkpoint();}
  }
  if(s.phase==="wide" && !s.stop){
   if(s.wide){
    for(let i=s.secondaryIndex;i<s.secondary.length;i++){
     if(s.stop)break;
     try{await scanStop(s.secondary[i]);}catch(e){s.errors++;}
     if(s.stop)break;
     s.secondaryIndex=i+1;
     if(i%5===0)say("Varredura ampliada: "+(i+1)+"/"+s.secondary.length+" paradas; "+s.buses.size+" carros conhecidos.");
     scheduleSave();
    }
   } else s.secondaryIndex=s.secondary.length;
   if(!s.stop){s.phase="done";await checkpoint();}
  }
  if(s.stop)say("Varredura interrompida. Progresso salvo: "+s.done+"/"+s.lines.length+" linhas. Pode retomar mais tarde.");
  else if(s.phase==="done"){
   say("Varredura concluída. "+s.buses.size+" carros conhecidos e "+s.routes.size+" itinerários. Os dados históricos permanecem salvos neste navegador.");
   if(el("poll").checked){s.poll=true;setTimeout(refresh,90000);}
  }
 }catch(e){
  say("Falha no SIU: "+e.message+". Progresso anterior preservado; tente novamente.",true);
 }finally{
  s.running=false;
  await checkpoint();
  buttonState();paint();
 }
}
async function refresh(){
 if(!s.poll||s.running)return;
 try{
  for(const id of s.routes){if(!s.poll)break;await getVehicles(id);}
  say("Atualização de itinerários concluída. Carros vistos: "+s.buses.size);
 }catch(e){say("Atualização parcial: "+e.message,true);}
 if(s.poll)setTimeout(refresh,90000);
}
async function direct(){
 const n=el("directNumber").value.trim();
 if(!/^[A-Za-z0-9_-]{1,32}$/.test(n)){el("directResult").textContent="Digite um número/identificador válido.";return;}
 el("direct").disabled=true;el("directResult").textContent="Consultando carro "+n+" diretamente...";
 try{
  const d=await api("/api/vehicle?number="+encodeURIComponent(n),true);
  if(!d.veiculos?.length){el("directResult").textContent="Nenhuma posição válida retornada para "+n+".";return;}
  s.mode="live";for(const v of d.veiculos)uniqueVehicle(v);
  paint();map.setView([d.veiculos[0].lat,d.veiculos[0].lon],16);
  el("directResult").textContent="Carro "+n+" localizado na resposta da API (posição não necessariamente instantânea).";
  tag("CONSULTA DIRETA AO SIU");
  await checkpoint();
 }catch(e){el("directResult").textContent="Falha na consulta: "+e.message;}
 finally{el("direct").disabled=false;}
}
async function exportGeo(){
 if(!s.routes.size){say("Descubra itinerários antes de exportar. O modo demonstração não inclui rotas oficiais.",true);return;}
 el("export").disabled=true;
 try{
  const features=[];let i=0;
  for(const id of s.routes){
   if(s.stop)break;
   let d=s.geometry.get(id);
   if(!d&&memoryAvailable){try{d=await memory.loadGeometry(id);if(d)s.geometry.set(id,d);}catch{}}
   if(!d){try{d=await api("/api/geometry?itinerary="+encodeURIComponent(id));s.geometry.set(id,d);
     if(memoryAvailable)await memory.saveGeometry(id,d);
    }catch(e){s.errors++;continue;}}
   if(d.geometry?.coordinates?.length>1)features.push({type:"Feature",properties:{itinerario:id,origem:"SIU",escala:"coordenadas reais; converter 1:2 fora do GeoJSON"},geometry:d.geometry});
   i++;if(i%5===0)say("Exportando trajetos: "+i+"/"+s.routes.size);
  }
  const blob=new Blob([JSON.stringify({type:"FeatureCollection",features},null,2)],{type:"application/geo+json"});
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download="FeiraBus-itinerarios-reais.geojson";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  say("GeoJSON gerado com "+features.length+" itinerários. A geometria segue coordenadas reais.");
 }finally{el("export").disabled=false;}
}
async function clearMemory(){
 if(s.running)return;
 if(!confirm("Excluir do navegador os carros salvos, linhas, progresso da varredura e geometria dos itinerários?"))return;
 try{
  if(saveTimer){clearTimeout(saveTimer);saveTimer=null;}
  if(memoryAvailable)await memory.clear();
  s.mode="demo";s.phase="new";s.lines=[];s.buses.clear();s.routes.clear();s.scanned.clear();
  s.geometry.clear();s.secondary=[];s.nextLineIndex=0;s.secondaryIndex=0;s.done=0;s.errors=0;s.poll=false;
  checkedThisVisit.clear();memoryLabel(memoryAvailable?"Memória limpa":"Indisponível");
  tag("MODO DEMONSTRAÇÃO");say("Memória local apagada. O monitor continua disponível para nova varredura.");
  buttonState();paint();
 }catch(e){memoryLabel("Erro ao limpar: "+e.message);}
}
el("clearMemory").addEventListener("click",clearMemory);
el("busSearch").addEventListener("input",paint);
el("direct").addEventListener("click",direct);
el("directNumber").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();direct();}});
el("start").addEventListener("click",run);
el("stop").addEventListener("click",()=>{s.stop=true;s.poll=false;say("Interrupção solicitada. Finalizando a consulta atual...");});
el("fit").addEventListener("click",fit);
el("export").addEventListener("click",exportGeo);
el("start").disabled=true;
restore();
paint();
})();
