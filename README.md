# userscripts

Userscripts pessoais para Violentmonkey ou Tampermonkey (Edge, Chrome, Firefox e Edge/Kiwi no
Android). Cada arquivo em `src/` é autocontido: sem `@require` ou biblioteca externa. Só a continuação de buscas AliExpress faz requisições
à própria origem; os demais scripts não acessam a rede. Padrão visual próprio: tokens `--us-*`, círculo 12/12 px, véu, painel/gaveta com sliders.

## Instalar

Com o gerenciador instalado, abra o link "raw" do script; ele oferece a instalação. As atualizações
chegam sozinhas: o gerenciador compara `@version` com o `@updateURL`.

| Script | O que faz | Instalar |
|---|---|---|
| Filtro de lojas | nota e vendas em cada anúncio; esmaece/oculta reprovados | [shop-filter.user.js](https://raw.githubusercontent.com/raschagas/userscripts/main/src/shop-filter.user.js) |
| Dados pessoais | borra dados pessoais na tela (desligado por padrão) | [dados-pessoais.user.js](https://raw.githubusercontent.com/raschagas/userscripts/main/src/dados-pessoais.user.js) |
| georritmo-links (links do homelab) | chip com Jellyfin, Seerr, Mealie e comparação de voos | [georritmo-links.user.js](https://raw.githubusercontent.com/raschagas/userscripts/main/src/georritmo-links.user.js) |
| Cookies | aceita e fecha avisos de cookies/LGPD | [cookies-aceitar.user.js](https://raw.githubusercontent.com/raschagas/userscripts/main/src/cookies-aceitar.user.js) |

Os ajustes ficam no próprio gerenciador, por dispositivo (`GM_getValue`). Para ver ou editar à mão:
Violentmonkey → script → aba **Valores**; Tampermonkey → script → **Armazenamento**.

Para desligar um script inteiro: desative-o no painel do gerenciador. Para desligar só num site, use o
item de menu do próprio script (ícone do gerenciador → nome do script).

### Sites extras por aparelho

O `@match` publicado cobre só sites genéricos. Endereços internos (intranet do trabalho, homelab)
entram por regra personalizada no gerenciador, em cada aparelho, sem editar o script — e sobrevivem
às atualizações automáticas:

- **Violentmonkey**: painel → script → editar → aba **Configurações** (*Settings*) → campo
  **@match rules**, uma regra por linha, com **Mantenha o original** (*Keep original*) marcado para
  continuar valendo nos sites do script.
- **Tampermonkey**: painel → nome do script → aba **Settings** → seção **User matches** (o botão
  abaixo dela adiciona cada regra); deixe marcada a caixa ao lado de **Original matches**.

---

## Filtro de lojas (`shop-filter.user.js`)

Cada anúncio ganha um **círculo** a 12 px do topo e da esquerda da foto:
verde = passa, vermelho = reprovado, cinza = sem dados. Ao lado, opcionalmente, nota e quantidade
(`4,8★ · 476`, ou `9,2/10 · 96` em lojas com outra escala). Reprovados ficam esmaecidos (o véu some
ao passar o mouse) ou ocultos. Patrocinados só ficam se forem aprovados e ganham o selo azul
"patrocinado ✓".

A **pílula** no canto inferior direito mostra a contagem ("4 reprovados · 2 patrocinados ocultos") e
abre o **painel** (PC) ou a **gaveta** (celular, tela com menos de 600 px).

| Ajuste | Padrão | Observação |
|---|---|---|
| Nota mínima | 90% da escala do site (4,5 / 5) | slider de 0 até a escala nativa |
| Avaliações ou vendidos (mín.) | 100 | 0 a 1.000; não aparece no KaBuM, que não mostra quantidade |
| Filtro ligado | sim | desligado remove todas as marcações |
| Ocultar reprovados | não (esmaecer) | |
| Patrocinado só se aprovado | sim | patrocinado reprovado ou sem nota some |
| Mostrar nota e quantidade | sim | |
| Abrir a página do item | sim | só AliExpress: reescreve links de combos/pacotes para `/item/<id>.html`; links sem id (loja, cupom, avaliações), botões (carrinho, favoritos), pedidos e checkout ficam intactos; link com `target="_blank"` abre em nova aba |
| Preencher e carregar mais | sim | só buscas do AliExpress: completa o lote que a página deixou fora do DOM e carrega a próxima página ao chegar ao fim |

Regras do veredito: nota ou contagem ausente não conta (ausente ≠ 0). Com as duas, reprova se
qualquer uma ficar abaixo do mínimo; com uma só, decide por ela; sem nenhuma, fica cinza. Os ajustes
valem **só para o site** em que foram feitos.

Em buscas compatíveis do AliExpress, o filtro lê o lote completo entregue pela própria página e
mostra os produtos ainda ausentes do DOM. Preenche a área visível e carrega páginas seguintes ao
aproximar-se do fim, preservando consulta, ordenação e filtros. Só há uma requisição por vez, com
intervalo mínimo de 1 segundo e timeout de 15 segundos. A continuação pausa após cinco páginas sem
rolagem, três páginas sem novos produtos visíveis ou 500 produtos acumulados. **Continuar** retoma
inclusive um lote parcialmente carregado e amplia o limite em mais 500 quando necessário.

**Pausar** interrompe o carregamento; falhas exigem **Tentar novamente** e nunca são repetidas pela
rolagem. Trocar a URL ou desligar o recurso cancela o trabalho anterior. Quando uma navegação SPA
mantém os dados antigos, a continuação espera um novo lote embutido (recarregar a busca também
resolve); não mistura os resultados. Layout, metadados ou CAPTCHA não reconhecidos preservam a
paginação nativa. Os marcadores de anúncio precisam estar explícitos nos dados recebidos.

A versão 1.1.0 tem testes offline de paginação e cancelamento; a validação visual final em página
real está pendente porque o AliExpress apresentou CAPTCHA no ambiente de teste.

Menu: **Abrir ajustes do filtro** · **Desligar/ligar neste site**.

| Site | Situação |
|---|---|
| AliExpress (PC e celular) | testado em página real em 2026-11-10 |
| Amazon.com.br (PC e celular) | testado em página real em 2026-11-10 |
| KaBuM | testado em página real em 2026-11-10 (sem contagem: filtra só pela nota) |
| Mercado Livre, Shopee, Magalu, Americanas, Casas Bahia, Temu, Shein | **experimental**: não abrem no navegador automatizado (login/403); seletores semânticos e por texto, não verificados. Só esmaece (nunca oculta, mesmo com "Ocultar reprovados" ligado; o painel avisa). Com menos de dois anúncios reconhecidos, ou "cartões" que reúnem vários produtos, o script não marca nada. |

## Dados pessoais (`dados-pessoais.user.js`)

Borra nomes, CPF, CNPJ, RG (só com "RG"/"identidade"/"SSP" por perto), telefones, e-mails, CEP,
endereços, valores em R$, agência/conta, cartões e anexos com nome sensível (RG, CPF, laudo,
extrato…). Desenha caixas com desfoque **por cima** da página — não altera nem envolve o texto,
então funciona em apps reativos (Outlook, Teams, WhatsApp, Gmail). Não borra campos editáveis nem
`svg`, respeita painéis com rolagem e o que está coberto por menus.

- Começa **desligado**. **Alt+Shift+P** liga e desliga (o estado fica salvo).
- Passar o mouse sobre uma caixa revela só aquele item.
- Menu: **Ligar/desligar (Alt+Shift+P)** · **Nomes extras a borrar…** (lista separada por vírgula,
  ex.: `Fulano, Siqueira`; o nome precisa vir seguido de sobrenome com maiúscula) ·
  **Nunca neste site** / **Voltar a borrar neste site**.
- Roda **só** em: Gmail, Google Contatos, Outlook pessoal (`outlook.live.com`), Outlook Web do
  Microsoft 365 (`outlook.office.com`, `outlook.office365.com`), WhatsApp Web, Telegram Web e Teams
  (`teams.microsoft.com`, `teams.cloud.microsoft`). Outros sites (intranet, homelab): veja
  [Sites extras por aparelho](#sites-extras-por-aparelho).

## georritmo-links — links do homelab (`georritmo-links.user.js`)

Um chip escuro e discreto no canto inferior direito, só quando há algo útil na página (alvo de
44 px no PC e no celular):

| Página | Botões |
|---|---|
| Filme no Letterboxd ou IMDb | **▶ Jellyfin** (busca pelo título) · **+ Seerr** (`/movie/<id TMDB>` quando a página informa o id, senão busca) |
| Receita (JSON-LD `Recipe`, inclusive em `@graph` e listas) | **+ Mealie** (importar por URL) |
| Google Voos (rota na URL: `q=` ou `tfs=`) | **Skyscanner** com a mesma rota e datas |
| Skyscanner (`/transporte/passagens-aereas/…`) | **Google Voos** com a mesma rota e datas |

Sites de receita: TudoGostoso, Receitas Globo, Panelinha, Receiteria, CyberCook, Receitas Nestlé,
Guia da Cozinha, Ana Maria Brogui, Receitas de Comida, Cookpad, Allrecipes, BBC Good Food, Serious
Eats, Simply Recipes, Bon Appétit, Food.com e Tasty. Nunca roda em `camara.leg.br`/`camara.gov.br`.

Endereços (valores do gerenciador, por aparelho; padrão = endereços públicos; um endereço da rede
local também serve):

| Chave | Padrão |
|---|---|
| `jellyfin` | `https://jellyfin.georritmo.com` |
| `seerr` | `https://seerr.georritmo.com` |
| `mealie` | `https://receitas.georritmo.com` |
| `mealieGrupo` | `home` (slug do grupo do Mealie na URL `/g/<grupo>/r/create/url`) |

O "×" esconde o chip na página atual. Menu: **Esconder o chip neste site** (desfazer: apague o host
da chave `esconder`).

## Cookies (`cookies-aceitar.user.js`)

Clica em "aceitar" nos avisos de cookies e some com eles: OneTrust, Cookiebot, Didomi, Quantcast,
Usercentrics, TrustArc, CookieYes, Complianz, Adopt, Osano, iubenda, Termly, gov.br e avisos
genéricos. Para de procurar após 15 s.

- **Aviso genérico** (só na página principal): o botão precisa estar **dentro** de uma caixa fixa ou
  com nome de cookie/consentimento que mencione "cookie" (no id/classe ou num texto curto);
  "privacidade", "LGPD" ou "dados pessoais" sozinhos não bastam. O texto do botão tem de ser um
  aceite explícito ("Aceitar todos", "Aceitar cookies", "Aceito os cookies", "Permitir todos",
  "Accept all", "Allow all"…). "OK", "Entendi", "Prosseguir" só valem quando a própria caixa tem
  "cookie" no id/classe.
- **Nunca clica** em botão de envio (`submit`), em nada dentro de formulário, em diálogo modal que não
  seja de cookies, nem em caixa com campo de texto, senha, CPF ou cartão.
- **Iframes**: só os botões das plataformas conhecidas.
- Não roda em `sso.acesso.gov.br` (login gov.br) nem em `camara.leg.br`/`camara.gov.br`.
- Diagnóstico: com o valor `debug` = `true` no gerenciador, marca no `<html>` qual regra clicou
  (`data-us-cookies`).

Menu: **Não mexer nos cookies deste site** (desfazer: apague o host da chave `desligado`).

---

## Testes

Requisitos: Node ≥ 18, Python 3 com `pytest` e `playwright` (Chromium).

```bash
cd tests
python3 -m pytest -q          # offline: sintaxe, cabeçalhos, escopo e fixtures
python3 fixture_shots.py      # prints das fixtures em docs/screenshots/
python3 smoke_real.py         # páginas reais (rede); resumo em docs/screenshots/smoke-resultados.json
```

- `test_static.py`: `node --check`, cabeçalho (namespace, versão, `@downloadURL`/`@updateURL`,
  grants mínimos, sem `@require`, rede restrita à continuação AliExpress) e escopo de `@match`/`@exclude` por um verificador
  próprio (`matchpattern.py`), inclusive que o `@match` de dados pessoais só tem sites genéricos.
- `test_shop_filter.py`: escala 5 e 10, patrocinado aprovado/reprovado/sem nota, ocultar/esmaecer,
  sliders e toggles mudando o resultado e persistindo após recarregar, rolagem infinita, nó
  reaproveitado, combos do AliExpress (loja, cupom e botão de carrinho intactos; `_blank`), sites
  experimentais só esmaecem, vitrine com vários produtos rejeitada, relógio que muda 1×/s sem
  revarrer, `position` só em cartão `static`, gaveta no celular (alvos ≥ 44 px), claro/escuro.
- `test_dados_pessoais.py`: caixa de correio e app reativo (0 erros, rascunho intacto, nada fora do
  painel), negativos (RG sem contexto, `svg`, editáveis), revelar no hover, "nunca neste site",
  espera máxima com re-render contínuo, nada fora da viewport, troca do `<body>`.
- `test_cookies.py`: OneTrust, aviso genérico em caixa com "cookie" no id, id genérico (oculto e fora
  de aviso ignorados), negativos (login com CPF e `submit`, pagamento, compartilhamento de dados,
  cabeçalho fixo, formulário com "OK", caixa com senha), iframes só com plataformas conhecidas,
  aviso tardio, parada aos 15 s, marca de diagnóstico só com `debug`, exclusão por site.
- `test_links.py`: Letterboxd (TMDB), IMDb, receitas em `@graph`/lista, Google Voos (`q` e `tfs`) ⇄
  Skyscanner, SPA mudando a rota, sem rota na URL não lê o texto da página, alvo de 44 px no PC e
  no celular.

As fixtures ficam servidas nos hosts reais por `route()` do Playwright, para o script escolher o
adaptador pelo host como faria no navegador. O adaptador `loja-exemplo.invalid` (escala 0–10) só
existe para os testes; o `@match` nunca injeta nesse host.

## Imagens

`docs/screenshots/`: páginas reais em PC (1366×768) e celular (412×915) e fixtures com dados
fictícios (borrão, escala 0–10, painel escuro).
