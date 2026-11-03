// Markdown simples da wiki (/wiki) → elementos React, SEM innerHTML.
// Suporta: # / ## / ### títulos, parágrafos, listas (- * 1.), citações (>),
// **negrito**, *itálico*, `código`, [texto](link) e /wiki/slug soltos.
// Links externos abrem em aba nova; internos (/...) navegam no app.
import { Fragment } from 'react';

const INLINE_RE = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\)|(?<![\w/.])\/wiki\/[a-z0-9-]+)/g;

function safeHref(href) {
  const h = String(href || '').trim();
  if (h.startsWith('/') && !h.startsWith('//')) return { href: h, internal: true };
  if (/^https?:\/\//i.test(h)) return { href: h, internal: false };
  return null;
}

function renderInline(text, onNavigate, keyBase) {
  const parts = String(text).split(INLINE_RE);
  return parts.map((p, i) => {
    const key = `${keyBase}-${i}`;
    if (!p) return null;
    if (/^\*\*[^*]+\*\*$/.test(p)) return <strong key={key}>{p.slice(2, -2)}</strong>;
    if (/^\*[^*]+\*$/.test(p)) return <em key={key}>{p.slice(1, -1)}</em>;
    if (/^`[^`]+`$/.test(p)) return <code key={key}>{p.slice(1, -1)}</code>;
    const link = p.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
    const bare = /^\/wiki\/[a-z0-9-]+$/.test(p) ? p : null;
    if (link || bare) {
      const target = safeHref(bare || link[2]);
      const label = bare || link[1];
      if (!target) return <Fragment key={key}>{label}</Fragment>;
      return target.internal
        ? <a key={key} href={target.href} onClick={(e) => { e.preventDefault(); onNavigate?.(target.href); }}>{label}</a>
        : <a key={key} href={target.href} target="_blank" rel="noopener noreferrer nofollow">{label}</a>;
    }
    return <Fragment key={key}>{p}</Fragment>;
  });
}

/** Quebra o markdown em blocos { type, text | items, level }. Puro (testável). */
export function parseWikiBlocks(md) {
  const lines = String(md || '').replace(/\r/g, '').split('\n');
  const blocks = [];
  let para = [];
  let list = null;
  const flushPara = () => { if (para.length) { blocks.push({ type: 'p', text: para.join(' ') }); para = []; } };
  const flushList = () => { if (list) { blocks.push(list); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^\s{0,3}(#{1,3})\s+(.+?)\s*#*$/);
    const li = line.match(/^\s*(?:([-*•])|(\d+)[.)])\s+(.+)$/);
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if (h) { flushPara(); flushList(); blocks.push({ type: 'h', level: h[1].length, text: h[2] }); continue; }
    if (li) {
      flushPara();
      const ordered = !!li[2];
      if (!list || list.ordered !== ordered) { flushList(); list = { type: 'list', ordered, items: [] }; }
      list.items.push(li[3]);
      continue;
    }
    if (quote) { flushPara(); flushList(); blocks.push({ type: 'quote', text: quote[1] }); continue; }
    flushList();
    para.push(line.trim());
  }
  flushPara();
  flushList();
  return blocks;
}

export const headingId = (text) => String(text || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function WikiMarkdown({ body, onNavigate }) {
  const blocks = parseWikiBlocks(body);
  return (
    <div className="wiki-md">
      {blocks.map((b, i) => {
        const key = `b${i}`;
        if (b.type === 'h') {
          const Tag = b.level === 1 ? 'h2' : b.level === 2 ? 'h3' : 'h4';
          return <Tag key={key} id={headingId(b.text)}>{renderInline(b.text, onNavigate, key)}</Tag>;
        }
        if (b.type === 'list') {
          const Tag = b.ordered ? 'ol' : 'ul';
          return <Tag key={key}>{b.items.map((it, j) => <li key={j}>{renderInline(it, onNavigate, `${key}-${j}`)}</li>)}</Tag>;
        }
        if (b.type === 'quote') return <blockquote key={key}>{renderInline(b.text, onNavigate, key)}</blockquote>;
        return <p key={key}>{renderInline(b.text, onNavigate, key)}</p>;
      })}
    </div>
  );
}
