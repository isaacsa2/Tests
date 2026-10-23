import assert from "node:assert/strict";
await import("./public/assets/gps-polling.js");
const {chooseRoutes,getConfig}=globalThis.FeiraBusGps;
assert.equal(getConfig(15).seconds,15);
assert.equal(getConfig(30).routeBatch,4);
assert.equal(getConfig(60).routeBatch,5);
assert.equal(getConfig(2).seconds,30,"Invalid configuration must use safe default");
const now=Date.now();
const all=Array.from({length:83},(_,i)=>String(i+1));
const buses=[
 {id:"400",itinerario:"70",lastSeen:now-20_000},
 {id:"401",itinerario:"50",lastSeen:now-60_000},
 {id:"OLD",itinerario:"80",lastSeen:now-9*3600_000}
];
const focused=chooseRoutes(new Set(all).values(),new Map(buses.map(x=>[x.id,x])).values(),"400",0,4,now);
assert.equal(focused.ids[0],"70","Selected vehicle route first");
assert.ok(focused.ids.includes("50"),"Recently observed routes prioritized");
assert.ok(focused.ids.length<=4,"Never scan all 83 itineraries at once");
assert.equal(new Set(focused.ids).size,focused.ids.length,"No duplicate requests");
let cursor=0;
const seen=new Set();
for(let i=0;i<90;i++){
 const wave=chooseRoutes(new Set(all).values(),buses,"400",cursor,4,now);
 assert.ok(wave.ids.length<=4);
 wave.ids.forEach(id=>seen.add(id));
 cursor=wave.cursor;
}
assert.equal(seen.size,83,"A round robin must eventually revisit every route");
assert.deepEqual(chooseRoutes([],[],null,0,4).ids,[]);
assert.ok(chooseRoutes(["valid","../secret"],[],null,0,6).ids.every(x=>x==="valid"),"Route identifiers validated");
assert.ok(chooseRoutes(all,[],null,0,2).ids.length<=2,"15 second mode remains rate-limited");
console.log("OK: GPS 15/30/60 s, vehicle priority, fairness, safe route budgets and input validation.");

const {normalizeLine,parseLineQuery}=globalThis.FeiraBusGps;
assert.equal(normalizeLine("7"),"007");
assert.equal(normalizeLine("07a"),"07A");
assert.equal(normalizeLine("7A"),"07A");
assert.equal(normalizeLine("300"),"300");
assert.equal(normalizeLine("brt2"),"BRT2");
assert.equal(normalizeLine("<script>"),"","Line tokens are validated");
assert.deepEqual(parseLineQuery("07A, 007 300;7"),["07A","007","300"],"Duplicates removed after normalization");
assert.equal(parseLineQuery("1 2 3 4 5 6 7 8 9 10").length,8,"Line search is bounded");
console.log("OK: GPS line filter normalization and bounds.");
