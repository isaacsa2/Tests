// FeiraBus shared D1 storage. Last observed GPS location only, never trip history.
// Keep D1 traffic bounded even when many users query the SIU simultaneously.
let schemaPromise=null;
const routeMemo=new Set();
const vehicleMemo=new Map();
let linesMemoAt=0;
const lineWindowMs=6*60*60*1000;
const vehicleWindowMs=5*60*1000;
const scheduleWindowMs=30*60*1000;
const now=()=>Date.now();
const validId=v=>typeof v==="string"&&/^[A-Za-z0-9_-]{1,32}$/.test(v);
export const HAS_DB=env=>!!env?.FEIRABUS_DB;

export async function ensureDb(db){
 if(!db)throw new Error("Binding FEIRABUS_DB ausente");
 if(!schemaPromise){
  // Reuse one promise per Worker isolate: repeated requests must not issue 5 DDLs.
  schemaPromise=(async()=>{
   const present=await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='fb_lines' LIMIT 1").first();
   if(present)return;
   await db.batch([
     db.prepare("CREATE TABLE IF NOT EXISTS fb_lines (id TEXT PRIMARY KEY NOT NULL, number TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)"),
     db.prepare("CREATE TABLE IF NOT EXISTS fb_routes (id TEXT PRIMARY KEY NOT NULL, updated_at INTEGER NOT NULL)"),
     db.prepare("CREATE TABLE IF NOT EXISTS fb_vehicles (id TEXT PRIMARY KEY NOT NULL, line TEXT NOT NULL DEFAULT '', lat REAL NOT NULL, lon REAL NOT NULL, heading REAL, itinerary TEXT, observed_at INTEGER NOT NULL)"),
     db.prepare("CREATE INDEX IF NOT EXISTS fb_vehicles_last_seen ON fb_vehicles(observed_at)"),
     db.prepare("CREATE TABLE IF NOT EXISTS fb_schedules (line_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)")
   ]);
  })().catch(error=>{schemaPromise=null;throw error;});
 }
 return schemaPromise;
}
async function writeChunks(db,statements){
 for(let i=0;i<statements.length;i+=40)await db.batch(statements.slice(i,i+40));
}
export async function saveLines(db,lines){
 const at=now();
 const unique=new Map();
 for(const row of (lines||[]).slice(0,600)){
  const id=String(row?.id??"");
  if(validId(id))unique.set(id,row);
 }
 if(!unique.size||at-linesMemoAt<lineWindowMs)return;
 await ensureDb(db);
 const stmts=[...unique].map(([id,row])=>db.prepare(
  "INSERT INTO fb_lines (id,number,name,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET number=excluded.number,name=excluded.name,updated_at=excluded.updated_at WHERE fb_lines.updated_at <= excluded.updated_at - 21600000"
 ).bind(id,String(row.numero??"").slice(0,60),String(row.nome??"").slice(0,140),at));
 await writeChunks(db,stmts);
 linesMemoAt=at;
}
export async function saveRoutes(db,routes){
 const candidates=[...new Set((routes||[]).map(v=>String(v??"")).filter(validId))];
 const fresh=candidates.filter(id=>!routeMemo.has(id)).slice(0,300);
 if(!fresh.length)return;
 await ensureDb(db);
 await writeChunks(db,fresh.map(id=>db.prepare(
  "INSERT OR IGNORE INTO fb_routes (id,updated_at) VALUES (?,?)"
 ).bind(id,now())));
 // Memoization is only an optimization. SQL INSERT OR IGNORE is authoritative
 // across cold starts and across Worker isolates.
 if(routeMemo.size>4000)routeMemo.clear();
 for(const id of fresh)routeMemo.add(id);
}
export async function saveVehicles(db,vehicles,route=null){
 const at=now();
 const unique=new Map();
 for(const row of (vehicles||[]).slice(0,200)){
  const id=String(row?.id??"");
  if(!validId(id)||!Number.isFinite(row.lat)||!Number.isFinite(row.lon)
    ||row.lat < -13.2||row.lat > -11.7||row.lon < -39.8||row.lon > -38.3)continue;
  if(at-(vehicleMemo.get(id)||0)<vehicleWindowMs)continue;
  unique.set(id,row);
 }
 if(unique.size){
  await ensureDb(db);
  const statements=[...unique].map(([id,row])=>{
   const itinerary=String(row.itinerario??route??"");
   return db.prepare(
    "INSERT INTO fb_vehicles (id,line,lat,lon,heading,itinerary,observed_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET line=excluded.line,lat=excluded.lat,lon=excluded.lon,heading=excluded.heading,itinerary=COALESCE(excluded.itinerary,fb_vehicles.itinerary),observed_at=excluded.observed_at WHERE fb_vehicles.observed_at <= excluded.observed_at - 300000"
   ).bind(id,String(row.linha??"").slice(0,70),row.lat,row.lon,
    Number.isFinite(row.rumo)?row.rumo:null,validId(itinerary)?itinerary:null,at);
  });
  await writeChunks(db,statements);
  if(vehicleMemo.size>3000)vehicleMemo.clear();
  for(const id of unique.keys())vehicleMemo.set(id,at);
 }
 if(route&&validId(String(route)))await saveRoutes(db,[String(route)]);
}
export async function saveSchedule(db,line,data){
 const id=String(line);
 if(!validId(id))return;
 const payload=JSON.stringify((data||[]).slice(0,2500));
 if(payload.length>500000)return;
 await ensureDb(db);
 await db.prepare(
  "INSERT INTO fb_schedules (line_id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(line_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at WHERE fb_schedules.updated_at <= excluded.updated_at - 1800000"
 ).bind(id,payload,now()).run();
}
export async function readSchedule(db,line,maxAgeMs=scheduleWindowMs){
 const id=String(line);
 if(!validId(id))return null;
 await ensureDb(db);
 const row=await db.prepare("SELECT payload,updated_at FROM fb_schedules WHERE line_id=? AND updated_at>=? LIMIT 1")
  .bind(id,now()-maxAgeMs).first();
 if(!row)return null;
 try{
  const horarios=JSON.parse(row.payload);
  return Array.isArray(horarios)?{horarios,consultadoEm:new Date(row.updated_at).toISOString()}:null;
 }catch{return null;}
}
export async function getMemory(db){
 await ensureDb(db);
 const cutoff=now()-48*3600000;
 const [lines,routes,vehicles]=await Promise.all([
  db.prepare("SELECT id,number AS numero,name AS nome,updated_at FROM fb_lines ORDER BY id LIMIT 600").all(),
  db.prepare("SELECT id,updated_at FROM fb_routes ORDER BY updated_at DESC LIMIT 1200").all(),
  db.prepare("SELECT id,line AS linha,lat,lon,heading AS rumo,itinerary AS itinerario,observed_at FROM fb_vehicles WHERE observed_at>=? ORDER BY observed_at DESC LIMIT 1200")
   .bind(cutoff).all()
 ]);
 return {
  origem:"Cloudflare D1",compartilhado:true,
  aviso:"Dados públicos observados anteriormente. Não representam GPS ao vivo, nem a frota integral.",
  linhas:(lines.results||[]).map(x=>({id:x.id,numero:x.numero,nome:x.nome})),
  itinerarios:(routes.results||[]).map(x=>String(x.id)),
  veiculos:(vehicles.results||[]).map(x=>({
   id:String(x.id),linha:String(x.linha||""),lat:Number(x.lat),lon:Number(x.lon),
   rumo:x.rumo==null?null:Number(x.rumo),itinerario:x.itinerario||null,lastSeen:Number(x.observed_at),origem:"d1"
  }))
 };
}
export async function dbStatus(db){
 await ensureDb(db);
 const [lines,routes,vehicles,schedules]=await Promise.all([
  db.prepare("SELECT COUNT(*) AS total FROM fb_lines").first(),
  db.prepare("SELECT COUNT(*) AS total FROM fb_routes").first(),
  db.prepare("SELECT COUNT(*) AS total FROM fb_vehicles").first(),
  db.prepare("SELECT COUNT(*) AS total FROM fb_schedules").first()
 ]);
 return {configured:true,initialized:true,lines:Number(lines?.total||0),routes:Number(routes?.total||0),vehicles:Number(vehicles?.total||0),schedules:Number(schedules?.total||0)};
}
