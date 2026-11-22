# Parede da Loja em 3D

O painel perfurado, o gancho cromado, a caixinha de plástico e as sombras da
Loja são **modelos 3D feitos por código e renderizados no Blender (Cycles)** —
não vêm de gerador de imagem. O script é `render.py`; as imagens prontas ficam
em `client/public/loja/parede/` e quem monta tudo é `client/src/styles/shop-store.css`.

| Arquivo | O que é |
|---|---|
| `caixinha.webp` | o plástico da caixinha e a aba de pendurar, em **cinza** (a cor de cada item é aplicada no CSS) |
| `sombra.webp` | a sombra que a caixinha faz na cartela |
| `gancho.webp` | o gancho cromado e a sombra dele |
| `painel.webp` | azulejo do painel perfurado (6 × 6 furos, repete sem emenda) |
| `medidas.json` | onde fica cada coisa dentro do quadro, em % (as mesmas medidas estão no CSS) |

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
python tools/loja-3d/render.py tudo          # painel + caixinha + sombra + gancho (~8 min em 2 núcleos)
python tools/loja-3d/render.py caixinha      # só uma camada (caixinha | sombra | gancho | painel)
python tools/loja-3d/render.py tudo --rascunho   # rápido e granulado, pra testar mudança
```

Mudou tamanho da caixinha, da aba ou a câmera? O script imprime `MEDIDAS`:
copie os números novos para as porcentagens de `.room-pack-window`,
`.room-pack-glare`, `.room-card-flags` e `transform-origin` de `.room-pack` em
`shop-store.css`. Trocou a imagem? Suba o `?v=` das `url()` no CSS pra ninguém
ficar com a antiga em cache.
