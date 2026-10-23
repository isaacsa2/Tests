"use strict";
(()=>{
const id=name=>document.getElementById(name);
const state={lines:[],schedule:[],variants:[],latestRequest:0,installPrompt:null,origins:[],origin:null,stopsRequest:0,openStop:null,stopBatchCursor:new Map(),stopBatchResults:new Map(),stopBatchToken:0,stopBatchRunning:false};
const API_TIMEOUT=55000;
function feedback(text,error=false){
 id("feedback").textContent=text;
 id("feedback").classList.toggle("error",error);
}
function make(tag,cls,text){
 const node=document.createElement(tag);
 if(cls)node.className=cls;
 if(text!==undefined)node.textContent=String(text);
 return node;
}
async function api(path){
 const control=new AbortController(),timer=setTimeout(()=>control.abort(),API_TIMEOUT);
 try{
  const res=await fetch(path,{signal:control.signal,cache:"no-store"});
  const data=await res.json();
  if(!res.ok){
   if(res.status===404 && path.startsWith("/api/schedule"))
     throw new Error("A API de horarios ainda nao foi publicada no Worker. Confira /api/status: versao siu-timetable-hotfix-v4.");
   throw new Error(data.erro||"HTTP "+res.status);
  }
  return data;
 }finally{clearTimeout(timer);}
}
function validCode(value){return /^[A-Za-z0-9_-]{1,32}$/.test(value);}
function liveClock(){
 const now=new Date();
 const parts=new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Bahia",hour:"2-digit",minute:"2-digit",hour12:false}).format(now);
 const m=parts.match(/(\d{2}):(\d{2})/);
 return m?Number(m[1])*60+Number(m[2]):null;
}
function dayMatches(label){
 const v=String(label).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
 const weekday=new Date(new Date().toLocaleString("en-US",{timeZone:"America/Bahia"})).getDay();
 if(weekday===0)return /domingo/.test(v);
 if(weekday===6)return /sabado/.test(v);
 return /util|segunda.*sexta/.test(v);
}
function plain(text){return String(text??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toUpperCase();}
function minutes(time){
 const m=String(time).match(/^(\d{1,2}):(\d{2})/);
 if(!m)return -1;
 const h=Number(m[1]),min=Number(m[2]);
 return h<24&&min<60?h*60+min:-1;
}
function renderLineChoices(){
 const filter=id("lineFilter").value.trim().toLocaleLowerCase("pt-BR");
 const previous=id("lineSelect").value;
 const matches=state.lines.filter(line=>[line.numero,line.nome,line.id].some(t=>String(t||"").toLocaleLowerCase("pt-BR").includes(filter))).slice(0,220);
 const sel=id("lineSelect");sel.replaceChildren();
 const head=make("option",null,"Selecione uma linha");head.value="";sel.append(head);
 for(const line of matches){
  const opt=make("option",null,[line.numero,line.nome].filter(Boolean).join(" · ").slice(0,130));
  opt.value=line.id;sel.append(opt);
 }
 if(matches.some(x=>x.id===previous))sel.value=previous;
}
async function selectLine(){
 const line=id("lineSelect").value,token=++state.latestRequest;
 if(!line){id("variantSelect").replaceChildren();state.schedule=[];renderSchedule();resetStops("Selecione uma linha em 01 para ver as origens.");return;}
 id("connection").textContent="Consultando linhas e sentidos...";
 state.schedule=[];
 id("variantSelect").replaceChildren();
 if(!validCode(line)){feedback("Código inválido.",true);return;}
 const original=state.lines.find(x=>String(x.id)===line);
 const variants=[original].filter(Boolean);
 try{
  const extra=await api("/api/sublines?line="+encodeURIComponent(line));
  if(token!==state.latestRequest)return;
  for(const v of extra.sublinhas||[]){
   if(v.id&&!variants.some(x=>x.id===v.id))variants.push(v);
  }
 }catch(e){feedback("Sublinhas indisponíveis; consultando a linha principal: "+e.message,true);}
 if(token!==state.latestRequest)return;
 state.variants=variants;
 const select=id("variantSelect");
 for(const v of variants){
  const opt=make("option",null,[v.numero,v.nome].filter(Boolean).join(" · ")||String(v.id));
  opt.value=v.id;select.append(opt);
 }
 try{localStorage.setItem("feirabus-passenger-last-line",line);}catch{}
 if(variants.length)await loadVariant();else feedback("Nenhum código válido para consultar o horário.",true);
}
async function loadSchedule(){
 const code=id("variantSelect").value,token=++state.latestRequest;
 if(!validCode(code))return;
 feedback("Consultando quadro de horários da linha "+code+"…");
 id("times").replaceChildren(make("div","empty","Aguardando SIU…"));
 try{
  const data=await api("/api/schedule?line="+encodeURIComponent(code));
  if(token!==state.latestRequest)return;
  state.schedule=(data.horarios||[]).filter(x=>minutes(x.horario)>=0);
  id("connection").textContent="SIU consultado · "+new Date().toLocaleTimeString("pt-BR");
  const day=id("daySelect");const former=day.value;
  day.replaceChildren();
  const days=[...new Set(state.schedule.map(x=>x.tipoDia).filter(Boolean))];
  if(days.length===0){day.append(make("option",null,"Sem tabela cadastrada"));day.value="";}
  for(const label of days){const opt=make("option",null,label);opt.value=label;day.append(opt);}
  if(days.includes(former))day.value=former;
  else {const guess=days.find(dayMatches);if(guess)day.value=guess;}
  renderSchedule();
  renderOriginInfo();
  feedback(state.schedule.length?state.schedule.length+" partidas programadas encontradas no SIU. Selecione o tipo de dia correto.":"O SIU não forneceu horários cadastrados para esta linha.");
 }catch(e){
  state.schedule=[];renderSchedule();
  feedback("Falha ao consultar quadro de horários: "+e.message,true);
 }
}
function renderSchedule(){
 const box=id("times");box.replaceChildren();
 const day=id("daySelect").value;
 const set=state.schedule.filter(x=>x.tipoDia===day||!day).sort((a,b)=>minutes(a.horario)-minutes(b.horario));
 id("scheduleCount").textContent=set.length?set.length+" partidas":"Sem horários";
 if(!set.length){box.append(make("div","empty","Nenhuma partida programada disponível para este tipo de dia."));return;}
 const now=liveClock();
 const isToday=dayMatches(day);
 const nextIndex=isToday&&now!==null?set.findIndex(x=>minutes(x.horario)>=now):-1;
 for(const [i,item] of set.slice(0,210).entries()){
  const tile=make("div","time-item"+(i===nextIndex?" next":isToday&&minutes(item.horario)<now?" old":""));
  tile.append(make("span",null,item.horario));
  tile.append(make("small",null,item.origem||"Origem não informada"));
  box.append(tile);
 }
 id("scheduleCaveat").textContent=(isToday?
  "Próxima partida destacada apenas pela hora local, considerando o tipo de dia selecionado. Feriados e partidas extraordinárias podem ter tabela diferente.":
  "Tipo de dia selecionado manualmente; os horários exibidos são apenas partidas previstas.")+
  " Não é possível inferir atraso do ônibus sem vincular a viagem à observação da operação.";
}
function selectedLineNumber(){
 const code=id("variantSelect").value;
 const v=state.variants.find(x=>String(x.id)===code)||state.lines.find(x=>String(x.id)===id("lineSelect").value);
 return plain(v?.numero);
}
function renderPredictions(output,list){
 output.replaceChildren();
 const mine=selectedLineNumber();
 const entries=(list||[]).filter(x=>x.linha&&x.linha!=="Sem Dados").slice(0,50)
  .map(row=>({row,match:!!mine&&plain(row.linha)===mine}))
  .sort((a,b)=>Number(b.match)-Number(a.match));
 if(!entries.length){output.append(make("div","empty","Não há previsão para esta parada no momento."));return 0;}
 for(const {row,match} of entries){
  const item=make("div","result"+(match?" match":""));
  const title=make("strong",null,"Linha "+row.linha);
  if(match)title.append(make("span","badge","Esta linha"));
  item.append(title);
  item.append(make("span","eta",row.previsao||"Sem tempo informado"));
  item.append(make("span",null,[row.destino,row.carro?"Carro "+row.carro:null].filter(Boolean).join(" · ")));
  output.append(item);
 }
 return entries.length;
}
async function getStop(){
 const code=id("stopCode").value.trim(),output=id("predictions");
 if(!/^\d{1,15}$/.test(code)){feedback("Informe um código numérico válido de parada.",true);return;}
 output.replaceChildren(make("div","empty","Consultando previsões do SIU…"));
 const b=id("checkStop");b.disabled=true;
 try{
  const d=await api("/api/predictions?stop="+code);
  renderPredictions(output,d.previsoes);
  try{localStorage.setItem("feirabus-passenger-last-stop",code);}catch{}
  feedback("Previsões da parada "+code+" consultadas no SIU.");
 }catch(e){output.replaceChildren(make("div","empty",e.message));feedback("Falha na previsão: "+e.message,true);}
 finally{b.disabled=false;}
}
function resetStops(message){
 state.stopsRequest++;state.stopBatchToken++;
 state.stopBatchCursor.clear();state.stopBatchResults.clear();
 state.origins=[];state.origin=null;state.openStop=null;
 id("sync15Stops").disabled=true;
 id("stopBatchStatus").textContent="Selecione a origem para sincronizar previsões.";
 id("originTabs").replaceChildren();
 id("originInfo").hidden=true;
 id("stopList").replaceChildren(make("li","empty","Os pontos de cada origem aparecerão aqui."));
 id("stopsMeta").textContent=message;
 id("refreshStops").disabled=!validCode(id("variantSelect").value);
}
// O SIU devolve cada ponto com o sentido da viagem; esse sentido coincide
// com a "origem" do quadro de horários (ex.: BAIRRO, TERMINAL CENTRAL).
function groupStops(paradas){
 const groups=new Map();
 for(const p of paradas||[]){
  if(!/^\d{1,15}$/.test(String(p?.id??"")))continue;
  const label=String(p.sentido||"").trim()||"Sentido não informado";
  const key=plain(label);
  if(!groups.has(key))groups.set(key,{key,label,stops:[],seen:new Set()});
  const g=groups.get(key);
  if(!g.seen.has(p.id)){
   g.seen.add(p.id);
   g.stops.push({id:String(p.id),nome:String(p.nome||"").trim().slice(0,180),
     codigoSIU:String(p.codigoSIU||"").trim().slice(0,40)});
  }
 }
 return [...groups.values()].map(({seen,...g})=>g);
}
async function loadStops(){
 const code=id("variantSelect").value;
 if(!validCode(code)){resetStops("Selecione uma linha em 01 para ver as origens.");return;}
 const token=++state.stopsRequest;
 const previous=state.origin;
 state.origins=[];state.origin=null;state.openStop=null;
 id("originTabs").replaceChildren();id("originInfo").hidden=true;
 id("stopList").replaceChildren(make("li","empty","Consultando pontos da linha no SIU…"));
 id("stopsMeta").textContent="Carregando origens da linha…";
 const button=id("refreshStops");button.disabled=true;
 try{
  const data=await api("/api/stops?line="+encodeURIComponent(code));
  if(token!==state.stopsRequest)return;
  state.origins=groupStops(data.paradas);
  if(!state.origins.length){resetStops("O SIU não informou pontos para esta linha.");return;}
  const total=state.origins.reduce((n,g)=>n+g.stops.length,0);
  id("stopsMeta").textContent=state.origins.length+(state.origins.length===1?" origem · ":" origens · ")+total+" pontos";
  renderOriginTabs();
  selectOrigin(state.origins.some(g=>g.key===previous)?previous:state.origins[0].key);
 }catch(e){
  if(token!==state.stopsRequest)return;
  id("stopList").replaceChildren(make("li","empty","Falha ao consultar pontos: "+e.message));
  id("stopsMeta").textContent="Pontos indisponíveis no momento.";
 }finally{if(token===state.stopsRequest)button.disabled=false;}
}
function renderOriginTabs(){
 const box=id("originTabs");box.replaceChildren();
 for(const g of state.origins){
  const tab=make("button","origin-tab");
  tab.type="button";tab.setAttribute("role","tab");tab.dataset.origin=g.key;
  tab.setAttribute("aria-controls","stopList");
  tab.append(make("small",null,"ORIGEM"),make("strong",null,g.label),make("span",null,g.stops.length+(g.stops.length===1?" ponto":" pontos")));
  tab.addEventListener("click",()=>selectOrigin(g.key));
  box.append(tab);
 }
}
function selectOrigin(key){
 const group=state.origins.find(g=>g.key===key);
 if(!group)return;
 state.stopBatchToken++;state.origin=key;state.openStop=null;
 id("sync15Stops").disabled=state.stopBatchRunning;
 id("stopBatchStatus").textContent="Até 15 paradas por lote · "+group.stops.length+" nesta origem.";
 for(const tab of id("originTabs").children){
  const on=tab.dataset.origin===key;
  tab.setAttribute("aria-selected",String(on));tab.tabIndex=on?0:-1;
 }
 const list=id("stopList");list.replaceChildren();
 list.setAttribute("aria-label","Pontos da origem "+group.label);
 group.stops.forEach((stop,i)=>{
  const li=make("li","stop");
  const row=make("button","stop-row");
  row.type="button";row.dataset.seq=String(i+1);
  row.dataset.stopId=stop.id;row.setAttribute("aria-expanded","false");
  const name=make("span","stop-name",stop.nome||"Ponto "+stop.id);
  name.append(make("small",null,"Código "+(stop.codigoSIU||stop.id)+" · "+(i+1)+"º ponto"));
  const preview=make("small","stop-preview",state.stopBatchResults.get(stop.id)||"");
  name.append(preview);
  row.append(name,make("span","stop-go","VER PREVISÃO ›"));
  const panel=make("div","stop-panel");panel.hidden=true;panel.id="stop-panel-"+stop.id+"-"+i;
  row.setAttribute("aria-controls",panel.id);
  row.addEventListener("click",()=>toggleStop(stop,row,panel));
  li.append(row,panel);list.append(li);
 });
 renderOriginInfo();
}
function renderOriginInfo(){
 const box=id("originInfo"),group=state.origins.find(g=>g.key===state.origin);
 if(!group){box.hidden=true;return;}
 const now=liveClock();
 const next=state.schedule
  .filter(x=>plain(x.origem)===group.key&&dayMatches(x.tipoDia)&&now!==null&&minutes(x.horario)>=now)
  .sort((a,b)=>minutes(a.horario)-minutes(b.horario))[0];
 box.replaceChildren();
 box.append("Origem: ",make("b",null,group.label));
 box.append(next?make("span",null," · próxima partida programada hoje às "):make("span",null," · sem partida programada restante hoje no quadro carregado"));
 if(next)box.append(make("b",null,next.horario.slice(0,5)));
 box.hidden=false;
}
async function toggleStop(stop,row,panel){
 const stopId=stop.id;
 if(row.getAttribute("aria-expanded")==="true"){
  row.setAttribute("aria-expanded","false");panel.hidden=true;state.openStop=null;
  row.querySelector(".stop-go").textContent="VER PREVISÃO ›";
  return;
 }
 for(const other of id("stopList").querySelectorAll('.stop-row[aria-expanded="true"]')){
  other.setAttribute("aria-expanded","false");
  other.querySelector(".stop-go").textContent="VER PREVISÃO ›";
  document.getElementById(other.getAttribute("aria-controls")).hidden=true;
 }
 const token=Symbol(stopId);state.openStop=token;
 row.setAttribute("aria-expanded","true");panel.hidden=false;
 row.querySelector(".stop-go").textContent="FECHAR";
 panel.replaceChildren(make("div","empty","Consultando previsões do SIU…"));
 try{
  const d=await api("/api/predictions?stop="+encodeURIComponent(stopId));
  if(state.openStop!==token)return;
  const count=renderPredictions(panel,d.previsoes);
  feedback(count?"Previsões de "+(stop.nome||"ponto "+stopId)+" consultadas no SIU.":"O SIU não informou previsão para "+(stop.nome||"ponto "+stopId)+" agora.");
 }catch(e){
  if(state.openStop!==token)return;
  panel.replaceChildren(make("div","empty",e.message));
  feedback("Falha na previsão: "+e.message,true);
 }
}
async function syncNext15Stops(){
 const group=state.origins.find(g=>g.key===state.origin);
 if(!group?.stops.length||state.stopBatchRunning)return;
 if(document.hidden){id("stopBatchStatus").textContent="Abra esta aba para consultar as paradas.";return;}
 state.stopBatchRunning=true;
 const button=id("sync15Stops");button.disabled=true;
 const token=++state.stopBatchToken;
 const start=state.stopBatchCursor.get(group.key)||0;
 const batch=group.stops.slice(start,start+15);
 let completed=0,failed=0;
 const status=id("stopBatchStatus");
 try{
  for(const stop of batch){
   if(token!==state.stopBatchToken||document.hidden)break;
   try{
    const data=await api("/api/predictions?stop="+encodeURIComponent(stop.id));
    if(token!==state.stopBatchToken)break;
    const entries=Array.isArray(data.previsoes)?data.previsoes:[];
    const first=entries.find(v=>v?.previsao);
    const label=entries.length?"SIU: "+(first?.previsao||entries.length+" previsão(ões)"):"Sem previsão no SIU";
    state.stopBatchResults.set(stop.id,label);
    const row=[...id("stopList").querySelectorAll(".stop-row")].find(v=>v.dataset.stopId===stop.id);
    const preview=row?.querySelector(".stop-preview");
    if(preview)preview.textContent=label;
   }catch(e){
    failed++;
    state.stopBatchResults.set(stop.id,"Falha na consulta");
   }
   completed++;
   status.textContent="Consultados "+completed+"/"+batch.length+" pontos do lote · "+
      (start+completed)+"/"+group.stops.length+" da origem · "+failed+" falhas.";
  }
  if(token===state.stopBatchToken){
   const next=start+completed;
   state.stopBatchCursor.set(group.key,next>=group.stops.length?0:next);
   if(next>=group.stops.length)status.textContent="Origem concluída: "+group.stops.length+
     " pontos examinados. Próxima rodada recomeça do primeiro.";
   else if(document.hidden)status.textContent="Pausado: "+next+"/"+group.stops.length+" pontos. Retome ao voltar.";
  }
 }finally{
  state.stopBatchRunning=false;
  button.disabled=!state.origins.length;
 }
}

async function loadVariant(){
 resetStops("Carregando origens da linha…");
 await Promise.all([loadSchedule(),loadStops()]);
}
function makeFleetLink(link){
 const a=make("a",null,link.label);
 a.href=link.url;a.target="_blank";a.rel="noopener noreferrer";
 return a;
}
let fleetSearch=null;
function addBusMap(box,v,history){
 const time=String(v.consultadoEm||"");
 const dt=Date.parse(time);
 const label=Number.isFinite(dt)?new Date(dt).toLocaleString("pt-BR"):"horário indisponível";
 box.append(make("span",null,history?
  "POSIÇÃO HISTÓRICA (D1) · Última consulta SIU: "+label+". Não representa GPS ao vivo.":
  "ENCONTRADO NO SIU · Consulta: "+label+". O horário original do equipamento GPS pode ser anterior."));
 box.append(make("span",null,"Linha: "+(v.linha||"não informada")+
  (v.itinerario?" · Itinerário "+v.itinerario:"")));
 if(Number.isFinite(v.lat)&&Number.isFinite(v.lon)){
  const a=make("a",null,"Abrir última posição no OpenStreetMap ↗");
  const lat=encodeURIComponent(v.lat),lon=encodeURIComponent(v.lon);
  a.href="https://www.openstreetmap.org/?mlat="+lat+"&mlon="+lon+"#map=16/"+lat+"/"+lon;
  a.target="_blank";a.rel="noopener noreferrer";
  const area=make("div","fleet-links");area.append(a);box.append(area);
 }
}
async function searchVehicleNetwork(prefix,box,button){
 if(fleetSearch)fleetSearch.cancelled=true;
 const task={cancelled:false};fleetSearch=task;
 button.disabled=true;button.textContent="Procurando nas linhas...";
 const status=make("span",null,"Consultando em lotes de até três itinerários. A busca pode levar alguns minutos.");
 const cancel=make("button","button button-outline","Interromper busca");
 cancel.type="button";
 cancel.addEventListener("click",()=>{task.cancelled=true;cancel.disabled=true;status.textContent="Interrompendo após a consulta atual...";});
 box.append(status,cancel);
 let cursor=0,previous=-1,total=0,failed=0,matched=null,complete=false;
 try{
  while(!task.cancelled&&!document.hidden){
   const data=await api("/api/vehicle/search?number="+encodeURIComponent(prefix)+"&cursor="+cursor);
   total=Number(data.totalItinerarios)||0;failed+=Number(data.erros)||0;
   if(data.veiculos?.length){matched=data.veiculos[0];complete=true;break;}
   const next=Number(data.nextCursor);
   if(!Number.isFinite(next)||next<=cursor||next===previous){
    status.textContent=total?"A busca não avançou; interrompida para proteger o SIU.":"Nenhum itinerário cadastrado na memória D1. Inicie a varredura do CCO primeiro.";
    break;
   }
   previous=cursor;cursor=next;
   status.textContent="Busca de prefixo "+prefix+": "+cursor+"/"+total+
    " itinerários examinados · "+failed+" falhas de consulta.";
   if(data.concluido||cursor>=total){complete=true;break;}
   // Yield UI thread; SIU upstream also uses cache/spacing.
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  if(task.cancelled)status.textContent="Busca interrompida em "+cursor+"/"+total+" itinerários. Nada foi apagado.";
  else if(document.hidden)status.textContent="Busca pausada porque a aba ficou em segundo plano. Pesquise novamente quando voltar.";
  else if(matched){
   status.textContent="Prefixo "+prefix+" encontrado no SIU durante a busca por itinerários!";
   addBusMap(box,matched,false);
  }else if(complete)status.textContent="Prefixo "+prefix+" não apareceu nas respostas de "+
    total+" itinerários consultados. Isso não comprova que o carro está fora de serviço ou sem GPS.";
 }catch(e){
  status.textContent="Não foi possível continuar a busca: "+e.message+". Consultados: "+cursor+"/"+total+".";
 }finally{
  cancel.remove();button.disabled=false;button.textContent="Procurar nas linhas do SIU";
  if(fleetSearch===task)fleetSearch=null;
 }
}
async function getVehicle(){
 if(fleetSearch)fleetSearch.cancelled=true;
 const code=id("vehicleCode").value.trim(),output=id("vehicleResult");
 if(!/^\d{2,8}$/.test(code)){feedback("Digite um prefixo de 2 a 8 dígitos.",true);return;}
 const fleet=globalThis.FeiraBusFleet.lookup(code),box=make("div","result");
 box.append(make("strong",null,"Prefixo "+code));
 box.append(make("span",null,fleet.empresa?
  "Empresa no acervo: "+fleet.empresa+" (não comprova operador atual)":
  fleet.ambigua?"Prefixo registrado nos dois acervos; empresa atual indefinida":
  "Operadora não identificada no acervo cadastrado"));
 box.append(make("span",null,fleet.confirmacao||""));
 if(fleet.fotosCadastradas)box.append(make("span",null,fleet.fotosCadastradas+" fotografias registradas no índice histórico."));
 const links=make("div","fleet-links");
 for(const link of fleet.links)links.append(makeFleetLink(link));
 if(fleet.referencia)links.append(makeFleetLink({label:"Foto identificada do carro ↗",url:fleet.referencia}));
 box.append(links);output.replaceChildren(box);
 const btn=id("checkVehicle");btn.disabled=true;
 try{
  const result=await api("/api/vehicle?number="+encodeURIComponent(code));
  if(result.veiculos?.length){
   const vehicle=result.veiculos[0];
   addBusMap(box,vehicle,result.historico===true||vehicle.historico===true||vehicle.origem==="d1");
  }else{
   box.append(make("span",null,"O SIU não devolveu este carro na consulta direta de embarque, e não há posição recente registrada na D1. A busca por prefixo precisa examinar os itinerários; isso não significa que o ônibus não existe."));
  }
  const search=make("button","button button-outline","Procurar nas linhas do SIU");
  search.type="button";
  search.style.marginTop="12px";
  search.addEventListener("click",()=>void searchVehicleNetwork(code,box,search));
  box.append(search);
  feedback("Prefixo "+code+" consultado. Para buscar GPS em outras linhas, use 'Procurar nas linhas do SIU'.");
 }catch(e){
  box.append(make("span",null,"Falha na consulta inicial: "+e.message));
  feedback("Não foi possível verificar a memória SIU deste prefixo.",true);
 }finally{btn.disabled=false;}
}
let installEvent=null;
window.addEventListener("beforeinstallprompt",e=>{
 e.preventDefault();installEvent=e;id("install").hidden=false;
});
id("install").addEventListener("click",async()=>{
 if(!installEvent)return;
 installEvent.prompt();
 await installEvent.userChoice;
 installEvent=null;id("install").hidden=true;
});
id("lineFilter").addEventListener("input",renderLineChoices);
id("lineSelect").addEventListener("change",selectLine);
id("variantSelect").addEventListener("change",loadVariant);
id("refreshStops").addEventListener("click",loadStops);
id("sync15Stops").addEventListener("click",syncNext15Stops);
id("daySelect").addEventListener("change",renderSchedule);
id("refreshSchedule").addEventListener("click",loadSchedule);
id("checkStop").addEventListener("click",getStop);
id("originTabs").addEventListener("keydown",e=>{
 if(!["ArrowLeft","ArrowRight"].includes(e.key)||!state.origins.length)return;
 const i=state.origins.findIndex(g=>g.key===state.origin);
 const next=state.origins[(i+(e.key==="ArrowRight"?1:-1)+state.origins.length)%state.origins.length];
 selectOrigin(next.key);
 id("originTabs").querySelector('[data-origin="'+CSS.escape(next.key)+'"]')?.focus();
});
id("checkVehicle").addEventListener("click",getVehicle);
for(const [input,run] of [["stopCode",getStop],["vehicleCode",getVehicle]]){
 id(input).addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();run();}});
}
(async()=>{
 try{
  const lines=await api("/api/lines");
  state.lines=lines.linhas||[];
  renderLineChoices();
  id("connection").textContent=state.lines.length+" linhas disponíveis";
  feedback(state.lines.length?"Selecione uma linha para consultar a tabela SIU.":"O SIU retornou um catálogo vazio.",!state.lines.length);
  let last="";
  try{last=localStorage.getItem("feirabus-passenger-last-line")||"";id("stopCode").value=localStorage.getItem("feirabus-passenger-last-stop")||"";}catch{}
  if(last&&state.lines.some(l=>l.id===last)){
   id("lineSelect").value=last;
   await selectLine();
  }
 }catch(e){id("connection").textContent="Sem conexão SIU";feedback("Não foi possível carregar as linhas: "+e.message,true);}
})();
if("serviceWorker" in navigator){
 window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));
}
})();