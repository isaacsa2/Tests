import assert from "node:assert/strict";
import fs from "node:fs";
const html=fs.readFileSync("public/index.html","utf8");
const css=fs.readFileSync("public/assets/style.css","utf8");
const app=fs.readFileSync("public/assets/app.js","utf8");
const mem=fs.readFileSync("public/assets/memory.js","utf8");
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(new Set(ids).size,ids.length,"IDs duplicados na interface");
const required=["map","stateTag","clockNow","clockDate","sourceState","start","stop","clearMemory","memoryState","wide","poll","export","notice","totalCars","freshCars","recentCount","oldCount","totalLines","totalRoutes","coverage","stage","progressFill","busSearch","directNumber","direct","directResult","listTitle","listCount","vehicleList","mapInfo","fit","mapFullscreen","mapTheme","fleetStatus","fleetLine","vehicleDetail","detailRefresh","copyCoords","eventList","phaseLabel","checkpointTime","errorCount"];
for(const id of required)assert.ok(ids.includes(id),"Campo CCO faltando: "+id);
for(const part of ['id="mapa"','id="frota"','id="eventos"','id="config"'])assert.ok(html.includes(part),"Seção operacional faltando: "+part);
for(const token of ["function paint(){","function uniqueVehicle(v)","function restore(){","async function run(){","async function direct(){","async function exportGeo(){","async function clearMemory()","function selectVehicle(","function renderEvents(","mapFullscreen","fleetStatus","fleetLine"])assert.ok(app.includes(token),"Fluxo do painel faltando: "+token);
for(const token of ["/api/initialize","/api/lines","/api/stops","/api/predictions","/api/vehicles","/api/vehicle","/api/geometry"])assert.ok(app.includes(token),"Endpoint perdido: "+token);
assert.ok(html.includes('/assets/memory.js')&&html.includes('/assets/app.js'),"Scripts de memória ou CCO não carregados");
assert.ok(mem.includes("indexedDB")&&mem.includes("saveGeometry"),"Memória não preservada");
assert.ok(css.includes("@media(max-width:740px)")&&css.includes(".map-panel.is-expanded"),"Layout responsivo incompleto");
assert.ok(html.includes("Não é uma central oficial"),"Aviso de protótipo ausente");
console.log("OK: CCO estrutural, controles, coleta SIU e memória.");

// Regressões: erro SRI do CSS Leaflet, falta de favicon e basemap que exige API key.
assert.ok(html.includes('integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="'),"SRI Leaflet CSS precisa coincidir com o arquivo oficial");
assert.ok(html.includes('integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo="'),"SRI Leaflet JS alterado inesperadamente");
assert.ok(html.includes('href="/favicon.svg"')&&html.includes('href="/favicon.ico"'),"Links de favicon ausentes");
assert.ok(fs.existsSync("public/favicon.svg")&&fs.existsSync("public/favicon.ico"),"Arquivos de favicon ausentes");
assert.ok(app.includes('https://tile.openstreetmap.org/{z}/{x}/{y}.png'),"Base de mapa OSM ausente");
assert.ok(!app.includes("basemaps.cartocdn.com")&&!html.includes("basemaps.cartocdn.com"),"CARTO ainda exige API key");
assert.ok(app.includes('function applyMapTheme(mode)')&&css.includes('.cco-map-dark .leaflet-tile-pane'),"Alternância de tema escuro local perdida");

// Passageiro, frota de referência e desempenho de varredura.
const passenger=fs.readFileSync("public/passageiro.html","utf8");
const passengerJS=fs.readFileSync("public/assets/passenger.js","utf8");
const fleet=fs.readFileSync("public/assets/fleet.js","utf8");
const manifest=JSON.parse(fs.readFileSync("public/manifest.webmanifest","utf8"));
const serviceWorker=fs.readFileSync("public/sw.js","utf8");
assert.ok(html.includes('href="/passageiro.html"')&&html.includes('/assets/fleet.js'),"CCO sem acesso ao passageiro/frota");
assert.ok(app.includes('Math.max(0,1600-')&&!app.includes('Math.max(0,2500-'),"Intervalo de consultas não foi otimizado");
assert.ok(app.includes("FeiraBusFleet?.lookup"),"Ficha não usa referências da frota");
for(const path of ["/api/lines","/api/schedule","/api/predictions","/api/vehicle"])assert.ok(passengerJS.includes(path),"Recurso ausente: "+path);
assert.ok(passenger.includes('rel="manifest"')&&passenger.includes('/assets/passenger.js'),"Página não carregou PWA");
assert.ok(serviceWorker.includes('url.pathname.startsWith("/api/")')&&serviceWorker.includes("return; // Nunca devolver"),"Service Worker não pode armazenar resposta SIU");
assert.ok(!fleet.includes("fetch(")&&fleet.includes('"15545"')&&fleet.includes('"32003"'),"Frota deve ser referência estática, não scraping");
assert.ok(manifest.start_url==="/passageiro.html"&&manifest.icons.some(i=>i.sizes==="192x192")&&manifest.icons.some(i=>i.sizes==="512x512"),"Manifest precisa ícones PNG 192/512");
for(const icon of manifest.icons.filter(i=>i.type==="image/png"))assert.ok(fs.existsSync("public"+icon.src),"Imagem PWA ausente: "+icon.src);

// Regressao obrigatoria: frontend e Worker precisam compartilhar rota /api/schedule.
const workerSource=fs.readFileSync("src/worker.js","utf8");
assert.ok(workerSource.includes('if(p==="/api/schedule")'),"ERRO: front-end consulta horarios, mas Worker nao registra /api/schedule");
assert.ok(workerSource.includes('V3/retornaQroLinha/'),"ERRO: Worker nao consulta o QRO do SIU");

const d1source=fs.readFileSync("src/d1-memory.js","utf8");
const d1conf=JSON.parse(fs.readFileSync("wrangler.jsonc","utf8"));
assert.equal(d1conf.d1_databases[0].database_id,"fef5837c-0c0f-4c63-b625-55c85303999b");
assert.equal(d1conf.d1_databases[0].binding,"FEIRABUS_DB");
assert.equal(d1conf.d1_databases[0].database_name,"db_app","Nome real da D1 não pode voltar ao valor provisório");
assert.ok(html.includes('id="d1State"')&&html.includes('id="sharedRefresh"'),"CCO sem indicadores D1");
const gpsSource=fs.readFileSync("public/assets/gps-polling.js","utf8");
assert.ok(html.includes('id="gpsInterval"')&&html.includes('id="gpsNow"')&&html.includes('id="gpsState"'),"GPS controls missing");
assert.ok(html.includes('/assets/gps-polling.js'),"GPS scheduler not loaded before app.js");
assert.ok(app.includes("GPS.chooseRoutes(")&&app.includes("function startGpsPolling()"),"Bounded GPS refresh missing");
assert.ok(app.includes("Date.parse(String(v.consultadoEm"),"GPS must distinguish SIU query age from rendering time");
assert.ok(!app.includes("for(const id of s.routes){if(!s.poll)break;"),"Regression: unlimited full fleet refresh");
assert.ok(gpsSource.includes("routeBatch:2")&&gpsSource.includes("routeBatch:4"),"Expected per-cycle query limits missing");
assert.ok(workerSource.includes('"retornoJSONVeiculos",12,ctx')&&workerSource.includes('"retornoJSONVeiculos",20,ctx'),"Cache TTLs too slow for focus poll");

assert.ok(app.includes('function hydrateSharedMemory()')&&app.includes('/api/memory/snapshot'),"CCO sem importação da memória D1");
assert.ok(d1source.includes("ON CONFLICT(id)")&&d1source.includes("saveVehicles"),"D1 não registra últimas posições");
assert.ok(fs.existsSync("migrations/0001_feirabus_memory.sql"),"Arquivo de migração D1 ausente");
