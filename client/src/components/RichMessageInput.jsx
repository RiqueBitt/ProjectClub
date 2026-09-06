import { useEffect, useRef } from 'react';

// Item pedido: "quando colocar um emoji no seu texto... em vez de
// aparecer :emoji: vai aparecer o emoji igual na barra de digitação"
// — um campo de texto comum (<input>/<textarea>) NUNCA consegue
// mostrar uma imagem misturada no meio do texto, é uma limitação da
// própria plataforma web, não do código — só um elemento contentEditable
// (uma div "editável", que aceita conteúdo html de verdade, não só
// texto puro) consegue isso.
//
// O "dado real" continua sendo texto puro com os mesmos shortcodes
// :nome: de sempre (é o que sobe pro servidor, o que os regex de
// menção/comando já existentes esperam) — esta div só MOSTRA esse
// texto de um jeito diferente, trocando cada :nome: reconhecido por
// uma imagem. Nunca reescreve o conteúdo da div enquanto a pessoa
// está digitando normalmente (só quando o valor muda por fora — texto
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

// Reconstrói o conteúdo visual (texto + imagens) a partir do texto
// puro com shortcodes — só chamada quando o valor muda de fora.
function renderInto(el, text, emojiMap) {
  el.innerHTML = '';
  SHORTCODE_RE.lastIndex = 0;
  let lastIndex = 0;
  let m;
  const frag = document.createDocumentFragment();
  while ((m = SHORTCODE_RE.exec(text))) {
    const url = emojiMap[m[1]];
    if (!url) continue;
    if (m.index > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
    frag.appendChild(makeEmojiImg(m[0], url));
    lastIndex = SHORTCODE_RE.lastIndex;
  }
  if (lastIndex < text.length || !frag.childNodes.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  el.appendChild(frag);
}

// Extrai o texto puro de volta (reconstruindo :nome: a partir de cada
// imagem) — chamada a cada tecla, pra manter o `content` (a fonte de
// verdade de verdade, usada pra tudo mais: menções, envio, etc) em dia.
function extractText(el) {
  let out = '';
  for (const node of el.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) out += node.textContent;
    else if (node.tagName === 'IMG') out += node.dataset.shortcode || '';
    else if (node.tagName === 'BR') { /* ignora — campo de uma linha só, não deveria ter quebra */ }
    else out += node.textContent || '';
  }
  return out;
}

// Enquanto digita, se o texto imediatamente antes do cursor forma um
// :nome: reconhecido (a pessoa acabou de fechar com o segundo ":"),
// troca só aquele trecho por uma imagem — sem tocar em mais nada do
// resto do texto, então o cursor do resto da digitação nunca é afetado.
function maybeConvertTypedShortcode(emojiMap) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return false;
  const range = sel.getRangeAt(0);
  if (!range.collapsed || range.startContainer.nodeType !== Node.TEXT_NODE) return false;

  const node = range.startContainer;
  const before = node.textContent.slice(0, range.startOffset);
  const m = before.match(TRAILING_SHORTCODE_RE);
  if (!m) return false;
  const url = emojiMap[m[1]];
  if (!url) return false;

  const matchStart = range.startOffset - m[0].length;
  const img = makeEmojiImg(m[0], url);

  const replaceRange = document.createRange();
  replaceRange.setStart(node, matchStart);
  replaceRange.setEnd(node, range.startOffset);
  replaceRange.deleteContents();
  replaceRange.insertNode(img);

  const after = document.createRange();
  after.setStartAfter(img);
  after.collapse(true);
  sel.removeAllRanges();
  sel.addRange(after);
  return true;
}

export default function RichMessageInput({ value, onChange, emojiMap, placeholder, inputRef, onSubmit, onFocus, onBlur, className }) {
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
    renderInto(el, value, emojiMap);
    lastEmittedRef.current = value;
    // O cursor sempre vai pro final depois de uma mudança externa —
    // seguro aqui porque toda mudança externa (limpar após enviar,
    // inserir emoji do seletor, completar uma menção) sempre mexe no
    // FINAL do texto, nunca no meio dele.
    if (document.activeElement === el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    }
  }, [value, emojiMap]);

  const onInput = () => {
    maybeConvertTypedShortcode(emojiMap);
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
      onKeyDown={onKeyDown}
      onPaste={onPaste}
      onFocus={onFocus}
      onBlur={onBlur}
    />
  );
}
