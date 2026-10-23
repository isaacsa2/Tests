import assert from "node:assert/strict";
import worker from "./src/worker.js";
const cache=new Map();
globalThis.caches={default:{async match(r){return cache.get(r.url)?.clone()??null;},async put(r,v){cache.set(r.url,v.clone());}}};
const requests=[];
globalThis.fetch=async function(url){
 const u=String(url);requests.push(u);
 const q=new URL(u).searchParams;
 assert.match(q.get("callback")||"",/^jQuery[0-9]+_[0-9]+$/);
 assert.ok(/^\d+$/.test(q.get("_")||""));
 let cb=q.get("callback"),d={sucesso:true};
 if(u.includes("/buscarLinhas/")){d.linhas='{"cod":"12","sgl":"001","nom":"Centro"},{"cod":"13","sgl":"002","nom":"Tomba"}';}
 else if(u.includes("/buscarParametrosIniciais/")){d.parametrosIniciais=[];}
 else if(u.includes("/retornaSublinhasDaLinha/")){d.subLinhas=[{cod:"120",sgl:"001A",nom:"Variante"}];}
 else if(u.includes("/buscarParadasPorLinha/")){d.paradas=[{cod:"315",sent:"Centro"}];}
 else if(u.includes("/buscarPrevisoes/")){d.previsoes=[{codItinerario:"90",sgLin:"001",numVeicGestor:"400"}];}
 else if(u.includes("/retornaVeiculosMapa/")){d.veiculos=[{lat:-12.25,long:-38.95,numVeicGestor:"400",descricao:"001",direcao:45}];}
 else if(u.includes("/retornaVeiculoEmbarcado/")){d.veiculo={lat:-12.25,long:-38.95,descricao:"001"};}
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
await get("/api/lines");assert.equal(requests.filter(s=>s.includes("/buscarLinhas/")).length,1);
[,data]=await get("/api/sublines?line=12");assert.equal(data.sublinhas[0].id,"120");
[,data]=await get("/api/stops?line=12");assert.equal(data.paradas[0].id,"315");
assert.ok(requests.some(x=>x.includes("V3/buscarParadasPorLinha/12/0/null/retornoJSON")));
[,data]=await get("/api/predictions?stop=315");assert.equal(data.previsoes[0].itinerario,"90");
[,data]=await get("/api/vehicles?itinerary=90");assert.equal(data.veiculos[0].id,"400");
[,data]=await get("/api/vehicle?number=400");assert.equal(data.veiculos[0].id,"400");
[,data]=await get("/api/geometry?itinerary=90");assert.equal(data.geometry.coordinates.length,2);
assert.equal((await get("/api/vehicle?number=../../admin"))[0],400);
assert.equal((await get("/api/lines","https://site-externo.invalid"))[0],403);
assert.equal((await get("/api/unknown"))[0],404);
const page=await worker.fetch(new Request("https://exemplo.invalid/"),env,ctx);assert.equal(await page.text(),"OK");
console.log("OK: testes com callback dinâmico JSONP, init, linhas fragmentadas, GPS, cache e rotas.");
