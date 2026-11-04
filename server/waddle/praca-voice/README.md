# Botões de voz dentro da barra do Club Penguin (+ consertos da interface)

`voice.as.tpl` é ActionScript 2 que roda no 1º quadro do `interface.swf`
(depois do script principal da interface). Ele:

- encurta a caixa de escrever do chat em 60 px (máscara + botão de enviar
  e campo de texto mais pra esquerda) e põe os botões **Falar** e **Ouvir**
  no espaço que sobra, desenhados igual aos botões da barra (os mesmos
  círculos/cores do botão 226 do `interface.swf`);
- conversa com a página pelo ExternalInterface do Ruffle
  (`pracaVoiceToggle`, `pracaVoiceReady` ← jogo; `pracaVoiceState` → jogo);
- conserta a compra de iglus, pisos e locais no catálogo de móveis
  (`purchaseItemFromAS3` ignorava os tipos 3, 5 e 6).

Os ícones ficam em `client/public/praca-ui/` (carregados pelo jogo).

## Gerar de novo

Precisa de Python 3 e do [JPEXS FFDec](https://github.com/jindrapetrik/jpexs-decompiler) (`ffdec.jar`):

```sh
cd server/waddle/praca-voice
python3 gen.py                      # voice.as.tpl → scripts/frame_1/DoAction.as
python3 template.py                 # template.swf (SWF vazio com 1 DoAction)
java -jar ffdec.jar -importScript template.swf voice.swf scripts
python3 extract.py                  # → ../src/server/file-server/praca-voice-action.ts
cd ../.. && npm run waddle:build
```

O servidor insere a tag no `interface.swf` na hora de servir
(`src/server/file-server/swf-patches.ts`).
