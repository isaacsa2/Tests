"use strict";
(function(){
const el=id=>document.getElementById(id), delay=ms=>new Promise(r=>setTimeout(r,ms));
const demo=[{id:"EX-101",linha:"Demonstração",lat:-12.260,lon:-38.966},{id:"EX-202",linha:"Demonstração",lat:-12.272,lon:-38.957},{id:"EX-303",linha:"Demonstração",lat:-12.251,lon:-38.978}];
const s={mode:"demo",running:false,stop:false,lines:[],buses:new Map(),routes:new Set(),scanned:new Set(),done:0,errors:0,poll:false,geometry:new Map()};
let previousRequest=0;
const map=L.map("map",{zoomControl:true}).setView([-12.265,-38.965],12);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:"© OpenStreetMap contribuidores"}).addTo(map);
const pins=L.layerGroup().addTo(map), linesLayer=L.layerGroup().addTo(map);
function say(t,error=false){el("notice").textContent=t;el("notice").classList.toggle("error",error);}
function tag(t){el("stateTag").textContent=t;el("mapInfo").textContent=t;}
function uniqueVehicle(v){
 if(!v||!v.id||!Number.isFinite(Number(v.lat))||!Number.isFinite(Number(v.lon)))return;
 const key=String(v.id).trim();if(!key)return;
 const old=s.buses.get(key);
 s.buses.set(key,Object.assign({},old||{},v,{id:key,lastSeen:Date.now()}));
}
function paint(){
 pins.clearLayers();
 const query=el("busSearch").value.trim().toLowerCase();
 const vehicles=[...s.buses.values()].filter(v=>[v.id,v.linha,v.itinerario].some(x=>String(x??"").toLowerCase().includes(query)));
 const all=s.mode==="demo"?demo:vehicles;
 if(s.mode==="demo")el("totalCars").textContent="3";
 else el("totalCars").textContent=s.buses.size;
 el("totalLines").textContent=s.mode==="demo"?"—":s.lines.length;
 el("totalRoutes").textContent=s.mode==="demo"?"—":s.routes.size;
 el("coverage").textContent=s.mode==="demo"?"—":s.done+"/"+s.lines.length;
 el("stage").textContent=s.mode==="demo"?"Aguardando consulta real":s.errors+" falhas nas consultas";
 const list=el("vehicleList");list.replaceChildren();
 const visible=all.filter(v=>[v.id,v.linha,v.itinerario].some(x=>String(x??"").toLowerCase().includes(query)));
 el("listCount").textContent=visible.length;
 for(const v of all){
  const old=v.lastSeen&&Date.now()-v.lastSeen>300000;
  const mark=L.circleMarker([v.lat,v.lon],{radius:8,color:old?"#64748b":"#006fbb",weight:2,fillColor:old?"#94a3b8":"#28a9fa",fillOpacity:.85});
  const popup=document.createElement("div");
  const name=document.createElement("strong");name.textContent="Carro "+v.id;popup.append(name);
  const info=document.createElement("p");info.textContent="Linha: "+(v.linha||"não informada")+(v.itinerario?" · itinerário "+v.itinerario:"");popup.append(info);
  const meta=document.createElement("small");meta.textContent=s.mode==="demo"?"POSIÇÃO FICTÍCIA":"Consulta: "+new Date(v.lastSeen||Date.now()).toLocaleTimeString("pt-BR");popup.append(meta);
  mark.bindPopup(popup).addTo(pins);
 }
 for(const v of visible.slice(0,300)){
  const b=document.createElement("button");b.className="busItem";
  const left=document.createElement("div"),title=document.createElement("b"),sub=document.createElement("span"),hint=document.createElement("small");
  title.textContent="Carro "+v.id;
  sub.textContent="Linha: "+(v.linha||"não informada");hint.textContent=s.mode==="demo"?"Exemplo":"Ver no mapa";
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
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),17000);
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
 s.scanned.add(id);
 const d=await api("/api/predictions?stop="+encodeURIComponent(id));
 for(const p of d.previsoes||[]){
  if(!p.itinerario||!(/^[\w-]{1,32}$/.test(p.itinerario)))continue;
  if(s.routes.has(p.itinerario))continue;
  s.routes.add(p.itinerario);
  try{await getVehicles(p.itinerario);}catch(e){s.errors++;}
 }
}
async function run(){
 if(s.running)return;
 s.running=true;s.stop=false;s.poll=false;s.mode="live";s.done=0;s.errors=0;s.lines=[];s.buses.clear();s.routes.clear();s.scanned.clear();s.geometry.clear();
 el("start").disabled=true;el("stop").disabled=false;tag("CONSULTANDO SIU • GPS REAL (SE DISPONÍVEL)");
 const wide=el("wide").checked,secondary=[],secondIds=new Set();
 try{
  say("Consultando catálogo de linhas do SIU...");
  const d=await api("/api/lines",true);s.lines=d.linhas||[];paint();
  if(!s.lines.length){say("O SIU respondeu sem linhas. Não há veículos para descobrir.",true);return;}
  for(const line of s.lines){
   if(s.stop)break;
   let variants=[line];
   if(wide){try{const v=await api("/api/sublines?line="+encodeURIComponent(line.id));variants.push(...(v.sublinhas||[]));}catch(e){s.errors++;}}
   for(const variant of variants){
    if(s.stop)break;
    try{
     const r=await api("/api/stops?line="+encodeURIComponent(variant.id));
     const groups=new Map();
     for(const p of r.paradas||[]){const name=String(p.sentido||"geral");if(!groups.has(name))groups.set(name,[]);groups.get(name).push(String(p.id));}
     for(const ids of groups.values()){
      const uniq=[...new Set(ids)];
      for(const [i,id] of uniq.entries()){
       if(i<2){try{await scanStop(id);}catch(e){s.errors++;}}
       else if(wide&&!secondIds.has(id)){secondIds.add(id);secondary.push(id);}
      }
     }
    }catch(e){s.errors++;}
   }
   s.done++;paint();
   say("Primeira passagem: "+s.done+"/"+s.lines.length+" linhas; "+s.buses.size+" carros; "+s.routes.size+" itinerários.");
  }
  if(wide&&!s.stop)for(const [i,id] of secondary.entries()){
   if(s.stop)break;
   try{await scanStop(id);}catch(e){s.errors++;}
   if(i%5===0)say("Varredura ampliada: "+(i+1)+"/"+secondary.length+" paradas adicionais; "+s.buses.size+" carros.");
  }
  if(!s.stop){say("Varredura concluída: "+s.buses.size+" carros observados e "+s.routes.size+" itinerários. Não é garantia de frota completa.");if(el("poll").checked){s.poll=true;setTimeout(refresh,90000);}}
 }catch(e){say("Falha na conexão com o SIU: "+e.message+". Confira /api/lines e a origem HTTP:6060.",true);}
 finally{s.running=false;el("start").disabled=false;el("stop").disabled=true;paint();}
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
   if(!d){try{d=await api("/api/geometry?itinerary="+encodeURIComponent(id));s.geometry.set(id,d);}catch(e){s.errors++;continue;}}
   if(d.geometry?.coordinates?.length>1)features.push({type:"Feature",properties:{itinerario:id,origem:"SIU",escala:"coordenadas reais; converter 1:2 fora do GeoJSON"},geometry:d.geometry});
   i++;if(i%5===0)say("Exportando trajetos: "+i+"/"+s.routes.size);
  }
  const blob=new Blob([JSON.stringify({type:"FeatureCollection",features},null,2)],{type:"application/geo+json"});
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download="FeiraBus-itinerarios-reais.geojson";document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  say("GeoJSON gerado com "+features.length+" itinerários. A geometria segue coordenadas reais.");
 }finally{el("export").disabled=false;}
}
el("busSearch").addEventListener("input",paint);
el("direct").addEventListener("click",direct);
el("directNumber").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();direct();}});
el("start").addEventListener("click",run);
el("stop").addEventListener("click",()=>{s.stop=true;s.poll=false;say("Interrupção solicitada. Finalizando a consulta atual...");});
el("fit").addEventListener("click",fit);
el("export").addEventListener("click",exportGeo);
paint();
})();
