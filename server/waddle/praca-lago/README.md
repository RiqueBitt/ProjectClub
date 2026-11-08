# Cenários do Project Club no mapa (e a sala Lago, arte do dono)

Esta pasta gera o **patch do mapa** (`icons.json` → ícones clicáveis em `MAP.id_0`)
e guarda a sala **Lago** feita da arte do dono (`lago.swf`, hoje fora do ar — o
ícone do lago no mapa leva ao **Lago Escondido** original de 2015).

## Cenários (salas ORIGINAIS de festas, já na mídia do WF)

`server/src/services/waddle/island.js` → `EXTRA_ROOMS`: Expedição da Montanha 2010
(`monte1`-`monte6`: Acampamento Base, Caverna de Gelo, Acampamento do Pico, Encosta,
Topo da Montanha, Gruta do Tesouro), Expedição da Caverna 2010 (`cavex1`-`cavex3`),
Wilderness 2011 (`wilder1`, Caverna dos Puffles Marrons), Music Jam 2010 (`jam10`,
Palco Music Maker), Aventura na Ilha 2010 (`copas`, Casa na Árvore; `pirata`, Convés
do Navio). Dentro das salas os gatilhos usam `partyN`; `swf-patches.ts` troca pelas
chaves novas (mesmo tamanho) pra cadeia continuar andando. Ícones: `make_icons.py`
recorta a arte original de cada sala (`art/renders/`) num círculo com borda, estilo
dos ícones do mapa 2015; posições e salas em `icons.json`. **Acesso rápido pelo mapa
DESLIGADO** (pedido do dono, nov/2026): `icons.json` só tem o lago; a lista completa
está em `icons.cenarios.json` — pra religar, copie as entradas de volta e regere.

```sh
python3 make_icons.py        # art/icon-<key>.png a partir de art/renders/<key>.png (FFDec: -export frame)
python3 build_map.py         # map.as + build/map-semscript.swf
java -jar ffdec.jar -importScript build/map-semscript.swf build/map.swf build/map-scripts
python3 extract.py           # → ../src/server/file-server/praca-lago-map-tags.ts
```

## Lago — sala própria (arte do dono)

Sala nova do Club Penguin da Praça (`room_key: lago`, id 438), feita a partir da
arte do dono (`art/cena.png`, 760×480) — não é um arquivo da Disney/Archives.

## O que a sala tem

- **`background_mc`**: a cena inteira (JPEG) + a **cachoeira animada**
  (`waterfall_mc`, 8 quadros a 12 fps, textura rolando sem emenda).
- **`foreground_mc`**: só a água do lago, com 62% de opacidade e pulsando de
  leve. O engine põe essa camada **por cima dos pinguins** (profundidade
  900001), então quem anda no lago fica "embaixo da água".
- **`block_mc`**: vetor (contornos da máscara `build/bloqueio.png`) com tudo em
  que não dá pra andar — árvores, pedras, lanternas, cerca, céu. Dá pra andar
  na neve, na água, no deque e na escada.
- **`triggers_mc`**: `forest_mc` (topo da escada → Floresta) e `cove_mc`
  (trilha da direita → Enseada). Sai andando.
- **Mapa**: `art/icone.png` (arte do dono) é o ícone `lake` em `icons.json`, só a
  água é clicável, sobre o laguinho entre as árvores (490, 362).

Pra voltar a servir a sala Lago: registrar `lago` (id 438, já em `rooms.ts`) em
`EXTRA_ROOMS` apontando pra `pcisland/lago.swf` (copiar o arquivo) e trocar o
`room` do ícone `lake` em `icons.json` pra `lago`.

## Gerar de novo

Precisa de Python 3 (Pillow, numpy, opencv-python-headless) e do
[JPEXS FFDec](https://github.com/jindrapetrik/jpexs-decompiler) (`ffdec.jar`).

```sh
cd server/waddle/praca-lago
python3 build.py                                                   # build/lago-semscript.swf + build/scripts (lago.as)
java -jar ffdec.jar -importScript build/lago-semscript.swf lago.swf build/scripts

python3 build_map.py                                               # build/map-semscript.swf + build/map-scripts (map.as)
java -jar ffdec.jar -importScript build/map-semscript.swf build/map.swf build/map-scripts
python3 extract.py                                                 # → ../src/server/file-server/praca-lago-map-tags.ts

cd ../.. && npm run waddle:build
```

`build/previa.png` mostra a cena com o bloqueio em vermelho e os gatilhos em
verde — confira antes de publicar. Trocar a arte: substitua `art/cena.png`
(760×480; se for a original 1672×941 o build escala e corta sozinho) e
`art/icone.png` (PNG com transparência) e rode tudo de novo.

`swfwriter.py` é um escritor mínimo de SWF (bitmaps JPEG3/lossless, formas,
sprites, PlaceObject2, ExportAssets) — detalhes que custaram: o RGB do
DefineBitsJPEG3 é premultiplicado pelo alpha; só MovieClip (DefineSprite) tem
nome acessível no AVM1 (forma solta com nome não resolve); no Ruffle um filho
do ícone não recebia o mouse, por isso a área de clique é um símbolo à parte.
