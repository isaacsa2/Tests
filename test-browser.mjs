// Teste de navegador (Playwright): app do passageiro e CCO com API simulada a
// partir de respostas reais do SIU (tests/fixtures). Não acessa o SIU.
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import {createRequire} from "node:module";

async function loadPlaywright(){
 try{return await import("playwright");}
 catch{return createRequire(path.join(process.execPath,"../../lib/node_modules/"))("playwright");}
}
const {chromium}=await loadPlaywright();
const PUB=path.resolve("public"),FIX=path.resolve("tests/fixtures");
const fixture=name=>JSON.parse(fs.readFileSync(path.join(FIX,name),"utf8"));
const lines=fixture("lines.json"),stops=fixture("stops-10.json"),schedule=fixture("schedule-10.json"),geometry=fixture("geometry-732.json");
const mid=geometry.geometry.coordinates[Math.floor(geometry.geometry.coordinates.length/2)];
const iso=ago=>new Date(Date.now()-ago).toISOString();
const MIN=60000;
const nearbyRequests=[];

function api(u){
 const q=u.searchParams,p=u.pathname;
 if(p==="/api/lines")return lines;
 if(p==="/api/sublines")return {sublinhas:[]};
 // Como no SIU real: a lista da linha vem sem coordenadas; as paradas dos itinerários trazem.
 if(p==="/api/stops")return q.get("line")==="10"?stops:{paradas:[]};
 if(p==="/api/stops/lines")return {parada:q.get("stop"),linhas:[{id:"10",numero:"007",nome:"JARDIM BRASIL"},{id:"5",numero:"001",nome:"TOMBA"}]};
 if(p==="/api/stops/nearby"){
  nearbyRequests.push(u.search);
  return {paradas:[{id:"5590",nome:"Av. Jardim Brasil (SAIDA)",codigoSIU:"",sentido:"",lat:-12.2702,lon:-38.9701,distancia:40},{id:"341",nome:"Estr. Velha de Jaiba",codigoSIU:"",sentido:"",lat:-12.272,lon:-38.97,distancia:230}],
   postosVenda:[{id:"PV1",nome:"Banca do Centro",lat:-12.2703,lon:-38.9702,distancia:60}]};
 }
 if(p==="/api/route-stops")return {itinerario:q.get("itinerary"),paradas:stops.paradas.map((x,i)=>({id:x.id,nome:x.nome,lat:-12.27+i*.0005,lon:-38.97}))};
 if(p==="/api/notices")return {avisos:[{id:"9",assunto:"Obra na Av. Getúlio Vargas",texto:"Linha 007 desviada.\n<img src=x onerror=\"window.__xss=1\">"}]};
 if(p==="/api/notices/stop")return {avisos:q.get("stop")==="5590"?[{id:"10",assunto:"Ponto com obra",texto:"Embarque 20 m adiante."}]:[]};
 if(p==="/api/schedule")return q.get("line")==="10"?schedule:{linha:q.get("line"),horarios:[]};
 if(p==="/api/predictions")return {previsoes:[
  {itinerario:"732",linha:"007",carro:"33011",previsao:"5 min",destino:"JARDIM BRASIL",acessibilidade:"1"},
  {itinerario:"999",linha:"07A",carro:"",previsao:"SAÍDA: 12:00",destino:"COND. AZALEIAS",acessibilidade:"0"}]};
 if(p==="/api/vehicles")return q.get("itinerary")==="732"?{itinerario:"732",veiculos:[
  {id:"33011",linha:"007",lat:mid[1],lon:mid[0],rumo:10,itinerario:"732",consultadoEm:iso(20000)},
  {id:"OLD1",linha:"007",lat:mid[1]+.012,lon:mid[0]+.015,rumo:10,itinerario:"732",consultadoEm:iso(40*MIN)}]}:{veiculos:[]};
 if(p==="/api/geometry")return q.get("itinerary")==="732"?geometry:{itinerario:q.get("itinerary"),geometry:{type:"LineString",coordinates:[]}};
 if(p==="/api/vehicle")return q.get("number")==="55555"?
  {veiculos:[{id:"55555",linha:"040",lat:-12.25,lon:-38.96,itinerario:"105",consultadoEm:iso(2*60*MIN),origem:"d1",historico:true}],historico:true}:
  {veiculos:[],origem:"nao_localizado"};
 if(p==="/api/memory/status")return {configured:true,initialized:true,lines:131,routes:1,vehicles:2,schedules:1};
 if(p==="/api/memory/snapshot")return {linhas:lines.linhas,itinerarios:["732"],veiculos:[
  {id:"33011",linha:"007",lat:mid[1],lon:mid[0],rumo:10,itinerario:"732",lastSeen:Date.now()-2*60*MIN,origem:"d1"},
  {id:"12019",linha:"040",lat:-12.254,lon:-38.9716,rumo:7,itinerario:"105",lastSeen:Date.now()-3*60*MIN,origem:"d1"}]};
 if(p==="/api/memory/vehicle-lines")return {janelaDias:7,veiculos:[
  {id:"33011",linhas:[{linha:"007",primeiraVez:Date.now()-5*60*MIN,ultimaVez:Date.now()-10*MIN},{linha:"07A",primeiraVez:Date.now()-26*60*MIN,ultimaVez:Date.now()-20*60*MIN}]}]};
 return null;
}
const mime={".html":"text/html",".css":"text/css",".js":"text/javascript",".svg":"image/svg+xml",".png":"image/png",".webmanifest":"application/json",".ico":"image/x-icon"};
const server=http.createServer((req,res)=>{
 const u=new URL(req.url,"http://local");
 if(u.pathname.startsWith("/api/")){
  const body=api(u);
  res.statusCode=body?200:404;res.setHeader("Content-Type","application/json");
  res.end(JSON.stringify(body??{erro:"Recurso nao encontrado"}));return;
 }
 const file=path.join(PUB,u.pathname==="/"?"index.html":u.pathname);
 if(!file.startsWith(PUB)||!fs.existsSync(file)||fs.statSync(file).isDirectory()){res.statusCode=404;res.end();return;}
 res.setHeader("Content-Type",mime[path.extname(file)]||"application/octet-stream");res.end(fs.readFileSync(file));
});
await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
const base="http://127.0.0.1:"+server.address().port;
const local="/opt/pw-browsers/chromium";
const browser=await chromium.launch(process.env.CI||!fs.existsSync(local)?{}:{executablePath:local});
const errors=[];
async function page(viewport,colorScheme="dark",ctx){
 const context=ctx||await browser.newContext({viewport,deviceScaleFactor:1,colorScheme,serviceWorkers:"block"});
 const p=await context.newPage();
 p.on("pageerror",e=>errors.push(e.message));
 // Sem tiles nem fontes externas: deixa o teste rápido e independente desses serviços.
 await context.route(/tile\.openstreetmap\.org|fonts\.(googleapis|gstatic)\.com/,r=>r.abort());
 return p;
}
const noOverflow=p=>p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
const step=name=>console.log("  · "+name);
try{
 console.log("Passageiro (celular)");
 const phone={width:390,height:844};
 const ctx=await browser.newContext({viewport:phone,colorScheme:"dark",serviceWorkers:"block",
  permissions:["geolocation"],geolocation:{latitude:-12.27012345,longitude:-38.97009876}});
 let p=await page(null,null,ctx);
 await p.goto(base+"/passageiro.html");
 await p.waitForSelector("#avisos:not([hidden]) .notice-item");
 const notice=await p.locator("#noticeList .notice-item").first().innerText();
 assert.match(notice,/Obra na Av\. Getúlio Vargas[\s\S]*Novo[\s\S]*<img src=x/,"aviso oficial visível, marcado como novo e como texto");
 assert.equal(await p.locator("#noticeList img").count(),0,"aviso do SIU nunca vira HTML");
 assert.equal(await p.evaluate(()=>window.__xss),undefined);
 step("avisos oficiais como texto puro");
 await p.click("#nearbyStops");
 await p.waitForSelector("#nearbyList .fav");
 assert.equal(nearbyRequests.at(-1),"?lat=-12.27&lon=-38.97","posição sai do aparelho arredondada");
 assert.match(await p.locator("#nearbyList .fav").first().innerText(),/Av\. Jardim Brasil[\s\S]*cerca de 40 m/);
 await p.click("#nearbyList .fav button:has-text('Previsão')");
 await p.waitForSelector("#nearbyList .notice-box");
 assert.match(await p.locator("#nearbyList .notice-box").innerText(),/AVISO DA OPERADORA[\s\S]*Ponto com obra/);
 assert.match(await p.locator("#nearbyList .sale-points").innerText(),/PONTOS DE VENDA[\s\S]*Banca do Centro[\s\S]*cerca de 60 m/);
 await p.waitForSelector("#nearbyList .stop-lines .line-chip");
 assert.deepEqual(await p.locator("#nearbyList .line-chip").allInnerTexts(),["007","001"]);
 step("pontos de venda e linhas do ponto");
 await p.click("#nearbyList .fav >> nth=0 >> button:has-text('🔔')");
 await p.click("#nearbyList .alarm-form button:has-text('5 min')");
 await p.waitForFunction(()=>/🔔 .*chegando em Av\. Jardim Brasil.*5 min/.test(document.getElementById("feedback").textContent),null,{timeout:15000});
 await p.waitForSelector("#alarmList",{state:"hidden",timeout:5000}); // alarme disparado sai da lista
 await p.click("#nearbyList .fav >> nth=1 >> button:has-text('🔔')");
 await p.click("#nearbyList .alarm-form button:has-text('3 min')");
 // A primeira conferência é assíncrona: espera o texto "agora: 5 min" aparecer.
 await p.waitForFunction(()=>/avisa a 3 min[\s\S]*agora: 5 min/.test(document.getElementById("alarmList").innerText),null,{timeout:10000});
 assert.match(await p.locator("#alarmList").innerText(),/ALARMES ATIVOS/,"5 min > 3 min: continua aguardando");
 await p.click("#alarmList .alarm button");
 await p.waitForSelector("#alarmList",{state:"hidden",timeout:5000});
 step("alarme toca na hora certa e espera quando ainda falta");
 await p.click("#nearbyList .line-chip:has-text('007')");
 await p.waitForSelector(".origin-tab");
 assert.equal(await p.inputValue("#lineSelect"),"10","tocar na linha do ponto abre a linha");
 step("linha do ponto abre em Paradas");
 step("paradas perto de mim com aviso do ponto");
 assert.equal(await p.locator(".origin-tab").count(),2);
 assert.match(await p.locator(".stop-name").first().innerText(),/Av\. Jardim Brasil/);
 step("origens e nomes das paradas");
 await p.click(".stop-row >> nth=0");
 await p.waitForSelector(".stop-panel .stop-tools");
 const first=p.locator(".stop-panel .result").first();
 assert.match(await first.innerText(),/Esta linha/);
 await p.waitForSelector(".stop-panel .notice-box");
 await p.waitForSelector("#nearestStop:not([hidden])",{timeout:20000});
 assert.ok(await p.isVisible("#nearestStop"),"coordenadas vindas dos itinerários ligam 'Mais perto' nesta linha");
 assert.match(await first.innerText(),/♿ Acessível \(SIU\)/,"tpAcess=1 mostra selo");
 assert.doesNotMatch(await p.locator(".stop-panel .result").nth(1).innerText(),/♿/,"tpAcess=0 não afirma nada");
 assert.equal(await p.evaluate(()=>location.hash),"#linha=007&parada=5590");
 step("previsão, acessibilidade e link no endereço");
 await p.click(".stop-tools button:has-text('Salvar')");
 await p.fill(".fav-name","Casa");
 await p.click(".stop-tools button:has-text('Confirmar')");
 await p.reload();
 await p.waitForSelector(".fav");
 assert.match(await p.locator(".fav-head").innerText(),/Casa[\s\S]*Linha 007 · Ponto 5590/);
 await p.click(".fav button:has-text('Previsão')");
 await p.waitForSelector(".fav-out .result");
 step("Meus pontos sobrevive ao recarregar e consulta em um toque");
 await p.waitForSelector('.stop-row[aria-expanded="true"]');
 await p.click("#sync15Stops");
 await p.waitForFunction(()=>/sincronizada/.test(document.getElementById("stopBatchStatus").textContent),null,{timeout:60000});
 assert.match(await p.textContent("#stopBatchStatus"),/24 pontos · 24 com previsão da linha 007 · carros a caminho: 33011/);
 assert.match(await p.locator(".stop-preview").first().innerText(),/Linha 007: 5 min · carro 33011/);
 step("sincroniza a linha toda");
 await p.click("#loadMap");
 await p.waitForFunction(()=>/visto/.test(document.getElementById("mapMeta").textContent),null,{timeout:60000});
 assert.match(await p.textContent("#mapMeta"),/^1 ônibus visto/,"carro com consulta de 40 min some do app");
 assert.ok(await p.locator("#lineMap path.leaflet-interactive").count()>=2,"trajeto e ônibus desenhados");
 step("mapa da linha esconde ônibus com mais de 30 min");
 await p.fill("#vehicleCode","55555");await p.click("#checkVehicle");
 await p.waitForFunction(()=>/SEM POSIÇÃO RECENTE/.test(document.getElementById("vehicleResult").textContent));
 assert.equal(await p.locator("#vehicleResult a:has-text('OpenStreetMap')").count(),0);
 step("frota não mostra posição antiga");
 assert.ok(await noOverflow(p),"sem rolagem lateral no celular");
 await p.click("#themeToggle");
 assert.equal(await p.evaluate(()=>getComputedStyle(document.body).backgroundColor),"rgb(243, 239, 230)");
 const shared=await page(null,null,ctx);
 await shared.goto(base+"/passageiro.html#linha=007&parada=5554");
 await shared.waitForSelector('.stop-row[aria-expanded="true"][data-stop-id="5554"]');
 assert.equal(await shared.evaluate(()=>document.documentElement.dataset.theme),"light","tema salvo");
 step("link compartilhado abre o ponto; tema claro persiste");
 await shared.route("**/api/**",r=>r.abort());
 await shared.reload();
 await shared.waitForFunction(()=>document.querySelectorAll("#lineSelect option").length>2);
 await shared.selectOption("#lineSelect","10");
 await shared.waitForFunction(()=>!document.getElementById("scheduleSource").hidden);
 assert.match(await shared.textContent("#scheduleSource"),/^Salvo em /);
 assert.ok(await shared.locator(".time-item").count()>10);
 step("horários e catálogo sem internet");

 console.log("CCO (celular)");
 const m=await page(phone);
 await m.goto(base+"/");
 await m.waitForFunction(()=>/carros/.test(document.getElementById("d1State").textContent));
 assert.equal(await m.evaluate(()=>document.body.dataset.view),"mapa");
 assert.ok(await m.evaluate(()=>document.getElementById("map").getBoundingClientRect().height)>300);
 assert.equal(await m.evaluate(()=>document.documentElement.scrollHeight),844,"aba Mapa cabe na tela");
 await m.click('.rail-link[data-view="frota"]');
 assert.ok(await m.locator("#vehicleList .busItem:has-text('CARRO 12019')").count(),"CCO mantém carro antigo");
 // Teclado do celular abre e fecha enquanto o mapa está oculto: o Leaflet passa a medir 0×0.
 await m.fill("#lineWatch","7");
 await m.setViewportSize({width:390,height:500});await m.waitForTimeout(150);
 await m.setViewportSize(phone);await m.waitForTimeout(150);
 await m.click("#lineWatchGo");
 await m.waitForFunction(()=>!document.getElementById("lineWatchGo").disabled,null,{timeout:120000});
 assert.equal(await m.inputValue("#lineWatch"),"007");
 assert.equal(await m.evaluate(()=>document.body.dataset.view),"mapa");
 // Trajeto chega por consulta espaçada (1,6 s): espera o desenho em vez de um tempo fixo.
 await m.waitForFunction(()=>document.querySelectorAll("#map path.leaflet-interactive").length>=3,null,{timeout:20000});
 await m.waitForFunction(()=>document.querySelectorAll("#map img.leaflet-tile").length>0,null,{timeout:10000});
 const zoom=await m.evaluate(()=>{
  const src=[...document.querySelectorAll("#map img.leaflet-tile")].map(i=>i.src).pop()||"";
  return Number((src.match(/\/(\d+)\/\d+\/\d+\.png/)||[])[1]);
 });
 const drawn=await m.evaluate(()=>document.querySelectorAll("#map path.leaflet-interactive").length);
 assert.ok(drawn>=3,"trajeto da linha e os dois ônibus no mapa");
 assert.ok(zoom>=11,"regressão: mapa oculto enquadrava no zoom mundial (zoom "+zoom+")");
 step("GPS por linha, trajeto e enquadramento no celular");
 await m.click('.rail-link[data-view="historico"]');
 await m.waitForSelector(".history-row");
 assert.match(await m.locator(".history-row").first().innerText(),/CARRO 33011[\s\S]*007[\s\S]*07A/);
 assert.ok(await noOverflow(m));
 step("histórico de linhas por carro");

 console.log("CCO (PC)");
 const d=await page({width:1440,height:900});
 await d.goto(base+"/");
 await d.waitForFunction(()=>/carros/.test(document.getElementById("d1State").textContent));
 assert.ok(await d.isVisible("#eventos")&&await d.isVisible("#historico")&&await d.isVisible(".kpis"),"PC mostra tudo de uma vez");
 assert.ok(await noOverflow(d));
 await d.click("#themeToggle");
 assert.equal(await d.evaluate(()=>document.getElementById("mapTheme").value),"streets");
 step("layout de PC e tema claro");
 assert.deepEqual(errors,[],"erros de JavaScript na página");
 console.log("OK: navegador - passageiro, CCO celular/PC, favoritos, mapa, offline, tema e histórico.");
}finally{
 await browser.close();server.close();
}
