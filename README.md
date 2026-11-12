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
| MakerWorld | modelos/criadores ocultos, filtros e carregamento nativo assistido (experimental) | [makerworld-filter.user.js](https://raw.githubusercontent.com/raschagas/userscripts/main/src/makerworld-filter.user.js) |
| Dados pessoais | borra dados pessoais na tela (desligado por padrão) | [dados-pessoais.user.js](https://raw.githubusercontent.com/raschagas/userscripts/main/src/dados-pessoais.user.js) |
| georritmo-links (links do homelab) | chip com Jellyfin, Seerr, Mealie e comparação de voos | [georritmo-links.user.js](https://raw.githubusercontent.com/raschagas/userscripts/main/src/georritmo-links.user.js) |
| Cookies | aceita e fecha avisos de cookies/LGPD | [cookies-aceitar.user.js](https://raw.githubusercontent.com/raschagas/userscripts/main/src/cookies-aceitar.user.js) |
| Unbloat — limpar sites | oculta Shorts, recomendações e banners no YouTube; banners de app, pop-ups e carrosséis nas lojas | [unbloat.user.js](https://raw.githubusercontent.com/raschagas/userscripts/main/src/unbloat.user.js) |

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

Cada anúncio ganha um **círculo** a 12 px do topo e da esquerda da foto (na Amazon em PC, da moldura
quadrada da foto, para os círculos ficarem alinhados na fileira mesmo com selos como "Escolha da
Amazon" ou fotos estreitas): verde = passa, vermelho = reprovado, cinza = sem dados. Ao lado,
opcionalmente, nota e quantidade (`4,8★ · 476`, ou `9,2/10 · 96` em lojas com outra escala).
Reprovados ficam esmaecidos (o véu some ao passar o mouse) ou ocultos; oculto sai da grade inteiro
(o item do contêiner de resultados), e os demais anúncios sobem sem deixar buraco. Patrocinados só
ficam se forem aprovados e ganham o selo azul "patrocinado ✓".

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

A versão 1.2.0 tem testes offline de paginação e cancelamento; a validação visual da continuação
em página real não foi concluída porque o AliExpress apresentou CAPTCHA no ambiente de teste.

Menu: **Abrir ajustes do filtro** · **Desligar/ligar neste site**.

| Site | Situação |
|---|---|
| AliExpress (PC e celular) | testado em página real em 2026-11-10; ocultar sem buracos na grade conferido em 2026-11-11 |
| Amazon.com.br (PC e celular) | testado em página real em 2026-11-10; círculo alinhado pela moldura da foto conferido em 2026-11-11 |
| KaBuM | testado em página real em 2026-11-10 (sem contagem: filtra só pela nota) |
| Shopee | verificado com o dono logado (a busca exige login; não abre no navegador automatizado). Oculta reprovados (o `li` da grade) e põe o círculo no canto da foto |
| Mercado Livre, Magalu, Americanas, Casas Bahia, Temu, Shein | **experimental**: não abrem no navegador automatizado (login/403); seletores semânticos e por texto, não verificados. Só esmaece (nunca oculta, mesmo com "Ocultar reprovados" ligado; o painel avisa). Com menos de dois anúncios reconhecidos, ou "cartões" que reúnem vários produtos, o script não marca nada. |

## Dados pessoais (`dados-pessoais.user.js`)

Versão 2.0.0. Um só script, com um adaptador por app sobre o mesmo motor (mesmo atalho, mesmo
estado). Desenha caixas com desfoque **por cima** da página — não altera nem envolve o texto, então
funciona em apps reativos. Não borra campos editáveis (a caixa de escrever fica intocada) nem `svg`,
respeita painéis com rolagem e o que está coberto por menus. Na dúvida, borra a mais: deixar escapar é
pior.

**Nomes**

- **Pela estrutura**: no Outlook Web e no Gmail, remetente e destinatários; no Teams, participantes e
  autores. Os nomes achados ali entram num dicionário da página e passam a ser borrados também no
  corpo do texto, inclusive sozinhos ("Abraço, Beltrana").
- **Fallback geral**: duas ou mais palavras com maiúscula (com da/de/do/dos/e), menos meses, dias da
  semana, cargos ("Deputado Fulano Silva" → só o nome), órgãos e lugares ("Câmara dos Deputados",
  "São Paulo"), menus e produtos. Nomes em MAIÚSCULAS, "Sobrenome, Prenome" e "Prenome S." usam a
  lista dos 4.000 prenomes mais frequentes do Censo 2010 do IBGE (via Brasil.IO, `genero-nomes`).
- **Fotos de perfil nunca são borradas** (nem as iniciais no lugar da foto). Só QR codes (ex.: tela
  de login do WhatsApp) e miniaturas de anexo com nome sensível.

**Mensageiros** (WhatsApp Web, Telegram Web `/k` e `/a`, Chatwoot):

- borra o nome de **toda** conversa, de grupo e individual, na lista lateral e no cabeçalho;
- borra **todo** número de telefone, onde aparecer;
- borra a prévia das mensagens na lista lateral;
- **não** borra quem enviou, nem dentro da conversa nem na lateral: o prefixo "Fulano:" da prévia
  fica legível; só o texto depois dele é borrado. Hora e contador de não lidas também ficam.
- O Chatwoot é auto-hospedado: o script o reconhece pela estrutura (rota `/app/accounts/<n>/` ou
  componentes do painel), não pelo endereço. Inclua o host do seu Chatwoot como regra `@match`
  pessoal ([Sites extras por aparelho](#sites-extras-por-aparelho)); `app.chatwoot.com` já está
  incluído.

**Padrões**: CPF (inclusive mascarado e sem máscara com "CPF" por perto), CNPJ, RG (só com
"RG"/"identidade"/"SSP"), CNH, título de eleitor, PIS/PASEP/NIS, passaporte, placa (antiga e
Mercosul), data de nascimento com contexto ("nasc.", "nascimento", "DN"), telefones (+55 e
internacionais, com e sem máscara; "61999999999" sozinho ou "fone 6132160000"), `@usuario`, e-mails,
CEP, endereços, valores em R$, agência/conta, cartões, chave Pix aleatória, linha digitável de
boleto, matrícula/ponto/Siape com contexto, IPv4 e anexos com nome sensível (RG, CPF, CNH, laudo,
extrato, boleto…).

**Uso**

- Começa **desligado**. **Alt+Shift+P** liga e desliga (o estado fica salvo). Ligado, mostra o selo
  **🔒 borrando** num canto — aparece nos prints; um clique nele desliga. Canto: valor
  `canto_selo` no gerenciador (`inferior-esquerdo`, padrão; `inferior-direito`, `superior-esquerdo`,
  `superior-direito`).
- Passar o mouse sobre uma caixa revela só aquele item.
- Menu: **Ligar/desligar (Alt+Shift+P)** · **Nomes extras a borrar…** (lista separada por vírgula,
  ex.: `Fulano, Siqueira`; cada nome vale sozinho, sem sobrenome) · **Nunca neste site** /
  **Voltar a borrar neste site**.
- Roda **só** em: Gmail, Google Contatos, Outlook pessoal (`outlook.live.com`), Outlook Web do
  Microsoft 365 (`outlook.office.com`, `outlook.office365.com`), WhatsApp Web, Telegram Web, Teams
  (`teams.microsoft.com`, `teams.cloud.microsoft`) e Chatwoot em nuvem (`app.chatwoot.com`). Outros
  sites (Outlook da intranet, Chatwoot próprio, homelab): veja
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
Usercentrics, TrustArc, CookieYes, Complianz, Adopt, Osano, iubenda, Termly, gov.br, Google Funding
Choices, Sourcepoint, consentmanager, Cookie Notice, Klaro, Borlabs Cookie 3, CookieHub, Axeptio,
Moove GDPR e avisos genéricos. Para de procurar após 15 s.

Plataformas acrescentadas na 1.1.0 e como cada seletor foi conferido (2026-11-11):

| Plataforma | Botão clicado | Conferido em |
|---|---|---|
| Google Funding Choices (Privacidade e mensagens) | `.fc-consent-root .fc-cta-consent` ("Consentir") | página real (dicio.com.br, todamateria.com.br, infoescola.com com `?fc=alwaysshow`, parâmetro de prévia da [documentação oficial](https://developers.google.com/funding-choices/fc-api-docs)); clique confirmado |
| Sourcepoint | `button.message-button.sp_choice_type_11` (11 = aceitar tudo; nunca 9 = assinar, 12 = opções, 13 = rejeitar) | página real (spiegel.de, theguardian.com, bild.de; iframe no subdomínio do próprio site); clique confirmado |
| consentmanager | `#cmpbox .cmpboxbtnyes`, inclusive dentro do shadow DOM `#cmpwrapper` | página real (consentmanager.net); clique confirmado |
| Cookie Notice (WordPress) | `#cookie-notice #cn-accept-cookie` | código público do plugin (`includes/frontend.php` no SVN do WordPress.org) |
| Klaro | `.klaro .cookie-notice .cm-btn-success` (aviso) e `.klaro .cm-btn-accept-all` (janela) | página real (klaro.org, aviso; clique confirmado) e código público (`consent-notice.jsx`, `consent-modal.jsx` em klaro-org/klaro-js) |
| Borlabs Cookie 3 | `#BorlabsCookieBox .brlbs-btn-accept-all` | página real (borlabs.io; a caixa só aparece depois de mexer na página); clique confirmado |
| CookieHub | `#ch2-dialog .ch2-allow-all-btn` | página real (cookiehub.com); clique confirmado |
| Axeptio | `#axeptio_btn_acceptAll` dentro do shadow DOM de `#axeptio_overlay > div` | página real (axept.io); clique confirmado (cookies `axeptio_*` gravados) |
| Moove GDPR Cookie Compliance (WordPress) | `#moove_gdpr_cookie_info_bar .moove-gdpr-infobar-allow-all` | código público do plugin (`gdpr-modules/infobar/infobar-buttons.php` no SVN do WordPress.org) |

Pendentes (não entram sem conferência): Ketch (o site oficial só mostrou a janela de preferências,
em que "Accept All" apenas liga os interruptores e não fecha), Real Cookie Banner (devowl.io não
exibiu o aviso no navegador automatizado; classes geradas), Privacy Tools (nenhum site público com o
aviso encontrado), Borlabs 2 (`._brlbs-btn-accept-all`) e o id antigo do consentmanager
(`#cmpbntyestxt`).

- **Aviso genérico** (só na página principal): o botão precisa estar **dentro** de uma caixa fixa ou
  com nome de cookie/consentimento que mencione "cookie" (no id/classe ou num texto curto);
  "privacidade", "LGPD" ou "dados pessoais" sozinhos não bastam. O texto do botão tem de ser um
  aceite explícito ("Aceitar todos", "Aceitar cookies", "Aceito os cookies", "Permitir todos",
  "Accept all", "Allow all"…). "OK", "Entendi", "Prosseguir" só valem quando a própria caixa tem
  "cookie" no id/classe.
- **Nunca clica** em botão de envio (`submit`), em nada dentro de formulário, em diálogo modal que não
  seja de cookies, nem em caixa com campo de texto, senha, CPF ou cartão.
- **Iframes**: só os botões das plataformas conhecidas.
- **Plataformas conhecidas**: só o botão de aceitar daquela plataforma (nunca recusar, fechar,
  assinar ou ajustes); em shadow DOM aberto, só nas plataformas listadas acima.
- Não roda em `sso.acesso.gov.br` (login gov.br) nem em `camara.leg.br`/`camara.gov.br`.
- Diagnóstico: com o valor `debug` = `true` no gerenciador, marca no `<html>` qual regra clicou
  (`data-us-cookies`).

Menu: **Não mexer nos cookies deste site** (desfazer: apague o host da chave `desligado`).

## Unbloat — limpar sites (`unbloat.user.js`)

Oculta por CSS (`display:none`) o que distrai no YouTube e nas lojas. **Nunca clica**, não remove nada
da página e não toca em formulário; desligar uma regra devolve o elemento na hora. Não duplica o
Filtro de lojas: os cartões do resultado da busca ficam por conta dele.

| Site | Regra (menu) | Padrão | O que some | Conferido em página real (2026-11-11) |
|---|---|---|---|---|
| YouTube | Shorts | ligada | prateleira na página inicial e na busca (PC e celular), aba no menu lateral (aberto e recolhido) e na barra inferior do celular, itens de Shorts nos resultados e nas recomendações | sim: prateleiras, abas e itens da busca no celular; itens soltos no PC (`ytd-video-renderer`/`yt-lockup-view-model` com link `/shorts/`) não apareceram na sessão de teste |
| YouTube | Recomendações da lateral (vídeo) | ligada | `#related` ao lado do vídeo (a playlist e o chat ficam) | sim |
| YouTube | Recomendações do fim do vídeo | ligada | tela de fim, cartões finais e grade de sugestões em tela cheia | elementos presentes na página do vídeo; a tela de fim em si não foi exibida no navegador automatizado |
| YouTube | Banners de anúncio, Premium e loja | ligada | anúncio de topo, anúncio no feed e na lateral, prateleira de produtos | sim (anúncio de topo, no feed e na lateral; prateleira de produtos presente oculta) |
| YouTube | Feed da página inicial | desligada | grade de vídeos da página inicial | sim |
| AliExpress | Banners "baixe o app" | ligada | item "Faça o download do aplicativo" do cabeçalho (PC) e faixa "Use o app" (celular) | sim |
| AliExpress | Pop-ups de promoção, cupom e moedas | ligada | pop-up de tela cheia e selo flutuante de promoção | sim (página inicial); a verificação "não sou um robô" nunca é ocultada |
| Amazon.com.br | Carrosséis patrocinados fora do resultado | ligada | carrossel "Ofertas do dia · Patrocinado" e faixa de anúncio no fim da lista (o resultado patrocinado continua com o Filtro de lojas) | sim (PC e celular) |
| Amazon.com.br | "Vistos recentemente" e recomendações do rodapé | ligada | bloco `#rhf` acima do rodapé | sim |
| Amazon.com.br | Pop-up de login/ofertas (celular) | ligada | folha "Ofertas exclusivas e compra mais rápida" | sim |
| Mercado Livre | Banners "abra o app" | ligada | folha "Abra o app e ganhe" (celular; devolve a rolagem da página) e faixa do rodapé | sim (página inicial) |
| Mercado Livre | Faixas de anúncio | ligada | faixas de anúncio (`section.adn`) | sim (página inicial) |

Busca do Mercado Livre: bloqueada no navegador automatizado (verificação de conta); carrosséis da
busca ainda não têm regra. Banners de Premium/"mealbar" do YouTube não apareceram na sessão de teste
e ficaram de fora.

Menu do gerenciador: uma entrada por regra (`✓ … (oculto)` / `✗ … (visível)`; clicar alterna na hora
e fica salvo) e **Desligar neste site** / **Ligar neste site**. Na página de Shorts e na aba Shorts de
um canal os Shorts não são ocultados. Nunca roda em `camara.leg.br`/`camara.gov.br`, nem se for
acrescentado por regra extra do gerenciador.

Valores no gerenciador: `regras` (por site e regra, `true` = ocultar) e `desligado` (hosts separados
por vírgula).

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
- `test_cookies.py`: cada plataforma acrescentada na 1.1.0 clica só no aceitar e, sem ele, não clica
  em nada; shadow DOM oculto ignorado; Sourcepoint em iframe; OneTrust, aviso genérico em caixa com "cookie" no id, id genérico (oculto e fora
  de aviso ignorados), negativos (login com CPF e `submit`, pagamento, compartilhamento de dados,
  cabeçalho fixo, formulário com "OK", caixa com senha), iframes só com plataformas conhecidas,
  aviso tardio, parada aos 15 s, marca de diagnóstico só com `debug`, exclusão por site.
- `test_unbloat.py`: em cada site, regra ligada oculta, desligada mostra, nada fora do escopo some,
  nada é clicado; menu alterna ao vivo e persiste; desligar no site remove o estilo; página de Shorts
  e navegação sem recarregar do YouTube; rolagem devolvida no Mercado Livre; verificação de robô do
  AliExpress intacta; nada na Câmara nem fora dos sites.
- `test_links.py`: Letterboxd (TMDB), IMDb, receitas em `@graph`/lista, Google Voos (`q` e `tfs`) ⇄
  Skyscanner, SPA mudando a rota, sem rota na URL não lê o texto da página, alvo de 44 px no PC e
  no celular.

As fixtures ficam servidas nos hosts reais por `route()` do Playwright, para o script escolher o
adaptador pelo host como faria no navegador. O adaptador `loja-exemplo.invalid` (escala 0–10) só
existe para os testes; o `@match` nunca injeta nesse host.

## Imagens

`docs/screenshots/`: páginas reais em PC (1366×768) e celular (412×915) e fixtures com dados
fictícios (borrão, escala 0–10, painel escuro).

## Novos scripts 1.0.0

- [YouTube — continuar assistindo](https://raw.githubusercontent.com/raschagas/userscripts/main/src/youtube-continuar.user.js): Confirma somente o aviso de inatividade do YouTube.
- [Reddit — idioma original](https://raw.githubusercontent.com/raschagas/userscripts/main/src/reddit-clean.user.js): Remove tradução automática; old.reddit opcional no menu.
- [Google — links diretos e Web opcional](https://raw.githubusercontent.com/raschagas/userscripts/main/src/google-clean.user.js): Preserva respostas por IA; oferece Web no menu e limpa links de resultados.
- [Amazon — link limpo e Keepa](https://raw.githubusercontent.com/raschagas/userscripts/main/src/amazon-links.user.js): Oferece link do produto sem parâmetros e consulta ao Keepa somente por clique.

Reddit mantém a interface atual por padrão; a opção old.reddit persiste no gerenciador. Google mantém a busca normal e a IA; Web só abre por escolha no menu. Amazon só mostra os links na página de produto (.com.br); nenhuma consulta ao Keepa ocorre antes do clique. YouTube confirma apenas o diálogo reconhecido de inatividade, sem retomar pausas manuais. Implementações originais, sem código copiado das propostas anteriores. Verificação em fixtures não substitui aceitação no Edge e nos aplicativos reais.

## MakerWorld (`makerworld-filter.user.js`)

**Experimental, publicado por solicitação do dono sem sessão no site real.** Validado em fixtures
Playwright, não em páginas reais: o acesso automatizado retornou Cloudflare 403. Nenhuma instalação
no navegador do dono foi feita. Ações ficam no menu “Ocultar” do cartão; ajustes ficam na pílula,
com painel no PC e gaveta no celular. Cores, véu e alvos seguem o filtro de lojas.

- Ocultar modelo ou criador persiste no gerenciador por dispositivo; desfazer último ocultamento
  e restaurar por nome/ID ficam no painel. Criador sem ID numérico reconhecível não ganha ação.
- Palavras no título: uma por linha, trechos literais, sem distinguir maiúsculas ou acentos.
  Curtidas/downloads mínimos: 0 por padrão. Apenas métricas explicitamente rotuladas são lidas;
  números sem rótulo ficam desconhecidos, nunca viram zero. Não é filtro de nota de impressão.
- Reprovados recebem véu por padrão; “Ocultar reprovados” remove-os da grade. Dados ausentes
  permanecem visíveis. Configurações inválidas voltam aos padrões seguros.
- Carregamento assistido começa ligado: aciona apenas um botão nativo inequívoco “Load more”,
  “Show more models”, “Carregar mais” ou “Mostrar mais modelos” dentro de `main`, perto da
  viewport. Aguarda modelos novos, pausa após três lotes consecutivos sem resultado visível ou
  após 12 segundos sem progresso. “Continuar” permite uma nova tentativa. Não faz chamadas de API
  nem navega páginas numeradas. **Rolagem infinita que o site já executa permanece nativa**;
  a pausa e o toggle controlam apenas os cliques do script, não requisições iniciadas pelo site.
- Home, busca, categorias, criadores e coleções usam o mesmo reconhecedor de cartões.
  `.js-design-card` e artigos semânticos com imagem e um único ID de modelo são candidatos;
  layouts desconhecidos ficam intactos. Esses tipos de página não foram verificados ao vivo.
- Desligar remove observadores, temporizadores e marcações. Para religar, use o menu Violentmonkey.

O seletor `.js-design-card` e o caminho de título foram conferidos como pistas no
[código público MakerWorld Enhancements](https://github.com/JMcrafter26/userscripts/blob/main/makerworld-enhancements/makerworld-enhancements.user.js);
não foi incorporado código desse projeto. Os testes sintéticos cobrem comportamento, não
confirmam compatibilidade atual do DOM. Imagens `makerworld-fixture-*` usam dados fictícios.

Para recuperar a página: desligue o script no menu ou no gerenciador. Os ajustes ficam preservados.
A primeira versão não substitui nenhum script existente.
