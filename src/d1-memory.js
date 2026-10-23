// Memória compartilhada FeiraBus no Cloudflare D1. Só o Worker grava dados obtidos do SIU.
// Sem endpoint público de escrita; posições de veículos ficam com apenas o último registro.
const initialized = new WeakMap();
export const HAS_DB = env => !!env?.FEIRABUS_DB;
export async function ensureDb(db){
  if(!db)throw new Error("Binding FEIRABUS_DB ausente");
  if(!initialized.has(db)){
    const pending=db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS fb_lines (id TEXT PRIMARY KEY NOT NULL, number TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', updated_at INTEGER NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS fb_routes (id TEXT PRIMARY KEY NOT NULL, updated_at INTEGER NOT NULL)"),
      db.prepare("CREATE TABLE IF NOT EXISTS fb_vehicles (id TEXT PRIMARY KEY NOT NULL, line TEXT NOT NULL DEFAULT '', lat REAL NOT NULL, lon REAL NOT NULL, heading REAL, itinerary TEXT, observed_at INTEGER NOT NULL)"),
      db.prepare("CREATE INDEX IF NOT EXISTS fb_vehicles_last_seen ON fb_vehicles(observed_at)"),
      db.prepare("CREATE TABLE IF NOT EXISTS fb_schedules (line_id TEXT PRIMARY KEY NOT NULL, payload TEXT NOT NULL, updated_at INTEGER NOT NULL)")
    ]).catch(error=>{initialized.delete(db);throw error;});
    initialized.set(db,pending);
  }
  return initialized.get(db);
}
const now=()=>Date.now();
const validId=v=>typeof v==="string"&&/^[A-Za-z0-9_-]{1,32}$/.test(v);
async function writeChunks(db,stmts){
  for(let i=0;i<stmts.length;i+=40)await db.batch(stmts.slice(i,i+40));
}
export async function saveLines(db,lines){
 await ensureDb(db);
 const at=now();
 const stmts=(lines||[]).slice(0,600).filter(x=>validId(String(x?.id??""))).map(x=>db.prepare(
  "INSERT INTO fb_lines (id,number,name,updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET number=excluded.number,name=excluded.name,updated_at=excluded.updated_at WHERE fb_lines.updated_at < excluded.updated_at - 1800 * 1000"
 ).bind(String(x.id),String(x.numero??"").slice(0,60),String(x.nome??"").slice(0,140),at));
 await writeChunks(db,stmts);
}
export async function saveRoutes(db,routes){
 await ensureDb(db);
 const at=now();
 const unique=[...new Set((routes||[]).map(x=>String(x??"")).filter(validId))].slice(0,300);
 await writeChunks(db,unique.map(id=>db.prepare(
  "INSERT INTO fb_routes (id,updated_at) VALUES (?,?) ON CONFLICT(id) DO UPDATE SET updated_at=excluded.updated_at WHERE fb_routes.updated_at < excluded.updated_at - 1800 * 1000"
 ).bind(id,at)));
}
export async function saveVehicles(db,vehicles,route=null){
 await ensureDb(db);
 const at=now();
 const stmts=(vehicles||[]).slice(0,200).filter(v=>
  validId(String(v?.id??""))&&Number.isFinite(v.lat)&&Number.isFinite(v.lon)&&v.lat>=-13.2&&v.lat<=-11.7&&v.lon>=-39.8&&v.lon<=-38.3
 ).map(v=>db.prepare(
  "INSERT INTO fb_vehicles (id,line,lat,lon,heading,itinerary,observed_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET line=excluded.line,lat=excluded.lat,lon=excluded.lon,heading=excluded.heading,itinerary=COALESCE(excluded.itinerary,fb_vehicles.itinerary),observed_at=excluded.observed_at"
 ).bind(String(v.id),String(v.linha??"").slice(0,70),v.lat,v.lon,Number.isFinite(v.rumo)?v.rumo:null,validId(String(v.itinerario??route??""))?String(v.itinerario??route):null,at));
 await writeChunks(db,stmts);
 if(route&&validId(String(route)))await saveRoutes(db,[String(route)]);
}
export async function saveSchedule(db,line,data){
 await ensureDb(db);
 if(!validId(String(line)))return;
 const payload=JSON.stringify((data||[]).slice(0,2500));
 if(payload.length>500000)return;
 await db.prepare("INSERT INTO fb_schedules (line_id,payload,updated_at) VALUES (?,?,?) ON CONFLICT(line_id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at")
  .bind(String(line),payload,now()).run();
}
export async function readSchedule(db,line,maxAgeMs=1800000){
 await ensureDb(db);
 if(!validId(String(line)))return null;
 const row=await db.prepare("SELECT payload,updated_at FROM fb_schedules WHERE line_id=? AND updated_at>=? LIMIT 1")
  .bind(String(line),now()-maxAgeMs).first();
 if(!row)return null;
 try{
  const horarios=JSON.parse(row.payload);
  return Array.isArray(horarios)?{horarios,consultadoEm:new Date(row.updated_at).toISOString()}:null;
 }catch{return null;}
}
export async function getMemory(db){
 await ensureDb(db);
 const cutoff=now()-48*3600000;
 const [lines, routes, vehicles] = await Promise.all([
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
   rumo:x.rumo==null?null:Number(x.rumo),itinerario:x.itinerario||null,lastSeen:Number(x.observed_at),
   origem:"d1"
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
