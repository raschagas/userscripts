// ==UserScript==
// @name         Dados pessoais — borrar na tela
// @namespace    raschagas/userscripts
// @version      2.0.0
// @description  Borra nomes, documentos (CPF, RG, CNH, título, PIS, passaporte), telefones, e-mails, endereços, placas, Pix, boletos, valores, contas e anexos sensíveis na tela; nos mensageiros borra o nome das conversas, os telefones e as prévias, deixando legível quem enviou. Começa desligado; Alt+Shift+P liga e desliga. Não altera a página: desenha o borrão por cima.
// @match        https://mail.google.com/*
// @match        https://contacts.google.com/*
// @match        https://outlook.live.com/*
// @match        https://outlook.office.com/*
// @match        https://outlook.office365.com/*
// @match        https://web.whatsapp.com/*
// @match        https://web.telegram.org/*
// @match        https://teams.microsoft.com/*
// @match        https://teams.cloud.microsoft/*
// @match        https://app.chatwoot.com/*
// @noframes
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/raschagas/userscripts/main/src/dados-pessoais.user.js
// @updateURL    https://raw.githubusercontent.com/raschagas/userscripts/main/src/dados-pessoais.user.js
// ==/UserScript==

(() => {
  'use strict';
  const get = (k, d) => { try { return GM_getValue(k, d); } catch (_) { return d; } };
  const set = (k, v) => { try { GM_setValue(k, v); } catch (_) {} };
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const wordSet = s => s.split(/\s+/).filter(Boolean).map(w => w.toLowerCase());

  // ---------- nomes: vocabulário ----------
  // Prenomes: os 4.000 mais frequentes no Brasil segundo o Censo Demográfico 2010 do IBGE (frequência
  // >= 2.860 pessoas), tirados do conjunto público "genero-nomes" do Brasil.IO
  // (https://brasil.io/dataset/genero-nomes/, derivado de https://censo2010.ibge.gov.br/nomes/).
  // Sem acento, em ordem alfabética e com prefixo comum compactado: "3son" depois de "edi" = "edison"
  // (o dígito diz quantas letras repetir da palavra anterior).
  const FIRST_PACKED = [
    'abadia 2dias 2el 4ardo 2gail 2igail 3lio 3mael 2mael 2ner 2raao 4o 1cacio 3ssio 2ir 1da 3il 5son 5to 7n 4r',
    '3lberto 4gisa 6za 4to 6n 3o 3uto 2eilda 6o 5son 5ton 4r 3laide 5r 4cio 4ia 5ce 5na 6o 5o 5r 5ta 4ma 5o 4so 6n',
    '3mar 6io 4ilson 6ton 5r 3nilda 7o 6son 6ton 6za 5r 3raldo 4bal 4son 3valdo 2iel 3la 4io 4ma 4so 6m 6n 4ton',
    '3milson 3r 3son 2milson 4r 2na 2olfo 3nias 2reia 3ia 5n 6a 6e 6o 4el 6e 6i 6le 7y 6y 5ne 4na 3oaldo 2son 1ecio',
    '2lson 1fonso 2ranio 1gata 4ha 2da 2emiro 3nor 3u 2naldo 3elo 4s 2ostinho 2ripino 2uida 4naldo 3stinho 1ida 3e',
    '2la 3son 3tom 5n 2res 3ton 2slan 1laide 6s 4ne 4r 3m 3n 4a 4e 4i 5s 3or 2ba 4no 3eri 6co 5t 6ina 8o 6o 3ina 5o',
    '2cebiades 4mir 4nir 4u 3i 4des 4lene 4mar 4na 5do 5eia 5o 4one 4r 2da 4ir 3eci 6r 4ir 4mar 5ir 4ni 6ce 6r 7a',
    '5or 7a 3ilene 4neia 4r 3o 2eandro 3cio 4sandro 3f 4e 3jandro 3ncar 3rrandro 3sandra 8o 4sandra 9o 3x 4adre',
    '5nder 7ra 8e 8ina 8o 4ia 4sander 8ra 9o 5sandro 2feu 3redo 2gusto 2iane 3ce 4ia 5o 3ete 3fe 5r 3na 4e 4i 3pio',
    '3rio 3som 5n 4som 6n 2lan 5a 3ison 2merinda 8o 3ir 5a 5o 2oisio 4zio 3nso 2tair 4mir 7a 7o 3emar 5ir 3ina 5o',
    '2uisio 4zio 2varo 3ina 5o 2yson 4son 2zenir 7a 3ira 1mabile 3da 4eu 6s 4o 3lia 3ncio 4da 3ra 4ildo 4o 3uri 5y',
    '2brosina 7o 2elia 3rica 6o 2iltom 6n 2os 1na 3cleto 3dir 3ilton 4r 3lia 5ce 3nda 4ias 3stacia 8o 3talia 2celmo',
    '2dersom 7n 6son 4son 3re 5a 5i 6a 6na 5lina 5sa 6on 6sa 5w 5y 5za 6za 4ia 5el 7e 7i 2e 3lise 5ta 3sia 5o 3te',
    '3zia 2gel 5a 5ica 6na 7o 6ta 5o 2i 3bal 3ele 3lda 5o 4son 4ton 3sia 5o 3ta 3zia 5o 2na 3e 3y 2selmo 2tenor 4ro',
    '3hony 3inio 3oni 6a 6el 7ta 6na 7ho 7o 6o 5y 2y 1parecida 8o 4icio 1quila 5es 1raci 4y 3o 2gemiro 4ntina 4u 2i',
    '3adne 4na 5e 3el 5a 5e 5i 3ldo 4son 3osvaldo 4valdo 3steu 5ide 8s 5on 6teles 3valdo 2lan 3ei 5de 4ne 4te 4y',
    '3inda 6o 2mando 3inda 6o 2naldo 3ildo 3o 4ldo 2oldo 2quimedes 2temio 3hu 5r 3u 4r 2y 1ssis 1taide 2ila 4io 2os',
    '1ugusta 6inho 6o 2rea 4lia 7no 6na 7o 6o 4ni 6ce 4o 3i 4a 4celia 8o 4lene 4neide 5o 3ora 2xiliadora 2zira',
    '1vani 5r 2elina 6o 2ila 1yla 2rton 0balbina 6o 3tazar 2rbara 3tolomeu 2silio 2tista 1eatris 6z 2lmira 6o',
    '2nedita 7o 3icio 4to 3jamim 7n 3ta 4o 3vinda 2renice 3nadete 6ino 6o 5rda 7ete 7ina 9o 7o 2tania 3ina 3o',
    '1ianca 3triz 2biana 1onifacio 1raian 3s 4ilina 3ulio 3yan 3z 2ena 4da 5o 6n 4no 4o 2ian 3gida 2una 4na 4o 2yan',
    '0cacilda 2etano 2ic 3k 4e 3lane 3o 3que 3ro 2lebe 3ine 3os 2mila 5e 5i 5la 6e 6y 5o 5y 2ndida 6o 2rem 4n 3ina',
    '5e 3la 4eane 5ne 4iane 5nda 7o 5to 4o 5s 5ta 3melia 7na 8da 7ta 5m 5n 4ina 4o 5sina 3ol 5aine 5ina 7e 7i 2sia',
    '4o 3sandra 4ia 6na 7e 7o 5lda 5o 2tarina 7e 7o 3ia 5na 6e 2ua 4m 4n 5a 5e 5i 3e 1eci 4lia 6o 2leste 6ina 8o 3i',
    '4a 5ne 4na 5o 4o 4ta 3ma 3so 5n 2nira 2sar 5io 2zar 1haiane 3rlene 6s 2eila 2irlei 6y 2ristian 9e 1ibele 5i',
    '2cera 5o 2d 3a 3inei 2las 3ene 2nara 3dy 3thia 4ia 2rene 3ilo 3lei 5ne 3o 1ladio 3ir 4ton 3ra 4ice 5nda 7o 5se',
    '6sa 7e 3udeci 8r 6mir 9o 6nice 8r 7or 6te 5ia 7na 8e 8o 6ene 6lene 6mar 6na 7ei 9a 9de 8te 8y 7o 6o 7mar 8iro',
    '7nor 6r 6van 5omiro 3yton 2ea 4ne 3ber 6son 4io 4son 3ci 5a 5o 3dson 3ia 4ce 5iane 4de 5iana 8e 6mar 5son',
    '4lson 5ton 4son 5son 4to 6m 6n 3lia 3mencia 6te 7ina 4ilda 6son 6ton 3nilda 6son 5o 3o 4mar 4ne 5ice 3ria 5o',
    '5ston 3sia 5o 3udiane 4nice 4sa 4ton 4za 3verson 6ton 3yton 2icia 2odoaldo 3tilde 3ves 4is 1onceicao 3rado',
    '3stancia 7tino 4uelo 2rina 3nelio 2sma 4e 4o 1remilda 3usa 4za 2is 4laine 6ne 5ene 4pim 6na 4thian 5iam 7n 8a',
    '8e 8i 8o 6ele 6na 7e 7o 5ofer 6vao 1ustodia 7o 1ynthia 0dafine 3ne 2gmar 3oberto 2iana 5e 5i 4ra 3lson 4ton',
    '3na 4e 3r 3se 4y 3vid 2lci 3ila 3mir 4o 3ton 3va 5n 4ina 2mares 5is 3iana 5o 2ndara 3iel 6a 6e 6i 6la 7e 7i 7y',
    '6y 4la 5o 3te 3ubia 2ra 3ci 5o 4y 3i 4a 5ne 4o 3lan 4ei 5ne 5y 4i 5ane 5son 2vi 4d 5son 4la 4na 4son 2yana 5e',
    '3se 1ebora 6h 2cio 2ilson 3se 4i 5ane 3vd 4id 6e 6i 5son 4son 3ze 2jair 4lma 4ne 5ira 2lci 5o 3fina 6o 3i 4a',
    '5ne 4o 3ma 5r 4ira 6o 3son 3za 2merval 4trio 2ner 3i 4lson 5ton 5za 4r 4s 5e 5on 4val 7do 4ze 3ner 4is',
    '2oclecio 3linda 2raldo 3ci 3ick 4k 4valdo 3li 2usa 4dete 4ilene 5mar 3zimar 2vair 4nir 3id 4son 2yse 3vid',
    '1iana 4e 2ego 3ne 4ifer 2jalma 2lce 3ene 3ma 5r 3son 3va 3za 2mas 2na 4ir 4lva 3ora 2ogenes 4o 3mar 3nata 7n',
    '4e 5i 6a 5s 4isia 7o 5zio 3vana 2rce 5u 3lei 5ne 2va 4ldo 4nir 3ina 5o 1jair 3lma 3nira 1oglas 2lglas 3ores',
    '2micio 4nga 7s 6o 7s 5ique 2nato 3izete 7i 2ra 4ci 4lice 6na 3gival 3is 4val 7do 3oteia 5i 3valina 8o 2uglas',
    '1riele 1ucilene 4neia 2lce 4ilene 5neia 2rval 6ina 8o 0eber 4son 1da 2carlos 2egar 3ilson 3lson 3mar 4ilson 5r',
    '3n 4ilson 5r 3r 4son 3sio 3valdo 3zio 2gar 5d 2i 3ana 5e 3carlos 4leia 3elson 4ne 3gar 3jane 3la 5ine 5mar 5ne',
    '6ia 4berto 4eia 6de 5ne 5usa 6za 4ma 4sa 5om 6n 4ton 4za 3mar 6a 4ilsom 8n 4undo 3na 5ldo 6va 4ei 6a 6de 5lson',
    '5te 4ilson 3o 4ne 3po 3r 3son 3te 4h 3val 6do 5n 6ia 7o 2jane 2la 4ine 3ene 4usa 5za 2mar 5a 3eia 3ilsom 7n',
    '3undo 2na 4ldo 5va 4rdo 3ei 5a 5de 4lson 4y 3ilson 3o 2som 4n 2uarda 6o 2val 5do 4n 5do 5ia 6o 4r 2y 1figenia',
    '1gidio 2naldo 2on 1itor 1laine 3ne 2ba 3er 2ci 4o 2da 3er 3o 2eandro 3m 3n 4a 4i 5ce 5lda 7e 7o 6son 6ton 5r',
    '5ta 4o 3onora 3usa 4za 2i 3a 4be 4n 5a 5dra 7o 5e 5i 5o 4s 3da 4ia 6ne 5o 3el 5ma 5son 5ton 4nai 5e 4ser 5io',
    '4te 4zer 3mar 3na 5ldo 4e 5ide 5te 3o 4mar 4nai 3s 4a 5bete 8h 5ma 5ndra 8o 6e 6gela 4ete 5u 4ia 6ne 5o 4mar',
    '4on 4sandra 9o 5on 4valdo 3ta 4on 3ude 3valdo 5n 6ia 4elton 3za 5bet 8e 8h 9e 8i 5ma 5ndra 8o 6e 6gela 4el 5te',
    '5u 4ia 6ne 2lem 4n 2ma 3o 2nice 2oa 3i 4na 4r 4sa 5e 4za 2pidio 2sa 3io 3o 4n 2ton 2ves 3io 4ra 4s 2y 2za 3i',
    '4ra 1ma 3noel 7e 4uel 7a 7e 7i 7le 8y 7y 2eli 4y 3rsom 6n 2idio 3le 5ne 4i 5a 6na 7o 5o 4le 5i 5y 4son 4y',
    '1nderson 2eas 3dina 3ias 4da 2i 3lda 5o 4son 3o 3r 3valdo 2oque 2rico 4que 2y 2zo 1paminondas 2itacio 1raldo',
    '3smo 2ci 4lia 6o 2emita 3ni 5ce 5lda 5ta 2iberto 3c 4a 4k 4les 4o 4son 3k 4a 4e 3naldo 4eide 3que 3smar 4on',
    '4valdo 6n 3valdo 5n 6ia 4elto 8n 2lan 5e 3i 3on 2melinda 4s 5on 3inia 6o 2na 4ndes 6o 5e 5i 3estina 6o 3i 2on',
    '4dina 4i 5lda 7es 7o 3tides 5ldes 1sdras 2equiel 2mael 3eralda 8ina 8o 2pedita 7o 2tefane 7i 8a 7o 7y 4la 5ina',
    '6ta 4nio 4r 4vam 6n 6o 3her 1telvina 3valdo 2iene 1uclides 2des 2genia 6o 2lalia 3er 3ina 2nice 2rico 4des',
    '4pedes 2staquio 2vira 2za 3ebio 1va 3ir 3ldo 3ndo 5ro 4eide 4gelina 8sta 4i 5a 5ce 5lda 7e 7o 6son 5o 5r',
    '3risto 2elen 4i 5m 5n 6e 4lyn 4y 5n 3raldo 4son 4tom 6n 2ilasio 4in 1werton 1xpedita 7o 1zequias 6el 2io',
    '0fabia 5na 6e 6o 4ele 4o 5la 4ula 3ricia 7o 2gner 2rley 2tima 2ustina 7o 5o 1co 1elicia 7na 8o 6o 4pe 5i',
    '4sberto 4x 3lipe 2rnada 6o 5nda 7es 7o 1ilipe 5i 3omena 2rmina 6o 1lavia 6na 7e 7o 5o 2ora 5ci 4encio 6tina 9o',
    '4iano 5nda 5pes 5sbela 6valdo 5za 1racisca 7o 3ncelina 5iane 6ca 7o 6dalva 6el 8e 8i 8le 9y 8y 7ne 6leide 8ne',
    '6mar 9a 6naldo 7e 8i 9de 8te 7i 8ldo 6s 7ca 8o 7laine 8ene 7o 6valdo 5o 4isco 4k 5lin 4scisca 9o 5isco 2ed',
    '4erico 4son 2ncisco 0gabriel 7a 7e 7i 7la 8e 8i 8y 7y 5l 2ldino 2rdenia 2spar 6ina 1ean 4derson 4e 4i 2ci',
    '2dalva 2ferson 2iciane 3lson 3sa 4e 4iane 4on 3za 2lson 2ma 2nario 3eci 4rosa 4sia 6o 3i 4fer 4lda 6o 5son',
    '5ton 5za 4r 4val 7do 3oveva 3til 3y 2orge 5ia 6na 3va 5n 6a 6e 6i 7a 6na 2ralda 6ina 8o 6o 4rdo 3ci 5na 6o',
    '3emias 3lane 4iane 3mana 6o 3onimo 3son 3trudes 3usa 4za 3vasio 2siane 4ca 4el 3se 4i 5ca 2tulio 1ian 4e',
    '2celia 2deao 2l 3berto 3cimar 3da 5sio 4ete 4o 3eno 3herme 3iard 7e 3ma 5r 6a 6io 3nei 3sa 4om 5n 3ton 3vam 5n',
    '6a 6e 7ide 7te 6i 7a 3za 2na 4ldo 2ovan 6a 6e 6i 6na 7i 2rlane 4eide 5ne 2sela 5da 5e 5i 6a 5le 3laine 5ne',
    '4eine 5ne 2ulia 6na 7o 2valdo 4nilda 8o 2zele 1laci 3dis 4son 3uber 4ce 5ia 7ne 6ene 6o 5o 2edson 3ice 5iane',
    '6ele 4de 5ison 5son 4se 5on 5son 3nda 3yce 2oria 1oncala 6o 2rete 1raca 4e 4iana 7e 7o 5ela 7e 7i 6ne 6te',
    '5lene 3siela 7e 7i 3ziela 7e 7i 7le 2egori 7o 6y 3ice 1uaraci 2ido 3lerme 4herme 8ina 3omar 2lherme 2mercindo',
    '2stavo 2temberg 0hadassa 2milton 2na 3na 2roldo 1eber 5t 2ctor 2itor 2laine 3cio 3der 3em 4n 5a 5ice 6ta 5o',
    '3ga 3ia 4da 4o 4ton 3len 3oisa 6e 5za 3ton 2merson 2nri 5que 4rique 4y 2raldo 3bert 3cilia 4ulano 6es 3ica',
    '4que 3mes 4inia 7o 3nandes 3on 2verton 1iago 2go 4r 2lario 3da 4ete 4o 3lary 3ma 3ton 1omero 2norina 6o 2racio',
    '3lando 3tencia 2sana 1udson 2go 2mberto 0iago 2n 3a 3ca 3dra 3e 2ra 2smim 5n 1caro 1da 3lia 5na 2elma 1eda',
    '1gnes 2o 3r 1lana 3rio 2ca 2da 3ete 3o 2ka 2ma 4r 2sa 3e 3on 2ton 2za 1maculada 1na 3cia 5o 3ldo 3ra 2dianara',
    '5ra 2es 3z 2gred 6e 6i 4id 6e 6i 1olanda 2nara 3e 3ice 1racema 4i 5lda 5r 4y 3ides 4lde 7s 3mar 3n 4eide 5te',
    '4i 5lda 7e 7o 6son 5r 2ene 4i 5ce 5lda 4o 3s 2ia 3neia 5u 3s 4mar 2lan 2ma 1sa 3ac 3bel 6a 6e 6i 6la 7e 7i 7y',
    '6y 3c 3dora 3el 3ias 4s 3ltina 3mara 3que 3ura 2idoro 3s 2la 4ine 4ne 2mael 4r 3enia 2olde 4ete 4ina 2rael',
    '3rael 1tacir 3la 4o 3mar 6a 1ure 3i 3y 1va 3ir 3ldo 3m 3n 4a 5ldo 4e 5ide 5te 4i 5a 5ce 5l 6da 7e 8s 7o 6son',
    '6ton 5r 6a 5se 4or 2ete 2o 3naldo 4e 5i 6de 5te 4i 1za 3bel 6a 6e 6i 6la 7e 3c 3dora 3el 3ias 3que 3ura 2ilda',
    '2olina 0jaci 4ane 5ra 4el 6e 4lene 4nta 6o 4r 5a 3keline 4son 3o 4b 3queline 3son 3y 2de 4r 5son 3iel 4lson 4r',
    '4son 3son 2elson 2iane 3lda 4ma 4som 6n 4ton 3me 3nara 4e 3r 4a 4o 3son 2keline 3son 2merson 4s 3il 5a 5e 5i',
    '5le 6y 5son 5ton 5y 4r 2nailson 5na 6e 3der 6son 4ir 6a 3e 4ide 4s 4te 3i 4a 4ce 5leide 4el 6e 6i 4lda 5son',
    '4ne 4o 4r 5a 3uario 2o 2queline 8i 5s 2rbas 3del 4iel 3lene 2son 2yme 1ean 4derson 4e 2fersom 7n 6son 4son',
    '5son 3ferson 2isa 4iane 4on 2lson 2nefer 3i 4fer 5fer 4lson 4val 7do 3nifer 2orge 3va 5na 6e 6i 2remias',
    '3ferson 5son 3onimo 3ri 4y 3son 3usa 2siane 4ca 4el 3se 4i 5ane 5ca 5ka 3uina 6o 4s 2verson 1henifer 6fer',
    '4nifer 2on 4ata 7n 7s 6han 4e 5s 4i 4ny 4y 1ilberto 3mar 3son 3van 1oa 3b 4e 3ci 5r 3n 4a 4derson 4e 4ice 5ta',
    '3o 3quim 6n 7a 3res 5z 3s 2bson 2celaine 5i 6a 6na 7o 6o 4mar 3iane 4el 6e 4lene 4mar 7a 2edson 3l 4ia 4ma',
    '4son 2hn 4ny 2ice 4iane 3lma 4son 3se 2mar 2nas 4ta 6m 6n 6s 5ha 7n 7s 3e 4s 3h 3i 4lson 3ny 3y 2rdan 6a 6ia',
    '5o 3ge 4ina 3je 2safa 4ne 3e 4ana 6e 4fa 5ina 4ilda 7o 6ton 4laine 5ene 5ha 5i 6a 6na 7o 6o 6ta 7o 5ma 4mar 7a',
    '5ir 4naldo 5eide 5i 6ce 6lda 8e 8o 7son 7ton 6r 4ph 4te 4val 7do 6n 3i 4ana 6e 6i 5s 4cleide 4el 6e 6i 6ma 5ne',
    '4laine 6ne 5da 6o 5eide 6ne 4mar 7a 5eire 4na 6ldo 5ei 7de 6te 5o 4val 7do 6n 7ia 3mar 3ue 5l 2vana 5e 3elina',
    '7o 4ntina 8o 3ina 5o 4ta 2yce 2ze 1uan 4a 3res 5z 2cara 3eli 6a 6na 7o 6o 3iane 5ra 4cleide 4ele 5ne 4leia 7de',
    '6ne 4mar 7a 4neia 7de 2dite 5h 3son 2lha 4o 3i 4a 5n 6a 6e 6o 5o 4e 5ne 5ta 6e 4mar 4o 4ta 2nia 4o 5r 2raci 6r',
    '5y 4ndi 7r 3ema 2sara 3celino 3sara 3tina 6o 2velina 4nal 5cio 5il 5tino 0kaiane 3c 3k 4e 4y 3la 5ne 3o 3que',
    '2lebe 3iane 4ne 2mila 5e 5la 6y 5y 2rem 4n 3in 5a 5e 3la 3ol 5aine 6yne 5ina 7e 5yne 2ssia 5o 2tarina 3hleen',
    '3ia 5na 6e 4ele 2ua 4m 4n 5a 5e 5i 5y 3e 2wan 2yke 4y 3lane 3o 3que 1eila 3te 2le 4n 3i 4ane 3le 5n 4i 4y 3ma',
    '3son 3ven 4in 3y 2mili 5ly 5y 2nedi 5y 3ia 3nedy 2ren 2sia 3sia 2telen 5in 3len 4in 4yn 2ven 3in 2yla 2zia',
    '1iara 2mberly 1leber 6son 3iton 0laci 2ecio 3lson 3rcio 4te 2iana 5e 3de 3la 4son 4ton 3ne 3r 4a 4ton 3s 4a 4e',
    '4la 4sa 3z 4a 2na 2ra 3iane 4ca 4sa 5sa 6e 3risa 6sa 3yssa 2saro 2uana 5e 3delina 8o 4iceia 3ra 4eci 5n 6tina',
    '9o 4i 5ane 5nda 7o 6ete 5ta 4o 2vinia 2yane 3la 3s 4a 2zara 5o 1ea 3nderson 5ra 6o 4e 2ci 2da 3iane 2ia 3da 4e',
    '4iana 7e 5mar 3la 5ne 4iane 4son 3ticia 2lia 5ne 2na 3i 4ce 4lda 6o 5son 4r 5a 4se 4ta 3o 4n 3y 2o 3cadia 3mar',
    '3n 4an 5rda 7o 4cio 4e 5l 4i 5ce 5da 7s 6es 6ia 5lda 7e 7o 6son 5r 4or 6a 4tina 3poldina 7o 3rnado 2ticia 2vi',
    '4no 3y 1ia 3na 4dra 4e 2bia 2cia 2dia 5na 6e 4nalva 4o 3uina 2ege 2gia 5ne 2lia 5m 5n 6a 6e 2na 3coln 5n 3da',
    '5ci 5lva 5mir 5ura 4inalva 4olfo 5mar 3o 2ria 4o 2s 3andra 3ete 3iane 2via 4o 2z 3andra 3ete 3iane 1oide 3va',
    '2raine 4n 5e 3eci 4n 5a 5co 5i 5zo 3i 4svaldo 4val 7do 3raine 5n 6a 6e 6y 5yne 2udes 3ise 3rdes 4enco 4ival',
    '1uam 3n 4a 4da 5erson 4e 4i 4na 3ra 2ca 4s 3ca 3elena 5ia 3i 4a 5n 6a 6e 6o 5ra 4cleia 8de 4dalva 4ele 6ma 5ne',
    '5te 4la 5eia 7de 6ne 5ia 4mar 7a 5eire 4naldo 7va 5da 5ei 7a 7de 6te 4o 4rene 4val 7do 6n 7ia 3recia 3y',
    '2dimila 3mila 2igi 3s 4a 3z 4a 2ma 2na 2rdes 2sia 4nete 2zanira 3ia 5na 6e 4ene 4lene 4mar 4neide 6te 0mabel',
    '2celo 3ia 4el 4lene 4o 2dalena 3son 2eli 2falda 2gali 3da 3na 4o 5lia 2ia 4na 5e 4ra 3co 5m 5n 3k 4e 4on 3la',
    '4on 4son 4ton 3nara 3que 3ra 3sa 3te 3za 2lu 3vina 2nel 3oel 6a 3uel 6a 6e 6la 2ra 4isa 3cel 6a 6e 6i 7a 7na',
    '8o 6la 7e 7o 7y 6o 4ia 6na 7e 7o 5el 7e 7i 5leia 7ne 6ia 7o 5o 4o 5ndes 6e 7s 6i 5s 4us 3essa 3garet 8e 8h',
    '6ida 3i 4a 5h 5na 6e 6gela 6i 6na 6o 4celia 4dalva 4ela 6e 6i 5ne 5ta 6e 4laine 6ne 5da 6o 5ei 7a 7de 6na 7e',
    '6te 5ha 5i 6a 5sa 5u 6ce 7i 8a 5za 4na 6lda 8o 7va 5eia 7de 6s 6te 6uza 6z 5ho 5o 4o 4sa 5e 6te 5ol 5tela 4uza',
    '4valda 8o 6nia 5one 4za 5e 6te 3jorie 3la 4ei 6de 5ne 5te 5y 4i 5se 6on 4om 5n 5s 4uce 6i 7a 4y 3ques 3ta 4ha',
    '4im 5n 6a 6ha 7o 6s 3y 2teus 3hes 5us 4ias 3ias 4lde 2ura 4i 5ceia 7lia 6ia 7o 5lio 5na 6o 4o 2x 3imiliano 5o',
    '3suel 3uel 3wel 6l 2yane 4ra 3com 5n 3kon 3ra 3sa 1eire 4iane 2l 3ania 3ina 4sa 5sa 2rcedes 5s 4ia 3i 2sias',
    '3sias 1icael 6a 6e 6i 3hael 4el 6e 6i 7ne 6le 7i 7y 6y 2dian 2guel 6ina 2kael 6a 6e 6i 6ly 6y 3e 2la 3ca 3eide',
    '4na 5e 5i 3lena 5r 3son 3tom 5n 2nervina 2queias 2raci 4lva 3ela 5e 5i 5la 6e 3ia 5m 5n 6e 3la 4ene 3na 3tes',
    '2sael 3lene 2zael 1oaci 5r 4yr 2desto 2iseis 5s 2nalisa 6za 3ica 4que 4se 2rgana 2zart 1uriel 4llo 5o 1ylena',
    '0nadia 4ne 4r 3ja 3son 2eli 2gila 2iana 5e 4ra 3de 3la 4de 4son 4ton 4za 3r 4a 2jara 2ldo 3va 2nci 4y 2poleao',
    '2ra 3ciso 2ta 4cha 4l 5ha 5i 6a 6ce 7ia 8o 6e 6na 7o 5y 4n 5ael 5i 6el 4sha 3halia 6y 5n 3iele 6i 4vidade',
    '2yane 4ra 3ra 2zare 6no 1eci 2dina 2emias 2i 3a 3da 4e 3la 4son 4ton 3mar 3va 2lci 3i 4a 4o 4ta 3ma 3sa 4i 4o',
    '5m 5n 3ton 3y 3za 2rci 3eu 3i 4valdo 2stor 2to 2uci 3ma 3raci 4i 3sa 3za 2wton 2y 1icanor 3e 4ia 3holas 3ola',
    '6s 6u 5e 5i 5le 6y 5y 2dia 2edja 3lson 2lce 5ia 3da 4e 5te 4o 3ma 5r 3o 3sa 4e 4o 5m 5n 3to 5m 5n 3va 3za 4ete',
    '2na 2valda 6o 3ea 3ia 1oberto 2e 3l 4i 5a 4ma 3me 4i 5a 2nato 2rberto 3ival 3ma 1ubia 0ocimar 2tavio 1dair',
    '2enir 3te 2ila 4ia 5o 4on 3neia 3r 4lei 1felia 1lavo 2egario 2ga 2impia 6o 3nda 5ina 3veira 5r 4ia 5o 1mar',
    '1ndina 2eide 2ildo 2ofre 3rio 1racio 2estes 2ides 3valdo 2landa 6ina 6o 3ei 1sana 2car 5ina 2eas 3ias 2ias 3el',
    '2mair 4r 5ina 6o 3ir 2ni 4r 2orio 2valdina 8o 6o 2waldo 1tacilia 7o 3viano 5o 2ilia 2oniel 2to 1vidio 1zana',
    '2eias 2ias 3el 0pablo 2lmira 3oma 2mela 5la 2ola 2scoal 2trcia 4ic 6ia 7o 6k 5k 5que 2ula 4iana 5na 6ho 6o 4o',
    '1edra 4ina 4o 2nha 2ricles 3la 3ola 3petua 2ter 5son 3ronio 4ucio 1helipe 1ierre 3tra 5o 1lacido 2inio 1oliana',
    '6e 3lyana 3yana 1ricila 3scila 7la 0queila 3li 3nia 3sia 3zia 2iteria 0rachel 2el 2fael 6a 6e 6i 6la 2i 3an 5a',
    '5e 4ra 3ca 3la 5n 6e 4da 5o 4son 4ton 3munda 7o 3nara 4e 3r 4a 3sa 4sa 3za 2lf 2mao 3ires 5o 3om 4n 5a 3undo',
    '2na 3gel 3iel 6e 6i 5re 6i 2oni 2phael 7a 2quel 6e 6i 2u 3l 2vena 2y 3an 5a 5e 5ne 3la 3ne 3sa 4sa 1ebeca 5ca',
    '2gane 3ia 5ne 4lene 4na 6lda 8o 4s 4valdo 2inaldo 5n 2jane 2na 4ldo 4m 4n 4ta 5o 3e 4r 3i 4lda 6e 6o 5son 5ton',
    '4valdo 1huan 1iam 3n 4a 4e 2bamar 2cardo 3hard 7son 3k 2ldo 2naldo 2quelme 2somar 4neide 2ta 2valdo 3elino',
    '1oberio 5son 5t 6a 6o 5val 3inson 4son 3som 5n 2dinei 3nei 5y 3olfo 3rigo 6ues 2ger 5ia 6o 2mana 4o 4rio 3erio',
    '5o 4u 3ilda 6o 5son 3oaldo 3ualdo 4lo 2nald 6e 6o 4n 3e 4i 4y 3i 4el 4lda 6o 5son 4valdo 5on 3y 2que 2sa 4gela',
    '4li 6a 6na 7o 5va 6o 4na 5e 5gela 5i 6a 4ria 6o 3e 4ana 6e 4laine 6ne 5ei 6ne 5i 6a 6ta 5y 4mar 7a 7i 7y 5eire',
    '6re 7i 4neide 5i 6lda 8e 8o 6r 3i 4ana 6e 4cleia 8de 7r 4el 6e 5ne 4laine 6ne 5da 6o 5ei 7a 7de 6ne 4mar 7a 7e',
    '7i 7y 5eire 6re 7i 4na 6ldo 7va 5ei 7a 7de 6te 5ha 4rene 4ta 4val 7do 6n 7ia 3sana 2zana 5gela 3eli 3ilda 1uam',
    '3n 4a 2bem 4n 5ita 5s 3ia 5na 2di 4mar 4nei 3nei 3son 2i 2te 3h 4e 4i 3i 2y 1yan 0sabina 5o 3rina 6e 2di 2fira',
    '2imon 3onara 2latiel 3ete 3omao 3vador 2manta 6ha 4ra 3ela 3ia 4la 5e 5i 4r 5a 3oel 3uel 2nderson 4oval 4ra',
    '5iele 5o 4y 3ta 5na 4iago 5na 6o 4o 5s 2ra 4h 3ita 2turnino 2ul 4o 2vio 2yonara 1cheila 1ebastiana 8o 4tiao',
    '2lia 4na 3ma 4o 3so 2nhorinha 2rafim 3gio 2veriano 6na 7o 1haiane 2eila 3yla 2irlei 6ne 6y 1ibele 2cero 2dinei',
    '7a 6y 3nei 6a 5y 2las 3eide 4ne 3ma 5r 6a 3va 5n 6a 6e 7i 8de 7te 6i 7a 7o 7r 8a 6o 4erio 5stre 4ia 6ne 5na 6o',
    '5o 4o 2mao 4ra 3one 5i 2nara 3eide 4sio 3tia 3val 6do 2rlei 6a 6de 5ne 5y 2valdo 1ocorro 2eli 2fia 2lange',
    '3imar 3on 2nia 2phia 2raia 4ya 1tefane 6i 7a 7e 6y 3la 4la 3phane 7i 8e 7y 2hefani 7y 1uane 2ele 5m 5n 6e 4i',
    '4len 4y 3nia 2iane 2lamita 2san 5a 5e 3i 2zana 5e 3ete 3i 4ane 3y 1ylvia 0tabata 2ciana 6e 4o 2deu 2iana 5e',
    '4ra 3la 5n 6e 3na 5n 5r 6a 4e 3rine 3s 4a 4e 4sa 3z 4a 2les 3ia 4ne 4s 5on 5son 4ta 3les 2mara 3ires 5is 2nia',
    '2rciana 5la 5o 5sio 6o 2ssia 6na 7e 5o 2tiana 6e 6i 4ele 6i 2ua 4n 5a 5e 5i 2yane 3la 3na 5ra 1elma 4o 2odora',
    '6o 3filo 2rcio 3esa 5inha 4za 5ina 7ha 1haiane 4la 4na 6ra 4s 5a 5e 5sa 3les 4ia 5s 5ta 4les 3mara 4ires 6is',
    '3yane 4la 4na 6ra 4s 2eo 3reza 6inha 2iago 3erry 2omas 5z 2yago 1iago 2ciane 2fani 2moteo 2to 1obias 2mas 4z',
    '3e 2ni 3y 1uane 4i 2lio 0uanderson 1baldo 2iraci 5jara 5tan 1dson 1eliton 3ton 2slei 1go 1ilian 3son 3ton',
    '1lisses 1mbelina 4rto 1rbano 2iel 2sula 0vagner 2lber 3ci 5r 3da 5ir 4eci 7r 5ir 5li 7ce 5mar 6ir 8a 8o 5ne 6i',
    '7a 7ce 7lson 7r 8a 6or 5res 7z 6i 5te 5vino 4i 5ce 5leia 7ne 5miro 5na 7r 6ei 8a 8de 7te 5r 6a 6ene 5via 7na',
    '8o 4o 5mira 8o 3entim 7n 8a 4ria 6o 4sca 5ka 3fredo 3kiria 3mir 6a 6o 4or 3nei 3quiria 3tair 4eir 5mir 5r 2nda',
    '4eir 5r 6lan 7ei 9a 8y 7i 7ucia 6son 5te 4ir 4o 3eide 4sa 5sa 4te 3i 4a 4ce 4lda 6e 6o 5son 5za 4o 4r 3tuir',
    '3usa 5ia 4za 5ia 1enancio 3icio 7s 4na 2ra 4lucia 3ena 3idiana 3onica 7e 1icencia 5te 6ina 3to 5r 6ia 2lani',
    '3ma 5r 6a 3son 2nicio 7s 6us 2rgilio 5nia 2tal 5ina 7o 3o 4r 5ia 6no 6o 2valdo 3ia 5m 5n 6a 6e 6i 1lademir',
    '4imir 1olmar 4ir 3nei 0wadson 2gner 2lace 4s 3ber 3demar 6ir 4ir 4omiro 3ison 5son 3kiria 3lace 5s 4ison 3mir',
    '3quiria 3ter 2nda 4er 6lei 9a 8y 6son 5son 3essa 3ia 2rlei 5y 2shigton 5ngton 6ton 1eber 5son 5t 2der 5son',
    '3son 2lber 3der 3igton 4ngton 5ton 4son 5son 4tom 6n 3ligton 5ngton 6ton 5son 5ton 3son 3ton 2merson 2ndel 6l',
    '5r 6son 4y 2slei 5n 5y 4ley 2verson 5ton 1ilames 3han 3iam 5n 6e 6s 3ker 3lames 5n 4iam 6n 7e 7s 4y 3ma 5r',
    '3som 5n 3ton 1ladimir 1oshington 5ton 0yago 2n 2ra 2smim 5n 1eda 1gor 1olanda 1ure 3i 0zacarias 2ira 2quel 5u',
    '1eferino 2li 4a 4na 5da 4ta 3ma 2naide 3eide 3i 4lda 6e 6o 5ton 4r 4ta 2zito 1ila 3da 4ete 3ma 5r 2ta 1oraide',
    '1uleica 5de 3ma 4ira 2mira',
  ].join(' ');
  const FIRST = new Set();
  { let prev = ''; for (const t of FIRST_PACKED.split(' ')) { prev = /^\d/.test(t) ? prev.slice(0, +t[0]) + t.slice(1) : t; FIRST.add(prev); } }
  // Palavras com maiúscula que separam ou nunca são nome: meses, dias, cargos, tratamentos, menus,
  // produtos e adjetivos de órgão ("Deputado Fulano Silva" → só "Fulano Silva").
  const SPLIT = wordSet(`janeiro fevereiro março abril maio junho julho agosto setembro outubro novembro dezembro
    jan fev mar abr mai jun jul ago set out nov dez segunda terça quarta quinta sexta sábado domingo feira
    hoje ontem amanhã semana mês ano dia dias manhã tarde noite bom boa bons boas olá oi prezado prezada prezados
    caro cara querido querida obrigado obrigada atenciosamente abraço abraços beijo beijos cordialmente att segue
    seguem conforme assunto re res fw fwd enc encaminhada encaminhado mensagem mensagens nova novo novas novos
    responder encaminhar enviar enviado enviados enviadas excluir excluídos excluídas arquivar arquivo arquivados
    arquivadas morto lixo eletrônico rascunho rascunhos caixa entrada saída itens pasta pastas favoritos marcar
    lido lida lidas não sinalizar fixar fixadas fixados mover filtro filtrar pesquisar buscar pesquisa todos todas
    configurações ajuda página inicial início calendário contatos pessoas tarefas notas chat conversa conversas
    equipes atividade chamadas arquivos aplicativos mais opções ver exibir compartilhar reunião reuniões evento
    agenda status canais comunidades grupo grupos online digitando visto última vez você voce eu mim nós
    federal nacional estadual municipal distrital geral oficial público pública regional superior central
    deputado deputada deputados deputadas senador senadora senadores vereador vereadora prefeito prefeita
    governador governadora presidente presidenta vice ministro ministra secretário secretária secretários
    diretor diretora diretores coordenador coordenadora chefe assessor assessora assessores consultor
    consultora consultores analista técnico técnica relator relatora juiz juíza desembargador desembargadora
    procurador procuradora promotor promotora delegado delegada defensor defensora auditor auditora gerente
    supervisor supervisora servidor servidora estagiário estagiária professor professora doutor doutora
    dr dra sr sra srta prof profa exmo exma ilmo ilma sua vossa excelência senhor senhora dom
    microsoft teams outlook office gmail google meet zoom whatsapp telegram chatwoot windows excel word powerpoint
    onedrive sharepoint youtube linkedin facebook instagram apple iphone android samsung chrome edge firefox
    copilot web app desktop new sign in out mark as read unread reply all forward delete archive settings help
    search home inbox sent drafts junk email deleted items calendar people files apps activity calls join now
    more options view share filter favorites folders groups focused other today yesterday available busy away
    meeting meetings message messages contacts chats chat team
    lei leis decreto portaria resolução medida provisória emenda emendas projeto projetos constituição código
    artigo artigos parágrafo inciso alínea capítulo título seção anexo anexos ofício memorando processo
    parecer requerimento proposição proposta nota técnica relatório placa mercosul`);
  // Palavras de órgão, empresa ou lugar: o trecho que as contém não é nome de pessoa.
  const ORG = wordSet(`ministério ministérios secretaria secretarias câmara senado congresso tribunal tribunais
    supremo justiça receita polícia procuradoria defensoria advocacia controladoria corregedoria ouvidoria
    assembleia conselho comissão comissões comitê gabinete diretoria coordenação coordenadoria departamento
    divisão seção setor núcleo assessoria consultoria superintendência gerência presidência vice-presidência
    prefeitura governo estado estados república união município agência autarquia fundação instituto
    universidade faculdade escola colégio hospital clínica banco caixa cooperativa empresa companhia loja
    lojas mercado supermercado farmácia associação sindicato federação confederação partido igreja paróquia
    serviço serviços sistema sistemas programa plataforma rede grupo equipe time centro casa palácio
    esplanada eixo setor anexo bloco edifício plenário plenária diário imprensa jornal revista rádio tv
    brasília são santa santo rio belo porto campo nova novo minas mato espírito distrito
    goiás goiânia bahia paraná pernambuco ceará amazonas pará piauí maranhão alagoas sergipe paraíba
    tocantins rondônia roraima amapá acre gerais grosso sul norte nordeste centro-oeste sudeste`);
  const PART = new Set(['da', 'de', 'do', 'das', 'dos', 'e', 'di', 'du', 'van', 'von', 'del', 'della']);
  for (const w of [...SPLIT, ...ORG]) FIRST.delete(norm(w));
  // Classe de uma palavra: 'O' (órgão/lugar), 'S' (separa) ou ''. Primeiro com acento ("Secretária" é
  // cargo, "Secretaria" é órgão); sem acento só quando o texto veio sem acento ("Camara").
  const ORG_L = new Set(ORG), SPLIT_L = new Set(SPLIT), ORG_N = new Set(ORG.map(norm)), SPLIT_N = new Set(SPLIT.map(norm));
  const cls = w => {
    const l = w.toLowerCase();
    if (ORG_L.has(l)) return 'O';
    if (SPLIT_L.has(l)) return 'S';
    const n = norm(w);
    return ORG_N.has(n) ? 'O' : SPLIT_N.has(n) ? 'S' : '';
  };

  // Nomes extras do usuário: valem sozinhos, sem sobrenome.
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const EXTRA = String(get('nomes', '')).split(',').map(s => s.trim()).filter(Boolean);
  // Dicionário da página: nomes achados nos campos de pessoa (remetente, destinatário, participante).
  const dict = new Set(EXTRA);
  let dictRx = null, dictSize = -1;
  function addName(raw) {
    const s = String(raw || '').replace(/<[^>]*>|\([^)]*@[^)]*\)|[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, ' ').replace(/[\s,;"']+$/g, '').replace(/^[\s,;"']+/g, '').replace(/\s+/g, ' ');
    if (s.length < 3 || s.length > 80 || dict.size > 600 || /\d{3}/.test(s)) return;
    const toks = s.split(/[\s,]+/);
    if (toks.some(t => cls(t) === 'O')) { dict.add(s); return; } // órgão ou empresa: só o nome inteiro
    dict.add(s);
    for (const t of toks) if (t.length >= 3 && /^\p{Lu}/u.test(t) && !PART.has(norm(t)) && !cls(t)) dict.add(t);
  }
  function getDictRx() {
    if (dict.size !== dictSize) {
      dictSize = dict.size;
      const l = [...dict].sort((a, b) => b.length - a.length).map(esc);
      dictRx = l.length ? new RegExp(`(?<![\\p{L}\\p{N}_])(?:${l.join('|')})(?![\\p{L}\\p{N}_])`, 'gu') : null;
    }
    return dictRx;
  }

  // ---------- nomes: estrutura ----------
  const W = "\\p{Lu}[\\p{Ll}\\p{M}]+(?:['’-]\\p{Lu}?[\\p{Ll}\\p{M}]+)*";
  const RUN_RX = new RegExp(`(?<![\\p{L}\\p{N}_@])(?:(?:Dra?|Sra?|Srta|Profa?)\\.?\\s+)?${W}(?:\\s+(?:(?:d[aeo]s?|e|di|du|van|von|del|della)\\s+)?${W})*`, 'gu');
  const WORD_RX = new RegExp(W, 'gu');
  const TITLE_RX = /^(?:Dra?|Sra?|Srta|Profa?)\.?\s+/u;
  const CAPS_RX = /(?<![\p{L}\p{N}])\p{Lu}{2,}(?:\s+(?:D[AEO]S?\s+|E\s+)?\p{Lu}{2,}){1,5}(?![\p{L}\p{N}])/gu;
  const INV_RX = new RegExp(`(?<![\\p{L}\\p{N}])(${W}(?:\\s+${W})?),\\s+(${W})(?:\\s+(?:(?:d[aeo]s?|e)\\s+)?${W})*`, 'gu');
  const INIT_RX = new RegExp(`(?<![\\p{L}\\p{N}])(${W})\\s+\\p{Lu}\\.(?!\\p{L})`, 'gu');

  // Palavras capitalizadas em sequência (com partículas) que não sejam órgão, cargo, mês ou menu: nome.
  function findNames(s, hit) {
    RUN_RX.lastIndex = 0; let m;
    while ((m = RUN_RX.exec(s))) {
      const txt = m[0], title = TITLE_RX.exec(txt);
      let seg = [], first = true;
      const flush = () => {
        if (seg.length && !seg.some(w => w.c === 'O')) {
          if (seg.length >= 2) hit(m.index + (first && title ? 0 : seg[0].a), m.index + seg[seg.length - 1].b);
          else if (first && title) hit(m.index, m.index + seg[0].b);
        }
        if (seg.length) first = false;
        seg = [];
      };
      WORD_RX.lastIndex = title ? title[0].length : 0; let w;
      while ((w = WORD_RX.exec(txt))) {
        const c = cls(w[0]);
        if (c === 'S') { flush(); first = false; continue; }
        seg.push({ c, a: w.index, b: w.index + w[0].length });
      }
      flush();
    }
    // MAIÚSCULAS ("JOSÉ CARLOS DA SILVA"): só se começar por prenome conhecido.
    CAPS_RX.lastIndex = 0;
    while ((m = CAPS_RX.exec(s))) {
      const ws = m[0].split(/\s+/);
      if (FIRST.has(norm(ws[0])) && !ws.some(cls)) hit(m.index, m.index + m[0].length);
    }
    // "Sobrenome, Prenome ..." (formato de catálogo do Outlook/Teams).
    INV_RX.lastIndex = 0;
    while ((m = INV_RX.exec(s))) {
      if (FIRST.has(norm(m[2])) && !m[1].split(/\s+/).some(cls) && !cls(m[2])) hit(m.index, m.index + m[0].length);
    }
    // "Prenome S." (inicial do sobrenome).
    INIT_RX.lastIndex = 0;
    while ((m = INIT_RX.exec(s))) if (FIRST.has(norm(m[1]))) hit(m.index, m.index + m[0].length);
  }

  // ---------- padrões ----------
  // [regex, pré-filtro (1 = precisa de dígito, 2 = precisa de "@"), validação opcional]
  const digits = s => s.replace(/\D/g, '').length;
  const FILE_RX = /\b[\w-]*(?:RG|CPF|CNH|comprovante|laudo|extrato|contracheque|holerite|exame|certid[aã]o|passaporte|boleto|fatura|t[ií]tulo)[\w.-]*\.(?:pdf|jpe?g|png|heic|docx?)\b/giu;
  const RULES = [
    [/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, 2],                                                 // e-mail
    [/(?<![\w@./])@[A-Za-z][A-Za-z0-9_]{3,31}\b/g, 2],                                     // @usuario (Telegram, menções)
    [/(?:\b|\*)[\d*]{3}\.[\d*]{3}\.[\d*]{3}-[\d*]{2}\b/g, 1],                              // CPF (inclusive mascarado)
    [/(?<=\bCPF\b[^\d\n]{0,12})\d{11}(?!\d)/gi, 1],                                       // CPF sem máscara, com contexto
    [/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, 1],                                         // CNPJ
    [/\b(?:\d{4}[ -]){3}\d{4}\b/g, 1],                                                    // cartão
    [/(?<![\w+])\+\d{1,3}(?:[\s.-]?\(?\d{1,4}\)?){1,3}[\s.-]?\d{3,4}(?![\w])/g, 1, s => digits(s) >= 8 && digits(s) <= 15], // telefone internacional
    [/(?:\(\d{2}\)\s?|\b\d{2}[\s.-])9?\d{4}[\s.-]?\d{4}\b/g, 1],                           // telefone com DDD
    [/\b9\d{4}-\d{4}\b/g, 1],                                                             // celular sem DDD
    [/(?<!\d)(?:\+?55)?[1-9]{2}9\d{8}(?!\d)/g, 1],                                        // celular sem máscara (61999999999)
    [/(?<=\b(?:tel|fone|cel|whats|zap|contato|ligar|ligue)[\p{L}.]*\s*:?\s*)(?:\+?55\s?)?\d{10,11}(?!\d)/giu, 1], // fixo sem máscara, com contexto
    [/\b\d{5}-\d{3}\b/g, 1],                                                              // CEP
    [/\b(?:RG|identidade)[:\s]*\d{1,2}\.?\d{3}\.?\d{3}(?:-[\dxX])?(?:\s?SSP\/[A-Z]{2})?|\b\d{1,2}\.\d{3}\.\d{3}(?:-[\dxX])?\s?SSP\/[A-Z]{2}/gi, 1], // RG (só com contexto)
    [/(?<=\b(?:CNH|habilita[çc][ãa]o)[^\d\n]{0,25})\d{9,11}(?!\d)/giu, 1],                 // CNH
    [/(?<=(?:t[íi]tulo(?:\s+de)?\s+eleitor(?:al)?|\beleitor)[^\d\n]{0,15})\d{4}\s?\d{4}\s?\d{4}(?!\d)/giu, 1], // título de eleitor
    [/\b\d{3}\.\d{5}\.\d{2}-\d\b/g, 1],                                                   // PIS/PASEP/NIS/NIT
    [/(?<=\b(?:PIS|NIS|PASEP|NIT)\b[^\d\n]{0,15})\d{11}(?!\d)/gi, 1],                      // PIS sem máscara
    [/(?<=\bpass(?:aporte|port)\b[^\p{L}\p{N}\n]{0,15}(?:n[º°o.]*\s*)?)[A-Z]{1,2}\d{6,7}\b/giu, 1], // passaporte
    [/\b(?!ISO|NBR|RFC|CVE|PEC|MPV|PLP|PDL|PLV|PRC|REQ|RIC|INC|SEI|NUP)[A-Z]{3}(?:-\d{4}|\d[A-Z]\d{2})\b/g, 1],                       // placa (antiga com hífen, Mercosul)
    [/(?<=\bplaca\b[^\w\n]{0,12})[A-Z]{3}\s?-?\d{4}\b/gi, 1],                             // placa antiga sem hífen
    [/(?<=(?:\bnasc(?:\.|imento|ida|ido)?|\bDN|\bD\.N\.)\s*(?:em)?\s*:?\s*)\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/gi, 1], // data de nascimento
    [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, 1],              // chave Pix aleatória (UUID)
    [/\b\d{5}\.?\d{5}\s?\d{5}\.?\d{6}\s?\d{5}\.?\d{6}\s?\d\s?\d{14}\b|\b(?:\d{11}-?\d\s?){3}\d{11}-?\d\b/g, 1], // linha digitável de boleto
    [/(?<=\b(?:matr[íi]cula|mat\.|ponto|siape|registro funcional|crach[áa])\s*(?:n[º°o.]*)?\s*:?\s*)\d[\d.\-/]{2,14}\d/giu, 1], // matrícula/ponto
    [/\b(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}\b/g, 1],         // IPv4
    [/R\$\s?\d{1,3}(?:\.\d{3})*(?:,\d{2})?/g, 1],                                         // valor
    [/\b(?:agência|ag\.)\s?\d{3,5}\b|\bconta\s?\d{4,8}-?\d?\b/gi, 1],                      // conta
    [/\b(?:SQN|SQS|SHIS|SHIN|SCLN|SCLS|QI|QL|QNL|QNM|Rua|Av\.|Avenida|Quadra)\s[^,.;\n]{2,40}(?:,\s?\d{1,5}[A-Za-z]?)?(?:,?\s(?:[Aa]pto|[Aa]pt\.|[Aa]p\.|[Bb]loco|[Cc]asa|[Ss]ala|[Ll]ote)\s?[\w-]{1,6})*/g, 0], // endereço
    [FILE_RX, 0],                                                                          // anexo com nome sensível
  ];
  // Hora, data curta e contador: ficam legíveis mesmo dentro de uma linha borrada.
  const TIME_RX = /^\s*(?:\d{1,2}:\d{2}(?:\s?[AaPp]\.?[Mm]\.?)?|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{1,4}|\d{1,3}\s?(?:s|min|m|h|d|sem|w|mo|a|y)\.?|agora|now|ontem|hoje|anteontem|yesterday|today|(?:seg|ter|qua|qui|sex|s[áa]b|dom)\.?|(?:segunda|ter[çc]a|quarta|quinta|sexta)(?:-feira)?|s[áa]bado|domingo)\s*$/i;

  // ---------- adaptadores ----------
  // Cada elemento marcado vale para o seu conteúdo; a marca mais próxima vence.
  // P = pessoa (borra o texto e alimenta o dicionário) · B = borra o texto · V = prévia (borra o texto,
  // menos o prefixo "Fulano:") · K = mantém nomes legíveis (só padrões) · N = normal.
  let flags = new Map();
  const flag = (root, sel, k) => { if (root) for (const e of root.querySelectorAll(sel)) flags.set(e, k); };
  const PERSON = '[email],[data-hovercard-id*="@"],[title*="@"]:not(a[href^="http"])';
  // Foto de perfil e iniciais no lugar da foto: nunca borradas (decisão do dono). Só elementos com até
  // 3 letras (as iniciais): um contêiner com "avatar" na classe que envolva a linha inteira não conta.
  const AVATAR = '[class*="avatar" i],[class*="Avatar"],[data-testid*="avatar" i],[data-tid*="avatar" i]';
  const QR = 'canvas[aria-label*="QR" i],img[alt*="QR" i],[data-ref] canvas,[aria-label*="QR" i] canvas,[aria-label*="QR" i] img,[class*="qr" i] canvas,[class*="qr" i] img,[class*="qr" i]>svg';
  // Remetente dentro da prévia: elemento seguido de ":" ("<b>Fulano</b>: oi").
  function senderOf(p, sel) {
    const s = sel && p.querySelector(sel);
    if (s) return s;
    let n = 0;
    for (const e of p.querySelectorAll('*')) {
      if (++n > 12) break;
      const nx = e.nextSibling, t = e.textContent.trim();
      if (t && t.length <= 60 && nx && /^\s*:/.test(nx.textContent || '')) return e;
    }
    return null;
  }
  function previews(root, sel, senderSel) {
    if (!root) return;
    for (const p of root.querySelectorAll(sel)) { flags.set(p, 'V'); const s = senderOf(p, senderSel); if (s) flags.set(s, 'K'); }
  }
  function markWhatsApp() {
    const side = document.getElementById('pane-side');
    if (side) {
      let rows = side.querySelectorAll('[role="listitem"]');
      if (!rows.length) rows = side.querySelectorAll('[role="row"]');
      for (const row of rows) {
        flags.set(row, 'B'); // nome da conversa, hora e prévia
        const titled = [...row.querySelectorAll('span[title]')].filter(e => !e.parentElement.closest('span[title]'));
        for (const p of titled.slice(1)) { flags.set(p, 'V'); const s = senderOf(p); if (s) flags.set(s, 'K'); }
      }
    }
    const main = document.getElementById('main');
    if (main) {
      flags.set(main, 'K'); // dentro da conversa: remetentes legíveis
      flag(main, '.selectable-text', 'N'); // texto das mensagens: regras normais
      const h = main.querySelector('header');
      const name = h && (h.querySelector('span[dir="auto"]') || h.querySelector('[title]'));
      if (name) flags.set(name, 'B');
    }
    // Painel "Dados do contato/grupo" e cabeçalhos de nome em gavetas laterais.
    flag(document, '[data-testid="contact-info-drawer"] span[dir="auto"]:first-of-type, section [data-testid="group-info-drawer-subject-input"]', 'B');
  }
  function markTelegram() {
    // Versão K (web.telegram.org/k)
    flag(document, '.chatlist-chat', 'B');
    previews(document, '.chatlist-chat .dialog-subtitle', '.peer-title,.sender-name');
    flag(document, '.bubbles', 'K');
    flag(document, '.bubble .message', 'N');
    flag(document, '.bubble .name, .bubble .peer-title, .bubble .reply, .bubble .reply-title', 'K');
    flag(document, '.chat-info', 'K');
    flag(document, '.chat-info .peer-title, .chat-info .user-title, .profile-name, .profile-content .peer-title', 'B');
    // Versão A (web.telegram.org/a)
    flag(document, '.chat-list .ListItem, .ListItem.Chat', 'B');
    previews(document, '.ListItem .last-message, .ListItem .subtitle .message', '.sender-name');
    flag(document, '.MessageList, .messages-container', 'K');
    flag(document, '.Message .text-content', 'N');
    flag(document, '.Message .message-title, .Message .sender-title, .Message .message-title-name, .EmbeddedMessage', 'K');
    flag(document, '.MiddleHeader', 'K');
    flag(document, '.MiddleHeader .ChatInfo .title, .MiddleHeader .ChatInfo .fullName, .MiddleHeader h3, .ProfileInfo .title, .ProfileInfo .fullName', 'B');
  }
  // Chatwoot é auto-hospedado: reconhecido pela rota do painel ou pelos componentes, nunca pelo host.
  const CW = '.conversations-list .conversation, .conversation--user, .conversation-header .user--name, .conversation--details';
  const isChatwoot = () => /^\/app\/accounts\/\d+(?:\/|$)/.test(location.pathname) || !!document.querySelector(CW);
  function markChatwoot() {
    flag(document, '.conversations-list .conversation, .conversation-card', 'B');
    previews(document, '.conversation--message, .conversation-card .message-preview', '.message__sender,.sender--name');
    flag(document, '.conversation-panel, .conversation-wrap .messages, [class*="conversation-panel"]', 'K');
    flag(document, '.message-text__wrap, .message-text, .text-content', 'N');
    flag(document, '.conversation-header, .conversation--header', 'K');
    flag(document, '.conversation-header .user--name, .conversation--header .user--name, .user--profile__meta h3, .conversation-header h3, .contact--name, .contact--profile .name', 'B');
  }
  const OWA_PEOPLE = '[aria-label^="De:"],[aria-label^="From:"],[aria-label^="Para:"],[aria-label^="To:"],[aria-label^="Cc:"],[aria-label^="Cco:"],[aria-label^="Bcc:"]';
  function markOutlook() {
    flag(document, OWA_PEOPLE, 'P');
    flag(document, '[role="listbox"] [role="option"] [title*="@"], [role="grid"] [role="row"] [title*="@"], [data-testid="persona"], [data-lpc-hover-target]', 'P');
  }
  function markTeams() {
    flag(document, ['[data-tid="message-author-name"]', '[data-tid="threadBodyDisplayName"]', '[data-tid="chat-list-item-title"]',
      '[id^="title-chat-list-item"]', '[data-tid="chat-title"]', '[data-tid*="roster" i] [title]', '[data-tid*="participant" i] [title]',
      '[data-tid*="display-name" i]', '[data-tid*="displayName"]', '[data-tid="calling-participant-name"]',
      '[data-tid="people-picker-selected-user"]'].join(','), 'P');
  }
  const ADAPTERS = [
    { id: 'whatsapp', chat: true, test: () => location.hostname === 'web.whatsapp.com', mark: markWhatsApp },
    { id: 'telegram', chat: true, test: () => location.hostname === 'web.telegram.org', mark: markTelegram },
    { id: 'chatwoot', chat: true, test: isChatwoot, mark: markChatwoot },
    { id: 'outlook', test: () => /^outlook\.|\.outlook\./.test(location.hostname) || /^\/owa(?:\/|$)/i.test(location.pathname), mark: markOutlook },
    { id: 'teams', test: () => /^teams\./.test(location.hostname), mark: markTeams },
    { id: 'geral', test: () => true, mark: () => {} },
  ];
  function personNames(e) {
    const label = e.getAttribute('name') || (e.matches(OWA_PEOPLE) ? e.getAttribute('aria-label') : '') || e.textContent;
    for (const part of String(label).split(';')) addName(part.replace(/^\s*(?:de|para|cc|cco|bcc|from|to)\s*:\s*/i, ''));
  }

  // ---------- varredura ----------
  const HARD = /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT|SELECT|OPTION|SVG|CANVAS|IFRAME|TEMPLATE)$/i;
  const EDIT = '[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"],[role="textbox"],[role="searchbox"],#pv-layer,#pv-badge';
  const isHard = e => HARD.test(e.nodeName) || e.matches(EDIT);

  // ---------- estado ----------
  let on = false, ranges = [], els = [], obs = null, layer = null, badge = null, raf = 0, timer = 0, firstDirty = 0, hoverIdx = -1, painted = [];
  const excluded = () => !!location.hostname && (get('excluir', '') || '').split(',').filter(Boolean).includes(location.hostname);

  function collect() {
    const t0 = performance.now(), out = [], boxes = new Set(), fileHosts = [];
    const root = document.body || document.documentElement;
    flags = new Map();
    const ad = ADAPTERS.find(a => a.test());
    for (const e of document.querySelectorAll(PERSON)) if (e.nodeName !== 'IMG') flags.set(e, 'P');
    try { ad.mark(); for (const e of document.querySelectorAll(AVATAR)) if (e.textContent.trim().length <= 3) flags.set(e, 'K'); } catch (_) { /* seletor que o navegador não aceita: segue só com o motor geral */ }
    if (!ad.chat) for (const [e, k] of flags) if (k === 'P') personNames(e);
    const drx = getDictRx();
    // Dono da marca mais próxima de cada elemento (memorizado por varredura).
    const memo = new Map(), vSeen = new Set();
    const owner = el => {
      if (!el || el === root) return flags.has(el) ? el : null;
      let o = memo.get(el);
      if (o === undefined) { o = flags.has(el) ? el : owner(el.parentElement); memo.set(el, o); }
      return o;
    };
    const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.nodeType === 1 ? (isHard(n) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_SKIP) : NodeFilter.FILTER_ACCEPT });
    const range = (t, a, b) => { const r = document.createRange(); r.setStart(t, a); r.setEnd(t, b); out.push(r); };
    const whole = (t, from) => {
      const s = t.nodeValue, a = Math.max(from || 0, s.search(/\S/)), b = s.length - (s.match(/\s*$/)[0].length);
      if (a >= 0 && b > a) range(t, a, b);
    };
    let t;
    while ((t = w.nextNode())) {
      const s = t.nodeValue;
      if (!/\S/.test(s)) continue;
      const o = owner(t.parentElement), k = o ? flags.get(o) : '';
      if (k === 'P') { whole(t); continue; }
      if (k === 'B') { if (!TIME_RX.test(s)) whole(t); continue; }
      if (k === 'V') {
        let off = 0;
        const c = /^\s*:\s*/.exec(s);
        if (c) off = c[0].length;
        else if (!vSeen.has(o)) {
          const m = /^\s*([^:\n]{1,40}?):\s/.exec(s);
          if (m && m[1].trim().split(/\s+/).length <= 4 && !/\d/.test(m[1])) off = m[0].length;
        }
        vSeen.add(o);
        whole(t, off);
        continue;
      }
      if (s.length < 3) continue;
      const hits = [], hasD = /\d/.test(s), hasAt = s.includes('@');
      for (const [rx, need, ok] of RULES) {
        if ((need === 1 && !hasD) || (need === 2 && !hasAt)) continue;
        rx.lastIndex = 0; let m;
        while ((m = rx.exec(s))) {
          if (!m[0].length) { rx.lastIndex++; continue; }
          if (!ok || ok(m[0])) { hits.push([m.index, m.index + m[0].length]); if (rx === FILE_RX) fileHosts.push(t.parentElement); }
        }
      }
      if (k !== 'K' && /\p{Lu}/u.test(s)) {
        findNames(s, (a, b) => hits.push([a, b]));
        if (drx) { drx.lastIndex = 0; let m; while ((m = drx.exec(s))) hits.push([m.index, m.index + m[0].length]); }
      }
      if (!hits.length) continue;
      hits.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
      let end = -1;
      for (const [a, b] of hits) { if (a < end) { end = Math.max(end, b); continue; } range(t, a, b); end = b; }
    }
    // Caixas inteiras: QR code e miniatura de anexo sensível. Fotos de perfil nunca.
    for (const e of document.querySelectorAll(QR)) boxes.add(e);
    for (const e of document.querySelectorAll('img[alt],img[title],img[aria-label]')) {
      FILE_RX.lastIndex = 0;
      if (FILE_RX.test(e.alt || e.title || e.getAttribute('aria-label') || '')) boxes.add(e);
    }
    for (const h of fileHosts) {
      let c = h;
      for (let i = 0; i < 4 && c && c !== root; i++, c = c.parentElement) {
        const th = c.querySelectorAll('img,canvas');
        if (th.length) { if (th.length <= 3) th.forEach(x => boxes.add(x)); break; }
      }
    }
    ranges = out; els = [...boxes];
    if (layer) { layer.dataset.scanMs = (performance.now() - t0).toFixed(1); layer.dataset.app = ad.id; }
  }

  // ---------- desenho (sem tocar no DOM da página) ----------
  // Área visível de um elemento: viewport recortada por todo ancestral com overflow (painéis com rolagem).
  function clipFor(el, cache, styles) {
    if (cache.has(el)) return cache.get(el);
    let c = { l: 0, t: 0, r: innerWidth, b: innerHeight };
    const p = el.parentElement;
    if (p && p !== document.documentElement) {
      c = Object.assign({}, clipFor(p, cache, styles));
      let cs = styles.get(p); if (!cs) { cs = getComputedStyle(p); styles.set(p, cs); }
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
        const pr = p.getBoundingClientRect();
        c = { l: Math.max(c.l, pr.left), t: Math.max(c.t, pr.top), r: Math.min(c.r, pr.right), b: Math.min(c.b, pr.bottom) };
      }
    }
    cache.set(el, c); return c;
  }
  function paint() {
    raf = 0; if (!on) return;
    const t0 = performance.now();
    const boxes = [], cache = new Map(), styles = new Map();
    const vw = innerWidth, vh = innerHeight;
    const add = (rect, key, node) => {
      // Fora da viewport: descarta antes de medir ancestrais e consultar elementFromPoint.
      if (rect.right <= 0 || rect.bottom <= 0 || rect.left >= vw || rect.top >= vh) return;
      const host = node.nodeType === 1 ? node : node.parentElement;
      let c = clipFor(host, cache, styles);
      if (node.nodeType !== 1) { // texto: o próprio elemento também recorta (prévia com reticências)
        let cs = styles.get(host); if (!cs) { cs = getComputedStyle(host); styles.set(host, cs); }
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') {
          const hr = host.getBoundingClientRect();
          c = { l: Math.max(c.l, hr.left), t: Math.max(c.t, hr.top), r: Math.min(c.r, hr.right), b: Math.min(c.b, hr.bottom) };
        }
      }
      const l = Math.max(rect.left, c.l), t = Math.max(rect.top, c.t), r = Math.min(rect.right, c.r), b = Math.min(rect.bottom, c.b);
      if (r - l < 2 || b - t < 2) return;
      // Coberto por outro elemento (modal, menu)? Confere o ponto central da parte visível. O selo não conta.
      const hit = document.elementFromPoint((l + r) / 2, (t + b) / 2);
      if (!hit || !(hit === host || host.contains(hit) || (badge && badge.contains(hit)))) return;
      boxes.push([{ left: l, top: t, width: r - l, height: b - t }, String(key)]);
    };
    ranges.forEach((r, i) => { if (r.startContainer.isConnected) for (const rc of r.getClientRects()) add(rc, i, r.startContainer); });
    els.forEach((e, i) => { if (e.isConnected) add(e.getBoundingClientRect(), 'e' + i, e); });
    let html = '';
    for (const [r, k] of boxes) html += `<div data-k="${k}" class="${k === hoverIdx ? 'rv' : ''}" style="left:${r.left - 2}px;top:${r.top - 1}px;width:${r.width + 4}px;height:${r.height + 2}px"></div>`;
    layer.innerHTML = html; layer.dataset.n = boxes.length;
    painted = boxes.map(([r, k]) => [r.left - 2, r.top - 1, r.left + r.width + 2, r.top + r.height + 1, k]); // para o hover
    layer.dataset.paintMs = (performance.now() - t0).toFixed(1); // medição para os testes
  }
  const schedule = () => { if (on && !raf) raf = requestAnimationFrame(paint); };
  // Debounce de 250 ms, mas com espera máxima de 1 s: app que re-renderiza sem parar ainda é revarrido.
  const run = () => { clearTimeout(timer); timer = 0; firstDirty = 0; collect(); schedule(); };
  const rescan = () => {
    const now = performance.now();
    if (!firstDirty) firstDirty = now;
    clearTimeout(timer);
    timer = setTimeout(run, Math.max(0, Math.min(250, firstDirty + 1000 - now)));
  };
  function onMove(e) {
    let k = -1;
    for (const [l, t, r, b, key] of painted) if (e.clientX >= l && e.clientX <= r && e.clientY >= t && e.clientY <= b) { k = key; break; }
    k = String(k);
    if (k !== hoverIdx) { hoverIdx = k; schedule(); }
  }

  // Selo "🔒 borrando": aparece nos prints e desliga com um clique. Canto: valor "canto_selo"
  // (inferior-esquerdo por padrão; também inferior-direito, superior-esquerdo, superior-direito).
  const CORNERS = { 'inferior-esquerdo': 'left:8px;bottom:8px', 'inferior-direito': 'right:8px;bottom:8px',
    'superior-esquerdo': 'left:8px;top:8px', 'superior-direito': 'right:8px;top:8px' };
  function enable() {
    if (on || excluded()) return; on = true;
    layer = document.createElement('div'); layer.id = 'pv-layer';
    const st = document.createElement('style'); st.id = 'pv-style';
    st.textContent = `#pv-layer{position:fixed;inset:0;pointer-events:none;z-index:var(--us-z,2147483646)}
      #pv-layer>div{position:fixed;border-radius:4px;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);background:rgba(127,127,127,.08);transition:opacity .1s}
      #pv-layer>div.rv{opacity:0}
      #pv-badge{position:fixed;${CORNERS[get('canto_selo', '')] || CORNERS['inferior-esquerdo']};z-index:2147483647;min-height:24px;box-sizing:border-box;
        display:flex;align-items:center;padding:2px 10px;border-radius:999px;background:rgba(17,24,39,.85);color:#f9fafb;
        font:600 12px/1 system-ui,"Segoe UI",Roboto,sans-serif;cursor:pointer;user-select:none;pointer-events:auto;
        box-shadow:0 2px 8px rgba(0,0,0,.25);opacity:.9}
      #pv-badge:hover{opacity:1}
      @media (prefers-reduced-motion: reduce){#pv-layer>div{transition:none}}`;
    badge = document.createElement('div'); badge.id = 'pv-badge'; badge.textContent = '🔒 borrando';
    badge.setAttribute('role', 'button'); badge.tabIndex = 0;
    badge.title = 'Dados pessoais: clique para desligar (Alt+Shift+P)';
    badge.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); toggle(); });
    badge.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } });
    document.documentElement.append(st, layer, badge);
    collect(); schedule();
    obs = new MutationObserver(muts => { if (muts.some(m => !layer.contains(m.target) && !badge.contains(m.target))) rescan(); });
    // No <html>: sobrevive à troca do <body> por apps que remontam a página.
    obs.observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    addEventListener('scroll', schedule, { capture: true, passive: true });
    addEventListener('resize', schedule, { passive: true });
    addEventListener('mousemove', onMove, { passive: true });
  }
  function disable() {
    if (!on) return; on = false;
    obs && obs.disconnect(); obs = null; clearTimeout(timer); timer = 0; firstDirty = 0; painted = [];
    removeEventListener('scroll', schedule, { capture: true }); removeEventListener('resize', schedule); removeEventListener('mousemove', onMove);
    layer && layer.remove(); badge && badge.remove(); badge = null;
    document.getElementById('pv-style')?.remove(); ranges = []; els = [];
  }
  function toggle() { on ? disable() : enable(); set('ligado', on); }

  addEventListener('keydown', e => { if (e.altKey && e.shiftKey && e.code === 'KeyP') { e.preventDefault(); toggle(); } }, true);
  try {
    GM_registerMenuCommand('Ligar/desligar (Alt+Shift+P)', toggle);
    GM_registerMenuCommand('Nomes extras a borrar…', () => {
      const v = prompt('Nomes separados por vírgula (ex.: Fulano, Siqueira). Valem sozinhos, sem sobrenome:', get('nomes', ''));
      if (v !== null) { set('nomes', v); location.reload(); }
    });
    if (excluded()) {
      GM_registerMenuCommand('Voltar a borrar neste site', () => {
        set('excluir', (get('excluir', '') || '').split(',').filter(h => h && h !== location.hostname).join(','));
      });
    } else {
      GM_registerMenuCommand('Nunca neste site', () => {
        const l = (get('excluir', '') || '').split(',').filter(Boolean); l.push(location.hostname);
        set('excluir', [...new Set(l)].join(',')); disable();
      });
    }
  } catch (_) {}
  if (get('ligado', false)) enable();
})();
