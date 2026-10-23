# FeiraBus Monitor — Feira de Santana

Painel web para estudar as linhas urbanas de Feira de Santana e consultar, mediante acesso autorizado, posições dos ônibus disponibilizados pelo SIU Mobile. Hospedagem: Cloudflare Workers com Static Assets e um gateway HTTPS no mesmo Worker.

## Corrigindo o erro do uploader da Cloudflare

A mensagem "This uploader does not yet support projects that require a build process" aparece porque o modo Drag and Drop/Direct Upload de site estático não é a forma correta de implantar um Worker com wrangler.jsonc e API dinâmica.

**Para aproveitar o seu endereço atual sem recriar outro projeto:**

1. Entre em https://dash.cloudflare.com/ e abra Workers & Pages.
2. Selecione o Worker EXISTENTE chamado feiradesantana.
3. Acesse Settings > Builds > Connect (ou Git repository / Connect to Git conforme a interface).
4. Escolha GitHub e selecione isaacsa2/Tests.
5. Branch de produção: main. Root directory: / (raiz).
6. Build command: npm test. Deploy command: npx wrangler deploy.
7. Salve a integração e acione um deploy da branch main se necessário (na interface da Cloudflare ou enviando um novo commit).

IMPORTANTE: o nome no arquivo wrangler.jsonc já é feiradesantana, que deve corresponder ao Worker existente. Conectar a outro Worker com nome diferente vai falhar. Faça backup da configuração anterior; uma implantação altera o serviço online.

URL esperada do seu Worker já existente:
https://feiradesantana.isaacsa2-santana.workers.dev/

Testes após implantar:
- https://feiradesantana.isaacsa2-santana.workers.dev/api/status
- https://feiradesantana.isaacsa2-santana.workers.dev/api/lines

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
