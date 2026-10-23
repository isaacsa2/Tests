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
