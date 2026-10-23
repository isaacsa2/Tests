import assert from "node:assert/strict";
import worker from "./src/worker.js";
import {ensureDb,HAS_DB,saveLines,saveRoutes,saveVehicles,saveSchedule,readSchedule,getMemory,dbStatus} from "./src/d1-memory.js";

class MockD1 {
 constructor(){
  this.tables={lines:new Map(),routes:new Map(),vehicles:new Map(),schedules:new Map()};
  this.statements=[];
  this.schemaExists=false;
  this.schemaProbes=0;
  this.readQueries=0;
 }
 prepare(sql){
  const db=this;
  const stmt={
   sql,args:[],
   bind(...args){this.args=args;return this;},
   async run(){
    db.statements.push({sql:this.sql,args:this.args});
    const v=this.args,t=db.tables;
    if(sql.startsWith("CREATE TABLE"))db.schemaExists=true;
    if(sql.includes("INSERT INTO fb_lines")){
      t.lines.set(v[0],{id:v[0],numero:v[1],nome:v[2],updated_at:v[3]});
    }else if(sql.includes("INSERT INTO fb_routes")||sql.includes("INSERT OR IGNORE INTO fb_routes")){
      t.routes.set(v[0],{id:v[0],updated_at:v[1]});
    }else if(sql.includes("INSERT INTO fb_vehicles")){
      t.vehicles.set(v[0],{id:v[0],linha:v[1],lat:v[2],lon:v[3],rumo:v[4],itinerario:v[5],observed_at:v[6]});
    }else if(sql.includes("INSERT INTO fb_schedules")){
      t.schedules.set(v[0],{line_id:v[0],payload:v[1],updated_at:v[2]});
    }
    return {success:true,meta:{changes:1}};
   },
   async first(){
    db.readQueries++;
    const t=db.tables;
    if(sql.includes("FROM sqlite_master")){
      db.schemaProbes++;
      return db.schemaExists?{name:"fb_lines"}:null;
    }
    if(sql.includes("SELECT payload,updated_at FROM fb_schedules")){
      const row=t.schedules.get(this.args[0]);
      return row&&row.updated_at>=this.args[1]?row:null;
    }
    if(sql.includes("COUNT(*)")){
      const key=sql.match(/FROM fb_(lines|routes|vehicles|schedules)/)?.[1];
      return {total:key?t[key].size:0};
    }
    throw new Error("SQL mock unsupported: "+sql);
   },
   async all(){
    db.readQueries++;
    const t=db.tables;let rows=[];
    if(sql.includes("FROM fb_lines"))rows=[...t.lines.values()];
    else if(sql.includes("FROM fb_routes"))rows=[...t.routes.values()].sort((a,b)=>b.updated_at-a.updated_at);
    else if(sql.includes("FROM fb_vehicles"))rows=[...t.vehicles.values()].filter(v=>v.observed_at>=this.args[0]).sort((a,b)=>b.observed_at-a.observed_at);
    else throw new Error("SQL mock unsupported: "+sql);
    return {results:rows};
   }
  };
  return stmt;
 }
 async batch(statements){
  for(const s of statements)await s.run();
  return statements.map(()=>({success:true}));
 }
}
const db=new MockD1();
assert.equal(HAS_DB({FEIRABUS_DB:db}),true);
assert.equal(HAS_DB({}),false);
await ensureDb(db);
await ensureDb(db);
assert.equal(db.schemaProbes,1,"Schema should be probed once per isolate");
const ddlCount=db.statements.filter(x=>x.sql.startsWith("CREATE ")).length;
assert.equal(ddlCount,5,"No existing DB: create schema once");
const now=Date.now();
await saveLines(db,[{id:"12",numero:"001",nome:"Centro"},{id:"13",numero:"002",nome:"Tomba"}]);
await saveRoutes(db,["90","91","90","../../etc"]);
const routeCount=db.statements.filter(x=>x.sql.includes("INSERT OR IGNORE INTO fb_routes")).length;
await saveRoutes(db,["90","91"]);
assert.equal(db.statements.filter(x=>x.sql.includes("INSERT OR IGNORE INTO fb_routes")).length,routeCount,"Do not rewrite discovered routes");
await saveLines(db,[{id:"12",numero:"001",nome:"Centro"}]);
assert.equal(db.statements.filter(x=>x.sql.includes("INSERT INTO fb_lines")).length,2,"Skip repeated line catalog write");
await saveVehicles(db,[{id:"400",linha:"001",lat:-12.25,lon:-38.95,rumo:42,itinerario:"90"},{id:"500",linha:"002",lat:4,lon:10}], "90");
const writesBefore=db.statements.filter(x=>x.sql.includes("INSERT INTO fb_vehicles")).length;
await saveVehicles(db,[{id:"400",linha:"001",lat:-12.25,lon:-38.95,rumo:42,itinerario:"90"}],"90");
assert.equal(db.statements.filter(x=>x.sql.includes("INSERT INTO fb_vehicles")).length,writesBefore,"Throttle unchanged vehicle writes");
await saveSchedule(db,"12",[{origem:"Centro",tipoDia:"Dia util",horario:"06:20"}]);
const found=await readSchedule(db,"12");
assert.equal(found.horarios[0].horario,"06:20");
const snapshot=await getMemory(db);
assert.equal(snapshot.linhas.length,2);
assert.equal(snapshot.itinerarios.length,2);
assert.equal(snapshot.veiculos.length,1);
assert.equal(snapshot.veiculos[0].id,"400");
assert.equal(snapshot.veiculos[0].origem,"d1");
assert.ok(snapshot.veiculos[0].lastSeen>=now);
assert.equal(snapshot.veiculos[0].lat,-12.25);
const stat=await dbStatus(db);
assert.equal(stat.initialized,true);
assert.deepEqual([stat.lines,stat.routes,stat.vehicles,stat.schedules],[2,2,1,1]);
assert.ok(db.statements.every(v=>!v.sql.includes("DROP TABLE")));
const reqRoot="https://tests.isaacsa2-santana.workers.dev";
const ctx={waitUntil(p){throw new Error("No unexpected scheduled writes from status endpoints");}};
const env={FEIRABUS_DB:db,FSA_SIU_CITY:"null",ASSETS:{fetch:()=>new Response("HTML")}};
const response=await worker.fetch(new Request(reqRoot+"/api/memory/status"),env,ctx);
assert.equal(response.status,200);
const stat1=await response.json();
assert.equal(stat1.vehicles,1);
assert.equal(stat1.cacheMaxAgeSeconds,300);
const queriesAfterStatus=db.readQueries;
const response2=await worker.fetch(new Request(reqRoot+"/api/memory/status"),env,ctx);
assert.equal((await response2.json()).vehicles,1);
assert.equal(db.readQueries,queriesAfterStatus,"Status cache avoids repetitive D1 reads");
const timetable=await worker.fetch(new Request(reqRoot+"/api/schedule?line=12"),env,ctx);
assert.equal(timetable.status,200);
assert.equal((await timetable.json()).horarios[0].horario,"06:20");
const queriesAfterTimetable=db.readQueries;
const timetable2=await worker.fetch(new Request(reqRoot+"/api/schedule?line=12"),env,ctx);
assert.equal((await timetable2.json()).horarios.length,1);
assert.equal(db.readQueries,queriesAfterTimetable,"Repeated timetable uses cached response rather than querying D1");
const saved=await worker.fetch(new Request(reqRoot+"/api/memory/snapshot"),env,ctx);
assert.equal(saved.status,200);
const snapshotResult=await saved.json();
assert.equal(snapshotResult.itinerarios.length,2);
assert.equal(snapshotResult.cacheMaxAgeSeconds,120);
const queriesAfterSnapshot=db.readQueries;
const savedAgain=await worker.fetch(new Request(reqRoot+"/api/memory/snapshot"),env,ctx);
assert.equal((await savedAgain.json()).itinerarios.length,2);
assert.equal(db.readQueries,queriesAfterSnapshot,"Snapshot cache avoids repetitive D1 reads");
const without=await worker.fetch(new Request(reqRoot+"/api/memory/snapshot"),{FSA_SIU_CITY:"null"},ctx);
assert.equal(without.status,503);
const status=await worker.fetch(new Request(reqRoot+"/api/status"),env,ctx);
assert.equal((await status.json()).d1Configurada,true);
console.log("OK: D1 cota - schema unico, linhas/veiculos desacelerados, rotas deduplicadas e endpoints cacheados.");
