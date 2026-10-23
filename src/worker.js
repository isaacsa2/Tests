import {HAS_DB,saveLines,saveRoutes,saveVehicles,saveSchedule,readSchedule,getMemory,dbStatus} from "./d1-memory.js";
// FeiraBus: gateway fixo do SIU. Respostas do servidor real ainda precisam ser validadas.
const BASE = "http://fsa.siumobile.com.br:6060/siumobile-ws-v01/rest/ws/";
const BOUNDS = {minLat:-13.2,maxLat:-11.7,minLon:-39.8,maxLon:-38.3};
const inflight = new Map();
let jsonpCounter = 0;
const TIMEOUT_MS = 45000; // SIU Mobile executaJson() usa 45 segundos.
let lastCall = 0;
const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"}});
const bad = (message,status=400) => Object.assign(new Error(message),{status});
function remember(env,ctx,work){
 if(!HAS_DB(env))return;
 // Se a D1 falhar, não pode interromper o rastreamento do SIU.
 ctx.waitUntil(Promise.resolve().then(()=>work(env.FEIRABUS_DB)).catch(e=>{
   console.warn("FeiraBus D1: falha de persistência:",String(e?.message??e).slice(0,150));
 }));
}

function ident(v) {
  v=String(v??"").trim();
  if(!/^[A-Za-z0-9_-]{1,32}$/.test(v)) throw bad("Identificador invalido");
  return v;
}
// Parses a limited Python-style literal dialect used by older SIU replies.
// Values are parsed as data, never executed: no eval/Function allowed.
function siuLegacyParse(raw){
  if(raw.length>500000)return undefined;
  let quote=null,buffer="",out="";
  for(let i=0;i<raw.length;i++){
    const ch=raw[i];
    if(quote){
      if(ch==="\\"){
        if(i+1>=raw.length)return undefined;
        const next=raw[++i];
        buffer += ({n:"\n",r:"\r",t:"\t",b:"\b",f:"\f"}[next]??next);
      }else if(ch===quote){
        out+=JSON.stringify(buffer);
        quote=null;buffer="";
      }else buffer+=ch;
      continue;
    }
    if(ch==="'" || ch==='"'){quote=ch;continue;}
    if(/[A-Za-z_]/.test(ch)){
      let word=ch;
      while(i+1<raw.length && /[A-Za-z_0-9]/.test(raw[i+1]))word+=raw[++i];
      if(word==="True")out+="true";
      else if(word==="False")out+="false";
      else if(word==="None")out+="null";
      else return undefined;
      continue;
    }
    if(!/[0-9{}\[\]:,\.\-+\s]/.test(ch))return undefined;
    out+=ch;
  }
  if(quote)return undefined;
  try{return JSON.parse(out);}catch{return undefined;}
}
function array(v,depth=0) {
  // No SIU, o campo "linhas" pode vir como string, array de strings,
  // objeto ou uma mistura. O app usa coerção para string + eval(...).
  // Interpretamos apenas JSON, sem executar código vindo do servidor.
  if(depth>5) return [];
  if(Array.isArray(v)) return v.flatMap(item=>array(item,depth+1));
  if(v && typeof v==="object") return [v];
  if(typeof v!=="string") return [];
  const raw=v.trim();
  if(!raw || raw==="null" || raw==="undefined")return [];
  for(const sample of [raw,"["+raw+"]"]){
    try {
      const parsed=JSON.parse(sample);
      if(parsed!==v) return array(parsed,depth+1);
    }catch{}
    const legacy=siuLegacyParse(sample);
    if(legacy!==undefined && legacy!==v) return array(legacy,depth+1);
  }
  return [];
}
function shape(d,rows){
  const raw=d?.linhas;
  const keys=d && typeof d==="object" ? Object.keys(d).slice(0,12):[];
  return {
    respostaSucesso:success(d),
    campoLinhasPresente:d!=null && Object.prototype.hasOwnProperty.call(d,"linhas"),
    tipoLinhas:Array.isArray(raw)?"array":raw===null?"null":typeof raw,
    elementosBrutos:Array.isArray(raw)?raw.length:null,
    tipoPrimeiroElemento:Array.isArray(raw)&&raw.length?(Array.isArray(raw[0])?"array":typeof raw[0]):null,
    comprimentoPrimeiroElemento:Array.isArray(raw)&&typeof raw[0]==="string"?raw[0].length:null,
    aparentaLiteralLegado:(typeof raw==="string" && raw.includes("'cod'")) ||
      (Array.isArray(raw)&&typeof raw[0]==="string"&&raw[0].includes("'cod'")),
    catalogoVazioConfirmado:(Array.isArray(raw)&&raw.length===0) ||
      (typeof raw==="string" && (raw.trim()==="" || raw.trim()==="[]")),
    caracteresTexto:typeof raw==="string"?raw.length:null,
    itensInterpretados:rows.length,
    primeirosCampos:rows[0] && typeof rows[0]==="object"?Object.keys(rows[0]).slice(0,12):[],
    camposResposta:keys
  };
}
function value(v){return Number(String(v??"").replace(",","."));}
function local(lat,lon){return Number.isFinite(lat)&&Number.isFinite(lon)&&lat>=BOUNDS.minLat&&lat<=BOUNDS.maxLat&&lon>=BOUNDS.minLon&&lon<=BOUNDS.maxLon;}
function success(d){return d?.sucesso===true||d?.sucesso==="true"||d?.sucesso===1;}
function decode(s,expectedCallback,pathCallback){
  s=s.trim().replace(/^\uFEFF/,"").replace(/^\/\*[\s\S]*?\*\/\s*/,"");
  if(s.startsWith("{")||s.startsWith("[")) return JSON.parse(s);
  // jQuery dataType=jsonp adiciona ?callback=<nomeDinâmico>. Em algumas
  // versões do serviço prevalece o callback que está no fim do caminho.
  const m=s.match(/^([A-Za-z_$][\w$]*)\s*\(([\s\S]*)\)\s*;?\s*$/);
  if(!m || ![expectedCallback,pathCallback].includes(m[1]))
    throw bad("Resposta JSONP fora do contrato do SIU",502);
  return JSON.parse(m[2]);
}
async function upstream(route,callback,ttl,ctx){
  const key="https://cache.feirabus.invalid/v5/"+encodeURIComponent(route);
  const req=new Request(key), cached=await caches.default.match(req);
  if(cached)return cached.json();
  if(inflight.has(route))return inflight.get(route);
  const promise=(async()=>{
    const wait=Math.max(0,1300-(Date.now()-lastCall));
    if(wait)await new Promise(r=>setTimeout(r,wait));
    lastCall=Date.now();
    // Formato gerado pelo jQuery 1.10.2 no Cordova: ?callback=jQuery...&_=timestamp
    const callbackName="jQuery"+Date.now()+ "_" + (++jsonpCounter);
    const upstreamUrl=new URL(route,BASE);
    upstreamUrl.searchParams.set("callback",callbackName);
    upstreamUrl.searchParams.set("_",String(Date.now()));
    let response;
    try {
      response=await fetch(upstreamUrl.toString(),{
        method:"GET", signal:AbortSignal.timeout(TIMEOUT_MS),
        headers:{Accept:"*/*"}
      });
    }catch(e) {
      const timedOut=e?.name==="TimeoutError"||e?.name==="AbortError";
      throw bad(timedOut?"SIU demorou mais de 45 segundos":"SIU inacessivel por HTTP/6060; conectividade real nao confirmada",504);
    }
    if(!response.ok)throw bad("SIU retornou HTTP "+response.status,502);
    if(Number(response.headers.get("content-length")||0)>2000000)throw bad("Resposta muito grande",502);
    const raw=await response.text();
    if(raw.length>2000000)throw bad("Resposta muito grande",502);
    const result=decode(raw,callbackName,callback);
    // Não guardar por uma hora uma lista de linhas vazia ou indecifrável.
    if(!route.startsWith("buscarLinhas/") || array(result?.linhas).some(x=>x?.cod!=null))
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
  if(p==="/api/status")return {projeto:"FeiraBus",gateway:"configurado",protocolo:"jsonp-compativel",timeoutMs:TIMEOUT_MS,versaoAppReferencia:"1.29.1",versao:"2026-10-23-d1-shared-memory-v5",d1Configurada:HAS_DB(env),recursos:["lines","sublines","stops","predictions","vehicles","vehicle","geometry","schedule"],worker:"tests",siuOnline:"nao verificado",frotaIntegralGarantida:false};
  if(p==="/api/memory/status"){
    if(!HAS_DB(env))return {configured:false,initialized:false,erro:"Binding FEIRABUS_DB ausente"};
    try{return await dbStatus(env.FEIRABUS_DB);}
    catch(e){throw bad("D1 indisponivel: "+String(e?.message??e).slice(0,130),503);}
  }
  if(p==="/api/memory/snapshot"){
    if(!HAS_DB(env))throw bad("D1 nao configurada; confira wrangler.jsonc e o deploy",503);
    try{return await getMemory(env.FEIRABUS_DB);}
    catch(e){throw bad("Memoria D1 indisponivel: "+String(e?.message??e).slice(0,130),503);}
  }
  if(p==="/api/initialize"){
    // O app FSA chama este endpoint ao abrir pela primeira vez. Retornamos
    // apenas o diagnóstico: parâmetros internos do operador não são publicados.
    const d=await upstream("buscarParametrosIniciais/retornoJSONParametrosIniciais","retornoJSONParametrosIniciais",1800,ctx);
    return {inicializacao:success(d)?"confirmada":"nao-confirmada",sucesso:success(d)};
  }
  if(p==="/api/lines" || p==="/api/diagnostics/lines"){
    const d=await upstream("buscarLinhas/retornoJSONListaLinhas","retornoJSONListaLinhas",3600,ctx);
    const parsed=array(d?.linhas);
    const meta=shape(d,parsed);
    if(!success(d))throw bad("SIU respondeu sem sucesso (campos: "+meta.camposResposta.join(", ")+")",502);
    const linhas=parsed.filter(x=>x && typeof x==="object" && x.cod!=null && x.cod!=="Sem Dados").slice(0,600)
      .map(x=>({id:String(x.cod),numero:String(x.sgl??""),nome:String(x.nom??"")}));
    meta.linhasValidas=linhas.length;
    if(p==="/api/diagnostics/lines")return {diagnostico:meta,linhasExemplo:linhas.slice(0,3)};
    if(linhas.length)remember(env,ctx,db=>saveLines(db,linhas));
    return {linhas,diagnostico:linhas.length?undefined:meta};
  }
  if(p==="/api/sublines"){
    const n=ident(q.get("line")),d=await upstream("V3/retornaSublinhasDaLinha/"+n+"/0/"+city+"/retornoSublinhasJSON","retornoSublinhasJSON",21600,ctx);
    return {sublinhas:success(d)?array(d.subLinhas).filter(x=>x?.cod!=null).map(x=>({id:String(x.cod),numero:String(x.sgl??""),nome:String(x.nom??"")})):[]};
  }
  if(p==="/api/schedule"){
    // API reproduzida do APK: assets/www/retornaQroLinha.html, funcao iniciar().
    const n=ident(q.get("line"));
    if(HAS_DB(env)){
      try{
        const cached=await readSchedule(env.FEIRABUS_DB,n);
        if(cached)return {linha:n,horarios:cached.horarios,fonte:"SIU Mobile - quadro programado (cache D1)",pontualidade:"nao-aferida",consultadoEm:cached.consultadoEm};
      }catch(e){console.warn("FeiraBus D1: leitura de horarios:",String(e?.message??e).slice(0,120));}
    }
    const d=await upstream("V3/retornaQroLinha/"+n+"/0/"+city+"/retornoJSON","retornoJSON",1800,ctx);
    if(!success(d))throw bad("SIU nao confirmou o quadro de horarios desta linha",502);
    const horarios=array(d?.qros).filter(x=>x&&typeof x==="object"&&x.cod!=="Sem Dados")
      .slice(0,2500).map(x=>({
        origem:String(x.origem??"").slice(0,120),
        tipoDia:String(x.tipoDia??"").slice(0,80),
        horario:String(x.horario??"").slice(0,15)
      })).filter(x=>{
        const m=x.horario.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
        return m&&Number(m[1])<24&&Number(m[2])<60;
      });
    if(horarios.length)remember(env,ctx,db=>saveSchedule(db,n,horarios));
    return {linha:n,horarios,fonte:"SIU Mobile - quadro de partidas programadas",pontualidade:"nao-aferida",consultadoEm:new Date().toISOString()};
  }
  if(p==="/api/stops"){
    const n=ident(q.get("line"));let d;
    try {d=await upstream("V3/buscarParadasPorLinha/"+n+"/0/"+city+"/retornoJSON","retornoJSON",21600,ctx);}
    catch {}
    if(!success(d)||!array(d.paradas).length)
      d=await upstream("V3/buscarParadasPorLinhaComCoordenadas/"+n+"/0/"+city+"/retornoJSONH","retornoJSONH",21600,ctx);
    return {paradas:success(d)?array(d.paradas).filter(x=>x?.cod!=null).map(x=>({id:String(x.cod),sentido:String(x.sent??x.sentido??"")})):[]};
  }
  if(p==="/api/predictions"){
    const n=ident(q.get("stop")),d=await upstream("V3/buscarPrevisoes/"+n+"/false/0/"+city+"/retornoJSON","retornoJSON",180,ctx);
    const previsoes=success(d)?array(d.previsoes).filter(x=>x?.sgLin!=="Sem Dados").map(x=>({
      itinerario:x?.codItinerario==null?null:String(x.codItinerario),
      linha:String(x?.sgLin??"").slice(0,50),carro:String(x?.numVeicGestor??"").slice(0,40),
      previsao:String(x?.prev??"").slice(0,110),
      destino:String(x?.apelidoLinha??"").slice(0,90),
      acessibilidade:String(x?.tpAcess??"").slice(0,15)
    })):[]};
    const itinerarios=previsoes.map(x=>x.itinerario).filter(Boolean);
    if(itinerarios.length)remember(env,ctx,db=>saveRoutes(db,itinerarios));
    return {previsoes};
  }
  if(p==="/api/vehicles"){
    const n=ident(q.get("itinerary")),d=await upstream("V3/retornaVeiculosMapa/"+n+"/0/"+city+"/retornoJSONVeiculos","retornoJSONVeiculos",45,ctx);
    const veiculos=success(d)?array(d.veiculos).map(x=>vehicle(x,n)).filter(x=>x?.id):[];
    if(success(d))remember(env,ctx,db=>saveVehicles(db,veiculos,n));
    return {veiculos,itinerario:n};
  }
  if(p==="/api/vehicle"){
    const n=ident(q.get("number")),d=await upstream("retornaVeiculoEmbarcado/"+n+"/retornoJSONVeiculos","retornoJSONVeiculos",60,ctx);
    const raw=array(d.veiculos);
    if(!raw.length&&d.veiculo&&typeof d.veiculo==="object")raw.push(d.veiculo);
    const veiculos=success(d)?raw.map(x=>vehicle(x,null,n)).filter(x=>x?.id===n):[];
    if(veiculos.length)remember(env,ctx,db=>saveVehicles(db,veiculos));
    return {veiculos,numeroConsultado:n};
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
