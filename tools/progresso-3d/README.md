# Pódio e medalhão da página de Progresso, em 3D

Os três blocos do pódio (ouro, prata e bronze, com o número em relevo) e o
medalhão de metal das conquistas são **modelos 3D feitos por código e
renderizados no Blender (Cycles)** — não vêm de gerador de imagem. O script é `render.py`; o resultado fica em
`client/public/progresso/` e quem monta a página é `client/src/styles/progress.css`.

| Arquivo | O que é |
|---|---|
| `podio.webp` | os três blocos e a sombra deles, com fundo transparente (serve em tema claro e escuro) |
| `medidas.json` | onde fica o topo de cada bloco dentro da imagem, em % |
| `medalhao.webp` | medalhão redondo visto de frente, em **cinza** (a cor é aplicada no CSS) e a sombra dele |

## Como a página usa

A imagem ocupa a caixa `.pg-podium` inteira. Cada pessoa do top 3 é posta em pé
no meio do topo do seu bloco com `left: --x` e `bottom: 100% - --topo`; esses
números estão em `progress.css` (`.pg-podium-spot.place-1/2/3`) e são os mesmos
de `medidas.json`. Como tudo é em %, o pódio encolhe junto com a tela.

## O medalhão

Sai do render em cinza neutro. O CSS (`.pg-medal`) pinta com `--tint` usando
`background-blend-mode: luminosity` (o render dá o claro/escuro e o brilho, a
cor vem da variável) e recorta com `mask` pela transparência da imagem. Assim
uma imagem só serve pro nível (cor do tema), pra cada raridade de conquista,
pras recompensas (verde quando liberada) e pros trancados (cinza escuro).
O disco fica um pouco fora do centro da imagem pra sobrar espaço pra sombra;
por isso o `::before` do `.pg-medal` é maior que a caixa e deslocado.

## Renderizar de novo

```
pip install bpy pillow numpy
python tools/progresso-3d/render.py podio --rascunho   # ~30 s, pra conferir
python tools/progresso-3d/render.py podio              # final, alguns minutos
python tools/progresso-3d/render.py medalhao           # ~1 min e meio
```

Mudou tamanho, altura ou posição dos blocos? Copie os números novos de
`medidas.json` pro `progress.css` e pro teste `client/e2e/progresso.spec.mjs`,
e troque o `?v=` da imagem no CSS pra ninguém ficar com a antiga em cache.

O número usa a fonte Inter Display Black (`PODIO3D_FONTE` aponta pra outro
arquivo, se precisar); sem ela o Blender usa a fonte padrão dele.
