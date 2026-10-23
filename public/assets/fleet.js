"use strict";
(function(root){
 const sites=Object.freeze({"Rosa":"https://onibusbrasil.com/empresa/rosa-feira-de-santana",
  "São João":"https://onibusbrasil.com/empresa/auto-onibus-sao-joao"});
 // Índices fotográficos históricos fornecidos em outubro/2026.
 // Não representa cadastro de veículos que estão em operação hoje.
 const expand=(blocks)=>{
  const ids=new Set();
  for(const text of blocks.trim().split(/\s+/)){
   if(!text)continue;
   if(/^\d+-\d+$/.test(text)){
    const [a,b]=text.split("-").map(Number);
    if(b>=a&&b-a<=100)for(let n=a;n<=b;n++)ids.add(String(n));
   }else ids.add(text);
  }
  return ids;
 };
 const SJ=expand("11001-11024 1172 12001-12034 13001-13026 13028-13044 21002-21027 22001-22004 23001-23023 23025-23026 23030-23031 24001-24020 25001-25013 3191 32001-32004 33001-33011 399 5640 5653 6598 6736 7087 7142 7143 7711 91309 91333 91336 91346 FS001 FS002 FS003 FS004 FS005 FS0059 FS007 FS008 FS009 FS010 FS011 FS012 FS013 FS014 FS015 FS016 FS017 FS018 FS019 FS020 FS021 FS022 FS023 FS024 FS025 FS026 FS027 FS028 FS029 FS030 FS031 FS032 FS034 FS035 FS036 FS037 FS038 FS041 FS043 FS044 FS045 FS046 FS047 FS049 FS050 FS051 FS053 FS054 FS055 FS057 FS058 FS061 FS062 FS063 FS065 FS067 FS068 FS069 FS070 FS071 FS072 FS073 FS074 FS075 FS076 FS077 FS078 FS080 FS082 FS084 FS085 FS086 FS090 FS091 FS092 FS6676 XY040");
 const ROSA=expand("001 11010 13500-13519 13521-13541 13544 1400 1402 1405 1408 1411 1412 1413 1415 1419 1421 1423 1424 1433 1435 1437 1440 1441 1443 1444 14500-14501 15344 15350-15373 15500-15506 15519-15520 15523-15529 15540-15586 15588-15593 15600-15603 15605-15606 15608-15612 15614 15616-15617 15619-15622 15624-15630 15632-15634 15636-15637 15639-15640 15642-15646 15648 15650-15659 15661-15662 15665 17300 20300-20321 23310-23311 3509 4050-4054 4056-4063 45101-45102 45104 45109 45123-45124 45130 5155 5526 7455 907 908 91300 91301 91305 91306 91309 91321 91322 91328 91329 91330 91335 91337 91338 91342-91344 91350 91351 91355 9405");
 // Correção explícita do usuário: 11010 pertence à São João, apesar de
 // haver uma ficha fotográfica com empresa Rosa.
 const corrections=Object.freeze({"11010":"São João"});
 function normalize(prefix){return String(prefix??"").toUpperCase().replace(/[\s.]/g,"").trim();}
 function lookup(prefix){
  const id=normalize(prefix);
  if(!/^[A-Z0-9]{2,8}$/.test(id))return {prefix:id,empresa:null,links:[],confirmacao:"Prefixo inválido"};
  const inSj=SJ.has(id),inRosa=ROSA.has(id);
  const corrected=corrections[id];
  const empresa=corrected||(inSj&&!inRosa?"São João":inRosa&&!inSj?"Rosa":null);
  const ambigua=!corrected&&inSj&&inRosa;
  const matched=empresa?[empresa]:ambigua?["Rosa","São João"]:[];
  const options=matched.length?matched:["Rosa","São João"];
  const links=options.map(name=>({
   label:matched.length?"Consultar fotos de "+name+" · "+id:"Consultar frota "+name,
   url:sites[name]+(matched.length?"/"+encodeURIComponent(id):"")
  }));
  return {prefix:id,empresa,
   confirmacao:corrected?
    "Correção de atribuição fornecida pelo responsável pelo projeto. Operação atual não confirmada.":
    ambigua?"Este prefixo aparece nos dois acervos; operadora atual indeterminada.":
    empresa?"Prefixo presente no acervo fotográfico; não comprova operação atual.":
    "Prefixo não localizado no índice histórico disponível. Isso não comprova inexistência.",
   ambigua,links,
   fotosCadastradas:id==="33009"?19:null,
   referencia:id==="33009"?"https://onibusbrasil.com/lm1000/14549517?context=company":null
  };
 }
 root.FeiraBusFleet=Object.freeze({lookup});
})(globalThis);
