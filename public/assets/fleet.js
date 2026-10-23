"use strict";
(function(root){
 const rosa="https://onibusbrasil.com/empresa/rosa-feira-de-santana";
 const saoJoao="https://onibusbrasil.com/empresa/auto-onibus-sao-joao";
 // Apenas vínculos individuais confirmados em páginas públicas indexadas;
 // prefixos desconhecidos não são atribuídos por uma suposta faixa numérica.
 const known=Object.freeze({
   "15566":"Rosa","15545":"Rosa","13540":"Rosa",
   "12027":"São João","21021":"São João","32003":"São João",
   "22004":"São João","25002":"São João"
 });
 function lookup(prefix){
   const id=String(prefix??"").trim();
   if(!/^[0-9]{2,8}$/.test(id))return {prefix:id,empresa:null,links:[]};
   const empresa=known[id]||null;
   if(empresa){
     const site=empresa==="Rosa"?rosa:saoJoao;
     return {prefix:id,empresa,confirmacao:"Referência fotográfica histórica; empresa atual não confirmada",links:[
      {label:"Ver carro "+id+" no Ônibus Brasil",url:site+"/"+encodeURIComponent(id)}
     ]};
   }
   return {prefix:id,empresa:null,confirmacao:"Operadora não identificada para este prefixo",links:[
     {label:"Consultar frota Rosa",url:rosa},
     {label:"Consultar frota São João",url:saoJoao}
   ]};
 }
 root.FeiraBusFleet=Object.freeze({lookup});
})(globalThis);
