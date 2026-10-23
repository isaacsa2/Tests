"use strict";
(function(){
const el=id=>document.getElementById(id), delay=ms=>new Promise(r=>setTimeout(r,ms));
const demo=[{id:"EX-101",linha:"Demonstração",lat:-12.260,lon:-38.966},{id:"EX-202",linha:"Demonstração",lat:-12.272,lon:-38.957},{id:"EX-303",linha:"Demonstração",lat:-12.251,lon:-38.978}];
const s={mode:"demo",running:false,stop:false,lines:[],buses:new Map(),routes:new Set(),scanned:new Set(),done:0,errors:0,poll:false,geometry:new Map(),phase:"new",nextLineIndex:0,secondary:[],secondaryIndex:0,wide:true,routeLines:new Map()};
const memory=globalThis.FeiraBusMemory;
const GPS=globalThis.FeiraBusGps;
const checkedThisVisit=new Set();
let gpsTimer=null,gpsBusy=false,gpsCursor=0,gpsFailCycles=0;
let memoryReady=false,memoryAvailable=false,saveTimer=null,previousRequest=0;
let cloudSyncBusy=false;
// Filtro "GPS por linha": linhas pedidas pelo operador e itinerários conhecidos delas.
const watch={lines:[],routes:new Set(),busy:false,discoveredAt:new Map()};
const ROUTE_ID=/^[A-Za-z0-9_-]{1,32}$/;
const map=L.map("map",{zoomControl:true}).setView([-12.265,-38.965],12);
const pins=L.layerGroup().addTo(map), linesLayer=L.layerGroup().addTo(map);
let selectedVehicleId=null;
const sessionEvents=[];
let previousLineOptions="";
// Apenas tiles do OSM: o modo escuro é um filtro CSS local, sem token ou serviço pago.
// Uma única camada evita requisições duplicadas quando o operador troca o tema.
const osmTiles=L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{
 maxZoom:19,
 attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>'
});
osmTiles.addTo(map);
function applyMapTheme(mode){
 const dark=mode==="dark";
 map.getContainer().classList.toggle("cco-map-dark",dark);
 el("mapTheme").value=dark?"dark":"streets";
 try{localStorage.setItem("feirabus-map-theme",dark?"dark":"streets");}catch{}
}
// Tema da página (compartilhado com o app do passageiro): segue o sistema até a escolha.
function pageTheme(){
 const t=document.documentElement.dataset.theme;
 if(t==="light"||t==="dark")return t;
 return window.matchMedia?.("(prefers-color-scheme: light)").matches?"light":"dark";
}
function paintThemeButton(){
 const t=pageTheme();
 el("themeToggle").textContent=t==="dark"?"☀":"☾";
 el("themeToggle").setAttribute("aria-label",t==="dark"?"Usar tema claro":"Usar tema escuro");
 document.querySelector('meta[name="theme-color"]')?.setAttribute("content",t==="dark"?"#12151c":"#f5f2ea");
}
el("themeToggle").addEventListener("click",()=>{
 const next=pageTheme()==="dark"?"light":"dark";
 document.documentElement.dataset.theme=next;
 try{localStorage.setItem("feirabus-theme",next);}catch{}
 applyMapTheme(next==="dark"?"dark":"streets");
 paintThemeButton();
});
paintThemeButton();
let initialMapTheme=pageTheme()==="dark"?"dark":"streets";
try{const saved=localStorage.getItem("feirabus-map-theme");if(saved==="dark"||saved==="streets")initialMapTheme=saved;}catch{}
applyMapTheme(initialMapTheme);
function operationalClock(){
 const now=new Date();
 const options={timeZone:"America/Bahia",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false};
 el("clockNow").textContent=new Intl.DateTimeFormat("pt-BR",options).format(now);
 el("clockDate").textContent=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Bahia",day:"2-digit",month:"2-digit",year:"numeric"}).format(now);
}
operationalClock();setInterval(operationalClock,1000);
function stamp(value){
 return Number.isFinite(Number(value))&&value?new Date(value).toLocaleString("pt-BR"):"Sem registro";
}
function isRecent(v){
 return s.mode!=="demo"&&checkedThisVisit.has(String(v.id))&&Number.isFinite(v.lastSeen)&&Date.now()-v.lastSeen<=300000;
}
function learnRoute(route,line){
 const id=String(route??""),name=GPS.normalizeLine(line);
 if(!ROUTE_ID.test(id)||!name)return;
 if(s.routeLines.get(id)===name)return;
 s.routeLines.set(id,name);
 if(watch.lines.includes(name))watch.routes.add(id);
}
function isWatched(v){
 return watch.lines.includes(GPS.normalizeLine(v.linha))||watch.routes.has(String(v.itinerario??""));
}
function refreshWatchRoutes(){
 watch.routes=new Set([...s.routeLines].filter(([,line])=>watch.lines.includes(line)).map(([route])=>route));
}
function eventLog(message,level="info"){
 const now=Date.now();
 if(sessionEvents[0]?.message===message&&now-sessionEvents[0].at<20000)return;
 sessionEvents.unshift({message,level,at:now});
 if(sessionEvents.length>18)sessionEvents.pop();
 renderEvents();
}
function renderEvents(){
 const list=el("eventList");list.replaceChildren();
 if(!sessionEvents.length){
  const p=document.createElement("p");p.className="muted";p.textContent="Nenhum evento registrado nesta sessão.";list.append(p);return;
 }
 for(const item of sessionEvents.slice(0,6)){
  const row=document.createElement("div");row.className="event-row "+(item.level==="error"?"error":item.level==="warn"?"warn":"");
  const dot=document.createElement("span");dot.className="event-indicator";dot.setAttribute("aria-hidden","true");
  const column=document.createElement("div"),message=document.createElement("strong"),time=document.createElement("small");
  message.textContent=item.message;time.textContent=new Date(item.at).toLocaleTimeString("pt-BR")+" · Registro local";
  column.append(message,time);row.append(dot,column);list.append(row);
 }
}
function updateSource(){
 const recentCount=[...s.buses.values()].filter(isRecent).length;
 const demoMode=s.mode==="demo";
 const label=demoMode?"DEMONSTRAÇÃO":recentCount?"CONSULTAS RECENTES":s.running?"CONSULTANDO SIU":"DADOS HISTÓRICOS";
 el("stateTag").replaceChildren();
 const dot=document.createElement("span");dot.className="status-dot";dot.setAttribute("aria-hidden","true");
 el("stateTag").append(dot,document.createTextNode(label));
 el("stateTag").classList.toggle("is-live",!!recentCount);
 el("sourceState").textContent=demoMode?"Fonte SIU • modo demonstração":s.running?"Fonte SIU • varredura em andamento":recentCount?"Fonte SIU • consultas recentes disponíveis":"Fonte SIU • aguardando novas posições";
 el("sourceState").parentElement.classList.toggle("is-live",!!recentCount);
 el("mapMode").textContent=demoMode?"SIMULAÇÃO":recentCount?"CONSULTAS RECENTES":"HISTÓRICO";
}
function syncLineOptions(){
 const selector=el("fleetLine");
 const lines=[...new Set([...s.buses.values()].map(v=>String(v.linha||"").trim()).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"pt-BR",{numeric:true}));
 const signature=lines.join("\u0000");
 if(signature===previousLineOptions)return;
 previousLineOptions=signature;
 const current=selector.value;selector.replaceChildren();
 const all=document.createElement("option");all.value="";all.textContent="Todas as linhas";selector.append(all);
 for(const name of lines){
  const option=document.createElement("option");option.value=name;option.textContent=name.slice(0,80);selector.append(option);
 }
 selector.value=lines.includes(current)?current:"";
}
function vehicleView(v,demonstration=false){
 selectedVehicleId=String(v.id);
 const fresh=!demonstration&&isRecent(v);
 const old=!demonstration&&!fresh;
 const detail=el("vehicleDetail");
 detail.innerHTML='<div class="detail-top"><div><div class="panel-eyebrow">IDENTIFICAÇÃO</div><div class="detail-id" id="detail-id"></div></div><span class="detail-flag" id="detail-flag"></span></div><div class="detail-grid"><div><span>LINHA INFORMADA</span><strong id="detail-line"></strong></div><div><span>ITINERÁRIO</span><strong id="detail-route"></strong></div><div><span>LATITUDE</span><strong id="detail-lat"></strong></div><div><span>LONGITUDE</span><strong id="detail-lon"></strong></div><div><span>DIREÇÃO INFORMADA</span><strong id="detail-direction"></strong></div><div><span>ÚLTIMA CONSULTA</span><strong id="detail-time"></strong></div></div><p class="detail-footnote">Posição retornada pelo serviço ou restaurada do armazenamento local. O instante da medição GPS pode ser diferente do horário da consulta.</p>';
 const fields={"detail-id":"CARRO "+v.id,"detail-line":v.linha||"Não informada","detail-route":v.itinerario||"Não informado","detail-lat":Number(v.lat).toFixed(5),"detail-lon":Number(v.lon).toFixed(5),"detail-direction":Number.isFinite(v.rumo)?v.rumo+"°":"Não informado","detail-time":demonstration?"Dados simulados":stamp(v.lastSeen)};
 for(const [id,text] of Object.entries(fields))el(id).textContent=text;
 const recentLines=busHistory.byBus.get(String(v.id));
 if(recentLines?.length){
  const section=document.createElement("div");section.className="cco-fleet-links";
  const title=document.createElement("span");title.textContent="LINHAS RECENTES · D1 (7 DIAS)";
  const list=document.createElement("small");
  list.textContent=recentLines.slice(0,8).map(l=>l.linha+" ("+shortTime(l.ultimaVez)+")").join(" · ");
  section.append(title,list);detail.append(section);
 }
 const fleet=globalThis.FeiraBusFleet?.lookup(v.id);
 if(fleet?.links?.length){
  const section=document.createElement("div");section.className="cco-fleet-links";
  const title=document.createElement("span");title.textContent="ÔNIBUS BRASIL · REFERÊNCIAS FOTOGRÁFICAS";
  section.append(title);
  const status=document.createElement("small");
  status.textContent=fleet.empresa?fleet.empresa+" (vínculo histórico; não comprova operador atual)":"Empresa não identificada para esse prefixo";
  section.append(status);
  for(const link of fleet.links){
   const a=document.createElement("a");a.href=link.url;a.target="_blank";a.rel="noopener noreferrer";a.textContent=link.label+" ↗";
   section.append(a);
  }
  detail.append(section);
 }
 const flag=el("detail-flag");flag.className="detail-flag"+(fresh?" recent":demonstration?" demo":"");
 flag.textContent=demonstration?"DEMONSTRAÇÃO":old?"HISTÓRICO / ANTIGO":"CONSULTADO RECENTEMENTE";
 el("detailRefresh").disabled=demonstration;
 el("copyCoords").disabled=demonstration;
}
function selectVehicle(v,demonstration=false,zoom=true){
 if(!v)return;
 vehicleView(v,demonstration);
 if(zoom)map.setView([v.lat,v.lon],Math.max(14,map.getZoom()));
 paint();
}
function clearDetail(){
 selectedVehicleId=null;
 el("vehicleDetail").innerHTML='<div class="empty-detail"><span>◎</span><strong>Nenhum veículo selecionado</strong><p>Escolha um carro na lista ou clique em um marcador no mapa para inspecionar sua última posição conhecida.</p></div>';
 el("detailRefresh").disabled=true;el("copyCoords").disabled=true;
}
function opPhase(){
 if(s.running)return s.phase==="wide"?"Varredura ampliada":"Primeira passagem";
 return s.phase==="done"?"Concluída":s.phase==="quick"||s.phase==="wide"?"Pausada":"Aguardando";
}

const isResumable=()=>["quick","wide"].includes(s.phase)&&s.lines.length>0;
function snapshot(){
 return {
  version:1,phase:s.phase,lines:s.lines,buses:[...s.buses.values()].map(({checkedSession,...v})=>v),
  routes:[...s.routes],scanned:[...s.scanned],done:s.done,errors:s.errors,
  nextLineIndex:s.nextLineIndex,secondary:s.secondary,secondaryIndex:s.secondaryIndex,wide:s.wide,
  pollRequested:el("poll").checked,gpsInterval:GPS.getConfig(el("gpsInterval").value).seconds,
  routeLines:[...s.routeLines].slice(-5000)
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
   for(const pair of Array.isArray(data.routeLines)?data.routeLines:[])if(Array.isArray(pair))learnRoute(pair[0],pair[1]);
   for(const v of s.buses.values())learnRoute(v.itinerario,v.linha);
   s.wide=data.wide!==false;s.phase=["quick","wide","done"].includes(data.phase)?data.phase:"new";
   el("wide").checked=s.wide;el("poll").checked=data.pollRequested===true;
   el("gpsInterval").value=String(GPS.getConfig(data.gpsInterval).seconds);
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
  void hydrateSharedMemory();
  if(el("poll").checked)startGpsPolling();
 }
}
async function hydrateSharedMemory(){
 if(cloudSyncBusy)return;
 cloudSyncBusy=true;el("sharedRefresh").disabled=true;
 el("d1State").textContent="Conectando...";
 try{
  const res=await api("/api/memory/snapshot",true);
  if(!Array.isArray(res.veiculos)||!Array.isArray(res.linhas)||!Array.isArray(res.itinerarios))
    throw new Error("Resposta incompleta da D1");
  if(!s.lines.length&&res.linhas.length)s.lines=res.linhas;
  for(const route of res.itinerarios){
   if(typeof route==="string"&&/^[A-Za-z0-9_-]{1,32}$/.test(route))s.routes.add(route);
  }
  let imported=0;
  for(const v of res.veiculos){
   if(!v?.id||!Number.isFinite(v.lat)||!Number.isFinite(v.lon))continue;
   learnRoute(v.itinerario,v.linha);
   const old=s.buses.get(String(v.id));
   if(old&&Number(old.lastSeen)>=Number(v.lastSeen))continue;
   s.buses.set(String(v.id),{...v,origem:"d1",lastSeen:Number(v.lastSeen)||0});
   imported++;
  }
  el("d1State").textContent=res.veiculos.length+" carros · "+res.itinerarios.length+" itinerários";
  if((res.veiculos.length||res.linhas.length)&&s.mode==="demo"){
   s.mode="memory";tag("HISTÓRICO COMPARTILHADO · POSIÇÕES NÃO AO VIVO");
  }
  if(!s.running)eventLog("Memória compartilhada D1 sincronizada: "+imported+" veículos novos, "+res.itinerarios.length+" itinerários conhecidos.");
  if(imported&&memoryAvailable)scheduleSave();
  paint();
  if(el("poll").checked&&!s.poll)startGpsPolling();
 }catch(e){
  el("d1State").textContent="Indisponível";
  if(!s.running)eventLog("D1 não disponível: "+e.message+". Memória local e SIU continuam disponíveis.","warn");
 }finally{cloudSyncBusy=false;el("sharedRefresh").disabled=false;}
}
function say(t,error=false){
 el("notice").textContent=t;
 el("notice").classList.toggle("error",error);
 const isProgress=/^(Primeira passagem:|Varredura ampliada:|Exportando trajetos:)/.test(t);
 if(error)eventLog(t,"error");
 else if(!isProgress)eventLog(t,/interrompida|não confirmada|históric/i.test(t)?"warn":"info");
}
function tag(t){el("mapInfo").textContent=t;updateSource();}
function uniqueVehicle(v){
 if(!v||!v.id||!Number.isFinite(Number(v.lat))||!Number.isFinite(Number(v.lon)))return;
 learnRoute(v.itinerario,v.linha);
 const key=String(v.id).trim();if(!key)return;
 const old=s.buses.get(key);
 const fetched=Date.parse(String(v.consultadoEm||""));
 const current=Date.now();
 const lastSeen=Number.isFinite(fetched)&&fetched>0&&fetched<=current+60000?Math.min(current,fetched):current;
 if(Number(old?.lastSeen)>lastSeen)return;
 s.buses.set(key,Object.assign({},old||{},v,{id:key,lastSeen}));
 checkedThisVisit.add(key);scheduleSave();
}
function paint(){
 syncLineOptions();
 const demoMode=s.mode==="demo", known=[...s.buses.values()];
 const recent=known.filter(isRecent).length, stale=known.length-recent;
 el("totalCars").textContent=demoMode?"3":known.length;
 el("recentCount").textContent=demoMode?"—":recent;
 el("oldCount").textContent=demoMode?"—":stale;
 el("freshCars").textContent=demoMode?"Exemplos fictícios":recent+" consultados há até 5 min nesta sessão";
 el("totalLines").textContent=demoMode?"—":s.lines.length;
 el("totalRoutes").textContent=demoMode?"—":s.routes.size;
 el("coverage").textContent=demoMode?"—":s.done+"/"+s.lines.length;
 el("stage").textContent=demoMode?"Aguardando consulta":s.phase==="wide"?"Paradas adicionais":s.errors+" falhas na coleta";
 el("progressFill").style.width=!s.lines.length?"0%":Math.min(100,s.done/s.lines.length*100)+"%";
 el("errorCount").textContent=s.errors;
 el("phaseLabel").textContent=opPhase();
 el("checkpointTime").textContent=el("memoryState").textContent.replace(/^(Salva às |Restaurada · )/,"").slice(0,35);
 updateSource();
 const query=el("busSearch").value.trim().toLocaleLowerCase("pt-BR");
 const mode=el("fleetStatus").value, line=el("fleetLine").value;
 const original=demoMode?demo:known;
 const visible=original.filter(v=>{
  if(![v.id,v.linha,v.itinerario].some(x=>String(x??"").toLocaleLowerCase("pt-BR").includes(query)))return false;
  if(line&&String(v.linha)!==line)return false;
  if(!demoMode&&watch.lines.length&&!isWatched(v))return false;
  if(!demoMode&&mode==="recent"&&!isRecent(v))return false;
  if(!demoMode&&mode==="old"&&isRecent(v))return false;
  if(demoMode&&mode!=="all")return false;
  return true;
 });
 el("listCount").textContent=visible.length;
 if(watch.lines.length)renderWatchChips();else el("lineWatchChips").hidden=true;
 pins.clearLayers();
 for(const v of visible){
  const fresh=isRecent(v);
  const color=demoMode?"#e9b463":fresh?"#47c8ff":"#91a2b7";
  const marker=L.circleMarker([v.lat,v.lon],{
    radius:String(v.id)===selectedVehicleId?10:7,
    color:String(v.id)===selectedVehicleId?"#fff":color,
    weight:String(v.id)===selectedVehicleId?3:2,
    fillColor:color,fillOpacity:.85
  });
  const popup=document.createElement("div"),name=document.createElement("strong"),info=document.createElement("p"),meta=document.createElement("small");
  name.textContent="Carro "+v.id;
  info.textContent="Linha: "+(v.linha||"não informada")+(v.itinerario?" · itinerário "+v.itinerario:"");
  meta.textContent=demoMode?"DADOS FICTÍCIOS":fresh?"CONSULTADO NESTA SESSÃO: "+stamp(v.lastSeen):"HISTÓRICO / CONSULTA ANTIGA: "+stamp(v.lastSeen);
  popup.append(name,info,meta);
  marker.bindPopup(popup).addTo(pins);
  marker.on("click",()=>selectVehicle(v,demoMode,false));
 }
 const list=el("vehicleList");list.replaceChildren();
 for(const v of visible.slice(0,300)){
  const b=document.createElement("button");b.type="button";b.className="busItem"+(String(v.id)===selectedVehicleId?" selected":"");
  const left=document.createElement("div"),title=document.createElement("b"),sub=document.createElement("span"),status=document.createElement("small");
  title.textContent="CARRO "+v.id;
  sub.textContent="Linha "+(v.linha||"não informada")+(v.itinerario?" · Itin. "+v.itinerario:"");
  const recentConsult=isRecent(v);
  status.className="bus-status "+(demoMode?"demo":recentConsult?"recent":"");
  status.textContent=demoMode?"Simulado":recentConsult?"Recente":"Histórico";
  left.append(title,sub);b.append(left,status);
  b.addEventListener("click",()=>{
   selectVehicle(v,demoMode);
   if(isMobile())el("detalhe").scrollIntoView({behavior:"smooth",block:"start"});
  });
  list.append(b);
 }
 if(!visible.length){
  const p=document.createElement("p");p.className="hint";p.style.padding="16px";p.textContent="Nenhum veículo corresponde aos filtros.";list.append(p);
 }
 if(selectedVehicleId){
  const v=original.find(x=>String(x.id)===selectedVehicleId);
  if(v)vehicleView(v,demoMode);else clearDetail();
 }
}
// No celular o mapa fica oculto fora da aba Mapa (tamanho 0): enquadrar ao abri-la.
let pendingFit=false;
function fit(){if(!map.getSize().x){pendingFit=true;return;}pendingFit=false;const known=[...s.buses.values()],only=watch.lines.length?known.filter(isWatched):known;const vals=s.mode==="demo"?demo:only.length?only:known;if(!vals.length)return;map.fitBounds(L.latLngBounds(vals.map(v=>[v.lat,v.lon])).pad(.20),{maxZoom:14});}
async function api(path,urgent=false){
 if(!urgent){const wait=Math.max(0,1600-(Date.now()-previousRequest));if(wait)await delay(wait);}
 previousRequest=Date.now();
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),55000);
 try {
  const response=await fetch(path,{signal:controller.signal,cache:"no-store"});
  const data=await response.json();
  if(!response.ok)throw new Error(data.erro||"HTTP "+response.status);
  return data;
 }finally{clearTimeout(timer);}
}
async function getVehicles(route,repaint=true){
 const d=await api("/api/vehicles?itinerary="+encodeURIComponent(route));
 for(const v of d.veiculos||[])uniqueVehicle(v);
 if(repaint)paint();
}
async function scanStop(id){
 if(s.stop||s.scanned.has(id))return;
 const d=await api("/api/predictions?stop="+encodeURIComponent(id));
 let complete=true;
 for(const p of d.previsoes||[]){
  if(s.stop){complete=false;break;}
  if(!p.itinerario||!(/^[\w-]{1,32}$/.test(p.itinerario)))continue;
  learnRoute(p.itinerario,p.linha);
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
 pauseGpsPolling();s.running=true;s.stop=false;s.mode="live";buttonState();
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
     if((i+1)%15===0||i+1===s.secondary.length)say("Varredura ampliada: "+(i+1)+"/"+s.secondary.length+" paradas (lotes de 15); "+s.buses.size+" carros conhecidos.");
     scheduleSave();
    }
   } else s.secondaryIndex=s.secondary.length;
   if(!s.stop){s.phase="done";await checkpoint();}
  }
  if(s.stop)say("Varredura interrompida. Progresso salvo: "+s.done+"/"+s.lines.length+" linhas. Pode retomar mais tarde.");
  else if(s.phase==="done"){
   say("Varredura concluída. "+s.buses.size+" carros conhecidos e "+s.routes.size+" itinerários. Os dados históricos permanecem salvos neste navegador.");
   if(el("poll").checked)eventLog("Varredura concluída; iniciando monitoramento GPS em lotes.");
  }
 }catch(e){
  say("Falha no SIU: "+e.message+". Progresso anterior preservado; tente novamente.",true);
 }finally{
  s.running=false;
  await checkpoint();
  buttonState();paint();
  if(el("poll").checked)startGpsPolling();
 }
}
function gpsInfo(label){el("gpsState").textContent=label;}
// Com filtro de linhas ativo, o GPS automático consulta só os itinerários delas.
function gpsPool(){return watch.lines.length?watch.routes:s.routes;}
function pauseGpsPolling(){
 s.poll=false;
 if(gpsTimer!==null){clearTimeout(gpsTimer);gpsTimer=null;}
}
function scheduleGpsNext(){
 if(!s.poll||s.running||document.hidden)return;
 if(gpsTimer!==null)clearTimeout(gpsTimer);
 const cfg=GPS.getConfig(el("gpsInterval").value);
 const delay=Math.min(120000,cfg.seconds*1000*Math.min(4,2**Math.floor(gpsFailCycles/2)));
 gpsTimer=setTimeout(()=>{gpsTimer=null;void refresh();},delay);
 gpsInfo("Monitoramento ativado · próxima rodada em "+Math.ceil(delay/1000)+" s · "+
  (watch.lines.length?gpsPool().size+" itinerários das linhas "+watch.lines.join(", ")+".":(s.routes.size||0)+" itinerários conhecidos.")+" Lotes de até "+cfg.routeBatch+".");
}
function startGpsPolling(){
 if(!el("poll").checked){pauseGpsPolling();gpsInfo("GPS automático desligado.");return;}
 if(!memoryReady||s.running){gpsInfo("GPS aguardando término da varredura.");return;}
 if(document.hidden){pauseGpsPolling();gpsInfo("GPS pausado: página em segundo plano.");return;}
 if(!gpsPool().size&&!s.buses.has(String(selectedVehicleId))){
  pauseGpsPolling();gpsInfo("Descubra itinerários ou localize um veículo para começar.");
  return;
 }
 s.poll=true;
 if(gpsTimer!==null){clearTimeout(gpsTimer);gpsTimer=null;}
 if(!gpsBusy)void refresh();
}
async function refresh(once=false){
 if((!s.poll&&!once)||gpsBusy||s.running||document.hidden)return;
 gpsBusy=true;
 el("gpsNow").disabled=true;
 const started=Date.now();
 let ok=0,failures=0,queries=0;
 try{
  const cfg=GPS.getConfig(el("gpsInterval").value);
  const target=selectedVehicleId&&s.buses.get(String(selectedVehicleId));
  // Prioritize one explicitly tracked bus, then a small fair batch of routes.
  if(target&&/^[A-Za-z0-9_-]{1,32}$/.test(String(target.id))){
   try{
    const response=await api("/api/vehicle?number="+encodeURIComponent(target.id));
    for(const vehicle of response.veiculos||[])uniqueVehicle(vehicle);
    ok++;queries++;
   }catch(e){failures++;queries++;eventLog("Consulta do carro "+target.id+" indisponível: "+e.message,"warn");}
  }
  const batch=GPS.chooseRoutes(gpsPool().values(),s.buses.values(),selectedVehicleId,
    gpsCursor,cfg.routeBatch);
  gpsCursor=batch.cursor;
  for(const id of batch.ids){
   if((!s.poll&&!once)||s.running||document.hidden)break;
   try{await getVehicles(id,false);ok++;}
   catch(e){failures++;eventLog("Falha de GPS no itinerário "+id+": "+e.message,"warn");}
   queries++;
  }
  if(ok){s.mode="live";tag("GPS · ÚLTIMAS CONSULTAS AO SIU");}
  paint();
  if(queries){
   const elapsed=((Date.now()-started)/1000).toFixed(1);
   gpsInfo("Última rodada: "+ok+"/"+queries+" consultas concluídas em "+elapsed+
     " s · "+new Date().toLocaleTimeString("pt-BR")+". A posição GPS pode ser anterior à consulta.");
  }else gpsInfo("Sem itinerários ou veículo selecionado para consultar.");
  if(!ok&&queries)gpsFailCycles=Math.min(8,gpsFailCycles+1);
  else gpsFailCycles=0;
 }catch(e){
  gpsFailCycles=Math.min(8,gpsFailCycles+1);
  gpsInfo("Erro nesta rodada de GPS: "+e.message+". Próxima tentativa com intervalo adaptativo.");
  eventLog("Falha na atualização GPS: "+e.message,"warn");
 }finally{
  gpsBusy=false;el("gpsNow").disabled=false;
  if(s.poll&&!s.running)scheduleGpsNext();
 }
}
async function direct(){
 const n=el("directNumber").value.trim();
 if(!/^[A-Za-z0-9_-]{1,32}$/.test(n)){el("directResult").textContent="Digite um número/identificador válido.";return;}
 el("direct").disabled=true;el("directResult").textContent="Consultando carro "+n+" diretamente...";
 try{
  const d=await api("/api/vehicle?number="+encodeURIComponent(n),true);
  if(!d.veiculos?.length){el("directResult").textContent="Nenhuma posição válida retornada para "+n+".";return;}
  s.mode="live";for(const v of d.veiculos)uniqueVehicle(v);
  paint();selectVehicle(d.veiculos[0],false,true);map.setView([d.veiculos[0].lat,d.veiculos[0].lon],16);
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
 if(!confirm("Limpar a memória LOCAL deste navegador? Os registros compartilhados da D1 permanecerão no servidor."))return;
 try{
  if(saveTimer){clearTimeout(saveTimer);saveTimer=null;}
  if(memoryAvailable)await memory.clear();
  clearDetail();s.mode="demo";s.phase="new";s.lines=[];s.buses.clear();s.routes.clear();s.scanned.clear();
  s.routeLines.clear();watch.routes.clear();watch.discoveredAt.clear();
  pauseGpsPolling();el("poll").checked=false;
  s.geometry.clear();s.secondary=[];s.nextLineIndex=0;s.secondaryIndex=0;s.done=0;s.errors=0;
  checkedThisVisit.clear();memoryLabel(memoryAvailable?"Memória limpa":"Indisponível");
  tag("MODO DEMONSTRAÇÃO");say("Memória deste navegador apagada. O histórico compartilhado na D1 permanece disponível; use Sincronizar histórico para restaurá-lo.");
  buttonState();paint();
 }catch(e){memoryLabel("Erro ao limpar: "+e.message);}
}
function lineInfo(text,error=false){
 el("lineWatchState").textContent=text;
 el("lineWatchState").classList.toggle("is-error",error);
}
function renderWatchChips(){
 const box=el("lineWatchChips");box.replaceChildren();
 box.hidden=!watch.lines.length;
 if(!watch.lines.length)return;
 const known=[...s.buses.values()];
 for(const line of watch.lines){
  const count=known.filter(v=>GPS.normalizeLine(v.linha)===line||s.routeLines.get(String(v.itinerario??""))===line).length;
  const chip=document.createElement("button");chip.type="button";chip.className="watch-chip";
  chip.title="Remover a linha "+line+" do filtro";
  const name=document.createElement("b");name.textContent=line;
  const total=document.createElement("small");total.textContent=count+(count===1?" carro":" carros");
  chip.append(name,total,document.createTextNode(" ✕"));
  chip.addEventListener("click",()=>{
   setWatch(watch.lines.filter(x=>x!==line));
   el("lineWatch").value=watch.lines.join(", ");
   lineInfo(watch.lines.length?"Filtro: "+watch.lines.join(", ")+".":"Filtro de linhas removido; mostrando toda a frota conhecida.");
  });
  box.append(chip);
 }
 const clear=document.createElement("button");clear.type="button";clear.className="watch-chip watch-clear";clear.id="lineWatchClear";
 clear.textContent="Limpar filtro";
 clear.addEventListener("click",()=>{setWatch([]);el("lineWatch").value="";lineInfo("Filtro de linhas removido; mostrando toda a frota conhecida.");});
 box.append(clear);
}
function setWatch(lines){
 const had=watch.lines.length>0;
 watch.lines=lines.slice(0,8);
 refreshWatchRoutes();
 try{localStorage.setItem("feirabus-cco-watch-lines",watch.lines.join(","));}catch{}
 if(watch.lines.length)tag("FILTRO DE LINHAS · "+watch.lines.join(", "));
 else if(had)tag(s.mode==="demo"?"MODO DEMONSTRAÇÃO":"FROTA CONHECIDA · SEM FILTRO DE LINHAS");
 paint();
 if(s.poll)scheduleGpsNext();
 void drawRouteLines();
}
// Itinerários de uma linha: previsões do primeiro ponto de cada sentido,
// o mesmo caminho da varredura, mas só para as linhas pedidas.
async function discoverLine(entry,line){
 if(Date.now()-(watch.discoveredAt.get(line)||0)<20*60*1000)return;
 const r=await api("/api/stops?line="+encodeURIComponent(entry.id));
 const firsts=new Map();
 for(const p of r.paradas||[]){
  const key=String(p.sentido||"geral");
  if(!firsts.has(key)&&/^\d{1,15}$/.test(String(p.id)))firsts.set(key,String(p.id));
 }
 for(const stop of [...firsts.values()].slice(0,3)){
  try{
   const d=await api("/api/predictions?stop="+encodeURIComponent(stop));
   for(const p of d.previsoes||[]){
    learnRoute(p.itinerario,p.linha);
    if(GPS.normalizeLine(p.linha)===line&&ROUTE_ID.test(String(p.itinerario??"")))s.routes.add(String(p.itinerario));
   }
  }catch(e){s.errors++;}
 }
 watch.discoveredAt.set(line,Date.now());
}
async function searchLines(){
 const wanted=GPS.parseLineQuery(el("lineWatch").value);
 if(!wanted.length){setWatch([]);lineInfo("Digite uma ou mais linhas, ex.: 07A, 007, 300.",true);return;}
 if(s.running){lineInfo("A varredura da cidade está em andamento. Interrompa-a para buscar linhas específicas.",true);return;}
 if(watch.busy)return;
 watch.busy=true;el("lineWatchGo").disabled=true;
 el("lineWatch").value=wanted.join(", ");
 pauseGpsPolling();
 for(let i=0;gpsBusy&&i<200;i++)await delay(300);
 setWatch(wanted);
 try{
  if(!s.lines.length){
   lineInfo("Carregando catálogo de linhas do SIU…");
   const d=await api("/api/lines",true);
   if(d.linhas?.length)s.lines=d.linhas;
  }
  const missing=[];
  for(const line of wanted){
   const entry=s.lines.find(l=>GPS.normalizeLine(l.numero)===line);
   if(!entry){missing.push(line);continue;}
   lineInfo("Descobrindo itinerários da linha "+line+"…");
   try{await discoverLine(entry,line);}catch(e){s.errors++;eventLog("Itinerários da linha "+line+" indisponíveis: "+e.message,"warn");}
  }
  refreshWatchRoutes();
  const routes=[...watch.routes].slice(0,24);
  let ok=0;
  for(const [i,route] of routes.entries()){
   lineInfo("Consultando GPS: itinerário "+(i+1)+" de "+routes.length+"…");
   try{await getVehicles(route,false);ok++;}catch(e){eventLog("Falha de GPS no itinerário "+route+": "+e.message,"warn");}
  }
  if(ok){s.mode="live";tag("GPS · LINHAS "+wanted.join(", "));}
  paint();fit();void drawRouteLines();
  const recent=[...s.buses.values()].filter(v=>isWatched(v)&&isRecent(v)).length;
  const parts=[];
  parts.push(routes.length?recent+(recent===1?" carro consultado agora":" carros consultados agora")+" em "+ok+"/"+routes.length+" itinerários.":
    "Nenhum itinerário encontrado agora para essas linhas (sem previsão nos pontos iniciais).");
  if(missing.length)parts.push("Fora do catálogo SIU: "+missing.join(", ")+".");
  parts.push("A posição GPS pode ser anterior à consulta.");
  lineInfo(parts.join(" "),!routes.length);
  eventLog("GPS por linha ("+wanted.join(", ")+"): "+recent+" carros, "+routes.length+" itinerários.");
  scheduleSave();
  if(isMobile())setView("mapa");
 }catch(e){lineInfo("Falha na busca por linha: "+e.message,true);}
 finally{
  watch.busy=false;el("lineWatchGo").disabled=false;
  if(el("poll").checked)startGpsPolling();
 }
}
// Trajeto das linhas filtradas (GPS por linha ou seletor de linha), com geometria em cache.
let drawnRoutesKey="";
async function drawRouteLines(){
 const chosen=el("fleetLine").value;
 const lines=watch.lines.length?watch.lines:chosen?[GPS.normalizeLine(chosen)]:[];
 const routes=[...s.routeLines].filter(([,line])=>lines.includes(line)).map(([route])=>route).slice(0,12);
 const key=routes.join(",");
 if(key===drawnRoutesKey)return;
 drawnRoutesKey=key;linesLayer.clearLayers();
 if(!routes.length)return;
 const colors=["#f2c230","#7aa7ef","#6fd39a","#ff8a7a","#c79bff","#f5f2ea"];
 for(const route of routes){
  let d=s.geometry.get(route);
  if(!d&&memoryAvailable){try{d=await memory.loadGeometry(route);if(d)s.geometry.set(route,d);}catch{}}
  if(!d){
   try{d=await api("/api/geometry?itinerary="+encodeURIComponent(route));s.geometry.set(route,d);if(memoryAvailable)await memory.saveGeometry(route,d);}
   catch(e){eventLog("Trajeto do itinerário "+route+" indisponível: "+e.message,"warn");continue;}
  }
  if(drawnRoutesKey!==key)return;
  const pts=(d.geometry?.coordinates||[]).map(([lon,lat])=>[lat,lon]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
  const line=s.routeLines.get(route)||"";
  if(pts.length>1)L.polyline(pts,{color:colors[Math.max(0,lines.indexOf(line))%colors.length],weight:4,opacity:.8})
   .bindTooltip("Linha "+line+" · itinerário "+route).addTo(linesLayer);
 }
 linesLayer.eachLayer(l=>l.bringToBack?.());
}
// Linhas recentes de cada carro (D1, 7 dias). O CCO mantém carros antigos; só o app os esconde.
const busHistory={rows:[],byBus:new Map(),loadedAt:0,busy:false};
async function loadHistory(force=false){
 if(busHistory.busy||(!force&&Date.now()-history.loadedAt<120000))return;
 busHistory.busy=true;el("historyRefresh").disabled=true;
 el("historyState").textContent="Consultando a memória compartilhada…";
 try{
  const d=await api("/api/memory/vehicle-lines",true);
  busHistory.rows=(d.veiculos||[]).filter(v=>v&&ROUTE_ID.test(String(v.id))&&Array.isArray(v.linhas));
  busHistory.byBus=new Map(busHistory.rows.map(v=>[String(v.id),v.linhas]));
  busHistory.loadedAt=Date.now();
  renderHistory();
  if(selectedVehicleId)paint();
 }catch(e){el("historyState").textContent="Histórico indisponível: "+e.message+". A tabela é criada na D1 após o deploy desta versão.";}
 finally{busHistory.busy=false;el("historyRefresh").disabled=false;}
}
function shortTime(ms){return new Date(ms).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});}
function renderHistory(){
 const q=el("historySearch").value.trim().toLocaleLowerCase("pt-BR"),line=GPS.normalizeLine(q);
 const rows=busHistory.rows.filter(v=>!q||String(v.id).includes(q)||v.linhas.some(l=>l.linha===line||String(l.linha).toLocaleLowerCase("pt-BR").includes(q)));
 const box=el("historyList");box.replaceChildren();
 el("historyState").textContent=busHistory.rows.length?rows.length+" de "+busHistory.rows.length+" carros · atualizado às "+new Date(busHistory.loadedAt).toLocaleTimeString("pt-BR"):"Nenhum registro ainda. Os carros entram aqui conforme aparecem nas consultas ao SIU.";
 for(const v of rows.slice(0,200)){
  const row=document.createElement("button");row.type="button";row.className="history-row";
  const name=document.createElement("b");name.textContent="CARRO "+v.id;
  const chips=document.createElement("span");chips.className="history-lines";
  for(const l of v.linhas.slice(0,8)){
   const chip=document.createElement("span");chip.className="history-chip";
   const n=document.createElement("strong");n.textContent=l.linha;
   const t=document.createElement("small");t.textContent=shortTime(l.ultimaVez);
   chip.title="Primeira vez: "+shortTime(l.primeiraVez)+" · última: "+shortTime(l.ultimaVez);
   chip.append(n,t);chips.append(chip);
  }
  row.append(name,chips);
  row.addEventListener("click",()=>{
   const bus=s.buses.get(String(v.id));
   if(bus){selectVehicle(bus,false);if(isMobile())setView("mapa");}
   else{el("directNumber").value=v.id;if(isMobile())setView("frota");el("directResult").textContent="Carro "+v.id+" sem posição na memória deste navegador. Toque em Localizar para consultar o SIU.";}
  });
  box.append(row);
 }
}
el("historySearch").addEventListener("input",renderHistory);
el("historyRefresh").addEventListener("click",()=>void loadHistory(true));
el("fleetLine").addEventListener("change",()=>void drawRouteLines());
el("lineWatchGo").addEventListener("click",()=>void searchLines());
el("lineWatch").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();void searchLines();}});
// Modo celular: uma área por vez (Geral, Mapa, Frota, Eventos, Ajustes) com abas fixas embaixo.
const mobileQuery=window.matchMedia("(max-width:740px)");
const VIEWS=["geral","mapa","frota","historico","eventos","ajustes"];
function isMobile(){return mobileQuery.matches;}
function setView(view){
 if(!VIEWS.includes(view))view="mapa";
 document.body.dataset.view=view;
 for(const link of document.querySelectorAll(".rail-link")){
  const on=link.dataset.view===view;
  link.classList.toggle("active",on);
  if(on)link.setAttribute("aria-current","page");else link.removeAttribute("aria-current");
 }
 if(view==="historico")void loadHistory();
 if(isMobile()){
  try{localStorage.setItem("feirabus-cco-view",view);}catch{}
  window.scrollTo(0,0);
  if(view==="mapa")setTimeout(()=>{map.invalidateSize();if(pendingFit)fit();},60);
 }
}
for(const link of document.querySelectorAll(".rail-link")){
 link.addEventListener("click",e=>{
  if(isMobile()){e.preventDefault();setView(link.dataset.view);}
  else setView(link.dataset.view);
 });
}
mobileQuery.addEventListener?.("change",()=>setTimeout(()=>map.invalidateSize(),60));
document.body.classList.add("m-views");
{
 let saved="mapa";
 try{saved=localStorage.getItem("feirabus-cco-view")||"mapa";}catch{}
 setView(isMobile()?saved:"geral");
 let lines="";
 try{lines=localStorage.getItem("feirabus-cco-watch-lines")||"";}catch{}
 const restored=GPS.parseLineQuery(lines);
 if(restored.length){el("lineWatch").value=restored.join(", ");setWatch(restored);
  lineInfo("Filtro restaurado: "+restored.join(", ")+". Toque em Buscar GPS para atualizar as posições.");}
}
el("fleetStatus").addEventListener("change",paint);
el("fleetLine").addEventListener("change",paint);
el("mapTheme").addEventListener("change",e=>applyMapTheme(e.target.value));
function toggleMapExpanded(){
 const panel=document.querySelector(".map-panel");
 const on=!panel.classList.contains("is-expanded");
 panel.classList.toggle("is-expanded",on);
 document.body.classList.toggle("map-is-expanded",on);
 el("mapFullscreen").setAttribute("aria-pressed",String(on));
 el("mapFullscreen").textContent=on?"⤢ Fechar mapa":"⛶ Expandir";
 setTimeout(()=>map.invalidateSize(),100);
}
el("mapFullscreen").addEventListener("click",toggleMapExpanded);
document.addEventListener("keydown",e=>{
 if(e.key==="Escape"&&document.querySelector(".map-panel").classList.contains("is-expanded"))toggleMapExpanded();
});
el("detailRefresh").addEventListener("click",()=>{
 if(!selectedVehicleId||s.mode==="demo")return;
 el("directNumber").value=selectedVehicleId;
 direct();
});
el("copyCoords").addEventListener("click",async()=>{
 const v=s.buses.get(String(selectedVehicleId));
 if(!v)return;
 const text=Number(v.lat).toFixed(6)+", "+Number(v.lon).toFixed(6);
 try{await navigator.clipboard.writeText(text);eventLog("Coordenadas copiadas do carro "+v.id);}
 catch{eventLog("Não foi possível copiar coordenadas neste navegador.","warn");}
});
el("clearMemory").addEventListener("click",clearMemory);
el("poll").addEventListener("change",()=>{
 if(el("poll").checked)startGpsPolling();
 else{pauseGpsPolling();gpsInfo("GPS automático desligado.");}
 scheduleSave();
});
el("gpsInterval").addEventListener("change",()=>{
 el("gpsInterval").value=String(GPS.getConfig(el("gpsInterval").value).seconds);
 if(s.poll)startGpsPolling();
 scheduleSave();
});
el("gpsNow").addEventListener("click",()=>void refresh(true));
document.addEventListener("visibilitychange",()=>{
 if(document.hidden){pauseGpsPolling();gpsInfo("GPS pausado: página em segundo plano.");}
 else if(el("poll").checked)startGpsPolling();
});
el("sharedRefresh").addEventListener("click",hydrateSharedMemory);
el("busSearch").addEventListener("input",paint);
el("direct").addEventListener("click",direct);
el("directNumber").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();direct();}});
el("start").addEventListener("click",run);
el("stop").addEventListener("click",()=>{s.stop=true;s.poll=false;say("Interrupção solicitada. Finalizando a consulta atual...");});
el("fit").addEventListener("click",fit);
el("export").addEventListener("click",exportGeo);
el("start").disabled=true;
eventLog("Interface de controle carregada. Nenhuma ocorrência externa é presumida.");
restore();
paint();
void loadHistory();
})();
