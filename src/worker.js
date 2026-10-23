// FeiraBus: gateway fixo do SIU. Respostas do servidor real ainda precisam ser validadas.
const BASE = "http://fsa.siumobile.com.br:6060/siumobile-ws-v01/rest/ws/";
const BOUNDS = {minLat:-13.2,maxLat:-11.7,minLon:-39.8,maxLon:-38.3};
const inflight = new Map();
let lastCall = 0;
const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const bad = (message,status=400) => Object.assign(new Error(message),{status});
function ident(v) {
  v=String(v??"").trim();
  if(!/^[A-Za-z0-9_-]{1,32}$/.test(v)) throw bad("Identificador invalido");
  return v;
}
function array(v) {
  if(Array.isArray(v)) return v;
  if(typeof v==="string") try{const x=JSON.parse(v);return Array.isArray(x)?x:[]}catch{}
  return [];
}
function value(v){return Number(String(v??"").replace(",","."));}
function local(lat,lon){return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=BOUNDS.minLat&&lat<=BOUNDS.maxLat&&lon>=BOUNDS.minLon&&lon<=BOUNDS.maxLon;}
function success(d){return d?.sucesso===true||d?.sucesso==="true"||d?.sucesso===1;}
function decode(s,cb){
  s=s.trim().replace(/^\uFEFF/,"");
  if(s.startsWith("{")||s.startsWith("[")) return JSON.parse(s);
  const m=s.match(/^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*;?\s*$/);
  if(!m||m[1]!==cb)throw bad("Resposta do SIU em formato inesperado",502);
  return JSON.parse(m[2]);
}
async function upstream(route,callback,ttl,ctx){
  const key="https://cache.feirabus.invalid/"+encodeURIComponent(route);
  const req=new Request(key), cached=await caches.default.match(req);
  if(cached)return cached.json();
  if(inflight.has(route))return inflight.get(route);
  const promise=(async()=>{
    const wait=Math.max(0,1300-(Date.now()-lastCall));
    if(wait)await new Promise(r=>setTimeout(r,wait));
    lastCall=Date.now();
    let response;
    try {response=await fetch(BASE+route,{method:"GET",signal:AbortSignal.timeout(12000),headers:{Accept:"application/json, text/javascript, application/javascript, */*"}});}
    catch {throw bad("SIU inacessivel por HTTP/6060; conectividade real nao confirmada",502);}
    if(!response.ok)throw bad("SIU retornou HTTP "+response.status,502);
    if(Number(response.headers.get("content-length")||0)>2000000)throw bad("Resposta muito grande",502);
    const raw=await response.text();
    if(raw.length>2000000)throw bad("Resposta muito grande",502);
    const result=decode(raw,callback);
    ctx.waitUntil(caches.default.put(req,new Response(JSON.stringify(result),{headers:{"Cache-Control":"public, max-age="+ttl,"Content-Type":"application/json"}})));
    return result;
  })();
  inflight.set(route,promise);
  try{return await promise;}finally{inflight.delete(route);}
}
function vehicle(x,route,idOverride){
  const lat=value(x?.lat),lon=value(x?.long??x?.lon);
  if(!local(lat,lon))return null;
  const dir=value(x?.direcao);
  return {id:String(x?.numVeicGestor??idOverride??"").slice(0,35),linha:String(x?.descricao??x?.sgLin??"").slice(0,70),lat,lon,rumo:Number.isFinite(dir)?dir:null,itinerario:route??null,consultadoEm:new Date().toISOString()};
}
async function action(url,env,ctx){
  const p=url.pathname,city=ident(env.FSA_SIU_CITY??"null"),q=url.searchParams;
  if(p==="/api/status")return {projeto:"FeiraBus",gateway:"configurado",siuOnline:"nao verificado",frotaIntegralGarantida:false};
  if(p==="/api/lines"){
    const d=await upstream("buscarLinhas/retornoJSONListaLinhas","retornoJSONListaLinhas",3600,ctx);
    if(!success(d))throw bad("SIU nao confirmou lista de linhas",502);
    return {linhas:array(d.linhas).filter(x=>x?.cod!=null).slice(0,600).map(x=>({id:String(x.cod),numero:String(x.sgl??""),nome:String(x.nom??"")}))};
  }
  if(p==="/api/sublines"){
    const n=ident(q.get("line")),d=await upstream("V3/retornaSublinhasDaLinha/"+n+"/0/"+city+"/retornoSublinhasJSON","retornoSublinhasJSON",21600,ctx);
    return {sublinhas:success(d)?array(d.subLinhas).filter(x=>x?.cod!=null).map(x=>({id:String(x.cod),numero:String(x.sgl??""),nome:String(x.nom??"")})):[]};
  }
  if(p==="/api/stops"){
    const n=ident(q.get("line"));let d;
    try{d=await upstream("buscarParadasPorLinha/"+n+"/0/retornoJSON","retornoJSON",21600,ctx);}catch{}
    if(!success(d)||!array(d.paradas).length)
      d=await upstream("V3/buscarParadasPorLinhaComCoordenadas/"+n+"/0/"+city+"/retornoJSONH","retornoJSONH",21600,ctx);
    return {paradas:success(d)?array(d.paradas).filter(x=>x?.cod!=null).map(x=>({id:String(x.cod),sentido:String(x.sent??x.sentido??"")})):[]};
  }
  if(p==="/api/predictions"){
    const n=ident(q.get("stop")),d=await upstream("V3/buscarPrevisoes/"+n+"/false/0/"+city+"/retornoJSON","retornoJSON",180,ctx);
    return {previsoes:success(d)?array(d.previsoes).map(x=>({itinerario:x?.codItinerario==null?null:String(x.codItinerario),linha:String(x?.sgLin??""),carro:String(x?.numVeicGestor??"")})):[]};
  }
  if(p==="/api/vehicles"){
    const n=ident(q.get("itinerary")),d=await upstream("V3/retornaVeiculosMapa/"+n+"/0/"+city+"/retornoJSONVeiculos","retornoJSONVeiculos",45,ctx);
    return {veiculos:success(d)?array(d.veiculos).map(x=>vehicle(x,n)).filter(x=>x?.id):[],itinerario:n};
  }
  if(p==="/api/vehicle"){
    const n=ident(q.get("number")),d=await upstream("retornaVeiculoEmbarcado/"+n+"/retornoJSONVeiculos","retornoJSONVeiculos",60,ctx);
    const raw=array(d.veiculos);
    if(!raw.length&&d.veiculo&&typeof d.veiculo==="object")raw.push(d.veiculo);
    return {veiculos:success(d)?raw.map(x=>vehicle(x,null,n)).filter(x=>x?.id===n):[],numeroConsultado:n};
  }
  if(p==="/api/geometry"){
    const n=ident(q.get("itinerary")),d=await upstream("V3/buscarItinerario/"+n+"/0/"+city+"/retornoJSONItinerario","retornoJSONItinerario",86400,ctx);
    const points=success(d)?array(d.itinerarios).slice(0,20000).map(x=>[value(x?.coordX),value(x?.coordY)]).filter(a=>local(a[1],a[0])):[];
    return {itinerario:n,geometry:{type:"LineString",coordinates:points}};
  }
  throw bad("Recurso nao encontrado",404);
}
export default {async fetch(request,env,ctx){
  const url=new URL(request.url);
  if(!url.pathname.startsWith("/api/"))return env.ASSETS.fetch(request);
  if(request.method!=="GET")return json({erro:"Somente GET"},405);
  const origin=request.headers.get("Origin");
  if(origin&&origin!==url.origin)return json({erro:"Origem proibida"},403);
  try{return json(await action(url,env,ctx));}
  catch(e){return json({erro:String(e?.message??"Erro inesperado").slice(0,220)},e?.status??502);}
}};
