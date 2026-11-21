// Editor de código do Project Club Dev (CodeMirror 6, tema escuro parecido
// com o VS Code). Um EditorState por arquivo aberto: trocar de aba mantém o
// desfazer/refazer e a posição do cursor de cada um.
import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { keymap } from '@codemirror/view';
import { indentWithTab } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { javascript } from '@codemirror/lang-javascript';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';

export function languageFor(path) {
  const ext = String(path).split('.').pop().toLowerCase();
  switch (ext) {
    case 'js': case 'cjs': case 'mjs': return javascript();
    case 'jsx': return javascript({ jsx: true });
    case 'ts': case 'mts': case 'cts': return javascript({ typescript: true });
    case 'tsx': return javascript({ jsx: true, typescript: true });
    case 'css': case 'scss': return css();
    case 'html': case 'htm': case 'svg': case 'xml': return html();
    case 'json': return json();
    case 'md': case 'markdown': return markdown();
    case 'py': return python();
    // Kotlin, Java, Gradle, AS, YAML…: destaque genérico parecido com JS
    case 'kt': case 'kts': case 'java': case 'gradle': case 'as': case 'tpl': return javascript();
    default: return [];
  }
}

const theme = EditorView.theme({
  '&': { height: '100%', fontSize: '13.5px' },
  '.cm-scroller': { fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace", lineHeight: '1.55' },
  '.cm-gutters': { borderRight: '1px solid #26272b' },
});

/**
 * value/onChange do arquivo `path`. `states` (Map) guarda o EditorState de
 * cada arquivo enquanto a página estiver aberta.
 */
export default function CodeEditor({ path, value, onChange, states, readOnly = false }) {
  const host = useRef(null);
  const view = useRef(null);
  const ro = useRef(new Compartment());
  const cb = useRef(onChange);
  cb.current = onChange;
  const current = useRef(path);

  const makeState = (p, doc) => EditorState.create({
    doc,
    extensions: [
      basicSetup,
      keymap.of([indentWithTab]),
      oneDark,
      theme,
      languageFor(p),
      ro.current.of(EditorState.readOnly.of(readOnly)),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && current.current === p) cb.current?.(u.state.doc.toString());
      }),
    ],
  });

  useEffect(() => {
    view.current = new EditorView({ parent: host.current, state: makeState(path, value ?? '') });
    states?.set(path, view.current.state);
    return () => { view.current?.destroy(); view.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // trocar de arquivo: guarda o estado do anterior e abre o do novo
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    if (current.current !== path) {
      states?.set(current.current, v.state);
      current.current = path;
      const saved = states?.get(path);
      v.setState(saved && saved.doc.toString() === (value ?? '') ? saved : makeState(path, value ?? ''));
      return;
    }
    // conteúdo trocado por fora (ex.: descartar rascunho, recarregar)
    if (v.state.doc.toString() !== (value ?? '')) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value ?? '' } });
    }
  }, [path, value]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    view.current?.dispatch({ effects: ro.current.reconfigure(EditorState.readOnly.of(readOnly)) });
  }, [readOnly]);

  return <div className="pcd-editor" ref={host} />;
}
