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
