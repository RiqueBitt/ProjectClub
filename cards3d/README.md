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
