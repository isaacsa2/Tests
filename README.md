# FeiraBus Monitor — Feira de Santana

Painel web para estudar as linhas urbanas de Feira de Santana e consultar, mediante acesso autorizado, posições dos ônibus disponibilizados pelo SIU Mobile. Hospedagem: Cloudflare Workers com Static Assets e um gateway HTTPS no mesmo Worker.

## Corrigindo o erro do uploader da Cloudflare

A mensagem "This uploader does not yet support projects that require a build process" aparece porque o modo Drag and Drop/Direct Upload de site estático não é a forma correta de implantar um Worker com wrangler.jsonc e API dinâmica.

**Para aproveitar o seu endereço atual sem recriar outro projeto:**

1. Entre em https://dash.cloudflare.com/ e abra Workers & Pages.
2. Selecione o Worker EXISTENTE chamado tests.
3. Acesse Settings > Builds > Connect (ou Git repository / Connect to Git conforme a interface).
4. Escolha GitHub e selecione isaacsa2/Tests.
5. Branch de produção: main. Root directory: / (raiz).
6. Build command: npm test. Deploy command: npx wrangler deploy.
7. Salve a integração e acione um deploy da branch main se necessário (na interface da Cloudflare ou enviando um novo commit).

IMPORTANTE: o nome no arquivo wrangler.jsonc já é tests, que deve corresponder ao Worker existente. Conectar a outro Worker com nome diferente vai falhar. Faça backup da configuração anterior; uma implantação altera o serviço online.

URL esperada do seu Worker já existente:
https://tests.isaacsa2-santana.workers.dev/

Testes após implantar:
- https://tests.isaacsa2-santana.workers.dev/api/status
- https://tests.isaacsa2-santana.workers.dev/api/lines

/api/status apenas confirma que o código entrou no ar; NÃO confirma a conexão com o SIU. /api/lines é o primeiro teste real de conectividade.

## Código

- public/index.html — interface responsiva, mapa Leaflet e busca de veículos.
- public/assets/app.js — varredura progressiva por linhas, sublinhas e paradas; busca direta; GeoJSON.
- public/assets/style.css — visual do dashboard.
- src/worker.js — gateway fixo para endpoints conhecidos do SIU; sem proxy genérico.
- wrangler.jsonc — configuração do Worker, incluindo suporte a porta HTTP customizada.
- test-worker.mjs — teste local com dados simulados, sem consumir a API oficial.

Com Node 22+, execute:

    npm test

Para testar localmente com Cloudflare:

    npx wrangler dev

Para implantação manual, se preferir:

    npx wrangler login
    npx wrangler deploy

## Limitações e uso responsável

- Não há endpoint de frota completa confirmado no APK. A opção "varredura ampliada" busca itinerários nas paradas e consulta os veículos desses itinerários; veículos inativos, sem itinerário ou omitidos pela origem podem não aparecer.
- A pesquisa por número utiliza o recurso de veículo embarcado presente no APK. Um retorno vazio NÃO significa que o carro não exista.
- A API identificada no APK é HTTP na porta 6060. O fato de o contrato estar no aplicativo não comprova que a origem ainda aceite conexões. Falhas devem ser verificadas com o operador; não tente contornar autenticação ou bloqueios.
- O painel identifica a hora da consulta HTTP, não necessariamente a hora exata de medição GPS.
- Há cache e intervalo de pelo menos 2,5 segundos entre as chamadas sequenciais por navegador. O cache do Worker não é um limitador global. Antes de disponibilizar o painel publicamente a muitas pessoas, configure Cloudflare Access e limitação global de taxa, e alinhe permissões de redistribuição/consulta com o operador.
- Nenhuma chave ou senha privada foi extraída nem incluída no código.
- Os veículos que aparecem ao abrir a interface são exemplos fictícios, claramente identificados.
- As coordenadas retornadas permanecem geográficas reais; o fator 1:2 só deve ser aplicado na futura ferramenta de conversão para OMSI 2/openOMSI.

Documentação Cloudflare:
- https://developers.cloudflare.com/workers/ci-cd/builds/
- https://developers.cloudflare.com/workers/static-assets/

## Compatibilidade com o SIU Mobile (atualização de 23/10/2026)

A consulta foi alinhada ao comportamento observado em `assets/www/js/json.js` e `assets/www/index.html` do APK 1.29.2:

- No início da varredura, chama `buscarParametrosIniciais/retornoJSONParametrosIniciais`; uma falha nessa etapa é exibida, mas a descoberta de linhas ainda é tentada. Não expõe os parâmetros internos retornados pelo operador.
- Usa requisições GET estilo jQuery JSONP com `callback=jQuery...&_=<timestamp>`; aceita a função JSONP dinâmica ou a função nomeada no caminho (sem executar JavaScript do servidor).
- Respeita timeout de 45 segundos no Worker e 55 segundos no navegador, para permitir a resposta ou um diagnóstico confiável.
- Interpreta listas de linhas como JSON tradicional **ou** texto contendo objetos JSON separados por vírgulas, tal como o aplicativo.
- Para listar paradas usa `V3/buscarParadasPorLinha/{linha}/0/{cidade}/retornoJSON`, com fallback para coordenadas.

**Não foi copiado o registro de uso do aplicativo:** `registraUsoSistema` parece contabilizar instalações/uso e não é comprovadamente um login. Um Worker gerando identificadores artificiais distorceria a telemetria do SIU. Também não há cookies, Bearer tokens ou credenciais privadas incluídos.

Ao verificar a implantação:

1. `/api/status` — informa que o novo código entrou no ar, sem afirmar conectividade real.
2. `/api/initialize` — testa a inicialização oficial.
3. `/api/lines` — testa a consulta JSONP das linhas.
4. Consulte a interface e procure um veículo pelo número apenas se o SIU responder.

**Limite:** os testes CI simulam as respostas do SIU; eles não garantem conectividade do servidor real nem autorizam contornar bloqueios por IP, origem ou credenciais. Se o servidor não permitir requisições originadas da Cloudflare, é necessário alinhamento com o operador.

## Worker atual: tests (23/10/2026)

O usuário confirmou que o painel agora está em `https://tests.isaacsa2-santana.workers.dev/`. O `wrangler.jsonc` usa agora `name: "tests"`, que **precisa corresponder exatamente** ao projeto Worker no painel da Cloudflare.

Se o painel avisar que o SIU retornou uma lista vazia, abra estes caminhos:
- `/api/status` — versão `2026-10-23-line-parser-v2` confirma que a implantação já usou este commit.
- `/api/diagnostics/lines` — apresenta somente tipos, contagens, chaves e até três linhas públicas de exemplo; nunca mostra o payload completo da API.
- `/api/lines` — lista usada pelo dashboard.

O parser agora aceita listas JSON aninhadas ou listas de strings que contêm sequências de objetos. O cache de linhas foi versionado e **não grava resultados vazios**, para evitar a falsa impressão de que a cidade não tem linhas. Se o diagnóstico informar `campoLinhasPresente: true` e `itensInterpretados: 0`, o serviço pode realmente estar retornando nada ou um formato que exige análise adicional; não inventar dados. `FSA_SIU_CITY = "null"` é coerente com o app FSA, que não exige seleção manual de cidade na instalação.

## Diagnóstico v3: formato legado do catálogo SIU

Na consulta `/api/lines`, o SIU pode retornar `linhas` como um array contendo string com objetos no formato `{'cod':'12','sgl':'001'}`, que não é JSON válido. O código passou a usar um decodificador limitado para literais no estilo Python (`True`, `False`, `None` e strings entre aspas simples); não usa `eval` nem executa scripts de origem externa.

O endpoint `/api/diagnostics/lines` diferencia `catalogoVazioConfirmado: true` (payload `linhas: []` ou vazio) e lista não vazia que não pôde ser decodificada. Esses dados não provam que a cidade não tem linhas, apenas descrevem a resposta desta API. Nova versão em `/api/status`: `2026-10-23-siu-legacy-catalog-v3`.

## Memória persistente no navegador (IndexedDB)

O FeiraBus agora grava automaticamente um checkpoint no **IndexedDB do navegador**, sem precisar de variável nova na Cloudflare. A memória armazena:
- linhas e itinerários descobertos;
- números/posições de veículos observados (posição salva como histórico, com data da última consulta);
- paradas consultadas, etapa atual (primeira passagem/ampliada), próximo índice de linha e fila de paradas pendentes;
- geometria dos itinerários exportados em GeoJSON, reutilizada em exportações futuras.

Ao abrir novamente o site **no mesmo navegador e perfil**, o usuário verá "Memória local" e poderá clicar em **Retomar varredura** sem reconsultar tudo do zero. O botão **Limpar memória** apaga snapshots e geometrias (exige confirmação). Nova varredura preserva os veículos conhecidos enquanto redescobre rotas. Não há sincronização entre aparelhos, nem trabalho em segundo plano com a aba fechada.

**Idade dos dados:** veículos recuperados aparecem em cinza até serem consultados novamente nesta sessão; cada carro mostra a data/hora da última consulta HTTP, que não é a data garantida do GPS. Registros de carros com mais de 7 dias são descartados ao restaurar. O IndexedDB pode ser removido pelo próprio navegador por limpeza de dados, modo privado ou pressão de armazenamento.

Teste: `npm test`, incluindo `test-memory.mjs`. Os testes simulam IndexedDB local e SIU. Não medem nem atestam atualidade das posições de ônibus.

## Interface CCO (Centro de Controle Operacional)

O layout do FeiraBus foi reformulado para uma central de monitoramento de ônibus, com:
- Cabeçalho de operação e relógio no horário de Feira de Santana (America/Bahia);
- Indicadores de carros conhecidos, consultados há menos de cinco minutos nesta sessão, históricos, linhas, itinerários e progresso;
- Mapa Leaflet com estilo escuro CARTO e alternativa de ruas OpenStreetMap, enquadramento e modo expandido;
- Frota com busca, filtros por linha e situação de atualização, seleção por marcador/lista e ficha detalhada;
- Painel de eventos apenas de monitoramento da sessão local e erros de consulta, sem inventar ocorrências reais;
- Controles de busca, varredura ampliada, atualização, exportação GeoJSON e memória IndexedDB preservados.

Nota: 'consultado recentemente' é uma posição recebida na requisição HTTP desta sessão, não comprova o instante da medição GPS. Posições restauradas são históricas e ficam cinza. Protótipo independente, não oficial.

A página usa bibliotecas de mapa externas e requer conexão para carregar os mapas-base. O teste automatizado de estrutura não substitui a validação visual no navegador.

## Hotfix Leaflet / mapas de CCO / favicon (23/10/2026)

- O hash SRI de `leaflet.css` foi alinhado ao publicado em https://leafletjs.com/download para Leaflet 1.9.4. O JavaScript manteve o hash correto.
- O tile-server CARTO foi **removido**. Em 2026, os tiles `dark_all` passaram a exigir API key; o painel utiliza só a base raster OSM e aplica modo escuro usando CSS no navegador, sem serviços pagos.
- O seletor Escuro/Ruas muda o filtro da mesma camada, sem duplicar requisições HTTP de tiles. A escolha fica gravada no `localStorage` do navegador.
- Adiciona `favicon.svg` e `favicon.ico`, incluídos nos assets Cloudflare Workers, para eliminar o 404 do ícone.
- Observe a política oficial do servidor OSM: https://operations.osmfoundation.org/policies/tiles/ (atribuição, cache do navegador e sem prefetch/bulk download). Para tráfego público elevado, migrar para tiles próprios ou serviço autorizado.

**Os endpoints SIU e a memória IndexedDB não foram alterados.**

## FeiraBus Passageiro (PWA) e horários SIU — 23/10/2026

- Acesse `/passageiro.html` pelo CCO. O aplicativo usa Web App Manifest e Service Worker, pode ser instalado no Android quando o navegador oferece instalação; não exige loja, API key, banco novo ou pagamento.
- `/api/schedule?line=<cod>` consulta o endpoint oficial `V3/retornaQroLinha/{cod}/0/null/retornoJSON`, descoberto no APK SIU Mobile em `assets/www/retornaQroLinha.html`. Mostra `origem`, `tipoDia`, `horario` (partidas programadas), sem alegar atraso/adiantamento de veículos específicos.
- A previsão por código de parada agora inclui o texto `prev` e o destino/descrição `apelidoLinha` do SIU, retirados do comportamento do APK; não inventa minutos.
- Pesquisa por número do carro exibe posição disponível via SIU e links de referência ao Ônibus Brasil. Apenas veículos individuais publicamente indexados têm empresa histórica pré-associada. Outros recebem links de pesquisa nos índices Rosa e São João; fotos não são copiadas ou redistribuídas.
- Serviço de página offline só guarda **arquivos estáticos**, nunca respostas `/api/*`. GPS/horários/ETA dependem de internet; não gera histórico operacional fictício.
- A varredura no CCO reduz o intervalo mínimo entre chamadas sequenciais do navegador de 2500 para 1600 ms. O Worker mantém seu espaçamento best effort de 1300 ms, cache e deduplicação. Isso pode reduzir espera quando a latência da API permitir; não significa ganho percentual garantido nem solicitações paralelas ilimitadas.
- Antes de rotular atrasos, será necessário relacionar viagem + origem + tipo de dia + identificador do carro + hora real de saída/passagem, validada em campo e em fontes autorizadas. A API atual só oferece a tabela de partidas e previsões por parada.


## Cloudflare D1 — Memória compartilhada entre dispositivos

A base informada para o projeto possui UUID `fef5837c-0c0f-4c63-b625-55c85303999b` e o Worker `tests` usa o binding **`FEIRABUS_DB`**. O banco D1 foi confirmado pelo proprietário com o nome **`db_app`**; o `wrangler.jsonc` registra `database_name: "db_app"` e o mesmo UUID. O binding usado no código permanece `FEIRABUS_DB`. O CI valida o repositório, mas a existência do vínculo e a leitura real da base só podem ser confirmadas depois da implantação na Cloudflare.

A D1 salva automaticamente, a partir de consultas bem-sucedidas ao SIU:
- Catálogo de linhas (`fb_lines`); itinerários descobertos (`fb_routes`);
- **A última posição por veículo**, nunca uma trilha de deslocamento (`fb_vehicles`); o endpoint público só mostra posições consultadas nas últimas 48 horas, marcadas como *históricas* ao carregar;
- Tabelas de partidas (`fb_schedules`), reutilizadas por até 30 minutos antes de consultar o SIU novamente.

Endpoints: `/api/memory/status` (verifica vínculo/contagens), `/api/memory/snapshot` (dados compartilhados). Somente o Worker insere registros derivados de respostas SIU; **não existe POST público** para alterar a D1. A memória IndexedDB continua ativa para checkpoint local e retomada da varredura. A sincronização central não transfere automaticamente checkpoints privados de um aparelho para outro.

**Migrations:** `migrations/0001_feirabus_memory.sql` contém só `CREATE TABLE IF NOT EXISTS`, sem `DROP` e sem afetar tabelas preexistentes. No deploy, o Worker também inicializa essas tabelas de forma idempotente no primeiro acesso, de modo que a ausência de execução manual de migração não bloqueie a implementação (recomenda-se aplicar a migração formalmente para controle de versões). Com acesso autenticado à conta:
```sh
npx wrangler d1 migrations apply FEIRABUS_DB --remote
npx wrangler deploy
```
Em Workers Builds conectado ao GitHub, mantenha `npm test` no build e `npx wrangler deploy` como deploy; a inicialização idempotente permite que o Worker prepare o schema na primeira chamada. O nome do banco já foi confirmado como `db_app`. Não execute migrações em uma base diferente.

**Nota de segurança:** dados são provenientes do serviço público SIU. Para redistribuição ampla/comercial, alinhe autorização do operador. D1 mantém um registro por prefixo, com data de observação, sem dados pessoais ou histórico de percurso. Se o D1 não estiver configurado/disponível, o gateway SIU continua funcionando.


## Contenção de cotas D1 (23/10/2026)

Esta otimização visa o limite do plano Cloudflare Workers Free (as cotas são compartilhadas entre todos os bancos D1 da conta):

- O Worker verifica `sqlite_master` uma única vez por instância aquecida; as 5 instruções idempotentes de criação só são enviadas se o esquema não existir. Não roda DDL em todo endpoint.
- Rotas/itinerários usam `INSERT OR IGNORE` e memorização em instância: identificadores conhecidos **não** são atualizados continuamente.
- O catálogo de linhas não é regravado por pelo menos **6 horas** na instância e também possui proteção SQL temporal contra escritas redundantes entre instâncias.
- A última posição por ônibus é gravada no máximo uma vez a cada **5 minutos** por instância, com proteção SQL cruzada entre instâncias. Isso **não limita as consultas GPS ao SIU** — só a persistência D1.
- Horários do passageiro: cache de leitura no Worker/edge por **15 minutos**. A D1 mantém a tabela de partidas reutilizável por até **30 minutos**.
- `/api/memory/snapshot`: cache de **120 segundos**; `/api/memory/status`: **300 segundos**. Há cache em memória da instância e tentativa de Cache API por região, mais deduplicação de requisições simultâneas. Os retornos incluem `cacheMaxAgeSeconds`.
- Sem `DELETE` ou criação de tabelas extras nesta atualização. A estrutura existente em `db_app` é preservada.

Essas medidas reduzem repetição de leitura e escrita, mas **não são um limite absoluto de gastos por dia**, pois instâncias do Worker podem ficar em regiões distintas e os outros bancos da conta usam as mesmas cotas. O dashboard da Cloudflare é a fonte para acompanhar linhas lidas/escritas. Um erro de cota da D1 não deve impedir o SIU nem a memória IndexedDB de continuar operando.

Se o painel D1 apresentar **zero tabelas** enquanto `/api/memory/status` mostrar `initialized:true` e itinerários salvos, atualize a página e confira no editor SQL da **db_app**:

```sql
SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'fb_%';
```

Esse SELECT retorna as tabelas realmente presentes. Não execute `DROP`, `TRUNCATE`, nem scripts de recriação para diagnosticar essa divergência. Para auditoria das cotas: https://developers.cloudflare.com/d1/observability/billing/.


## Atualização GPS adaptativa — CCO (23/10/2026)

O CCO antes consultava **todos** os itinerários em sequência e só então esperava 90 segundos; esse processo demorava vários minutos quando a memória D1 trazia dezenas de rotas. A nova atualização é opcional, fica ativa apenas com a aba **visível**, e oferece:
- **15 segundos:** modo rápido; consulta o ônibus selecionado e no máximo **2 itinerários** por rodada.
- **30 segundos (padrão):** consulta o carro em foco e até **4 itinerários** por rodada.
- **60 segundos:** modo econômico; carro selecionado e até **5 itinerários** por rodada.

Os lotes favorecem o itinerário selecionado e linhas com carros vistos recentemente, mas incluem rodízio entre outras rotas. Portanto, **15/30/60 s são os intervalos entre rodadas, NÃO a frequência garantida de atualização de cada um dos 83 itinerários**. A duração das respostas SIU pode elevar o intervalo real. Caso falhem seguidas rodadas, há backoff de até 4×. É possível desligar ou consultar manualmente. Após varredura inicial, o GPS automático só opera quando a opção foi marcada. Ao trocar a aba, pausa; ao voltar, retoma.

No Worker, cache das posições passa a **12 s por veículo** e **20 s por itinerário**, com origem HTTP SIU e deduplicação já existente. O campo `consultadoEm` agora conserva a data/hora da **requisição efetiva feita ao SIU**, incluindo respostas vindas do cache. Isso não comprova a data da medição original do módulo GPS do ônibus. A D1 mantém a política de persistir **no máximo uma posição por carro a cada 5 minutos**, sem multiplicar escrita na D1 por causa do polling mais ágil.

Não mantém monitoramento em segundo plano com a aba fechada, não envia alterações ao SIU e não garante novos pontos quando o próprio sistema do operador demora a atualizar.


## Busca por prefixo (SIU + D1 + acervo Ônibus Brasil)

O app Passageiro agora distingue três informações:
1. **Identidade histórica da frota:** o índice local de prefixos veio de listas de Rosa e Auto Ônibus São João transcritas pelo mantenedor. A classificação não confirma que o carro opere atualmente. Atribuições conflitantes não são tratadas como certeza; a correção manual do prefixo **11010 → São João** prevalece sobre uma ficha incorreta da Rosa. O **33009 → São João** possui registros fotográficos documentados (19 no índice consultado) e um exemplo de foto identificada em 2026.
2. **Última posição conhecida:** `/api/vehicle?number=...` consulta o fluxo de embarque apenas quando o SIU fornece identidade compatível, ou retorna a última posição da D1 marcada como *histórica*, quando disponível. Não preenche identidade ausente na resposta do SIU com o prefixo digitado.
3. **Busca por itinerários:** botão *Procurar nas linhas do SIU* usa `/api/vehicle/search?number=33009&cursor=0`, buscando **no máximo 3 itinerários por requisição**, com paginação. A interface avança enquanto estiver aberta e visível, mostra progresso, permite parar e não escreve na D1 o resultado negativo. Quando localiza um veículo, grava somente essa observação com a proteção de cinco minutos por prefixo já existente.

Os itinerários são extraídos da memória compartilhada `fb_routes` existente, que deve ser abastecida antes pelo CCO (83 itinerários na primeira integração). Se não houver rotas, a busca informa que é necessário iniciar a descoberta pelo CCO. Uma busca completa não garante encontrar carros sem telemetria disponível naqueles itinerários.

O endpoint de embarque `retornaVeiculoEmbarcado` do SIU Mobile **não é um catálogo universal da frota**: o APK só o invoca quando o passageiro usa o fluxo especial após embarcar. O mapa comum utiliza `V3/retornaVeiculosMapa/{codItinerario}/0/{cidade}/retornoJSONVeiculos`. Por isso o app não deve mostrar “o carro não existe” após apenas uma consulta direta vazia.

A pesquisa no Ônibus Brasil abre páginas de referências e não copia fotografias, faz scraping automático ou disponibiliza dados em massa para terceiros. Para novas confirmações de frota, atualize com fonte verificável e data da observação.


## Sincronização em lotes de 10 e 15 (outubro de 2026)

- **CCO / GPS:** cada rodada consulta em sequência até **10 itinerários** (15, 30 ou 60 segundos como intervalo configurável **entre rodadas**, após completar a anterior). Continua priorizando o veículo selecionado e itinerários conhecidos. O equipamento do ônibus e o SIU podem atualizar a telemetria mais lentamente; não equivale a posição nova a cada rodada. As gravações na D1 seguem desaceleradas por veículo.
- **FeiraBus Passageiro:** na aba Paradas, depois de selecionar a linha, o botão **Sincronizar linha toda** consulta as previsões de todos os pontos de todas as origens, em lotes de 15 e **uma consulta por vez**. Exibe progresso, a previsão da linha escolhida e o carro em cada ponto, pausa ao ocultar a aba e o mesmo botão interrompe. Não informa nem estima quantidade de pessoas dentro do ônibus: são **pontos de parada**.
- **Nomes oficiais das paradas:** a API `/api/stops?line=...` agora devolve `nome` a partir de `dt.end`, `sentido` de `dt.sent` e `codigoSIU` de `dt.siu` (conforme `retornaParadas.html` do APK). O app exibe `nome` e código separadamente. Quando o SIU não fornece nome, aparece `Ponto <código>`, sem inventar endereço.
- Nenhum endpoint retorna total de passageiros embarcados: esse dado não está confirmado na API SIU examinada. As consultas são limitadas e não realizadas em segundo plano com a página fechada.

## Passageiro e CCO: favoritos, mapa, tema e histórico (outubro de 2026)

- **Meus pontos:** salve ponto + linha com apelido (até 12, só no aparelho) e consulte a previsão em um toque.
- **Link compartilhável:** `passageiro.html#linha=007&parada=5590` abre a linha e a previsão do ponto. O endereço é atualizado ao abrir um ponto.
- **Sem internet:** catálogo de linhas e os 6 últimos quadros de horários ficam salvos com o aviso “Salvo em …”. Previsões e GPS nunca vêm desse cache.
- **Mapa da linha (04 / MAPA):** Leaflet é baixado só quando pedido; desenha o trajeto (`/api/geometry`) e os ônibus dos itinerários da linha, atualizando a cada 30 s com a página visível.
- **Ônibus antigos:** no app, carros sem consulta nova há mais de **30 min** não aparecem (mapa e busca por prefixo). O CCO continua mostrando todos.
- **Acessibilidade:** o selo ♿ aparece só quando o SIU envia `tpAcess = "1"`; `"0"` ou vazio não afirma nada.
- **Tema claro:** segue o sistema até a escolha no botão ☀/☾, compartilhado entre app e CCO. O CCO usa a mesma identidade visual do app.
- **Ponto mais perto:** usa o GPS do celular, mas só aparece quando `/api/stops` traz coordenadas. Confira com `/api/diagnostics/stops?line=10`, que mostra os campos crus das duas variantes de paradas do SIU.
- **CCO, trajetos:** com “GPS por linha” ou o seletor de linha, o mapa desenha a geometria dos itinerários filtrados.
- **CCO, Histórico:** aba com as linhas em que cada carro apareceu nos últimos 7 dias (`/api/memory/vehicle-lines`). A tabela `fb_vehicle_lines` guarda só carro, linha e horários (sem coordenadas), grava na troca de linha ou a cada 30 min e apaga registros com mais de 7 dias. O Worker cria a tabela sozinho; a migração manual é `migrations/0002_vehicle_lines.sql`.

### Teste de navegador

`npm run test:browser` abre o passageiro e o CCO no Chromium (celular e PC) com a API simulada a partir de respostas reais em `tests/fixtures`. Cobre favoritos, sincronização da linha toda, mapa, ônibus antigos, link compartilhado, modo sem internet, tema, histórico e a regressão do mapa que abria no zoom mundial após o teclado do celular. No GitHub Actions roda no job `browser`; localmente precisa do pacote `playwright` 1.56.1 e do Chromium.

## Paradas próximas, paradas do itinerário e avisos oficiais (APK 1.29.2)

Rotas reproduzidas do app SIU Mobile 1.29.2, **somente leitura** de dados públicos:

| Recurso FeiraBus | Consulta SIU (APK) | Uso |
| --- | --- | --- |
| `/api/stops/nearby?lat=&lon=` | `V3/buscarParadasProximas/{lon}/{lat}/0/{cidade}` | “📍 Paradas perto de mim” em Meus pontos |
| `/api/stops?line=` (coordenadas) | `V3/buscarParadasPorLinhaComCoordenadas` (campos `y`/`x`) | “Mais perto nesta linha” e pontos no mapa |
| `/api/route-stops?itinerary=` | `buscarParadasPorItiComCoordenadas/{iti}/0` | Paradas do itinerário no mapa do CCO |
| `/api/notices` | `V3/buscarNotificacao/{cidade}` (`cod`, `assunto`, `evento`) | Card “Avisos oficiais” |
| `/api/notices/stop?stop=` | `V3/verificaNotificacaoParada/{parada}/{cidade}` | Aviso dentro do ponto aberto |

- A posição do passageiro é **arredondada a ~100 m no aparelho** e de novo no Worker antes de ir ao SIU; fora da região atendida o Worker nem consulta.
- Avisos são exibidos **sempre como texto** (o APK original os insere como HTML).
- `/api/diagnostics/siu?kind=nearby|routeStops|notices|stopNotices` mostra o formato cru dessas consultas para conferência após o deploy; aceita só essa lista fechada.
- **Fora do FeiraBus, de propósito:** botão de pânico (`emiteAlarmePanico`, `buscarAlarmesPanico`), alarme de desembarque PNE (`emiteAlarmeDesembarquePNE`), consulta de cartão PNE (`pesquisaCartaoPNE`), favoritos do servidor e chamados PCD. Disparam ações reais ou envolvem dados pessoais; `test-ui.mjs` falha se algum aparecer no código.

## Velocidade: rodadas de 20/30/40 com paralelismo limitado

- **Worker:** a fila de 1,3 s entre consultas ao SIU virou um limite de **8 consultas simultâneas por isolate, com 60 ms entre inícios**. Teste: 20 previsões em ~1,8 s (antes ~26 s), pico de 8 simultâneas.
- **Previsões** ficam 30 s em cache (antes 180 s): dados mais frescos a cada sincronização.
- **CCO:** sem a espera de 1,6 s por consulta; no máximo **6 consultas simultâneas** por navegador. GPS automático em rodadas de **20 / 30 / 40 itinerários** (intervalos de 15 / 30 / 60 s), e “GPS por linha” consulta os itinerários em paralelo.
- **Passageiro:** “Sincronizar linha toda” em **lotes de 30 pontos, 6 por vez**; o mapa da linha carrega trajetos e ônibus em paralelo. Medido com dados reais: linha 007 (76 pontos) de 97 s para **17 s**, ainda com o Worker anterior publicado.
- O SIU nunca recebe mais que 6 consultas simultâneas de um mesmo aparelho; disparar 30–40 de uma vez poderia bloquear o Worker para todos.
