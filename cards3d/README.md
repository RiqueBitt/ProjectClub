# Guerra das Cartas 3D (em andamento — pausado)

Trabalho começado em 22/11/2026 e pausado a pedido do dono (prioridade: Rust no ar).

O que já tem aqui:
- `blender/pc3d/lib.py` — base do pipeline (primitivas, materiais, esqueleto, animações, exportar `.glb`).
- `blender/pc3d/rigs.py` — esqueletos e as 11 animações (idle, walk, run, attack, special, defense, hit,
  victory, defeat, death, spawn) dos 5 arquétipos: bípede, quadrúpede, bolinha, voador e serpente.
- `blender/pc3d/creatures.py` — construtores das criaturas por arquétipo.
- `blender/pc3d/recipes.py` — a "receita" do modelo das cartas originais do Project Club e os espíritos elementais.
- `blender/build.py` — gera `assets/units/<slug>.glb` (e prévias com `--preview`).

Como rodar: `pip install bpy` e `python blender/build.py --preview lobo-brasa`.

Falta: arenas, heróis, cliente 3D em Rust (Bevy → WebAssembly), motor de regras em Rust, integração na tela de
batalha e voz na partida.

## Novo visual (22/11/2026): arena em faixas + puffles do Club Penguin

Os bonecos feitos à mão no Blender (`pc3d/creatures.py`) ficaram feios, então o
visual agora é o de "bonecos de papelão" de desenho animado de pé numa arena 3D:

- `blender/pc3d/arena.py` — tabuleiro 5 faixas × 2 lados: piso de hexágonos por
  terreno (campo, água, pântano, lava, luz, sombra, ar), linhas neon, plataformas
  nos slots, moldura de madeira, parede de tábuas. Tudo por código, original.
  `python blender/arena_preview.py [--glb] [--rapido]` → `preview/arena_*.png` e `assets/arena.glb`.
- `sprites/puffle/*.webp` — os 9 puffles ORIGINAIS do Club Penguin (SWF do bucket
  `waddle-media`, renderizado em alta com o Ruffle, fundo transparente). O SWF só
  tem 1 pose por cor (as demais mudam por dentro de clipes), então a animação
  (pulo, esmagar, balançar, ataque) é feita no jogo.
- `blender/pack_sprites.py` — recorta o puffle de cada cor.

## Visual v2 (22/11/2026): tudo com a arte ORIGINAL do Club Penguin em 3D

A referência do dono é a imagem da praça nevada com pista de gelo. Os personagens
(heróis e unidades) agora são a ARTE ORIGINAL do Club Penguin — pinguins e puffles
tirados dos SWFs do bucket `waddle-media`, renderizados em alta com o Ruffle — virada
em objeto 3D com volume por "relevo inflado" (`blender/pc3d/relief.py`): de frente é
idêntico ao Club Penguin, e tem corpo, luz e sombra de verdade.

- `tools/` — renderizar SWF → PNG (Ruffle + Chrome headless): `swf.py`/`frames.py`
  (cortam um quadro e ajustam o palco), `multi.py`/`bigshot.py` (capturas),
  `ruffle_index.html` (página do player). Precisa de `npm i @ruffle-rs/ruffle` e Playwright.
- `blender/make_penguin_sprites.py` — pinguim sem o aro do chão, recolorido nas 17 cores da Praça.
- `blender/make_hero_sprite.py` — pinguim + item de cabeça original (ex.: King's Crown, id 667).
- `blender/pack_sprites.py` — puffles (9 cores) sem a sombra desenhada.
- `blender/pc3d/plaza.py` — praça nevada (pista de gelo, prédios, pinheiros, montanhas…) por código.
- `blender/praca_preview.py [--glb] [--rapido]` — cena completa → `preview/praca.png`, `assets/praca.glb`.
- Substitui o visual de arena em faixas (v1) e os bonecos feitos à mão (`pc3d/creatures.py`).
