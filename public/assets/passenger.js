"use strict";
(()=>{
const id=name=>document.getElementById(name);
const state={lines:[],schedule:[],variants:[],latestRequest:0,installPrompt:null,origins:[],origin:null,stopsRequest:0,openStop:null,pendingStop:null,stopBatchResults:new Map(),stopBatchToken:0,stopBatchRunning:false,lineRoutes:new Set()};
// Ônibus sem posição nova há mais de 30 min some do app (o CCO continua mostrando).
const BUS_MAX_AGE=30*60*1000;
const FAV_KEY="feirabus-passenger-favorites",FAV_MAX=12;
function store(key,value){try{if(value==null)localStorage.removeItem(key);else localStorage.setItem(key,JSON.stringify(value));return true;}catch{return false;}}
function load(key){try{return JSON.parse(localStorage.getItem(key)||"null");}catch{return null;}}
function busAge(v){const t=Date.parse(String(v?.consultadoEm||""));return Number.isFinite(t)?Date.now()-t:Infinity;}
function freshBus(v){return busAge(v)<=BUS_MAX_AGE;}
function savedLabel(at){return new Date(at).toLocaleString("pt-BR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"});}
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
 if(!line){id("variantSelect").replaceChildren();state.schedule=[];renderSchedule();resetStops("Selecione uma linha em 01 para ver as origens.");resetMap();return;}
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
  saveScheduleOffline(code,state.schedule);
  id("scheduleSource").hidden=true;
  fillDays();
  feedback(state.schedule.length?state.schedule.length+" partidas programadas encontradas no SIU. Selecione o tipo de dia correto.":"O SIU não forneceu horários cadastrados para esta linha.");
 }catch(e){
  if(token!==state.latestRequest)return;
  const saved=load("feirabus-schedule-"+code);
  if(saved&&Array.isArray(saved.horarios)&&saved.horarios.length){
   state.schedule=saved.horarios.filter(x=>minutes(x.horario)>=0);
   id("scheduleSource").textContent="Salvo em "+savedLabel(saved.at);id("scheduleSource").hidden=false;
   fillDays();
   feedback("Sem conexão com o SIU ("+e.message+"). Mostrando o quadro salvo em "+savedLabel(saved.at)+"; pode estar desatualizado.",true);
   return;
  }
  state.schedule=[];renderSchedule();
  feedback("Falha ao consultar quadro de horários: "+e.message,true);
 }
}
// Quadro programado muda pouco: guardamos os 6 últimos para consulta sem internet.
// Previsões e GPS nunca vêm desse cache.
function saveScheduleOffline(code,horarios){
 if(!horarios.length)return;
 const index=(load("feirabus-schedule-index")||[]).filter(x=>x!==code);
 index.unshift(code);
 for(const old of index.splice(6))store("feirabus-schedule-"+old,null);
 if(store("feirabus-schedule-"+code,{at:Date.now(),horarios:horarios.slice(0,2500)}))store("feirabus-schedule-index",index);
}
function fillDays(){
 const day=id("daySelect");const former=day.value;
 day.replaceChildren();
 const days=[...new Set(state.schedule.map(x=>x.tipoDia).filter(Boolean))];
 if(days.length===0){day.append(make("option",null,"Sem tabela cadastrada"));day.value="";}
 for(const label of days){const opt=make("option",null,label);opt.value=label;day.append(opt);}
 if(days.includes(former))day.value=former;
 else {const guess=days.find(dayMatches);if(guess)day.value=guess;}
 renderSchedule();
 renderOriginInfo();
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
function renderPredictions(output,list,lineNumber){
 output.replaceChildren();
 const mine=lineNumber===undefined?selectedLineNumber():plain(lineNumber);
 const entries=(list||[]).filter(x=>x.linha&&x.linha!=="Sem Dados").slice(0,50)
  .map(row=>({row,match:!!mine&&plain(row.linha)===mine}))
  .sort((a,b)=>Number(b.match)-Number(a.match));
 if(!entries.length){output.append(make("div","empty","Não há previsão para esta parada no momento."));return 0;}
 for(const {row,match} of entries){
  const item=make("div","result"+(match?" match":""));
  const title=make("strong",null,"Linha "+row.linha);
  if(match)title.append(make("span","badge","Esta linha"));
  // tpAcess do SIU: só "1" é tratado como acessível; "0" ou vazio não afirma nada.
  if(String(row.acessibilidade??"").trim()==="1")title.append(make("span","badge badge-access","♿ Acessível (SIU)"));
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
  void attachStopNotices(output,code);
  try{localStorage.setItem("feirabus-passenger-last-stop",code);}catch{}
  feedback("Previsões da parada "+code+" consultadas no SIU.");
 }catch(e){output.replaceChildren(make("div","empty",e.message));feedback("Falha na previsão: "+e.message,true);}
 finally{b.disabled=false;}
}
function resetStops(message){
 state.stopsRequest++;state.stopBatchToken++;
 state.stopBatchResults.clear();state.lineRoutes.clear();
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
   const item={id:String(p.id),nome:String(p.nome||"").trim().slice(0,180),
     codigoSIU:String(p.codigoSIU||"").trim().slice(0,40)};
   if(Number.isFinite(p.lat)&&Number.isFinite(p.lon)){item.lat=p.lat;item.lon=p.lon;}
   g.stops.push(item);
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
  id("nearestStop").hidden=!allStops().some(x=>Number.isFinite(x.lat));
  const wanted=state.pendingStop&&state.origins.find(g=>g.stops.some(x=>x.id===state.pendingStop));
  selectOrigin(wanted?wanted.key:state.origins.some(g=>g.key===previous)?previous:state.origins[0].key);
  if(wanted)openStopById(state.pendingStop);
  else if(state.pendingStop){
   id("stopCode").value=state.pendingStop;
   document.querySelector(".manual-stop").open=true;
   void getStop();
  }
  state.pendingStop=null;
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
 state.origin=key;state.openStop=null;
 id("sync15Stops").disabled=false;
 if(!state.stopBatchRunning){
  const total=new Set(state.origins.flatMap(g=>g.stops.map(x=>x.id))).size;
  id("stopBatchStatus").textContent="Linha toda: "+total+" pontos em "+state.origins.length+(state.origins.length===1?" origem":" origens")+", consultados em lotes de 15.";
 }
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
  const results=make("div");
  const count=renderPredictions(results,d.previsoes);
  panel.replaceChildren(results,stopTools(stopId));
  void attachStopNotices(panel,stopId,()=>state.openStop===token);
  setShareHash(stopId);
  feedback(count?"Previsões de "+(stop.nome||"ponto "+stopId)+" consultadas no SIU.":"O SIU não informou previsão para "+(stop.nome||"ponto "+stopId)+" agora.");
 }catch(e){
  if(state.openStop!==token)return;
  panel.replaceChildren(make("div","empty",e.message));
  feedback("Falha na previsão: "+e.message,true);
 }
}
function allStops(){return state.origins.flatMap(g=>g.stops);}
function currentOriginLabel(stopId){return state.origins.find(g=>g.stops.some(x=>x.id===stopId))?.label||"";}
function openStopById(stopId){
 const row=id("stopList").querySelector('.stop-row[data-stop-id="'+CSS.escape(stopId)+'"]');
 if(!row)return false;
 if(row.getAttribute("aria-expanded")!=="true")row.click();
 row.scrollIntoView({behavior:"smooth",block:"center"});
 return true;
}
// Ferramentas do ponto aberto: salvar em Meus pontos e compartilhar link direto.
function stopTools(stop){
 const box=make("div","stop-tools");
 const line=selectedLineNumber(),stopInfo=allStops().find(x=>x.id===stop);
 const already=favorites().some(f=>f.stop===stop&&f.line===line);
 const save=make("button","button button-outline button-small",already?"★ Salvo":"☆ Salvar");
 save.type="button";save.disabled=already;
 save.addEventListener("click",()=>{
  if(save.dataset.step!=="name"){
   save.dataset.step="name";
   const input=make("input");input.type="text";input.maxLength=30;input.placeholder="Apelido (ex.: Casa)";
   input.value=stopInfo?.nome?stopInfo.nome.slice(0,30):"";input.className="fav-name";
   box.insertBefore(input,save);input.focus();
   save.textContent="Confirmar";
   input.addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();save.click();}});
   return;
  }
  const name=(box.querySelector(".fav-name")?.value||"").trim().slice(0,30)||"Ponto "+stop;
  const ok=addFavorite({stop,line,lineId:id("variantSelect").value,name,origin:currentOriginLabel(stop),stopName:stopInfo?.nome||""});
  box.querySelector(".fav-name")?.remove();
  save.textContent=ok?"★ Salvo":"Limite de "+FAV_MAX+" pontos";save.disabled=true;
  if(ok)feedback("Ponto "+stop+" salvo em Meus pontos como “"+name+"”.");
 });
 const share=make("button","button button-outline button-small","↗ Compartilhar");
 share.type="button";
 share.addEventListener("click",()=>void shareStop(stop,line));
 box.append(save,share);
 return box;
}
function shareUrl(stop,line){
 const params=new URLSearchParams();
 if(line)params.set("linha",line);
 params.set("parada",stop);
 return location.origin+location.pathname+"#"+params.toString();
}
function setShareHash(stop){
 try{history.replaceState(null,"","#"+new URLSearchParams({...(selectedLineNumber()?{linha:selectedLineNumber()}:{}),parada:stop}).toString());}catch{}
}
async function shareStop(stop,line){
 const url=shareUrl(stop,line),text="Previsão do ponto "+stop+(line?" · linha "+line:"")+" no FeiraBus";
 try{
  if(navigator.share){await navigator.share({title:"FeiraBus",text,url});return;}
  await navigator.clipboard.writeText(url);
  feedback("Link copiado: "+url);
 }catch(e){if(e?.name!=="AbortError")feedback("Não foi possível compartilhar. Link: "+url,true);}
}
function favorites(){
 const list=load(FAV_KEY);
 return Array.isArray(list)?list.filter(f=>f&&/^\d{1,15}$/.test(String(f.stop))).slice(0,FAV_MAX):[];
}
function addFavorite(f){
 const list=favorites();
 if(list.some(x=>x.stop===f.stop&&x.line===f.line))return true;
 if(list.length>=FAV_MAX)return false;
 list.push({...f,savedAt:Date.now()});
 const ok=store(FAV_KEY,list);renderFavorites();return ok;
}
function removeFavorite(i){
 const list=favorites();list.splice(i,1);store(FAV_KEY,list);renderFavorites();
}
function renderFavorites(){
 const box=id("favList"),list=favorites();
 box.replaceChildren();
 if(!list.length){
  const empty=make("div","empty","Nenhum ponto salvo. Abra um ponto em 02 e toque em ");
  empty.append(make("b",null,"☆ Salvar"),".");box.append(empty);return;
 }
 list.forEach((f,i)=>{
  const card=make("article","fav");
  const head=make("div","fav-head");
  const title=make("div");
  title.append(make("strong",null,f.name));
  title.append(make("small",null,[f.line?"Linha "+f.line:null,"Ponto "+f.stop,f.origin?"Origem "+f.origin:null].filter(Boolean).join(" · ")));
  const actions=make("div","fav-actions");
  const go=make("button","button button-main button-small","Previsão");go.type="button";
  const del=make("button","button button-outline button-small","✕");del.type="button";
  del.setAttribute("aria-label","Remover "+f.name);
  actions.append(go,del);head.append(title,actions);
  const out=make("div","fav-out");out.hidden=true;
  go.addEventListener("click",async()=>{
   out.hidden=false;go.disabled=true;
   out.replaceChildren(make("div","empty","Consultando previsões do SIU…"));
   try{
    const d=await api("/api/predictions?stop="+encodeURIComponent(f.stop));
    renderPredictions(out,d.previsoes,f.line||"");
    out.append(make("small","fav-time","Consultado às "+new Date().toLocaleTimeString("pt-BR")));
    void attachStopNotices(out,f.stop);
   }catch(e){out.replaceChildren(make("div","empty",e.message));}
   finally{go.disabled=false;go.textContent="↻ Atualizar";}
  });
  del.addEventListener("click",()=>removeFavorite(i));
  card.append(head,out);box.append(card);
 });
}
// Avisos oficiais (SIU): sempre exibidos como texto, nunca como HTML.
function noticeItem(a,isNew){
 const item=make("article","notice-item");
 const title=make("strong",null,a.assunto||"Aviso");
 if(isNew)title.append(make("span","badge","Novo"));
 item.append(title);
 if(a.texto)item.append(make("p",null,a.texto));
 return item;
}
async function loadNotices(){
 try{
  const d=await api("/api/notices");
  const list=(d.avisos||[]).filter(a=>a&&(a.assunto||a.texto));
  const box=id("noticeList");box.replaceChildren();
  id("avisos").hidden=!list.length;
  if(!list.length)return;
  const seen=new Set(load("feirabus-notices-seen")||[]);
  for(const a of list)box.append(noticeItem(a,!!a.id&&!seen.has(a.id)));
  store("feirabus-notices-seen",list.map(a=>a.id).filter(Boolean).slice(0,100));
 }catch{id("avisos").hidden=true;}
}
async function attachStopNotices(container,stopId,stillOpen=()=>true){
 try{
  const d=await api("/api/notices/stop?stop="+encodeURIComponent(stopId));
  const list=(d.avisos||[]).filter(a=>a&&(a.assunto||a.texto));
  if(!list.length||!stillOpen()||!container.isConnected)return;
  const box=make("div","notice-box");
  box.append(make("small","notice-kicker","⚠ AVISO DA OPERADORA PARA ESTE PONTO"));
  for(const a of list)box.append(noticeItem(a,false));
  container.prepend(box);
 }catch{}
}
// Paradas próximas de qualquer linha. A posição sai do aparelho já arredondada (~100 m).
function nearbyCard(st){
 const card=make("article","fav");
 const head=make("div","fav-head"),title=make("div");
 title.append(make("strong",null,st.nome||"Ponto "+st.id));
 title.append(make("small",null,"Código "+(st.codigoSIU||st.id)+" · cerca de "+(st.distancia<1000?Math.max(10,Math.round(st.distancia/10)*10)+" m":(st.distancia/1000).toFixed(1)+" km")));
 const actions=make("div","fav-actions");
 const go=make("button","button button-main button-small","Previsão");go.type="button";
 const save=make("button","button button-outline button-small",favorites().some(f=>f.stop===st.id&&!f.line)?"★":"☆");save.type="button";
 save.setAttribute("aria-label","Salvar "+(st.nome||"ponto "+st.id)+" em Meus pontos");
 actions.append(go,save);head.append(title,actions);
 const out=make("div","fav-out");out.hidden=true;
 go.addEventListener("click",async()=>{
  out.hidden=false;go.disabled=true;
  out.replaceChildren(make("div","empty","Consultando previsões do SIU…"));
  try{
   const d=await api("/api/predictions?stop="+encodeURIComponent(st.id));
   renderPredictions(out,d.previsoes,"");
   void attachStopNotices(out,st.id);
  }catch(e){out.replaceChildren(make("div","empty",e.message));}
  finally{go.disabled=false;go.textContent="↻ Atualizar";}
 });
 save.addEventListener("click",()=>{
  const ok=addFavorite({stop:st.id,line:"",lineId:"",name:(st.nome||"Ponto "+st.id).slice(0,30),origin:"",stopName:st.nome||""});
  save.textContent=ok?"★":"!";
  feedback(ok?"Ponto "+st.id+" salvo em Meus pontos.":"Limite de "+FAV_MAX+" pontos atingido.",!ok);
 });
 card.append(head,out);
 return card;
}
function nearbyStops(){
 const b=id("nearbyStops"),status=id("nearbyState"),list=id("nearbyList");
 if(!navigator.geolocation){status.textContent="Este navegador não informa a localização.";return;}
 b.disabled=true;status.textContent="Pedindo sua localização ao navegador…";
 navigator.geolocation.getCurrentPosition(async pos=>{
  const lat=Math.round(pos.coords.latitude*1000)/1000,lon=Math.round(pos.coords.longitude*1000)/1000;
  status.textContent="Consultando paradas próximas no SIU…";
  try{
   const d=await api("/api/stops/nearby?lat="+lat+"&lon="+lon);
   list.replaceChildren();
   const stops=(d.paradas||[]).filter(x=>/^\d{1,15}$/.test(String(x.id))).slice(0,12);
   for(const st of stops)list.append(nearbyCard(st));
   status.textContent=stops.length?stops.length+" paradas perto de você (distância em linha reta, posição aproximada).":"O SIU não encontrou paradas perto dessa posição.";
  }catch(e){status.textContent=/região/.test(e.message)?"Você parece estar fora da área atendida pelo SIU de Feira de Santana.":"Não foi possível consultar paradas próximas: "+e.message;}
  finally{b.disabled=false;}
 },err=>{
  b.disabled=false;
  status.textContent=err.code===1?"Permissão de localização negada. Ative no navegador para usar esta função.":"Não foi possível obter sua localização agora.";
 },{enableHighAccuracy:false,timeout:15000,maximumAge:120000});
}
function distance(a,b){
 const r=6371000,rad=x=>x*Math.PI/180;
 const dLat=rad(b.lat-a.lat),dLon=rad(b.lon-a.lon);
 const h=Math.sin(dLat/2)**2+Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(dLon/2)**2;
 return 2*r*Math.asin(Math.sqrt(h));
}
function nearestStop(){
 const stops=allStops().filter(x=>Number.isFinite(x.lat));
 if(!stops.length||!navigator.geolocation){feedback("Este navegador ou esta linha não tem coordenadas para calcular o ponto mais perto.",true);return;}
 const b=id("nearestStop");b.disabled=true;feedback("Pedindo sua localização ao navegador…");
 navigator.geolocation.getCurrentPosition(pos=>{
  b.disabled=false;
  const me={lat:pos.coords.latitude,lon:pos.coords.longitude};
  let best=null;
  for(const st of stops){const d=distance(me,st);if(!best||d<best.d)best={st,d};}
  const group=state.origins.find(g=>g.stops.includes(best.st));
  if(group&&state.origin!==group.key)selectOrigin(group.key);
  openStopById(best.st.id);
  feedback("Ponto mais perto nesta linha: "+(best.st.nome||"ponto "+best.st.id)+", a cerca de "+(best.d<1000?Math.round(best.d/10)*10+" m":(best.d/1000).toFixed(1)+" km")+" em linha reta.");
 },err=>{
  b.disabled=false;
  feedback(err.code===1?"Permissão de localização negada. Ative no navegador para usar esta função.":"Não foi possível obter sua localização agora.",true);
 },{enableHighAccuracy:true,timeout:15000,maximumAge:60000});
}
// Mapa da linha: Leaflet só é baixado quando o passageiro pede o mapa.
const mapState={map:null,routeLayer:null,busLayer:null,code:null,line:"",routes:[],timer:null,busy:false};
let leafletPromise=null;
function loadLeaflet(){
 if(window.L)return Promise.resolve(window.L);
 if(!leafletPromise)leafletPromise=new Promise((resolve,reject)=>{
  const css=document.createElement("link");
  css.rel="stylesheet";css.href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
  css.integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=";css.crossOrigin="";
  const js=document.createElement("script");
  js.src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
  js.integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=";js.crossOrigin="anonymous";
  js.onload=()=>resolve(window.L);
  js.onerror=()=>{leafletPromise=null;reject(new Error("não foi possível carregar o componente de mapa"));};
  document.head.append(css,js);
 });
 return leafletPromise;
}
function resetMap(){
 if(mapState.timer){clearInterval(mapState.timer);mapState.timer=null;}
 mapState.code=null;mapState.routes=[];
 mapState.routeLayer?.clearLayers();mapState.busLayer?.clearLayers();
 id("lineMap").hidden=true;id("refreshBuses").hidden=true;
 const ok=validCode(id("variantSelect").value);
 id("loadMap").disabled=!ok;id("loadMap").textContent="Ver no mapa";
 id("mapMeta").textContent=ok?"Toque em Ver no mapa para carregar o trajeto e os ônibus.":"Selecione uma linha em 01.";
}
function applyMapTheme(){
 const box=id("lineMap");
 box.classList.toggle("map-dark",currentTheme()==="dark");
}
async function loadLineMap(){
 const code=id("variantSelect").value,line=selectedLineNumber();
 if(!validCode(code)||mapState.busy)return;
 mapState.busy=true;id("loadMap").disabled=true;
 const meta=id("mapMeta");meta.textContent="Carregando mapa…";
 try{
  const L=await loadLeaflet();
  const box=id("lineMap");box.hidden=false;applyMapTheme();
  if(!mapState.map){
   mapState.map=L.map(box,{zoomControl:true}).setView([-12.265,-38.965],12);
   L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(mapState.map);
   mapState.routeLayer=L.layerGroup().addTo(mapState.map);
   mapState.busLayer=L.layerGroup().addTo(mapState.map);
  }
  mapState.map.invalidateSize();
  mapState.routeLayer.clearLayers();mapState.busLayer.clearLayers();
  mapState.code=code;mapState.line=line;
  // Itinerários desta linha: previsões do primeiro ponto de cada origem.
  meta.textContent="Descobrindo itinerários da linha "+(line||code)+"…";
  const routes=new Set();
  for(const g of state.origins.slice(0,3)){
   const first=g.stops[0];if(!first)continue;
   try{
    const d=await api("/api/predictions?stop="+encodeURIComponent(first.id));
    for(const row of d.previsoes||[])
     if(plain(row.linha)===line&&validCode(String(row.itinerario??"")))routes.add(String(row.itinerario));
   }catch{}
   if(mapState.code!==code)return;
  }
  for(const r of state.lineRoutes)routes.add(r);
  mapState.routes=[...routes].slice(0,8);
  const bounds=[];
  const colors=["#f2c230","#7aa7ef","#6fd39a","#ff8a7a","#c79bff","#f5f2ea"];
  for(const [i,route] of mapState.routes.entries()){
   try{
    const g=await api("/api/geometry?itinerary="+encodeURIComponent(route));
    if(mapState.code!==code)return;
    const pts=(g.geometry?.coordinates||[]).map(([lon,lat])=>[lat,lon]).filter(p=>Number.isFinite(p[0])&&Number.isFinite(p[1]));
    if(pts.length>1){L.polyline(pts,{color:colors[i%colors.length],weight:5,opacity:.85}).bindTooltip("Itinerário "+route).addTo(mapState.routeLayer);bounds.push(...pts);}
   }catch{}
  }
  for(const st of allStops().filter(x=>Number.isFinite(x.lat))){
   L.circleMarker([st.lat,st.lon],{radius:4,color:"#16181f",weight:1,fillColor:"#f5f2ea",fillOpacity:1})
    .bindPopup((st.nome?st.nome+" · ":"")+"Ponto "+st.id).addTo(mapState.routeLayer);
   bounds.push([st.lat,st.lon]);
  }
  if(bounds.length)mapState.map.fitBounds(bounds,{padding:[24,24],maxZoom:15});
  if(!mapState.routes.length){
   meta.textContent="O SIU não informou viagens desta linha agora (sem previsão nos pontos iniciais), então não há trajeto para desenhar.";
   return;
  }
  id("refreshBuses").hidden=false;
  await refreshBuses();
  if(!mapState.timer)mapState.timer=setInterval(()=>{
   const visible=!document.hidden&&!id("lineMap").hidden&&id("lineMap").getBoundingClientRect().bottom>0;
   if(visible)void refreshBuses();
  },30000);
 }catch(e){meta.textContent="Mapa indisponível: "+e.message+".";}
 finally{mapState.busy=false;id("loadMap").disabled=false;id("loadMap").textContent="↻ Recarregar mapa";}
}
async function refreshBuses(){
 const code=mapState.code;
 if(!code||!mapState.routes.length||!window.L)return;
 const b=id("refreshBuses");b.disabled=true;
 let seen=0,ok=0;const markers=[];
 for(const route of mapState.routes){
  try{
   const d=await api("/api/vehicles?itinerary="+encodeURIComponent(route));
   ok++;
   for(const v of d.veiculos||[]){
    if(!freshBus(v)||!Number.isFinite(v.lat)||!Number.isFinite(v.lon))continue;
    seen++;
    const when=new Date(Date.parse(v.consultadoEm)).toLocaleTimeString("pt-BR",{hour:"2-digit",minute:"2-digit"});
    markers.push(L.circleMarker([v.lat,v.lon],{radius:9,color:"#16181f",weight:2,fillColor:"#f2c230",fillOpacity:1})
     .bindPopup("Carro "+v.id+" · linha "+(v.linha||mapState.line)+"<br>Consulta SIU às "+when));
   }
  }catch{}
  if(mapState.code!==code){b.disabled=false;return;}
 }
 mapState.busLayer.clearLayers();
 for(const m of markers)m.addTo(mapState.busLayer);
 id("mapMeta").textContent=(seen?seen+(seen===1?" ônibus visto":" ônibus vistos"):"Nenhum ônibus visto")+" nos últimos 30 min em "+ok+"/"+mapState.routes.length+" itinerários · "+new Date().toLocaleTimeString("pt-BR");
 b.disabled=false;
}
// Tema: segue o sistema até a pessoa escolher; a escolha fica salva.
function currentTheme(){
 const t=document.documentElement.dataset.theme;
 if(t==="light"||t==="dark")return t;
 return window.matchMedia?.("(prefers-color-scheme: light)").matches?"light":"dark";
}
function paintThemeButton(){
 const t=currentTheme(),b=id("themeToggle");
 b.textContent=t==="dark"?"☀":"☾";
 b.setAttribute("aria-label",t==="dark"?"Usar tema claro":"Usar tema escuro");
 document.querySelector('meta[name="theme-color"]')?.setAttribute("content",t==="dark"?"#12151c":"#f5f2ea");
 if(mapState.map)applyMapTheme();
}
function normLine(v){
 const t=plain(v).replace(/\s+/g,"");
 if(/^\d{1,2}$/.test(t))return t.padStart(3,"0");
 const m=t.match(/^(\d)([A-Z])$/);return m?"0"+m[1]+m[2]:t;
}
// Sincroniza a linha toda (todas as origens) em lotes de 15 pontos, uma consulta por vez.
// O mesmo botão interrompe. Os itinerários desta linha encontrados alimentam o mapa.
async function syncNext15Stops(){
 if(state.stopBatchRunning){state.stopBatchToken++;id("stopBatchStatus").textContent="Parando após a consulta atual…";return;}
 const seen=new Set(),queue=[];
 for(const g of state.origins)for(const st of g.stops)if(!seen.has(st.id)){seen.add(st.id);queue.push(st);}
 if(!queue.length)return;
 if(document.hidden){id("stopBatchStatus").textContent="Abra esta aba para consultar as paradas.";return;}
 state.stopBatchRunning=true;
 const button=id("sync15Stops");button.textContent="■ Parar";
 const token=++state.stopBatchToken,line=selectedLineNumber(),code=id("variantSelect").value;
 const status=id("stopBatchStatus"),buses=new Set();
 let completed=0,failed=0,withLine=0;
 try{
  for(let start=0;start<queue.length;start+=15){
   const batch=queue.slice(start,start+15);
   for(const stop of batch){
    if(token!==state.stopBatchToken||document.hidden)break;
    try{
     const data=await api("/api/predictions?stop="+encodeURIComponent(stop.id));
     if(token!==state.stopBatchToken)break;
     const entries=(Array.isArray(data.previsoes)?data.previsoes:[]).filter(v=>v?.linha&&v.linha!=="Sem Dados");
     const mine=entries.filter(v=>plain(v.linha)===line);
     for(const v of mine){
      if(validCode(String(v.itinerario??"")))state.lineRoutes.add(String(v.itinerario));
      if(v.carro)buses.add(v.carro);
     }
     if(mine.length)withLine++;
     const best=mine.find(v=>v.previsao)||entries.find(v=>v.previsao);
     const label=!entries.length?"Sem previsão no SIU":
      mine.length?"Linha "+line+": "+(best?.previsao||"sem tempo")+(best?.carro?" · carro "+best.carro:""):
      "Só outras linhas: "+(best?"linha "+best.linha+" "+best.previsao:entries.length+" previsão(ões)");
     state.stopBatchResults.set(stop.id,label);
     const row=id("stopList").querySelector('.stop-row[data-stop-id="'+CSS.escape(stop.id)+'"]');
     const preview=row?.querySelector(".stop-preview");
     if(preview)preview.textContent=label;
    }catch(e){
     failed++;
     state.stopBatchResults.set(stop.id,"Falha na consulta");
    }
    completed++;
    status.textContent="Linha toda: "+completed+"/"+queue.length+" pontos (lote "+(Math.floor(start/15)+1)+" de "+Math.ceil(queue.length/15)+") · "+
     withLine+" com previsão da linha "+line+" · "+failed+" falhas.";
   }
   if(token!==state.stopBatchToken||document.hidden)break;
  }
  if(token!==state.stopBatchToken)status.textContent="Sincronização interrompida em "+completed+"/"+queue.length+" pontos.";
  else if(document.hidden)status.textContent="Pausado em "+completed+"/"+queue.length+" pontos porque a aba ficou em segundo plano.";
  else status.textContent="Linha toda sincronizada: "+queue.length+" pontos · "+withLine+" com previsão da linha "+line+
   (buses.size?" · carros a caminho: "+[...buses].slice(0,8).join(", "):" · nenhum carro identificado nas previsões")+" · "+failed+" falhas.";
  if(state.lineRoutes.size&&mapState.code===code)void loadLineMap();
 }finally{
  state.stopBatchRunning=false;
  button.textContent="↻ Sincronizar linha toda";
  button.disabled=!state.origins.length;
 }
}
async function loadVariant(){
 resetMap();
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
 if(!freshBus(v)){
  box.append(make("span",null,"SEM POSIÇÃO RECENTE · Este carro não aparece nas consultas ao SIU há mais de 30 minutos (última: "+label+"). No app, só mostramos ônibus vistos recentemente."));
  return;
 }
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
id("loadMap").addEventListener("click",()=>void loadLineMap());
id("refreshBuses").addEventListener("click",()=>void refreshBuses());
id("nearestStop").addEventListener("click",nearestStop);
id("nearbyStops").addEventListener("click",nearbyStops);
id("themeToggle").addEventListener("click",()=>{
 const next=currentTheme()==="dark"?"light":"dark";
 document.documentElement.dataset.theme=next;
 try{localStorage.setItem("feirabus-theme",next);}catch{}
 paintThemeButton();
});
window.matchMedia?.("(prefers-color-scheme: light)").addEventListener?.("change",paintThemeButton);
paintThemeButton();
renderFavorites();
void loadNotices();
for(const [input,run] of [["stopCode",getStop],["vehicleCode",getVehicle]]){
 id(input).addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();run();}});
}
// Link compartilhado: #linha=007&parada=1520 abre a linha e a previsão do ponto.
function readShareHash(){
 const h=new URLSearchParams(location.hash.slice(1));
 const linha=normLine(h.get("linha")||""),parada=String(h.get("parada")||"");
 return {linha:/^[A-Z0-9-]{1,12}$/.test(linha)?linha:"",parada:/^\d{1,15}$/.test(parada)?parada:""};
}
async function openShared(link){
 const line=link.linha&&state.lines.find(l=>normLine(l.numero)===link.linha);
 if(line){
  state.pendingStop=link.parada||null;
  id("lineSelect").value=line.id;
  document.getElementById("paradas").scrollIntoView({block:"start"});
  await selectLine();
  return true;
 }
 if(link.parada){
  id("stopCode").value=link.parada;
  document.querySelector(".manual-stop").open=true;
  document.getElementById("paradas").scrollIntoView({block:"start"});
  await getStop();
  return true;
 }
 return false;
}
(async()=>{
 try{
  let lines;
  try{
   lines=await api("/api/lines");
   if(lines.linhas?.length)store("feirabus-lines-cache",{at:Date.now(),linhas:lines.linhas});
  }catch(e){
   const cached=load("feirabus-lines-cache");
   if(!cached?.linhas?.length)throw e;
   lines={linhas:cached.linhas};
   feedback("Sem conexão com o SIU. Usando o catálogo salvo em "+savedLabel(cached.at)+"; horários salvos podem ser consultados.",true);
  }
  state.lines=lines.linhas||[];
  renderLineChoices();
  id("connection").textContent=state.lines.length+" linhas disponíveis";
  if(!id("feedback").classList.contains("error"))
   feedback(state.lines.length?"Selecione uma linha para consultar a tabela SIU.":"O SIU retornou um catálogo vazio.",!state.lines.length);
  let last="";
  try{last=localStorage.getItem("feirabus-passenger-last-line")||"";id("stopCode").value=localStorage.getItem("feirabus-passenger-last-stop")||"";}catch{}
  const shared=readShareHash();
  if(await openShared(shared))return;
  if(last&&state.lines.some(l=>l.id===last)){
   id("lineSelect").value=last;
   await selectLine();
  }
 }catch(e){id("connection").textContent="Sem conexão SIU";feedback("Não foi possível carregar as linhas: "+e.message,true);}
})();
window.addEventListener("hashchange",()=>{const link=readShareHash();if(link.linha||link.parada)void openShared(link);});
if("serviceWorker" in navigator){
 window.addEventListener("load",()=>navigator.serviceWorker.register("/sw.js").catch(()=>{}));
}
})();