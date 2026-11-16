# Navidrome — letras: notas (2026-11-16)

## Nativo antes

- **Navidrome 0.64 (UI web)**: a barra de letra do player só recebe o que vem no campo `lyrics` da faixa;
  letras em `.lrc`/`.yml` ao lado da música chegam só pela API Subsonic `getLyricsBySongId`
  (navidrome#4148, #6191). O servidor já entrega sidecars sincronizados desde a 0.63.
- **Greasy Fork — NavidromeGeniusLyrics** (script 520494, v1.0.2, MIT): troca o botão de letra por uma
  busca no Genius. Não lê as letras do próprio servidor nem sincroniza. Não serve.
- **GitHub — J0R6IT0/navidrome-lyrics-plugin**: plugin de servidor com provedores externos; o README diz
  que a UI web não mostra letras de plugin.
- OpenUserJS e Userscript.Zone: nada para Navidrome (Greasy Fork recusa busca automatizada; achado pela web).

## Rodadas

1. Painel/gaveta/tela cheia próprios (A/B/C): o dono pediu **usar o lugar nativo** da letra no Navidrome.
2. Preencher o campo de letra que a própria UI usa (abaixo), com duas opções para letra só texto.
3. Aceita a opção A (rodada 97): letra só texto fica como no nativo. Versão 1.0.0 enviada para aceite
   final (rodada 102).
4. Versão 1.0.1 (revisão, depois das imagens da rodada 102): listas grandes/aleatórias sem espera, offset
   pelo sinal da especificação, cache só de respostas bem-sucedidas, `c=NavidromeUI`, quebras de linha
   dentro de uma linha viram espaço. A barra nativa mostrada nas imagens não muda.

As imagens de aprovação (capas e letras da biblioteca do dono) não ficam no repositório: estão no
NewsReader — Aprovações, conversa `mediastack/navidrome-letras`, rodadas 96, 97 e 102.

## Como a UI 0.64.2 mostra letra (lido no bundle `/app/assets/index-*.js`)

- Cada item da fila é montado do registro de `/api/song` (lista ou item) ou `/api/playlist/<id>/tracks`
  pela função que lê `song.lyrics`: string JSON `[{lang, synced, line:[{start(ms), value}], …}]`; vazio é `"[]"`.
- Só as entradas `synced: true` viram LRC (`[mm:ss.cc] texto`, uma por linha) no campo `lyric` do item da
  fila. **Letra só texto é ignorada** pela UI, mesmo embutida.
- O player (react-jinke-music-player) tem `showLyric: true`: o botão de livro aparece **sempre**; abre uma
  barra de uma linha com a linha atual ("No lyrics" quando o LRC está vazio). No celular o botão fica no
  player em tela cheia.
- A UI busca `/api/*` com `fetch` (cabeçalho `x-nd-authorization`); XHR não é usado nessas rotas.

## O que o script faz

- `@run-at document-start`, injeta um `<script>` no contexto da página (o Navidrome não envia CSP) que
  envolve `window.fetch`. Em `GET` da própria origem para `/api/song`, `/api/song/<id>` e
  `/api/playlist/<id>/tracks`, com resposta OK e JSON, preenche `lyrics` das faixas **sem** letra
  sincronizada usando `getLyricsBySongId` (sessão Subsonic da UI: `username`, `subsonic-salt`,
  `subsonic-token` no `localStorage`). A resposta é recriada com os mesmos status e cabeçalhos
  (`X-Total-Count` incluído). Qualquer erro devolve a resposta original.
- Faixas que já têm sincronizada (ex.: embutida) não geram requisição e ficam intactas.
- Letra só texto fica de fora (a barra nativa mostra "No lyrics"), como escolhido na aprovação.
- **Por que lista inteira e não só a fila**: a UI converte o registro em item da fila de forma síncrona no
  clique de tocar, com o registro já carregado; não há como buscar "depois" sem mexer no estado interno
  do React. Então o preenchimento acontece quando a lista chega:
  - uma requisição por faixa; buscas simultâneas da mesma faixa compartilham a promessa; no máximo 4
    consultas ao mesmo tempo (somando as de fundo) e até 100 faixas por resposta;
  - **álbum, item e lista pequena (até 30 faixas)**: a resposta espera no máximo 3 s; o que não chegar a
    tempo entra na próxima resposta da mesma faixa;
  - **lista com mais de 30 faixas ou `_sort=random`**: não espera; preenche só o que já está guardado e
    busca o resto em segundo plano, para a próxima resposta — a reprodução nunca fica esperando;
  - guarda só resultado de resposta bem-sucedida (HTTP ok e `status: ok`, inclusive "sem letra"); erro
    HTTP, `status: failed` ou falha de rede não ficam guardados e são tentados de novo na próxima resposta.
  Álbum de 6 faixas: 6 requisições na primeira visita, 0 depois.
- `offset` segue a [especificação OpenSubsonic de `structuredLyrics`](https://opensubsonic.github.io/docs/responses/structuredlyrics/):
  milissegundos, positivo = a letra aparece antes; início efetivo = `start − offset`.
- Usa `c=NavidromeUI`, o mesmo cliente da UI, para o servidor não registrar outro player.
- Quebra de linha (`\r\n`, `\r`, `\n`) dentro de uma linha da letra vira espaço (o LRC nativo é uma linha
  por marca de tempo).
- Limite: faixas que já estavam na fila salva (`localStorage.state`) antes de instalar continuam sem letra
  até serem tocadas de novo a partir de uma lista.

## Capturas em página real (`tests/navidrome_proto.py`)

Faixas, álbuns e segundos do print entram pela linha de comando (nenhum dado de biblioteca no
repositório); prints e `resultados.json` vão para `.cache/navidrome-letras/` (ignorado pelo git).
Navidrome real, login da UI feito uma vez (storage state fora do repositório), script em
document-start, áudio mudo, barra nativa aberta pelo botão. Bloqueados nas rotas: `scrobble`,
`reportPlayback` (o 0.64 o usa para "tocando agora"), `savePlayQueue`, favoritos, notas, playlists,
bookmarks e qualquer escrita em `/api/*`.
