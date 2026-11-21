import { useEffect, useMemo, useState } from 'react';
import '../styles/code-preview.css';

// Prévia de arquivos de texto/código no chat (igual ao Discord): mostra as
// primeiras linhas com cores de sintaxe, botão pra expandir, trocar a
// linguagem, ver tudo numa janela e baixar. highlight.js é carregado só
// quando aparece um arquivo desses (não pesa no app).

const EXT_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  json: 'json', html: 'xml', htm: 'xml', xml: 'xml', svg: 'xml', css: 'css', scss: 'scss', md: 'markdown',
  py: 'python', java: 'java', kt: 'kotlin', kts: 'kotlin', c: 'c', h: 'c', cpp: 'cpp', hpp: 'cpp', cs: 'csharp',
  go: 'go', rs: 'rust', php: 'php', rb: 'ruby', lua: 'lua', sh: 'bash', bash: 'bash', bat: 'dos', ps1: 'powershell',
  yml: 'yaml', yaml: 'yaml', toml: 'ini', ini: 'ini', cfg: 'ini', properties: 'properties', sql: 'sql',
  gradle: 'gradle', dockerfile: 'dockerfile', txt: 'plaintext', log: 'plaintext', csv: 'plaintext', env: 'bash',
};
export const LANG_OPTIONS = [
  ['plaintext', 'Texto'], ['javascript', 'JavaScript'], ['typescript', 'TypeScript'], ['json', 'JSON'], ['xml', 'HTML/XML'],
  ['css', 'CSS'], ['python', 'Python'], ['java', 'Java'], ['kotlin', 'Kotlin'], ['csharp', 'C#'], ['cpp', 'C++'], ['c', 'C'],
  ['go', 'Go'], ['rust', 'Rust'], ['php', 'PHP'], ['lua', 'Lua'], ['bash', 'Shell'], ['yaml', 'YAML'], ['ini', 'INI/TOML'],
  ['properties', 'Properties'], ['sql', 'SQL'], ['markdown', 'Markdown'],
];
const MAX_BYTES = 300 * 1024;
const COLLAPSED_LINES = 12;

export function isCodeFile(att) {
  if (!att) return false;
  const ext = String(att.filename || '').toLowerCase().split('.').pop();
  if ((att.size || att.sizeBytes || 0) > MAX_BYTES) return false;
  return /^text\//.test(att.mimeType || '') || ['application/json', 'application/javascript', 'application/xml'].includes(att.mimeType) || !!EXT_LANG[ext];
}

let hljsPromise = null;
function loadHljs() {
  if (!hljsPromise) hljsPromise = import('highlight.js/lib/common').then((m) => m.default || m);
  return hljsPromise;
}
const escapeHtml = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function useHighlighted(text, lang) {
  const [html, setHtml] = useState(null);
  useEffect(() => {
    let alive = true;
    if (text == null) return undefined;
    if (lang === 'plaintext') { setHtml(escapeHtml(text)); return undefined; }
    loadHljs().then((hljs) => {
      if (!alive) return;
      try {
        const out = hljs.getLanguage(lang) ? hljs.highlight(text, { language: lang, ignoreIllegals: true }) : hljs.highlightAuto(text);
        setHtml(out.value);
      } catch { setHtml(escapeHtml(text)); }
    }).catch(() => alive && setHtml(escapeHtml(text)));
    return () => { alive = false; };
  }, [text, lang]);
  return html ?? (text != null ? escapeHtml(text) : null);
}

function CodeBlock({ text, lang }) {
  const html = useHighlighted(text, lang);
  const count = useMemo(() => (text ? text.split('\n').length : 0), [text]);
  return (
    <div className="cfp-code hljs">
      <pre className="cfp-gutter" aria-hidden="true">{Array.from({ length: count }, (_, i) => i + 1).join('\n')}</pre>
      {/* eslint-disable-next-line react/no-danger */}
      <pre className="cfp-src"><code dangerouslySetInnerHTML={{ __html: html || '' }} /></pre>
    </div>
  );
}

const fmtSize = (b) => (b >= 1024 * 1024 ? `${(b / 1048576).toFixed(1)} MB` : b >= 1024 ? `${Math.round(b / 1024)} KB` : `${b} B`);

export default function CodeFilePreview({ attachment }) {
  const ext = String(attachment.filename || '').toLowerCase().split('.').pop();
  const [text, setText] = useState(null);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [full, setFull] = useState(false);
  const [lang, setLang] = useState(EXT_LANG[ext] || 'plaintext');
  const [langOpen, setLangOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(attachment.url, { credentials: 'include' })
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error('falhou'))))
      .then((t) => { if (alive) setText(t.length > MAX_BYTES ? `${t.slice(0, MAX_BYTES)}\n…` : t); })
      .catch(() => alive && setError(true));
    return () => { alive = false; };
  }, [attachment.url]);

  const allLines = text != null ? text.replace(/\r\n/g, '\n').split('\n') : [];
  const total = allLines.length;
  const shown = expanded ? text : allLines.slice(0, COLLAPSED_LINES).join('\n');
  const size = attachment.size || attachment.sizeBytes || (text ? new Blob([text]).size : 0);

  useEffect(() => {
    if (!full) return undefined;
    const k = (e) => { if (e.key === 'Escape') setFull(false); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [full]);

  return (
    <div className="cfp">
      <div className="cfp-body">
        {error ? <p className="cfp-error">Não deu pra carregar a prévia deste arquivo.</p>
          : text == null ? <p className="cfp-loading">Carregando prévia…</p>
            : <CodeBlock text={shown} lang={lang} />}
      </div>
      <div className="cfp-bar">
        {total > COLLAPSED_LINES && (
          <button type="button" className="cfp-btn" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? 'Recolher' : `Expandir (${total} linhas)`} title={expanded ? 'Recolher' : `Expandir (${total} linhas)`}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true" style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}><path d="M6 9l6 6 6-6" /></svg>
          </button>
        )}
        <div className="cfp-name">
          <a href={attachment.url} download={attachment.filename} target="_blank" rel="noreferrer">{attachment.filename}</a>
          <small>{fmtSize(size)}{total ? ` · ${total} ${total === 1 ? 'linha' : 'linhas'}` : ''}</small>
        </div>
        <div className="cfp-lang">
          <button type="button" className="cfp-btn" onClick={() => setLangOpen((v) => !v)} aria-label="Alterar idioma" title="Alterar linguagem">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M8 7l-5 5 5 5M16 7l5 5-5 5" /></svg>
          </button>
          {langOpen && (
            <div className="cfp-langmenu" role="listbox" aria-label="Linguagem">
              {LANG_OPTIONS.map(([v, l]) => (
                <button key={v} type="button" role="option" aria-selected={lang === v} className={lang === v ? 'on' : ''} onClick={() => { setLang(v); setLangOpen(false); }}>{l}</button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="cfp-btn" onClick={() => setFull(true)} disabled={text == null} aria-label="Visualize o arquivo inteiro" title="Ver o arquivo inteiro">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        </button>
        <a className="cfp-btn" href={attachment.url} download={attachment.filename} aria-label="Baixar" title="Baixar">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
        </a>
      </div>
      {full && (
        <div className="cfp-full" role="dialog" aria-modal="true" aria-label={attachment.filename} onMouseDown={(e) => { if (e.target === e.currentTarget) setFull(false); }}>
          <div className="cfp-full-box">
            <header>
              <strong>{attachment.filename}</strong>
              <small>{total} linhas · {fmtSize(size)}</small>
              <button type="button" className="cfp-btn" onClick={() => { try { navigator.clipboard.writeText(text); } catch { /* sem área de transferência */ } }}>Copiar</button>
              <button type="button" className="cfp-btn" onClick={() => setFull(false)} aria-label="Fechar">✕</button>
            </header>
            <div className="cfp-full-body"><CodeBlock text={text} lang={lang} /></div>
          </div>
        </div>
      )}
    </div>
  );
}
