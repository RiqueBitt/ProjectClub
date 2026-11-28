# Parede da Loja em 3D

O painel perfurado, o gancho cromado, a caixinha de plástico e as sombras da
Loja são **modelos 3D feitos por código e renderizados no Blender (Cycles)** —
não vêm de gerador de imagem. O script é `render.py`; as imagens prontas ficam
em `client/public/loja/parede/` e quem monta tudo é `client/src/styles/shop-store.css`.

| Arquivo | O que é |
|---|---|
| `caixinha.webp` | o plástico da caixinha e a aba de pendurar, em **cinza** (a cor de cada item é aplicada no CSS) — **tira de 7 quadros**, um por giro |
| `sombra.webp` | a sombra que a caixinha faz na cartela — tira de 7 quadros |
| `gancho.webp` | o gancho cromado e a sombra dele (um quadro só: o gancho não gira) |
| `painel.webp` | azulejo do painel perfurado (6 × 6 furos, repete sem emenda) |
| `medidas.json` | onde fica cada coisa dentro do quadro, em %, e a matriz de cada giro |
| `../../src/data/lojaCaixinha.js` | as mesmas matrizes, geradas pro site importar |

Aqui na pasta ficam também `caixinha.glb` (o **modelo 3D** exportado: abre em
qualquer visualizador de glTF, no Blender, no Windows 3D Viewer…) e
`prova-3d.png` (o mesmo modelo visto de frente, de lado, por trás e de cima).

## O modelo

- **Caixinha**: prisma de cantos arredondados, fechado — filme da frente, as
  quatro laterais, e a placa de trás —, com quina arredondada na frente e
  atrás e parede com espessura (modificador Solidify).
- **Aba**: chapa de plástico com o furo comprido, saindo do fundo.
- **Gancho**: a cabeça fica presa no painel; o arame desce rente à parede por
  trás da aba, dobra pra fora, **atravessa o furo** e vira pra cima na ponta.
- **Plástico**: bem claro de frente (dá pra ver o item atrás) e mais fechado de
  lado, com verniz e a microtextura do plástico injetado.

## Vários ângulos (o giro)

A caixinha é renderizada girando no gancho em `ANGULOS` (−15° a +15°, de 5 em
5°): roda em volta do furo da aba e desliza pra fora no arame o bastante pra
quina de trás não entrar na parede. Cada camada vira uma tira com os 7 quadros
lado a lado; o site troca de quadro conforme o mouse/dedo
(`client/src/utils/packSpin.js`), então o que aparece ao virar são as
laterais de verdade do modelo.

O item e a etiqueta do nome ficam no plano do **fundo** da caixinha; o brilho e
os selos (Novo, desconto…), no plano da **frente**. Pra cada giro o script
calcula a matriz (homografia) que leva o retângulo "de frente" pro lugar onde
aquele plano aparece no render — é ela que o site aplica (`--m-fundo`,
`--m-frente`).

## Como as camadas se juntam

De baixo pra cima, dentro de cada cartela: sombra → fundo da caixinha com o item
(o que já existia: moldura, efeito, fonte, estilo) → etiqueta com o nome →
plástico → etiquetas (Novo, desconto…) → gancho.

A caixinha sai do render em cinza neutro. O CSS pinta com a cor do item usando
`background-blend-mode: luminosity` (o render dá o claro/escuro e o brilho, a
cor vem de `--pack`) e recorta com `mask` pela transparência da própria imagem.
Assim uma imagem só serve pra qualquer cor.

Gancho, caixinha e sombra usam a **mesma câmera e o mesmo quadro** (264 × 357,6 px
na tela), então é só empilhar. A câmera fica acima e à direita, bem longe, com a
lente deslocada: a frente da caixinha continua um retângulo reto (o item encaixa
sem distorcer) e mesmo assim aparecem a tampa e a lateral.

## Renderizar de novo

```bash
pip install bpy pillow          # Blender como módulo do Python
python tools/loja-3d/render.py giro          # os 7 giros da caixinha + sombra + gancho (~30 min em 2 núcleos)
python tools/loja-3d/render.py giro --rascunho   # rápido e granulado (~2 min), pra testar mudança
python tools/loja-3d/render.py painel        # só o painel perfurado
python tools/loja-3d/render.py prova         # prova-3d.png (várias vistas) + caixinha.glb
python tools/loja-3d/render.py giro --refazer    # ignora os quadros já prontos em /tmp/l3d
```

Mudou tamanho da caixinha, da aba ou a câmera? O script imprime `MEDIDAS`:
copie os números novos para as porcentagens de `.room-pack-window`,
`.room-pack-glare`, `.room-card-flags` e `transform-origin` de `.room-pack` em
`shop-store.css`. Trocou a imagem? Suba o `?v=` das `url()` no CSS pra ninguém
ficar com a antiga em cache.
