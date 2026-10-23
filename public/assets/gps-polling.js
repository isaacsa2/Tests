"use strict";
(function(root){
 const CONFIG=Object.freeze({
  "15":Object.freeze({seconds:15,routeBatch:20,label:"15 s · rápido"}),
  "30":Object.freeze({seconds:30,routeBatch:30,label:"30 s · equilibrado"}),
  "60":Object.freeze({seconds:60,routeBatch:40,label:"60 s · econômico"})
 });
 function getConfig(raw){
  return CONFIG[String(raw)]||CONFIG["30"];
 }
 function chooseRoutes(routes,buses,selectedId,cursor=0,batch=30,now=Date.now()){
  const all=[...new Set(Array.from(routes||[],String).filter(v=>/^[\w-]{1,32}$/.test(v)))];
  const limit=Math.min(Math.max(0,Math.floor(batch)),40);
  if(!limit||!all.length)return {ids:[],cursor:0};
  const keep=new Set(all),seen=new Set(),chosen=[];
  const add=id=>{
   id=String(id??"");
   if(keep.has(id)&&!seen.has(id)&&chosen.length<limit){
    seen.add(id);chosen.push(id);
   }
  };
  const vehicles=Array.from(buses||[]).filter(v=>v&&Number.isFinite(Number(v.lastSeen)))
   .sort((a,b)=>Number(b.lastSeen)-Number(a.lastSeen));
  const selected=vehicles.find(v=>String(v.id)===String(selectedId));
  add(selected?.itinerario);
  // Reserve half the batch for fair round-robin of ALL known routes.
  const recentLimit=Math.max(1,Math.floor(limit/2));
  for(const v of vehicles){
   if(chosen.length>=recentLimit)break;
   if(now-Number(v.lastSeen)>10*60*1000)continue;
   add(v.itinerario);
  }
  const start=((Math.floor(cursor)||0)%all.length+all.length)%all.length;
  for(let i=0;i<all.length&&chosen.length<limit;i++)add(all[(start+i)%all.length]);
  // Advance the fair scan even if all the priority slots were taken.
  return {ids:chosen,cursor:(start+Math.max(1,limit-recentLimit))%all.length};
 }
 // Linhas no formato do catálogo SIU: "7" -> "007", "7A" -> "07A"; "BRT2" fica igual.
 function normalizeLine(raw){
  let v=String(raw??"").trim().toUpperCase().replace(/\s+/g,"");
  if(!/^[A-Z0-9-]{1,12}$/.test(v))return "";
  if(/^\d{1,2}$/.test(v))return v.padStart(3,"0");
  const m=v.match(/^(\d)([A-Z])$/);
  return m?"0"+m[1]+m[2]:v;
 }
 function parseLineQuery(text,max=8){
  const out=[];
  for(const part of String(text??"").split(/[\s,;\/]+/)){
   const line=normalizeLine(part);
   if(line&&!out.includes(line))out.push(line);
   if(out.length>=max)break;
  }
  return out;
 }
 // Executa uma lista com no máximo `limit` tarefas ao mesmo tempo.
 async function pool(items,limit,task){
  const list=Array.from(items||[]);let next=0;
  const worker=async()=>{while(next<list.length){const i=next++;await task(list[i],i);}};
  await Promise.all(Array.from({length:Math.max(0,Math.min(limit,list.length))},worker));
 }
 root.FeiraBusGps=Object.freeze({getConfig,chooseRoutes,normalizeLine,parseLineQuery,pool,PARALLEL:6});
})(globalThis);
