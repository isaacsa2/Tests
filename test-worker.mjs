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
 else if(u.includes("/buscarParadasPorLinha/")){d.paradas=[{cod:"315",sent:"Centro",end:"AVENIDA SENHOR DOS PASSOS",siu:"P00315"},{cod:"316",sent:"Centro"}];}
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
