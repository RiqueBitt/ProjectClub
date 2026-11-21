// Project Club Dev — área dos administradores para editar o Project Club.
//
// Código: árvore de arquivos do GitHub + editor. O que você digita vira
// rascunho no navegador (nada vai pro banco); "Salvar" grava num commit na
// sua branch de testes (dev/<você>); "Publicar" manda a atualização pros
// donos, que implementam (vai pro site oficial) ou recusam.
// Outras abas: Atualizações, Arquivos enviados, Logs do servidor e
// Configurações (só donos: chave do GitHub e quem é dono).
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { devApi, errMsg, loadDrafts, saveDrafts, fmtBytes } from './dev/devApi.js';
import '../styles/dev-studio.css';

const CodeEditor = lazy(() => import('./dev/CodeEditor.jsx'));

const TABS = [
  { id: 'code', label: 'Código', icon: '⌨️' },
  { id: 'updates', label: 'Atualizações', icon: '📬' },
  { id: 'files', label: 'Arquivos', icon: '🗂️' },
  { id: 'logs', label: 'Logs', icon: '📜' },
  { id: 'config', label: 'Configurações', icon: '⚙️', owner: true },
];

const STATUS_ICON = { added: '🆕', modified: '✏️', removed: '🗑️', renamed: '✏️', changed: '✏️' };

function Toast({ toast, onClose }) {
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(onClose, toast.kind === 'bad' ? 7000 : 4000);
    return () => clearTimeout(t);
  }, [toast, onClose]);
  if (!toast) return null;
  return <div className={`pcd-toast ${toast.kind === 'bad' ? 'is-bad' : ''}`} role="status">{toast.text}</div>;
}

function Modal({ title, children, onClose, wide }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="pcd-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`pcd-modal${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="pcd-modal-head"><strong>{title}</strong><button type="button" className="pcd-icon-btn" onClick={onClose} aria-label="Fechar">✕</button></div>
        {children}
      </div>
    </div>
  );
}

// ---------- árvore de arquivos ----------
function buildTree(files) {
  const root = { name: '', path: '', dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts.slice(0, i + 1).join('/');
      if (!node.dirs.has(parts[i])) node.dirs.set(parts[i], { name: parts[i], path: p, dirs: new Map(), files: [] });
      node = node.dirs.get(parts[i]);
    }
    node.files.push({ ...f, name: parts[parts.length - 1] });
  }
  return root;
}

function TreeNode({ node, depth, open, toggle, onOpen, activePath, drafts }) {
  const dirs = [...node.dirs.values()].sort((a, b) => a.name.localeCompare(b.name));
  const files = [...node.files].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <>
      {dirs.map((d) => {
        const isOpen = open.has(d.path);
        return (
          <div key={d.path}>
            <button type="button" className="pcd-tree-row is-dir" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => toggle(d.path)} aria-expanded={isOpen}>
              <span className="pcd-caret">{isOpen ? '▾' : '▸'}</span>📁 {d.name}
            </button>
            {isOpen && <TreeNode node={d} depth={depth + 1} open={open} toggle={toggle} onOpen={onOpen} activePath={activePath} drafts={drafts} />}
          </div>
        );
      })}
      {files.map((f) => {
        const draft = drafts[f.path];
        return (
          <button key={f.path} type="button" className={`pcd-tree-row${activePath === f.path ? ' is-active' : ''}${draft?.deleted ? ' is-deleted' : ''}`} style={{ paddingLeft: 22 + depth * 14 }} onClick={() => onOpen(f.path)} title={f.path}>
            <span className="pcd-file-name">{f.name}</span>
            {draft && <span className={`pcd-dot ${draft.isNew ? 'is-new' : draft.deleted ? 'is-del' : ''}`} title={draft.isNew ? 'Novo (não salvo)' : draft.deleted ? 'Apagado (não salvo)' : 'Editado (não salvo)'} />}
          </button>
        );
      })}
    </>
  );
}

// ---------- aba Código ----------
function CodeTab({ status, notify, onPublished }) {
  const branch = status.branch;
  const [tree, setTree] = useState(null);
  const [treeErr, setTreeErr] = useState('');
  const [filter, setFilter] = useState('');
  const [open, setOpen] = useState(() => new Set(['client', 'server', 'client/src', 'server/src']));
  const [tabs, setTabs] = useState([]); // paths abertos
  const [active, setActive] = useState(null);
  const [loaded, setLoaded] = useState({}); // path → { content, binary, tooBig }
  const [drafts, setDrafts] = useState(() => loadDrafts(branch));
  const [changes, setChanges] = useState(null);
  const [busy, setBusy] = useState('');
  const [saveOpen, setSaveOpen] = useState(false);
  const [pubOpen, setPubOpen] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [showTree, setShowTree] = useState(() => !window.matchMedia('(max-width: 820px)').matches);
  const states = useRef(new Map());

  const refreshTree = useCallback(() => {
    setTreeErr('');
    devApi.tree().then(setTree).catch((err) => setTreeErr(errMsg(err, 'Não deu pra carregar os arquivos.')));
  }, []);
  const refreshChanges = useCallback(() => { devApi.changes().then(setChanges).catch(() => {}); }, []);
  useEffect(() => { refreshTree(); refreshChanges(); }, [refreshTree, refreshChanges]);
  useEffect(() => { if (!saveDrafts(branch, drafts)) notify('O navegador não deixou guardar o rascunho (espaço cheio?). Salve no GitHub.', 'bad'); }, [branch, drafts, notify]);

  const allFiles = useMemo(() => {
    const list = tree?.files || [];
    const have = new Set(list.map((f) => f.path));
    const extra = Object.entries(drafts).filter(([p, d]) => d.isNew && !have.has(p)).map(([p]) => ({ path: p, size: 0 }));
    return [...list, ...extra];
  }, [tree, drafts]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return allFiles;
    return allFiles.filter((f) => f.path.toLowerCase().includes(q)).slice(0, 400);
  }, [allFiles, filter]);
  const root = useMemo(() => buildTree(shown), [shown]);
  const openAll = filter.trim().length > 0;
  const openSet = useMemo(() => {
    if (!openAll) return open;
    const s = new Set();
    for (const f of shown) { const parts = f.path.split('/'); for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join('/')); }
    return s;
  }, [openAll, open, shown]);

  const toggle = (p) => setOpen((o) => { const n = new Set(o); if (n.has(p)) n.delete(p); else n.add(p); return n; });

  const openFile = useCallback(async (path) => {
    setTabs((t) => (t.includes(path) ? t : [...t, path]));
    setActive(path);
    if (window.matchMedia('(max-width: 820px)').matches) setShowTree(false);
    if (loaded[path] || drafts[path]?.isNew) return;
    try {
      const f = await devApi.file(path);
      setLoaded((l) => ({ ...l, [path]: f }));
    } catch (err) {
      notify(errMsg(err, 'Não deu pra abrir o arquivo.'), 'bad');
    }
  }, [loaded, drafts, notify]);

  const closeTab = (path) => {
    setTabs((t) => {
      const n = t.filter((x) => x !== path);
      if (active === path) setActive(n[n.length - 1] || null);
      return n;
    });
  };

  const valueOf = (path) => {
    const d = drafts[path];
    if (d && !d.deleted) return d.content;
    return loaded[path]?.content ?? '';
  };

  const onEdit = (path, content) => {
    setDrafts((ds) => {
      const d = ds[path];
      const original = d?.isNew ? null : (d?.original ?? loaded[path]?.content ?? '');
      if (!d?.isNew && content === original) {
        const { [path]: _, ...rest } = ds;
        return rest;
      }
      return { ...ds, [path]: { content, original, isNew: !!d?.isNew, deleted: false, at: Date.now() } };
    });
  };

  const discard = (path) => {
    setDrafts((ds) => { const { [path]: _, ...rest } = ds; return rest; });
    if (drafts[path]?.isNew) closeTab(path);
    states.current.delete(path);
  };

  const removeFile = (path) => {
    if (!window.confirm(`Apagar ${path}? (só vale quando você salvar)`)) return;
    setDrafts((ds) => (ds[path]?.isNew ? (() => { const { [path]: _, ...rest } = ds; return rest; })() : { ...ds, [path]: { content: '', original: loaded[path]?.content ?? '', deleted: true, at: Date.now() } }));
    closeTab(path);
  };

  const createFile = (path) => {
    const p = path.trim().replace(/^\/+/, '');
    if (!p || p.endsWith('/')) return;
    if (allFiles.some((f) => f.path === p)) { openFile(p); return; }
    setDrafts((ds) => ({ ...ds, [p]: { content: '', original: null, isNew: true, deleted: false, at: Date.now() } }));
    setTabs((t) => [...t, p]);
    setActive(p);
    const parts = p.split('/');
    setOpen((o) => { const n = new Set(o); for (let i = 1; i < parts.length; i++) n.add(parts.slice(0, i).join('/')); return n; });
  };

  const draftList = Object.entries(drafts);

  const doSave = async (message) => {
    const files = draftList.map(([path, d]) => ({ path, content: d.deleted ? null : d.content }));
    setBusy('save');
    try {
      const out = await devApi.save(files, message);
      // salvo: os rascunhos viram o conteúdo "original" do arquivo
      setLoaded((l) => {
        const n = { ...l };
        for (const [path, d] of draftList) {
          if (d.deleted) delete n[path]; else n[path] = { ...(n[path] || {}), path, content: d.content, binary: false, tooBig: false };
        }
        return n;
      });
      setDrafts({});
      setSaveOpen(false);
      notify(`Salvo no GitHub (${out.branch}).`);
      refreshTree();
      refreshChanges();
    } catch (err) {
      notify(errMsg(err, 'Não deu pra salvar.'), 'bad');
    } finally { setBusy(''); }
  };

  const doPublish = async (title, description) => {
    setBusy('publish');
    try {
      const out = await devApi.publish(title, description);
      setPubOpen(false);
      notify(`Atualização #${out.number} enviada pros donos.`);
      onPublished?.();
    } catch (err) {
      notify(errMsg(err, 'Não deu pra publicar.'), 'bad');
    } finally { setBusy(''); }
  };

  const doSync = async () => {
    setBusy('sync');
    try { await devApi.sync(); notify('Sua branch agora tem tudo que já está no site oficial.'); refreshTree(); refreshChanges(); setLoaded({}); states.current.clear(); }
    catch (err) { notify(errMsg(err), 'bad'); } finally { setBusy(''); }
  };

  const doReset = async () => {
    if (!window.confirm('Desfazer TUDO que você salvou e ainda não foi implementado? Sua branch volta a ser igual ao site oficial. (Rascunhos não salvos continuam aqui.)')) return;
    setBusy('reset');
    try { await devApi.reset(); notify('Branch desfeita.'); refreshTree(); refreshChanges(); setLoaded({}); states.current.clear(); }
    catch (err) { notify(errMsg(err), 'bad'); } finally { setBusy(''); }
  };

  const activeFile = active ? loaded[active] : null;
  const activeDraft = active ? drafts[active] : null;
  const saved = changes?.files || [];

  return (
    <div className={`pcd-code${showTree ? '' : ' tree-hidden'}`}>
      <aside className="pcd-tree" aria-label="Arquivos do código">
        <div className="pcd-tree-tools">
          <input className="pcd-input" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Buscar arquivo…" aria-label="Buscar arquivo" />
          <button type="button" className="pcd-icon-btn" onClick={() => setNewOpen(true)} title="Novo arquivo" aria-label="Novo arquivo">＋</button>
          <button type="button" className="pcd-icon-btn" onClick={refreshTree} title="Recarregar" aria-label="Recarregar arquivos">⟳</button>
        </div>
        <div className="pcd-tree-list">
          {treeErr && <p className="pcd-empty">{treeErr}</p>}
          {!tree && !treeErr && <p className="pcd-empty">Carregando arquivos…</p>}
          {tree && <TreeNode node={root} depth={0} open={openSet} toggle={toggle} onOpen={openFile} activePath={active} drafts={drafts} />}
          {tree?.truncated && <p className="pcd-empty">O GitHub cortou a lista (repositório grande). Use a busca.</p>}
        </div>
      </aside>

      <section className="pcd-main">
        <div className="pcd-tabs" role="tablist">
          <button type="button" className="pcd-icon-btn pcd-tree-toggle" onClick={() => setShowTree((v) => !v)} aria-label="Mostrar/esconder arquivos" title="Arquivos">☰</button>
          {tabs.map((p) => (
            <div key={p} className={`pcd-tab${p === active ? ' is-active' : ''}`} role="tab" aria-selected={p === active}>
              <button type="button" className="pcd-tab-name" onClick={() => setActive(p)} title={p}>
                {drafts[p] && <span className={`pcd-dot ${drafts[p].isNew ? 'is-new' : ''}`} />}
                {p.split('/').pop()}
              </button>
              <button type="button" className="pcd-tab-x" onClick={() => closeTab(p)} aria-label={`Fechar ${p}`}>✕</button>
            </div>
          ))}
        </div>

        <div className="pcd-editor-wrap">
          {!active && (
            <div className="pcd-welcome">
              <h2>Project Club Dev</h2>
              <p>Abra um arquivo à esquerda pra editar. O que você digitar fica guardado neste navegador até você <b>Salvar</b>.</p>
              <ol>
                <li><b>Salvar</b> grava na sua branch de testes <code>{branch}</code> no GitHub — o site oficial não muda.</li>
                <li><b>Publicar</b> manda a atualização (com a sua descrição) pros donos.</li>
                <li>Um dono <b>implementa</b> (vai pro site oficial em alguns minutos) ou <b>recusa</b>.</li>
              </ol>
            </div>
          )}
          {active && activeFile?.binary && <div className="pcd-welcome"><p>Esse arquivo é binário (imagem, som, SWF…) e não abre no editor.</p></div>}
          {active && activeFile?.tooBig && <div className="pcd-welcome"><p>Arquivo grande demais pro editor ({fmtBytes(activeFile.size)}).</p></div>}
          {active && !activeFile && !activeDraft?.isNew && <div className="pcd-welcome"><p>Abrindo…</p></div>}
          {active && (activeDraft?.isNew || (activeFile && !activeFile.binary && !activeFile.tooBig)) && (
            <Suspense fallback={<div className="pcd-welcome"><p>Carregando o editor…</p></div>}>
              <CodeEditor path={active} value={valueOf(active)} onChange={(v) => onEdit(active, v)} states={states.current} />
            </Suspense>
          )}
        </div>

        {active && (
          <div className="pcd-statusbar">
            <span className="pcd-path">{active}</span>
            {activeDraft && <button type="button" className="pcd-link" onClick={() => discard(active)}>Descartar mudanças</button>}
            {!activeDraft?.isNew && <button type="button" className="pcd-link is-bad" onClick={() => removeFile(active)}>Apagar arquivo</button>}
          </div>
        )}
      </section>

      <aside className="pcd-side" aria-label="Mudanças">
        <div className="pcd-side-block">
          <div className="pcd-side-title">Não salvas ({draftList.length})</div>
          {draftList.length === 0 && <p className="pcd-muted">Nenhum rascunho.</p>}
          <ul className="pcd-change-list">
            {draftList.map(([p, d]) => (
              <li key={p}>
                <button type="button" className="pcd-link" onClick={() => openFile(p)} title={p}>{d.isNew ? '🆕' : d.deleted ? '🗑️' : '✏️'} {p.split('/').pop()}</button>
                <button type="button" className="pcd-tab-x" onClick={() => discard(p)} aria-label={`Descartar ${p}`}>✕</button>
              </li>
            ))}
          </ul>
          <button type="button" className="pcd-btn is-primary" disabled={!draftList.length || busy === 'save'} onClick={() => setSaveOpen(true)}>
            {busy === 'save' ? 'Salvando…' : 'Salvar no GitHub'}
          </button>
        </div>

        <div className="pcd-side-block">
          <div className="pcd-side-title">Salvas na sua branch ({saved.length})</div>
          <p className="pcd-muted"><code>{branch}</code>{changes?.behind ? ` · ${changes.behind} mudança(s) do site oficial que você não tem` : ''}</p>
          <ul className="pcd-change-list">
            {saved.map((f) => (
              <li key={f.path}><button type="button" className="pcd-link" onClick={() => openFile(f.path)} title={f.path}>{STATUS_ICON[f.status] || '✏️'} {f.path.split('/').pop()}</button><span className="pcd-diffnum">+{f.additions} −{f.deletions}</span></li>
            ))}
          </ul>
          <button type="button" className="pcd-btn is-green" disabled={!saved.length || !!busy} onClick={() => setPubOpen(true)}>Publicar pros donos</button>
          <div className="pcd-row">
            <button type="button" className="pcd-btn" disabled={!changes?.exists || !!busy} onClick={doSync} title="Traz o que já entrou no site oficial">Atualizar</button>
            <button type="button" className="pcd-btn is-bad" disabled={!changes?.exists || !!busy} onClick={doReset}>Desfazer</button>
          </div>
        </div>
      </aside>

      {saveOpen && <SaveModal drafts={draftList} busy={busy === 'save'} onClose={() => setSaveOpen(false)} onSave={doSave} />}
      {pubOpen && <PublishModal me={status.me} files={saved} busy={busy === 'publish'} onClose={() => setPubOpen(false)} onPublish={doPublish} />}
      {newOpen && <NewFileModal onClose={() => setNewOpen(false)} onCreate={(p) => { setNewOpen(false); createFile(p); }} base={active ? active.split('/').slice(0, -1).join('/') : 'client/src'} />}
    </div>
  );
}

function SaveModal({ drafts, busy, onClose, onSave }) {
  const [msg, setMsg] = useState('');
  return (
    <Modal title="Salvar no GitHub" onClose={onClose}>
      <p className="pcd-muted">Vai pra sua branch de testes. O site oficial só muda quando um dono implementar.</p>
      <ul className="pcd-change-list is-boxed">
        {drafts.map(([p, d]) => <li key={p}>{d.isNew ? '🆕' : d.deleted ? '🗑️' : '✏️'} <code>{p}</code></li>)}
      </ul>
      <label className="pcd-label" htmlFor="pcd-msg">O que você fez (curto)</label>
      <input id="pcd-msg" className="pcd-input" value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={200} placeholder="Ex.: Arrumei o botão de enviar no celular" autoFocus />
      <div className="pcd-modal-foot">
        <button type="button" className="pcd-btn" onClick={onClose}>Cancelar</button>
        <button type="button" className="pcd-btn is-primary" disabled={busy} onClick={() => onSave(msg.trim() || 'Ajustes no Project Club Dev')}>{busy ? 'Salvando…' : 'Salvar'}</button>
      </div>
    </Modal>
  );
}

function summaryOf(name, files) {
  const c = files.filter((f) => f.status === 'added').length;
  const e = files.filter((f) => ['modified', 'renamed', 'changed'].includes(f.status)).length;
  const r = files.filter((f) => f.status === 'removed').length;
  const parts = [];
  if (c) parts.push(`criou ${c} ${c === 1 ? 'arquivo novo' : 'arquivos novos'}`);
  if (e) parts.push(`editou ${e} ${e === 1 ? 'arquivo' : 'arquivos'}`);
  if (r) parts.push(`apagou ${r} ${r === 1 ? 'arquivo' : 'arquivos'}`);
  return `Admin ${name} ${parts.join(', ')}`;
}

function PublishModal({ me, files, busy, onClose, onPublish }) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const name = me.displayName || me.username;
  return (
    <Modal title="Publicar pros donos" onClose={onClose} wide>
      <p className="pcd-muted">Os donos recebem esta mensagem e decidem se implementam no site oficial.</p>
      <div className="pcd-preview">
        <strong>{summaryOf(name, files)}</strong>
        <ul className="pcd-change-list">
          {files.map((f) => <li key={f.path}>{STATUS_ICON[f.status] || '✏️'} <code>{f.path}</code></li>)}
        </ul>
        {desc.trim() && <p className="pcd-preview-desc">{desc}</p>}
      </div>
      <label className="pcd-label" htmlFor="pcd-title">Título</label>
      <input id="pcd-title" className="pcd-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={summaryOf(name, files)} />
      <label className="pcd-label" htmlFor="pcd-desc">Descrição pros donos</label>
      <textarea id="pcd-desc" className="pcd-input pcd-textarea" value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={4000} placeholder="O que mudou, por quê e como testar." autoFocus />
      <div className="pcd-modal-foot">
        <button type="button" className="pcd-btn" onClick={onClose}>Cancelar</button>
        <button type="button" className="pcd-btn is-green" disabled={busy || !desc.trim()} onClick={() => onPublish(title.trim(), desc.trim())}>{busy ? 'Enviando…' : 'Publicar'}</button>
      </div>
    </Modal>
  );
}

function NewFileModal({ onClose, onCreate, base }) {
  const [p, setP] = useState(base ? `${base}/` : '');
  return (
    <Modal title="Novo arquivo" onClose={onClose}>
      <label className="pcd-label" htmlFor="pcd-new">Caminho no projeto</label>
      <input id="pcd-new" className="pcd-input" value={p} onChange={(e) => setP(e.target.value)} placeholder="client/src/components/MeuComponente.jsx" autoFocus onKeyDown={(e) => { if (e.key === 'Enter') onCreate(p); }} />
      <div className="pcd-modal-foot">
        <button type="button" className="pcd-btn" onClick={onClose}>Cancelar</button>
        <button type="button" className="pcd-btn is-primary" disabled={!p.trim() || p.endsWith('/')} onClick={() => onCreate(p)}>Criar</button>
      </div>
    </Modal>
  );
}

// ---------- aba Atualizações ----------
function Patch({ text }) {
  if (!text) return <p className="pcd-muted">(sem prévia — arquivo grande ou binário)</p>;
  return (
    <pre className="pcd-patch">
      {text.split('\n').map((l, i) => (
        <span key={i} className={l.startsWith('+') ? 'is-add' : l.startsWith('-') ? 'is-del' : l.startsWith('@@') ? 'is-hunk' : ''}>{l}{'\n'}</span>
      ))}
    </pre>
  );
}

function UpdatesTab({ status, notify, refreshKey, onCount }) {
  const [state, setState] = useState('open');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const [openFile, setOpenFile] = useState({});
  const [rejecting, setRejecting] = useState(null);
  const [busy, setBusy] = useState(null);

  const load = useCallback(() => {
    setErr('');
    devApi.updates(state).then((d) => { setData(d); if (state === 'open') onCount?.(d.updates.length); }).catch((e) => setErr(errMsg(e)));
  }, [state, onCount]);
  useEffect(() => { load(); }, [load, refreshKey]);

  const approve = async (u) => {
    if (!window.confirm(`Implementar "${u.title}" no site oficial? O site atualiza sozinho em alguns minutos.`)) return;
    setBusy(u.number);
    try { await devApi.approve(u.number); notify('Implementado! O site oficial atualiza em alguns minutos.'); load(); }
    catch (e) { notify(errMsg(e), 'bad'); } finally { setBusy(null); }
  };
  const reject = async (u, reason) => {
    setBusy(u.number);
    try { await devApi.reject(u.number, reason); setRejecting(null); notify('Atualização recusada.'); load(); }
    catch (e) { notify(errMsg(e), 'bad'); } finally { setBusy(null); }
  };

  const CHECK = { success: ['✅', 'Testes passaram'], failure: ['❌', 'Testes falharam'], pending: ['⏳', 'Testes rodando'], none: ['➖', 'Sem testes'], unknown: ['❔', 'Testes: ?'] };

  return (
    <div className="pcd-page">
      <div className="pcd-page-head">
        <h2>Atualizações</h2>
        <div className="pcd-seg" role="tablist">
          <button type="button" className={state === 'open' ? 'is-on' : ''} onClick={() => setState('open')}>Esperando</button>
          <button type="button" className={state === 'closed' ? 'is-on' : ''} onClick={() => setState('closed')}>Fechadas</button>
        </div>
        <button type="button" className="pcd-btn" onClick={load}>⟳ Atualizar</button>
      </div>
      <p className="pcd-muted">{status.isOwner ? 'Você é dono: decide o que entra no site oficial.' : 'Aqui ficam as atualizações que você mandou. Os donos decidem se implementam.'}</p>
      {err && <p className="pcd-error">{err}</p>}
      {!data && !err && <p className="pcd-muted">Carregando…</p>}
      {data?.updates.length === 0 && <p className="pcd-empty">{state === 'open' ? 'Nenhuma atualização esperando.' : 'Nada por aqui.'}</p>}
      <div className="pcd-cards">
        {data?.updates.map((u) => {
          const c = u.checks ? CHECK[u.checks.state] || CHECK.unknown : null;
          return (
            <article key={u.number} className="pcd-card">
              <header className="pcd-card-head">
                <div>
                  <div className="pcd-card-title">{u.title}</div>
                  <div className="pcd-card-sub">{u.summary} · #{u.number}{u.updatedAt && !Number.isNaN(Date.parse(u.updatedAt)) ? ` · ${new Date(u.updatedAt).toLocaleString('pt-BR')}` : ''}</div>
                </div>
                <span className={`pcd-pill is-${u.state}`}>{u.state === 'merged' ? 'Implementada' : u.state === 'open' ? 'Esperando' : 'Recusada'}</span>
              </header>
              {u.description && <p className="pcd-card-desc">{u.description}</p>}
              {c && <p className="pcd-checks" title={(u.checks.runs || []).map((r) => `${r.name}: ${r.conclusion || r.status}`).join('\n')}>{c[0]} {c[1]}</p>}
              <ul className="pcd-file-list">
                {u.files.map((f) => (
                  <li key={f.path}>
                    <button type="button" className="pcd-link" onClick={() => setOpenFile((o) => ({ ...o, [`${u.number}:${f.path}`]: !o[`${u.number}:${f.path}`] }))}>
                      {STATUS_ICON[f.status] || '✏️'} <code>{f.path}</code> <span className="pcd-diffnum">+{f.additions} −{f.deletions}</span>
                    </button>
                    {openFile[`${u.number}:${f.path}`] && <Patch text={f.patch} />}
                  </li>
                ))}
              </ul>
              {status.isOwner && u.state === 'open' && (
                <div className="pcd-card-actions">
                  <button type="button" className="pcd-btn is-bad" disabled={busy === u.number} onClick={() => setRejecting(u)}>Recusar</button>
                  <button type="button" className="pcd-btn is-green" disabled={busy === u.number} onClick={() => approve(u)}>{busy === u.number ? '…' : 'Implementar no site'}</button>
                </div>
              )}
            </article>
          );
        })}
      </div>
      {rejecting && <RejectModal u={rejecting} busy={busy === rejecting.number} onClose={() => setRejecting(null)} onReject={(r) => reject(rejecting, r)} />}
    </div>
  );
}

function RejectModal({ u, busy, onClose, onReject }) {
  const [reason, setReason] = useState('');
  return (
    <Modal title={`Recusar #${u.number}`} onClose={onClose}>
      <p className="pcd-muted">{u.summary}. O admin recebe o motivo e pode continuar editando.</p>
      <label className="pcd-label" htmlFor="pcd-reason">Motivo</label>
      <textarea id="pcd-reason" className="pcd-input pcd-textarea" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={2000} placeholder="O que precisa mudar?" autoFocus />
      <div className="pcd-modal-foot">
        <button type="button" className="pcd-btn" onClick={onClose}>Cancelar</button>
        <button type="button" className="pcd-btn is-bad" disabled={busy} onClick={() => onReject(reason.trim())}>Recusar</button>
      </div>
    </Modal>
  );
}

// ---------- aba Arquivos ----------
function FilesTab() {
  const [prefix, setPrefix] = useState('');
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setData(null); setErr('');
    devApi.uploads(prefix).then(setData).catch((e) => setErr(errMsg(e)));
  }, [prefix]);
  const crumbs = prefix.split('/').filter(Boolean);
  const more = async () => {
    try { const d = await devApi.uploads(prefix, data.next); setData((o) => ({ ...d, files: [...o.files, ...d.files], folders: [...o.folders, ...d.folders] })); } catch (e) { setErr(errMsg(e)); }
  };
  return (
    <div className="pcd-page">
      <div className="pcd-page-head"><h2>Arquivos enviados</h2><span className="pcd-muted">{data?.source === 'b2' ? 'Backblaze B2' : data ? 'Pasta de uploads' : ''}</span></div>
      <nav className="pcd-crumbs" aria-label="Pasta">
        <button type="button" className="pcd-link" onClick={() => setPrefix('')}>raiz</button>
        {crumbs.map((c, i) => <span key={i}> / <button type="button" className="pcd-link" onClick={() => setPrefix(`${crumbs.slice(0, i + 1).join('/')}/`)}>{c}</button></span>)}
      </nav>
      {err && <p className="pcd-error">{err}</p>}
      {!data && !err && <p className="pcd-muted">Carregando…</p>}
      {data && (
        <div className="pcd-table">
          {data.folders.map((f) => (
            <button key={f} type="button" className="pcd-table-row" onClick={() => setPrefix(f)}>
              <span>📁 {f.slice(prefix.length).replace(/\/$/, '')}</span><span /><span />
            </button>
          ))}
          {data.files.map((f) => (
            <div key={f.key} className="pcd-table-row">
              <span className="pcd-file-name" title={f.key}>📄 {f.key.slice(prefix.length)}</span>
              <span className="pcd-muted">{fmtBytes(f.size)}</span>
              <span>{f.url ? <a className="pcd-link" href={f.url} target="_blank" rel="noreferrer">Abrir</a> : null}</span>
            </div>
          ))}
          {!data.folders.length && !data.files.length && <p className="pcd-empty">Pasta vazia.</p>}
          {data.next && <button type="button" className="pcd-btn" onClick={more}>Carregar mais</button>}
        </div>
      )}
    </div>
  );
}

// ---------- aba Logs ----------
function LogsTab() {
  const [lines, setLines] = useState([]);
  const [paused, setPaused] = useState(false);
  const [q, setQ] = useState('');
  const [level, setLevel] = useState('all');
  const last = useRef(0);
  const box = useRef(null);
  const stick = useRef(true);
  useEffect(() => {
    if (paused) return undefined;
    let alive = true;
    const tick = async () => {
      try {
        const d = await devApi.logs(last.current);
        if (!alive) return;
        last.current = d.last;
        if (d.lines.length) setLines((l) => [...l, ...d.lines].slice(-3000));
      } catch { /* tenta de novo */ }
    };
    tick();
    const t = setInterval(tick, 2000);
    return () => { alive = false; clearInterval(t); };
  }, [paused]);
  useEffect(() => { if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight; }, [lines]);
  const shown = lines.filter((l) => (level === 'all' || l.level === level) && (!q || l.text.toLowerCase().includes(q.toLowerCase())));
  return (
    <div className="pcd-page pcd-logs-page">
      <div className="pcd-page-head">
        <h2>Logs do servidor</h2>
        <input className="pcd-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar…" aria-label="Filtrar logs" />
        <select className="pcd-input pcd-select" value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Nível">
          <option value="all">Tudo</option><option value="log">Normal</option><option value="warn">Avisos</option><option value="error">Erros</option>
        </select>
        <button type="button" className="pcd-btn" onClick={() => setPaused((p) => !p)}>{paused ? '▶ Continuar' : '⏸ Pausar'}</button>
        <button type="button" className="pcd-btn" onClick={() => setLines([])}>Limpar</button>
      </div>
      <p className="pcd-muted">Ao vivo, desde o último reinício do servidor. Senhas e chaves aparecem como ***.</p>
      <div className="pcd-logs" ref={box} onScroll={(e) => { const el = e.currentTarget; stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {shown.map((l) => (
          <div key={l.id} className={`pcd-log is-${l.level}`}><span className="pcd-log-time">{new Date(l.at).toLocaleTimeString('pt-BR')}</span>{l.text}</div>
        ))}
        {!shown.length && <p className="pcd-empty">Sem linhas ainda.</p>}
      </div>
    </div>
  );
}

// ---------- aba Configurações (donos) ----------
function ConfigTab({ notify, onSaved }) {
  const [cfg, setCfg] = useState(null);
  const [token, setToken] = useState('');
  const [owners, setOwners] = useState([]);
  const [repo, setRepo] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => devApi.config().then((c) => { setCfg(c); setOwners(c.owners); setRepo(c.repo); }).catch((e) => notify(errMsg(e), 'bad')), [notify]);
  useEffect(() => { load(); }, [load]);
  if (!cfg) return <div className="pcd-page"><p className="pcd-muted">Carregando…</p></div>;
  const save = async () => {
    setBusy(true);
    try {
      await devApi.saveConfig({ ...(token.trim() ? { githubToken: token.trim() } : {}), owners: owners.filter((id) => id !== cfg.mainOwner), repo });
      setToken('');
      notify('Configurações salvas.');
      load();
      onSaved?.();
    } catch (e) { notify(errMsg(e), 'bad'); } finally { setBusy(false); }
  };
  return (
    <div className="pcd-page pcd-config">
      <h2>Configurações do Project Club Dev</h2>
      <section className="pcd-card">
        <div className="pcd-card-title">Chave do GitHub {cfg.hasToken ? <span className="pcd-pill is-merged">ligada · {cfg.tokenHint}</span> : <span className="pcd-pill is-closed">falta</span>}</div>
        <ol className="pcd-steps">
          <li>No GitHub: <b>Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token</b>.</li>
          <li>Em <b>Repository access</b> escolha só <code>{cfg.repo}</code>.</li>
          <li>Em <b>Permissions</b>: <b>Contents: Read and write</b>, <b>Pull requests: Read and write</b> e <b>Commit statuses</b>/<b>Checks: Read</b>. Não marque <b>Workflows</b>.</li>
          <li>Copie a chave (começa com <code>github_pat_</code>) e cole aqui.</li>
        </ol>
        <input className="pcd-input" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder={cfg.hasToken ? 'Colar uma chave nova (troca a atual)' : 'github_pat_…'} autoComplete="off" />
        <label className="pcd-label" htmlFor="pcd-repo">Repositório</label>
        <input id="pcd-repo" className="pcd-input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="dono/repositorio" />
      </section>
      <section className="pcd-card">
        <div className="pcd-card-title">Donos (aprovam as atualizações)</div>
        <p className="pcd-muted">Só aparecem administradores da plataforma. O dono principal (e-mail do servidor) é sempre dono.</p>
        <div className="pcd-owner-list">
          {cfg.admins.map((a) => {
            const main = a.id === cfg.mainOwner;
            return (
              <label key={a.id} className="pcd-owner">
                <input type="checkbox" checked={main || owners.includes(a.id)} disabled={main} onChange={(e) => setOwners((o) => (e.target.checked ? [...o, a.id] : o.filter((x) => x !== a.id)))} />
                <span>{a.displayName || a.username} <span className="pcd-muted">@{a.username}</span>{main ? ' · dono principal' : ''}</span>
              </label>
            );
          })}
        </div>
      </section>
      <div className="pcd-modal-foot"><button type="button" className="pcd-btn is-primary" disabled={busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button></div>
    </div>
  );
}

// ---------- página ----------
export default function DevStudioPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'code';
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState('');
  const [toast, setToast] = useState(null);
  const [updatesKey, setUpdatesKey] = useState(0);
  const [openCount, setOpenCount] = useState(null);
  const notify = useCallback((text, kind) => setToast({ text, kind, at: Date.now() }), []);

  const loadStatus = useCallback(() => devApi.status().then(setStatus).catch((e) => setErr(errMsg(e, 'Sem acesso ao Project Club Dev.'))), []);
  useEffect(() => { if (user?.platformRole === 'ADMIN') loadStatus(); }, [user, loadStatus]);
  useEffect(() => { document.title = 'Project Club Dev'; return () => { document.title = 'Project Club'; }; }, []);
  useEffect(() => {
    if (status?.configured) devApi.updates('open').then((d) => setOpenCount(d.updates.length)).catch(() => {});
  }, [status]);

  if (user && user.platformRole !== 'ADMIN') {
    return (
      <div className="pcd-root pcd-center">
        <div className="pcd-card pcd-locked"><h2>Project Club Dev</h2><p>Área só para administradores do Project Club.</p><button type="button" className="pcd-btn" onClick={() => navigate('/')}>Voltar ao Project Club</button></div>
      </div>
    );
  }
  const setTab = (t) => setParams((p) => { const n = new URLSearchParams(p); n.set('tab', t); return n; }, { replace: true });

  return (
    <div className="pcd-root">
      <header className="pcd-header">
        <button type="button" className="pcd-brand" onClick={() => navigate('/')} title="Voltar ao Project Club">
          <span className="pcd-logo">{'</>'}</span><span className="pcd-brand-text"><b>Project Club</b> Dev</span>
        </button>
        <nav className="pcd-nav" role="tablist" aria-label="Seções">
          {TABS.filter((t) => !t.owner || status?.isOwner).map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`pcd-nav-btn${tab === t.id ? ' is-on' : ''}`} onClick={() => setTab(t.id)}>
              <span aria-hidden="true">{t.icon}</span><span className="pcd-nav-label">{t.label}</span>
              {t.id === 'updates' && openCount > 0 && <span className="pcd-badge">{openCount}</span>}
            </button>
          ))}
        </nav>
        {status && (
          <div className="pcd-who" title={status.repo}>
            <span className="pcd-branch">⑂ {status.branch}</span>
            {status.isOwner && <span className="pcd-pill is-merged">dono</span>}
            {status.me?.github && <img className="pcd-gh" src={status.me.github.avatar} alt={`GitHub @${status.me.github.login}`} title={`Commits saem como @${status.me.github.login}`} />}
          </div>
        )}
      </header>

      <main className="pcd-body">
        {err && <div className="pcd-center"><div className="pcd-card pcd-locked"><p>{err}</p></div></div>}
        {!status && !err && <div className="pcd-center"><p className="pcd-muted">Abrindo o Project Club Dev…</p></div>}
        {status && !status.configured && tab !== 'config' && tab !== 'logs' && tab !== 'files' && (
          <div className="pcd-center">
            <div className="pcd-card pcd-locked">
              <h2>Falta ligar o GitHub</h2>
              <p>{status.isOwner ? 'Cole a chave do GitHub nas Configurações pra começar a editar.' : 'Um dono precisa colar a chave do GitHub nas Configurações do Dev.'}</p>
              {status.isOwner && <button type="button" className="pcd-btn is-primary" onClick={() => setTab('config')}>Abrir Configurações</button>}
            </div>
          </div>
        )}
        {status?.configured && tab === 'code' && <CodeTab status={status} notify={notify} onPublished={() => { setUpdatesKey((k) => k + 1); setOpenCount((c) => (c ?? 0) + 1); }} />}
        {status?.configured && tab === 'updates' && <UpdatesTab status={status} notify={notify} refreshKey={updatesKey} onCount={setOpenCount} />}
        {status && tab === 'files' && <FilesTab />}
        {status && tab === 'logs' && <LogsTab />}
        {status?.isOwner && tab === 'config' && <ConfigTab notify={notify} onSaved={loadStatus} />}
      </main>
      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
