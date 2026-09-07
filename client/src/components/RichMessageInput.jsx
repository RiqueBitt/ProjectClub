import { useEffect, useMemo, useRef } from 'react';

// Item pedido: "quando colocar um emoji no seu texto... em vez de
// aparecer :emoji: vai aparecer o emoji igual na barra de digitação"
// — um campo de texto comum (<input>/<textarea>) NUNCA consegue
// mostrar uma imagem misturada no meio do texto, é uma limitação da
// própria plataforma web, não do código — só um elemento contentEditable
// (uma div "editável", que aceita conteúdo html de verdade, não só
// texto puro) consegue isso.
//
// O "dado real" continua sendo texto puro com os mesmos shortcodes
// :nome: e menções @nome de sempre (é o que sobe pro servidor, o que
// os regex de menção/comando já existentes esperam) — esta div só
// MOSTRA esse texto de um jeito diferente, trocando cada :nome: por
// uma imagem e cada @nome reconhecido por um "chip" com foto de
// perfil. Nunca reescreve o conteúdo da div enquanto a pessoa está
// digitando normalmente (só quando o valor muda por fora — texto
// limpo depois de enviar, emoji inserido pelo seletor, menção
// completada) — mexer no DOM sem necessidade é a forma mais comum de
// contentEditable "comer" o cursor no meio da digitação.
const SHORTCODE_RE = /:([a-zA-Z0-9_]{2,32}):/g;
// Mesma regex, mas ancorada no FINAL do texto — usada só pra saber se
// a pessoa acabou de fechar um :nome: (o segundo ":") enquanto digita.
const TRAILING_SHORTCODE_RE = /:([a-zA-Z0-9_]{2,32}):$/;

function makeEmojiImg(shortcode, url) {
  const img = document.createElement('img');
  img.src = url;
  img.alt = shortcode;
  img.draggable = false;
  img.contentEditable = 'false';
  img.className = 'composer-inline-emoji';
  img.dataset.shortcode = shortcode;
  return img;
}

// Item pedido: "quando eu marcar algum cargo ou membro... quero que
// apareça a foto de perfil do user, tipo assim: [foto] @riqueBitt" —
// um "chip" com fundo destacado (igual a imagem enviada), com a foto
// de perfil dentro quando é uma pessoa (cargo/@everyone/@here não têm
// foto, só o fundo destacado mesmo).
// Item pedido: "no chat e no menu [de digitação] é pra aparecer a
// caixinha com o @ sem foto de perfil" — a foto de perfil é só pra
// aparecer na lista suspensa que sugere quem marcar (o menu que
// abre ao digitar @), nunca dentro do próprio selo da menção — nem
// aqui (ainda escrevendo) nem na mensagem já enviada (ver
// richTextRender.jsx). Mesmas classes já usadas numa mensagem já
// enviada (.mention-chip), pra ficar visualmente idêntico nos dois
// estados.
function makeMentionChip(mentionText) {
  const span = document.createElement('span');
  span.contentEditable = 'false';
  span.className = 'composer-inline-mention mention-chip';
  span.dataset.mention = mentionText;
  span.appendChild(document.createTextNode(mentionText));
  return span;
}

// Nomes de menção conhecidos ordenados do mais LONGO pro mais curto —
// evita "Rique" casar sozinho quando o nome de verdade é "Rique Bitt"
// (um nome mais curto que por acaso é prefixo de um mais longo).
function buildMentionRegex(mentionMap) {
  const names = Object.keys(mentionMap).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!names.length) return null;
  return new RegExp(`@(${names.join('|')})(?=\\s|$)`, 'g');
}

// Reconstrói o conteúdo visual (texto + imagens + chips de menção) a
// partir do texto puro — só chamada quando o valor muda de fora.
function renderInto(el, text, emojiMap, mentionMap) {
  el.innerHTML = '';
  const mentionRe = buildMentionRegex(mentionMap);
  const frag = document.createDocumentFragment();

  // Passo 1: quebra o texto nos pontos de :emoji: primeiro (mesma
  // lógica de sempre), depois quebra CADA pedaço de texto puro
  // resultante nos pontos de @menção — assim os dois tipos de "chip"
  // convivem no mesmo texto sem atropelar um ao outro.
  const appendWithMentions = (chunk) => {
    if (!mentionRe) { frag.appendChild(document.createTextNode(chunk)); return; }
    mentionRe.lastIndex = 0;
    let last = 0;
    let mm;
    let any = false;
    while ((mm = mentionRe.exec(chunk))) {
      any = true;
      if (mm.index > last) frag.appendChild(document.createTextNode(chunk.slice(last, mm.index)));
      frag.appendChild(makeMentionChip(mm[0]));
      last = mentionRe.lastIndex;
    }
    if (last < chunk.length || !any) frag.appendChild(document.createTextNode(chunk.slice(last)));
  };

  SHORTCODE_RE.lastIndex = 0;
  let lastIndex = 0;
  let m;
  let hadShortcode = false;
  while ((m = SHORTCODE_RE.exec(text))) {
    const url = emojiMap[m[1]];
    if (!url) continue;
    hadShortcode = true;
    if (m.index > lastIndex) appendWithMentions(text.slice(lastIndex, m.index));
    frag.appendChild(makeEmojiImg(m[0], url));
    lastIndex = SHORTCODE_RE.lastIndex;
  }
  if (lastIndex < text.length || !hadShortcode) appendWithMentions(text.slice(lastIndex));
  el.appendChild(frag);
}

// Extrai o texto puro de volta (reconstruindo :nome: e @menção a
// partir de cada elemento) — chamada a cada tecla, pra manter o
// `content` (a fonte de verdade de verdade, usada pra tudo mais:
// menções, envio, etc) em dia.
function extractText(el) {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent;
    else if (node.tagName === 'IMG') out += node.dataset.shortcode || '';
    else if (node.dataset?.mention) out += node.dataset.mention;
    else if (node.tagName === 'BR') { /* ignora — campo de uma linha só, não deveria ter quebra */ }
    else out += node.textContent || '';
  }
  return out;
}

// Enquanto digita, se o texto imediatamente antes do cursor forma um
// :nome: ou @nome reconhecido (a pessoa acabou de fechar/completar),
// troca só aquele trecho por uma imagem/chip — sem tocar em mais nada
// do resto do texto, então o cursor do resto da digitação nunca é
// afetado.
function maybeConvertTyped(emojiMap, mentionMap) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) return false;

  const node = range.startContainer;
  const before = node.textContent.slice(0, range.startOffset);

  const shortcodeMatch = before.match(TRAILING_SHORTCODE_RE);
  if (shortcodeMatch) {
    const url = emojiMap[shortcodeMatch[1]];
    if (url) return replaceTypedMatch(node, range, shortcodeMatch[0], makeEmojiImg(shortcodeMatch[0], url), sel);
  }

  // Item pedido: "quando marcar um membro... a foto de perfil" — só
  // converte enquanto digitando quando o próximo caractere depois do
  // nome já foi digitado (espaço) — sem isso não dá pra saber se a
  // pessoa terminou de digitar "Rique" ou ainda vai completar "Rique
  // Bitt", já que nomes podem ter espaço no meio.
  if (before.endsWith(' ')) {
    const withoutTrailingSpace = before.slice(0, -1);
    const mentionRe = buildMentionRegex(mentionMap);
    if (mentionRe) {
      const anchored = new RegExp(mentionRe.source + '$');
      const mentionMatch = withoutTrailingSpace.match(anchored);
      if (mentionMatch) {
        const full = mentionMatch[0] + ' ';
        return replaceTypedMatch(node, range, full, makeMentionChip(mentionMatch[0]), sel, true);
      }
    }
  }

  return false;
}

// Substitui o trecho de texto recém-digitado (matchText, terminando
// bem onde o cursor está agora) pelo elemento dado, e deixa o cursor
// logo depois dele — combinado, cobre tanto :emoji: (o elemento some
// no lugar do texto todo) quanto @menção (o chip entra, e um espaço
// de verdade continua logo depois dele, já que keepTrailingSpace pede
// pra recriar esse espaço como texto normal, não como parte do chip).
function replaceTypedMatch(node, range, matchText, element, sel, keepTrailingSpace) {
  const matchStart = range.startOffset - matchText.length;
  const replaceRange = document.createRange();
  replaceRange.setStart(node, matchStart);
  replaceRange.setEnd(node, range.startOffset);
  replaceRange.deleteContents();
  replaceRange.insertNode(element);

  const after = document.createRange();
  if (keepTrailingSpace) {
    const spaceNode = document.createTextNode(' ');
    element.after(spaceNode);
    after.setStart(spaceNode, 1);
  } else {
    after.setStartAfter(element);
  }
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
  return true;
}

export default function RichMessageInput({ value, onChange, emojiMap, mentionMap = {}, placeholder, inputRef, onSubmit, onFocus, onBlur, className }) {
  const elRef = useRef(null);
  // Último valor que ESTE componente já emitiu via onChange — se o
  // `value` recebido por prop for igual a isso, a mudança veio da
  // própria digitação (já refletida no DOM, não precisa reescrever
  // nada). Só reescreve quando são DIFERENTES (mudança de fora).
  //
  // BUG CORRIGIDO: começar isso já igual a `value` (em vez de null)
  // fazia a comparação abaixo achar que "nada mudou" logo na primeira
  // montagem, mesmo quando `value` chega não-vazio de início (um
  // rascunho salvo, por exemplo) — o campo apareceria vazio na tela
  // mesmo já tendo conteúdo de verdade por trás. null nunca é igual a
  // uma string de verdade, garantindo que a primeira montagem sempre
  // desenha o conteúdo inicial corretamente.
  const lastEmittedRef = useRef(null);

  useEffect(() => {
    if (!inputRef) return;
    inputRef.current = { focus: () => elRef.current?.focus() };
  }, [inputRef]);

  useEffect(() => {
    if (value === lastEmittedRef.current) return;
    const el = elRef.current;
    if (!el) return;
    renderInto(el, value, emojiMap, mentionMap);
    lastEmittedRef.current = value;
    // O cursor sempre vai pro final depois de uma mudança externa —
    // seguro aqui porque toda mudança externa (limpar após enviar,
    // inserir emoji do seletor, completar uma menção) sempre mexe no
    // FINAL do texto, nunca no meio dele.
    //
    // BUG CORRIGIDO ("marco alguém e o espaço some — vira
    // '@nomebomdia' em vez de '@nome bom dia'"): "ir pro fim do
    // container inteiro" (selectNodeContents + collapse) é ambíguo
    // bem na borda entre um bloco não-editável (o chip da menção,
    // contentEditable="false") e o texto de verdade logo depois dele
    // (o espaço) — alguns navegadores resolvem essa borda de um jeito
    // que a próxima letra digitada entra ANTES do espaço em vez de
    // depois, comendo ele. Em vez de deixar o navegador decidir isso
    // sozinho, aponta explicitamente pro nó de verdade: se o último
    // pedaço do texto é texto puro (o caso comum — sempre sobra pelo
    // menos o espaço depois de uma menção, ou o próprio texto que já
    // tinha antes), o cursor vai pro fim DESSE nó de texto vazio; só
    // cai no "depois do elemento" se o próprio conteúdo terminar
    // direto numa imagem/chip, sem nenhum texto depois (mais raro).
    if (document.activeElement === el) {
      const range = document.createRange();
      const last = el.lastChild;
      if (last && last.nodeType === Node.TEXT_NODE) {
        range.setStart(last, last.textContent.length);
      } else if (last) {
        range.setStartAfter(last);
      } else {
        range.selectNodeContents(el);
      }
      range.collapse(true);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, [value, emojiMap, mentionMap]);

  // BUG CORRIGIDO ("escolho a menção pela lista, ela cria a caixinha
  // certinho, mas continuo digitando e do nada o nome dela volta
  // como texto solto colado na frente — só no celular"): teclados
  // virtuais de celular (o "IME" do sistema) não digitam letra por
  // letra direto — enquanto você ainda está no meio de uma palavra,
  // o texto fica "em composição" por baixo dos panos, só virando
  // texto de verdade quando termina (evento compositionend). Mexer
  // no próprio DOM (que é o que maybeConvertTyped faz, trocando texto
  // por um selo) bem no meio dessa composição confunde o teclado
  // sobre o que já foi digitado, e ele reinsere um pedaço que já
  // tinha processado — exatamente o "nome duplicado" relatado. A
  // correção: nunca mexer no DOM enquanto uma composição está rolando,
  // só depois que ela termina de verdade (compositionend).
  const composingRef = useRef(false);

  const onInput = () => {
    if (!composingRef.current) maybeConvertTyped(emojiMap, mentionMap);
    const text = extractText(elRef.current);
    lastEmittedRef.current = text;
    onChange(text);
  };

  const onCompositionStart = () => { composingRef.current = true; };
  const onCompositionEnd = () => {
    composingRef.current = false;
    // A composição terminou (ex: apertou espaço) — só agora é seguro
    // conferir se o que acabou de ser digitado forma um :emoji: ou
    // @menção completos.
    maybeConvertTyped(emojiMap, mentionMap);
    const text = extractText(elRef.current);
    lastEmittedRef.current = text;
    onChange(text);
  };

  const onKeyDown = (e) => {
    // BUG CORRIGIDO ("Enter não envia mais"): o <input> de antes vivia
    // dentro de um <form>, que envia sozinho ao apertar Enter — uma
    // div contentEditable não tem esse comportamento nativo nenhum,
    // então precisa ser tratado manualmente aqui, senão apertar Enter
    // não faria absolutamente nada.
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSubmit?.();
    }
  };

  // Colar sempre insere texto puro, nunca formatação/HTML de outro
  // lugar (um site, um documento) — o navegador colaria isso como
  // parte do conteúdo "rico" da contentEditable por padrão, algo que
  // o <input> antigo nunca permitiria acontecer.
  const onPaste = (e) => {
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  return (
    <div
      ref={elRef}
      className={`rich-message-input ${className || ''}`}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="false"
      data-placeholder={placeholder}
      onInput={onInput}
      onCompositionStart={onCompositionStart}
      onCompositionEnd={onCompositionEnd}
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  );
}
