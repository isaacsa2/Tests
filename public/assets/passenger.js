"use strict";
(()=>{
const id=name=>document.getElementById(name);
const state={lines:[],schedule:[],variants:[],latestRequest:0,installPrompt:null};
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
 if(!line){id("variantSelect").replaceChildren();showSchedule([]);return;}
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
 if(variants.length)await loadSchedule();else feedback("Nenhum código válido para consultar o horário.",true);
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
async function getStop(){
 const code=id("stopCode").value.trim(),output=id("predictions");
 if(!/^\d{1,15}$/.test(code)){feedback("Informe um código numérico válido de parada.",true);return;}
 output.replaceChildren(make("div","empty","Consultando previsões do SIU…"));
 const b=id("checkStop");b.disabled=true;
 try{
  const d=await api("/api/predictions?stop="+code);
  output.replaceChildren();
  const entries=(d.previsoes||[]).filter(x=>x.linha&&x.linha!=="Sem Dados").slice(0,50);
  if(!entries.length)output.append(make("div","empty","Não há previsão para esta parada no momento."));
  for(const row of entries){
   const item=make("div","result");
   item.append(make("strong",null,"Linha "+row.linha));
   item.append(make("span","eta",row.previsao||"Sem tempo informado"));
   item.append(make("span",null,[row.destino,row.carro?"Carro "+row.carro:null].filter(Boolean).join(" · ")));
   output.append(item);
  }
  try{localStorage.setItem("feirabus-passenger-last-stop",code);}catch{}
  feedback("Previsões da parada "+code+" consultadas no SIU.");
 }catch(e){output.replaceChildren(make("div","empty",e.message));feedback("Falha na previsão: "+e.message,true);}
 finally{b.disabled=false;}
}
function makeFleetLink(link){
 const a=make("a",null,link.label);
 a.href=link.url;a.target="_blank";a.rel="noopener noreferrer";
 return a;
}
async function getVehicle(){
 const code=id("vehicleCode").value.trim(),output=id("vehicleResult");
 if(!/^\d{2,8}$/.test(code)){feedback("Digite um prefixo de 2 a 8 dígitos.",true);return;}
 const fleet=globalThis.FeiraBusFleet.lookup(code),box=make("div","result");
 box.append(make("strong",null,"Prefixo "+code));
 box.append(make("span",null,fleet.empresa?fleet.empresa+" · vínculo histórico confirmado no acervo":"Operadora não confirmada para este prefixo"));
 box.append(make("span",null,fleet.confirmacao||""));
 const links=make("div","fleet-links");
 for(const link of fleet.links)links.append(makeFleetLink(link));
 box.append(links);
 output.replaceChildren(box);
 const button=id("checkVehicle");button.disabled=true;
 try{
  const data=await api("/api/vehicle?number="+encodeURIComponent(code));
  if(data.veiculos?.length){
   const v=data.veiculos[0];
   box.append(make("span",null,"Posição disponível na resposta SIU. Linha: "+(v.linha||"não informada")+". Consulta: "+new Date().toLocaleString("pt-BR")));
   if(Number.isFinite(v.lat)&&Number.isFinite(v.lon)){
    const a=make("a",null,"Ver posição no OpenStreetMap ↗");
    a.href="https://www.openstreetmap.org/?mlat="+encodeURIComponent(v.lat)+"&mlon="+encodeURIComponent(v.lon)+"#map=16/"+encodeURIComponent(v.lat)+"/"+encodeURIComponent(v.lon);
    a.target="_blank";a.rel="noopener noreferrer";
    const linkGroup=make("div","fleet-links");linkGroup.append(a);box.append(linkGroup);
   }
  }else box.append(make("span",null,"Nenhuma posição confirmada agora pelo endpoint direto do SIU."));
 }catch(e){box.append(make("span",null,"SIU indisponível para consulta direta: "+e.message));}
 finally{button.disabled=false;}
 feedback("Consulta do carro "+code+" concluída. O acervo fotográfico não comprova operação atual.");
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
id("variantSelect").addEventListener("change",loadSchedule);
id("daySelect").addEventListener("change",renderSchedule);
id("refreshSchedule").addEventListener("click",loadSchedule);
id("checkStop").addEventListener("click",getStop);
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