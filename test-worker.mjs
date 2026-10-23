import assert from "node:assert/strict";
import worker from "./src/worker.js";
const cache=new Map();
globalThis.caches={default:{async match(r){return cache.get(r.url)?.clone()??null;},async put(r,v){cache.set(r.url,v.clone());}}};
const requests=[];
let lineMode=0;
globalThis.fetch=async function(url){
 const u=String(url);requests.push(u);
 const q=new URL(u).searchParams;
 assert.match(q.get("callback")||"",/^jQuery[0-9]+_[0-9]+$/);
 assert.ok(/^\d+$/.test(q.get("_")||""));
 let cb=q.get("callback"),d={sucesso:true};
 if(u.includes("/buscarLinhas/")){d.linhas=lineMode===0?['{"cod":"12","sgl":"001","nom":"Centro"},{"cod":"13","sgl":"002","nom":"Tomba"}']:lineMode===1?'{"cod":"12","sgl":"001","nom":"Centro"},{"cod":"13","sgl":"002","nom":"Tomba"}':
  lineMode===2?[]:
  lineMode===3?["{'cod':'12','sgl':'001','nom':'Centro'},{'cod':'13','sgl':'002','nom':'Tomba'}"]:
  ["indecifravel"];}
 else if(u.includes("/buscarParametrosIniciais/")){d.parametrosIniciais=[];}
 else if(u.includes("/V3/retornaQroLinha/")){d.qros=[
  {cod:"1",origem:"Terminal Central",tipoDia:"Dia util",horario:"06:20"},
  {cod:"1",origem:"Terminal Central",tipoDia:"Sabado",horario:"07:10"},
  {cod:"Sem Dados",origem:"",tipoDia:"",horario:""},
  {cod:"1",origem:"Terminal Central",tipoDia:"Dia util",horario:"99:99"}
 ];}
 else if(u.includes("/retornaSublinhasDaLinha/")){d.subLinhas=[{cod:"120",sgl:"001A",nom:"Variante"}];}
 else if(u.includes("/buscarParadasPorLinha/77/")){d.paradas=[{cod:"501",sent:"Bairro",end:"RUA A"},{cod:"502",sent:"Bairro",end:"RUA B"}];}
 else if(u.includes("/buscarParadasPorLinhaComCoordenadas/77/")){d.paradas=[{cod:"501",y:"-12,2610",x:"-38,9600",azimute:"90"},{cod:"502",y:"-23,5",x:"-46,6"}];}
 else if(u.includes("/V3/buscarParadasProximas/")){d.paradas=[{cod:"601",desc:"PRACA DA MATRIZ",siu:"P601",y:"-12,2700",x:"-38,9700",azimute:"180"},{cod:"602",desc:"LONGE",y:"-12,2800",x:"-38,9800"},{cod:"Sem Dados"}];
  d.postosVenda=["{'cod':'PV1','desc':'Banca do Centro','x':'-38,9702','y':'-12,2703','praca':'FSA'},{'cod':'PV2','desc':'Fora','x':-46.6,'y':-23.5}"];}
 else if(u.includes("/retornaLinhasQueAtendemParada/")){d.linhas=[{cod_linha:10,num_linha:"007",descricao:"JARDIM BRASIL",cor:4},{cod_linha:11,num_linha:"07A",descricao:"COND. AZALEIAS"},{cod:"Sem Dados"}];}
 else if(u.includes("/buscarParadasPorItiComCoordenadas/")){d.paradas=[{cod:"701",desc:"INICIO",y:-12.25,x:-38.95},{cod:"702",desc:"FIM",y:-12.26,x:-38.94}];}
 else if(u.includes("/V3/buscarNotificacao/")){d.notificacao=["{'cod':'9','assunto':'Obra na Av. Getúlio','evento':'Linha 007 desviada.\\nPonto 5590 desativado.'},{'cod':'Sem Dados'}"];}
 else if(u.includes("/V3/verificaNotificacaoParada/")){d.notificacaoParada=u.includes("/5590/")?[{cod:"9",assunto:"Ponto desativado",evento:"<b>use</b> o ponto 5554"}]:[""];}
 else if(u.includes("/buscarParadasPorLinha/")){d.paradas=[{cod:"315",sent:"Centro",end:"AVENIDA SENHOR DOS PASSOS",siu:"P00315"},{cod:"316",sent:"Centro"},{cod:"318",sent:"Centro",lat:"-12,2601",long:"-38,9655"},{cod:"317",sent:"Bairro",coordY:-23.5,coordX:-46.6}];}
 else if(u.includes("/buscarParadasPorLinhaComCoordenadas/")){d.paradas=[{cod:"315",sent:"Centro",lat:-12.25,long:-38.96}];}
 else if(u.includes("/buscarPrevisoes/")){d.previsoes=[{codItinerario:"90",sgLin:"001",numVeicGestor:"400",prev:"5 min",apelidoLinha:"Terminal Central"}];}
 else if(u.includes("/retornaVeiculosMapa/")){d.veiculos=[{lat:-12.25,long:-38.95,numVeicGestor:"400",descricao:"001",direcao:45}];}
 else if(u.includes("/retornaVeiculoEmbarcado/")){
  // O protocolo de embarque não serve como índice global de prefixos.
  d.veiculo={lat:-12.25,long:-38.95,numVeicGestor:"400",descricao:"001"};
 }
 else if(u.includes("/buscarItinerario/")){d.itinerarios=[{coordX:-38.95,coordY:-12.25},{coordX:-38.94,coordY:-12.26}];}
 else return new Response("not found",{status:404});
 return new Response(cb+"("+JSON.stringify(d)+");");
};
const env={FSA_SIU_CITY:"null",ASSETS:{fetch:async()=>new Response("OK")}};
const ctx={waitUntil(p){p.catch(()=>{});}};
async function get(path,origin){
 const headers=origin?{Origin:origin}:{};
 const r=await worker.fetch(new Request("https://feiradesantana.isaacsa2-santana.workers.dev"+path,{headers}),env,ctx);
 return [r.status,await r.json()];
}
assert.equal((await get("/api/status"))[0],200);
let [initStatus,initData]=await get("/api/initialize");
assert.equal(initStatus,200);assert.equal(initData.inicializacao,"confirmada");
let [status,data]=await get("/api/lines");assert.equal(status,200);assert.equal(data.linhas[0].numero,"001");assert.equal(data.linhas[1].numero,"002");
let [ds,diagnostic]=await get("/api/diagnostics/lines");
assert.equal(ds,200);assert.equal(diagnostic.diagnostico.linhasValidas,2);
assert.equal(diagnostic.diagnostico.tipoLinhas,"array");
await get("/api/lines");assert.equal(requests.filter(s=>s.includes("/buscarLinhas/")).length,1);
lineMode=1;cache.clear();
[,data]=await get("/api/lines");assert.equal(data.linhas.length,2);
lineMode=2;cache.clear();
[,data]=await get("/api/lines");assert.equal(data.linhas.length,0);
assert.equal(data.diagnostico.elementosBrutos,0);
assert.equal(data.diagnostico.linhasValidas,0);
assert.equal(data.diagnostico.catalogoVazioConfirmado,true);
lineMode=3;cache.clear();
[,data]=await get("/api/lines");assert.equal(data.linhas.length,2);
assert.equal(data.linhas[0].numero,"001");
lineMode=4;cache.clear();
[,data]=await get("/api/lines");assert.equal(data.linhas.length,0);
assert.equal(data.diagnostico.elementosBrutos,1);
assert.equal(data.diagnostico.catalogoVazioConfirmado,false);
lineMode=0;cache.clear();
[,data]=await get("/api/sublines?line=12");assert.equal(data.sublinhas[0].id,"120");
let [scCode,sc]=await get("/api/schedule?line=12");
assert.equal(scCode,200,"/api/schedule deve existir no Worker");
assert.equal(sc.linha,"12");
assert.equal(sc.horarios.length,2);
assert.deepEqual(sc.horarios[0],{origem:"Terminal Central",tipoDia:"Dia util",horario:"06:20"});
assert.equal(sc.pontualidade,"nao-aferida");
assert.ok(requests.some(s=>s.includes("/V3/retornaQroLinha/12/0/null/retornoJSON")));
assert.equal((await get("/api/schedule?line=../../admin"))[0],400);
const [,caps]=await get("/api/status");assert.ok(caps.recursos.includes("schedule"));

[,data]=await get("/api/stops?line=12");assert.equal(data.paradas[0].id,"315");
assert.equal(data.paradas[0].nome,"AVENIDA SENHOR DOS PASSOS");
assert.equal(data.paradas[0].codigoSIU,"P00315");
assert.equal(data.paradas[0].sentido,"Centro");
assert.equal(data.paradas[1].nome,"","Unknown stop names must remain missing");
assert.equal(data.paradas[0].lat,undefined,"Sem coordenada inventada");
assert.equal(data.paradas[2].lat,-12.2601);assert.equal(data.paradas[2].lon,-38.9655);
assert.equal(data.paradas[3].lat,undefined,"Coordenadas fora de Feira de Santana são descartadas");
[,data]=await get("/api/diagnostics/stops?line=12");
assert.equal(data.diagnostico.buscarParadasPorLinha.paradas,4);
assert.equal(data.diagnostico.buscarParadasPorLinhaComCoordenadas.interpretado.lat,-12.25);
assert.equal((await get("/api/diagnostics/stops?line=../x"))[0],400);
[,data]=await get("/api/stops?line=77");
assert.deepEqual([data.paradas[0].lat,data.paradas[0].lon,data.paradas[0].azimute,data.paradas[0].nome],[-12.261,-38.96,90,"RUA A"],"Coordenada da variante ComCoordenadas junta pelo código");
assert.equal(data.paradas[1].lat,undefined,"Coordenada fora da região descartada");
let [nbCode,nb]=await get("/api/stops/nearby?lat=-12.27012345&lon=-38.97009876");
assert.equal(nbCode,200);
assert.ok(requests.some(x=>x.includes("V3/buscarParadasProximas/-38.97/-12.27/0/null/retornoJSONH")),"Posição arredondada antes de ir ao SIU");
assert.deepEqual(nb.paradas.map(x=>[x.id,x.nome,x.codigoSIU]),[["601","PRACA DA MATRIZ","P601"],["602","LONGE",""]]);
assert.ok(nb.paradas[0].distancia<nb.paradas[1].distancia);
assert.equal((await get("/api/stops/nearby?lat=-23.5&lon=-46.6"))[0],400,"Fora da região não consulta o SIU");
assert.deepEqual(nb.postosVenda.map(x=>[x.id,x.nome]),[["PV1","Banca do Centro"]],"Pontos de venda da mesma resposta, só dentro da região");
assert.ok(nb.postosVenda[0].distancia<100);
[,data]=await get("/api/stops/lines?stop=5590");
assert.deepEqual(data.linhas,[{id:"10",numero:"007",nome:"JARDIM BRASIL"},{id:"11",numero:"07A",nome:"COND. AZALEIAS"}]);
assert.ok(requests.some(x=>x.includes("/retornaLinhasQueAtendemParada/5590/0/retornoJSON")));
assert.equal((await get("/api/stops/lines?stop=../x"))[0],400);
assert.equal((await get("/api/stops/nearby?lat=abc&lon=1"))[0],400);
[,data]=await get("/api/route-stops?itinerary=732");
assert.deepEqual(data.paradas.map(x=>[x.id,x.lat]),[["701",-12.25],["702",-12.26]]);
[,data]=await get("/api/notices");
assert.deepEqual(data.avisos,[{id:"9",assunto:"Obra na Av. Getúlio",texto:"Linha 007 desviada.\nPonto 5590 desativado."}]);
[,data]=await get("/api/notices/stop?stop=5590");
assert.equal(data.avisos[0].texto,"<b>use</b> o ponto 5554","Texto bruto: quem exibe é que trata como texto");
[,data]=await get("/api/notices/stop?stop=1");assert.deepEqual(data.avisos,[]);
[,data]=await get("/api/diagnostics/siu?kind=nearby&lat=-12.27&lon=-38.97");
assert.equal(data.itens,3);assert.equal(data.primeiroItem.cod,"601");
assert.equal((await get("/api/diagnostics/siu?kind=emiteAlarmePanico"))[0],400,"Diagnóstico só aceita consultas de leitura listadas");
[,data]=await get("/api/stops?line=12");
assert.ok(requests.some(x=>x.includes("V3/buscarParadasPorLinha/12/0/null/retornoJSON")));
[,data]=await get("/api/predictions?stop=315");assert.equal(data.previsoes[0].itinerario,"90");assert.equal(data.previsoes[0].previsao,"5 min");
[,data]=await get("/api/vehicles?itinerary=90");assert.equal(data.veiculos[0].id,"400");
assert.match(data.veiculos[0].consultadoEm,/^20\d\d-/);
const lastOriginCall=requests.filter(x=>x.includes("/retornaVeiculosMapa/")).length;
const siuStamp=data.veiculos[0].consultadoEm;
[,data]=await get("/api/vehicles?itinerary=90");
assert.equal(data.veiculos[0].consultadoEm,siuStamp,"Cached GPS must retain the upstream fetch timestamp");
assert.equal(requests.filter(x=>x.includes("/retornaVeiculosMapa/")).length,lastOriginCall);
[,data]=await get("/api/vehicle?number=400");assert.equal(data.veiculos[0].id,"400");
[,data]=await get("/api/vehicle?number=33009");
assert.equal(data.veiculos.length,0,"Não inventar coordenadas quando o SIU devolve outro prefixo");
assert.equal(data.origem,"nao_localizado");
const mockDb={
 prepare(sql){return {
  sql,args:[],bind(...x){this.args=x;return this;},
  async first(){
   if(sql.includes("sqlite_master"))return {name:"fb_lines"};
   if(sql.includes("FROM fb_vehicles"))return null;
   throw Error("Unexpected SQL: "+sql);
  },
  async all(){
   if(sql.includes("SELECT id FROM fb_routes"))return {results:[{id:"90"},{id:"91"}]};
   throw Error("Unexpected SQL: "+sql);
  },
  async run(){return {success:true};}
 };},
 async batch(statements){return Promise.all(statements.map(x=>x.run()));}
};
async function dbGet(path){
 const response=await worker.fetch(new Request("https://tests.isaacsa2-santana.workers.dev"+path),
   {...env,FEIRABUS_DB:mockDb},ctx);
 return [response.status,await response.json()];
}
let [finderStatus,finderData]=await dbGet("/api/vehicle/search?number=400&cursor=0");
assert.equal(finderStatus,200);
assert.equal(finderData.veiculos[0].id,"400");
assert.equal(finderData.origem,"siu_itinerario");
assert.equal(finderData.totalItinerarios,2);
[finderStatus,finderData]=await dbGet("/api/vehicle/search?number=33009&cursor=0");
assert.equal(finderStatus,200);
assert.equal(finderData.veiculos.length,0);
assert.equal(finderData.concluido,true);
assert.equal(finderData.totalItinerarios,2);
assert.equal((await dbGet("/api/vehicle/search?number=../../admin&cursor=0"))[0],400);
assert.equal((await dbGet("/api/vehicle/search?number=33009&cursor=9999"))[0],400);

[,data]=await get("/api/geometry?itinerary=90");assert.equal(data.geometry.coordinates.length,2);
assert.equal((await get("/api/vehicle?number=../../admin"))[0],400);
assert.equal((await get("/api/lines","https://site-externo.invalid"))[0],403);
assert.equal((await get("/api/unknown"))[0],404);
const page=await worker.fetch(new Request("https://exemplo.invalid/"),env,ctx);assert.equal(await page.text(),"OK");
console.log("OK: testes com callback dinâmico JSONP, init, linhas fragmentadas, GPS, cache e rotas.");

// Velocidade com limite: 20 previsões ao mesmo tempo nunca passam de 8 consultas simultâneas ao SIU
// e terminam bem antes da fila antiga (20 × 1,3 s = 26 s).
{
 let active=0,peak=0;
 const plain=globalThis.fetch;
 globalThis.fetch=async url=>{
  active++;peak=Math.max(peak,active);
  await new Promise(r=>setTimeout(r,500)); // SIU real: ~1 s por consulta
  active--;
  const cb=new URL(String(url)).searchParams.get("callback");
  return new Response(cb+"("+JSON.stringify({sucesso:true,previsoes:[]})+");");
 };
 cache.clear();
 const t0=Date.now();
 const codes=await Promise.all(Array.from({length:20},(_,i)=>get("/api/predictions?stop="+(9000+i)).then(r=>r[0])));
 const took=Date.now()-t0;
 globalThis.fetch=plain;
 assert.ok(codes.every(c=>c===200));
 assert.ok(peak<=8,"no máximo 8 consultas simultâneas ao SIU (pico "+peak+")");
 assert.ok(peak>=4,"consultas devem andar em paralelo (pico "+peak+")");
 assert.ok(took<3000,"20 previsões em menos de 3 s (levou "+took+" ms)");
 console.log("OK: 20 previsões em "+took+" ms, pico de "+peak+" consultas simultâneas ao SIU.");
}
