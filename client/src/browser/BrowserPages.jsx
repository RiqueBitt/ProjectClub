import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBrowser } from './browserStore';
import { wvOf } from './BrowserHost.jsx';
import { B, Ico, Favicon } from './BrowserChrome.jsx';
import { SEARCH_ENGINES, NEW_TAB, displayUrl, hostOf, nativeBrowser, fmtBytes, timeAgo, toUrl, isOfflineMode } from './urlTools';
import { useStore } from '../store/useStore';
import { useCinema } from '../cinema/cinemaStore';
import { useYouTubeApp } from '../youtube/youtubeStore';
import { useMusic } from '../music/musicStore';
import { feat, engineApi, browserPlatform } from './platform';

const Fav = ({ url, favicon, size = 18 }) => <Favicon tab={{ url, favicon, loading: false }} size={size} />;

// ---------------- Nova aba ----------------
function NewTabPage({ tab }) {
  const prefs = useBrowser((s) => s.prefs);
  const bookmarks = useBrowser((s) => s.bookmarks);
  const history = useBrowser((s) => s.history);
  const total = useBrowser((s) => s.totalBlocked);
  const user = useStore((s) => s.user);
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const inputRef = useRef(null);
  const engine = SEARCH_ENGINES[prefs.searchEngine] || SEARCH_ENGINES.ddg;
  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 60); }, [tab.id]);

  // Sites mais visitados (do seu histórico) + favoritos.
  const top = useMemo(() => {
    const count = new Map();
    for (const h of history.slice(0, 1500)) {
      const host = hostOf(h.url); if (!host) continue;
      const c = count.get(host) || { n: 0, url: `https://${new URL(h.url).host}`, title: '', favicon: h.favicon };
      c.n += 1; if (!c.favicon && h.favicon) c.favicon = h.favicon;
      count.set(host, c);
    }
    const fromHistory = [...count.entries()].sort((a, b) => b[1].n - a[1].n).map(([host, c]) => ({ url: c.url, title: host, favicon: c.favicon }));
    const seen = new Set(); const out = [];
    for (const it of [...bookmarks, ...fromHistory]) { const h = hostOf(it.url); if (!h || seen.has(h)) continue; seen.add(h); out.push(it); if (out.length >= 10) break; }
    return out;
  }, [bookmarks, history]);

  const go = (input) => { const u = toUrl(input, prefs.searchEngine); if (u) useBrowser.getState().navigate(tab.id, u); };
  const hour = new Date().getHours();
  const greet = hour < 5 ? 'Boa madrugada' : hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const pcLinks = [
    { label: 'Filmes e Séries', icon: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4', run: () => useCinema.getState().openApp() },
    { label: 'YouTube', icon: B.yt, run: () => useYouTubeApp.getState().openApp() },
    { label: 'Música', icon: 'M9 18V5l11-2v13M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z', run: () => useMusic.getState().openPanel?.(true) },
    { label: 'Mini-jogos', icon: 'M6 11h4M8 9v4M15 12h.01M18 10h.01M17 6H7a5 5 0 0 0-5 5v1a4 4 0 0 0 7 2.6h6A4 4 0 0 0 22 12v-1a5 5 0 0 0-5-5z', run: () => navigate('/minijogos') },
    { label: 'Arena de Cartas', icon: 'M4 6l8-3 8 3v6c0 5-4 8-8 9-4-1-8-4-8-9z', run: () => navigate('/cartas') },
    { label: 'Chat', icon: 'M4 5h16v11H8l-4 4z', run: () => navigate('/') },
  ];
  return (
    <div className={`pcb-page pcb-newtab-page${tab.private ? ' is-private' : ''}`}>
      <div className="pcb-nt-hero">
        {tab.private ? (
          <>
            <span className="pcb-nt-badge is-private"><Ico d={B.mask} size={18} /> Aba privada</span>
            <h1>Navegação privada</h1>
            <p>Histórico, cookies e dados desta aba somem quando você fechar a última aba privada. Os downloads e favoritos continuam salvos.</p>
          </>
        ) : (
          <>
            <span className="pcb-nt-badge"><Ico d={B.globe} size={16} /> Navegador do Project Club</span>
            <h1>{greet}{user?.displayName ? `, ${user.displayName.split(' ')[0]}` : ''}</h1>
          </>
        )}
        <form className="pcb-nt-search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) go(q); }}>
          <Ico d={B.search} size={18} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Pesquisar com ${engine.name} ou digitar um endereço`} aria-label="Pesquisar" />
          <button type="submit" className="pcb-btn is-primary">Ir</button>
        </form>
        {feat('shield')
          ? <p className="pcb-nt-shield"><Ico d={B.shield} size={15} /> <strong>{total.toLocaleString('pt-BR')}</strong> anúncios e rastreadores bloqueados · Só HTTPS · Sem telemetria</p>
          : <p className="pcb-nt-shield"><Ico d={B.globe} size={15} /> Sites que permitem abrem aqui dentro; os outros abrem numa guia nova. No app para computador e no celular, todos abrem aqui.</p>}
      </div>
      {top.length > 0 && (
        <div className="pcb-nt-tiles">
          {top.map((t) => (
            <button key={t.url} type="button" className="pcb-tile" onClick={() => go(t.url)} title={t.url}>
              <span className="pcb-tile-ico"><Fav url={t.url} favicon={t.favicon} size={26} /></span>
              <span className="pcb-tile-t" data-no-translate>{t.title || hostOf(t.url)}</span>
            </button>
          ))}
        </div>
      )}
      {!tab.private && !isOfflineMode() && (
        <section className="pcb-nt-pc">
          <h3>No Project Club</h3>
          <div className="pcb-nt-pc-list">
            {pcLinks.map((l) => (
              <button key={l.label} type="button" className="pcb-nt-pc-item" onClick={l.run}><Ico d={l.icon} size={18} /> {l.label}</button>
            ))}
          </div>
        </section>
      )}
      {!tab.private && history.length > 0 && (
        <section className="pcb-nt-recent">
          <h3>Visitados recentemente <button type="button" className="pcb-link" onClick={() => useBrowser.getState().navigate(tab.id, 'pc://historico')}>Ver histórico</button></h3>
          {history.slice(0, 6).map((h) => (
            <button key={h.at} type="button" className="pcb-row" onClick={() => go(h.url)}>
              <Fav url={h.url} favicon={h.favicon} />
              <span className="pcb-row-t" data-no-translate>{h.title || displayUrl(h.url)}</span>
              <span className="pcb-row-s">{timeAgo(h.at)}</span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

// ---------------- Histórico ----------------
function HistoryPage({ tab }) {
  const history = useBrowser((s) => s.history);
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(150);
  const [clearing, setClearing] = useState(false);
  const st = useBrowser.getState;
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? history.filter((h) => h.url.toLowerCase().includes(t) || (h.title || '').toLowerCase().includes(t)) : history;
  }, [history, q]);
  const groups = [];
  for (const h of list.slice(0, limit)) {
    const day = new Date(h.at).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
    if (!groups.length || groups[groups.length - 1].day !== day) groups.push({ day, items: [] });
    groups[groups.length - 1].items.push(h);
  }
  const clear = async (ms, data) => {
    st().clearHistory(ms);
    if (data) await engineApi()?.clearData?.({ cookies: true, cache: true, storage: true });
    setClearing(false);
  };
  return (
    <div className="pcb-page">
      <header className="pcb-page-h">
        <h2><Ico d={B.history} size={20} /> Histórico</h2>
        <input className="pcb-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar no histórico" aria-label="Buscar no histórico" />
        <button type="button" className="pcb-btn" onClick={() => setClearing((v) => !v)}>Limpar dados…</button>
      </header>
      {clearing && (
        <div className="pcb-card pcb-clear">
          <strong>Limpar dados de navegação</strong>
          <div className="pcb-clear-a">
            <button type="button" className="pcb-btn" onClick={() => clear(3600 * 1000)}>Última hora</button>
            <button type="button" className="pcb-btn" onClick={() => clear(24 * 3600 * 1000)}>Últimas 24 h</button>
            <button type="button" className="pcb-btn" onClick={() => clear(null)}>Todo o histórico</button>
            <button type="button" className="pcb-btn is-danger" onClick={() => clear(null, true)}>Tudo + cookies e cache</button>
          </div>
          <small>“Tudo + cookies e cache” desconecta você dos sites.</small>
        </div>
      )}
      {!list.length && <p className="pcb-empty">{q ? 'Nada encontrado.' : 'Seu histórico aparece aqui. Abas privadas não entram.'}</p>}
      {groups.map((g) => (
        <section key={g.day} className="pcb-group">
          <h3>{g.day}</h3>
          {g.items.map((h) => (
            <div key={h.at} className="pcb-row">
              <button type="button" className="pcb-row-main" onClick={() => st().navigate(tab.id, h.url)}>
                <span className="pcb-row-time">{new Date(h.at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
                <Fav url={h.url} favicon={h.favicon} />
                <span className="pcb-row-t" data-no-translate>{h.title || displayUrl(h.url)}</span>
                <span className="pcb-row-s" data-no-translate>{hostOf(h.url)}</span>
              </button>
              <button type="button" className="pcb-row-x" onClick={() => st().removeHistory(h.at)} aria-label="Remover do histórico" title="Remover"><Ico d={B.close} size={13} /></button>
            </div>
          ))}
        </section>
      ))}
      {list.length > limit && <button type="button" className="pcb-btn pcb-more" onClick={() => setLimit((l) => l + 300)}>Mostrar mais</button>}
    </div>
  );
}

// ---------------- Favoritos ----------------
function BookmarksPage({ tab }) {
  const bookmarks = useBrowser((s) => s.bookmarks);
  const [edit, setEdit] = useState(null);
  const st = useBrowser.getState;
  return (
    <div className="pcb-page">
      <header className="pcb-page-h"><h2><Ico d={B.bookmarks} size={20} /> Favoritos</h2></header>
      {!bookmarks.length && <p className="pcb-empty">Clique na estrela da barra de endereço (ou Ctrl+D) para salvar um site.</p>}
      <div className="pcb-bm-grid">
        {bookmarks.map((b) => (
          <div key={b.url} className="pcb-bm">
            <button type="button" className="pcb-bm-main" onClick={() => st().navigate(tab.id, b.url)} title={b.url}>
              <Fav url={b.url} favicon={b.favicon} size={22} />
              {edit === b.url
                ? <input className="pcb-input" defaultValue={b.title} autoFocus onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === 'Enter') { st().renameBookmark(b.url, e.currentTarget.value || b.title); setEdit(null); } if (e.key === 'Escape') setEdit(null); }} onBlur={(e) => { st().renameBookmark(b.url, e.currentTarget.value || b.title); setEdit(null); }} />
                : <span><strong data-no-translate>{b.title}</strong><small data-no-translate>{displayUrl(b.url)}</small></span>}
            </button>
            <div className="pcb-bm-a">
              <button type="button" onClick={() => setEdit(b.url)} aria-label="Renomear" title="Renomear">✎</button>
              <button type="button" onClick={() => useBrowser.setState({ share: { url: b.url, title: b.title } })} aria-label="Compartilhar" title="Compartilhar no Project Club"><Ico d={B.share} size={13} /></button>
              <button type="button" onClick={() => st().toggleBookmark(b.url)} aria-label="Remover" title="Remover"><Ico d={B.close} size={13} /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Downloads ----------------
function DownloadsPage() {
  const downloads = useBrowser((s) => s.downloads);
  const nb = engineApi();
  const list = [...downloads].reverse();
  return (
    <div className="pcb-page">
      <header className="pcb-page-h"><h2><Ico d={B.down} size={20} /> Downloads</h2></header>
      {!list.length && <p className="pcb-empty">{browserPlatform() === 'android' ? 'Os arquivos baixados vão para a pasta Download do celular (o Android avisa na barra de notificações quando terminar).' : browserPlatform() === 'web' ? 'Os downloads vão para a pasta de downloads do seu navegador.' : 'Os arquivos baixados vão para a sua pasta Downloads. Programas (.exe etc.) nunca abrem sozinhos.'}</p>}
      {list.map((d) => (
        <div key={d.id} className={`pcb-card pcb-dl is-${d.state}`}>
          <div className="pcb-dl-t">
            <strong data-no-translate>{d.filename}</strong>
            <small data-no-translate>{hostOf(d.url)} · {d.state === 'system' ? 'Baixado pelo Android · pasta Download' : d.state === 'completed' ? fmtBytes(d.total || d.received) : d.state === 'cancelled' ? 'Cancelado' : d.state === 'interrupted' ? 'Falhou' : `${fmtBytes(d.received)} de ${d.total ? fmtBytes(d.total) : '?'}`}{d.private ? ' · aba privada' : ''}</small>
            {(d.state === 'progressing' || d.state === 'paused') && <span className="pcb-bar"><i style={{ width: `${d.total ? Math.round((d.received / d.total) * 100) : 30}%` }} /></span>}
          </div>
          <div className="pcb-dl-a">
            {d.state === 'completed' && <button type="button" className="pcb-btn" onClick={() => nb?.downloadAction?.(d.id, 'open')}>Abrir</button>}
            {d.state === 'completed' && <button type="button" className="pcb-btn" onClick={() => nb?.downloadAction?.(d.id, 'show')}>Mostrar na pasta</button>}
            {d.state === 'progressing' && <button type="button" className="pcb-btn" onClick={() => nb?.downloadAction?.(d.id, 'pause')}>Pausar</button>}
            {d.state === 'paused' && <button type="button" className="pcb-btn" onClick={() => nb?.downloadAction?.(d.id, 'resume')}>Continuar</button>}
            {(d.state === 'progressing' || d.state === 'paused') && <button type="button" className="pcb-btn" onClick={() => nb?.downloadAction?.(d.id, 'cancel')}>Cancelar</button>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------- Senhas ----------------
function PasswordsPage() {
  const nb = nativeBrowser();
  const pw = nb?.passwords;
  const [data, setData] = useState(null);
  const [shown, setShown] = useState({});
  const [q, setQ] = useState('');
  const [copied, setCopied] = useState('');
  const reload = () => pw?.list().then(setData).catch(() => setData({ entries: [], never: [], encryption: {} }));
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!pw) return <div className="pcb-page"><p className="pcb-empty">{browserPlatform() === 'desktop' ? 'Atualize o app para usar as senhas salvas.' : browserPlatform() === 'android' ? 'No celular, o preenchimento automático do Android (Google, Samsung Pass, Bitwarden…) salva e preenche as senhas dos sites.' : 'No site, as senhas ficam com o gerenciador do seu navegador.'}</p></div>;
  const reveal = async (id) => { if (shown[id]) { setShown((s) => ({ ...s, [id]: null })); return; } const v = await pw.reveal(id); setShown((s) => ({ ...s, [id]: v })); setTimeout(() => setShown((s) => ({ ...s, [id]: null })), 20000); };
  const copy = async (id) => { const v = shown[id] || await pw.reveal(id); if (!v) return; await navigator.clipboard.writeText(v).catch(() => {}); setCopied(id); setTimeout(() => setCopied(''), 1500); };
  const enc = data?.encryption || {};
  const list = (data?.entries || []).filter((x) => !q || x.origin.includes(q.toLowerCase()) || (x.username || '').toLowerCase().includes(q.toLowerCase()));
  return (
    <div className="pcb-page pcb-settings">
      <header className="pcb-page-h">
        <h2><Ico d={B.key} size={20} /> Senhas salvas</h2>
        <input className="pcb-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar site ou usuário" aria-label="Buscar senhas" />
      </header>
      <div className={`pcb-card pcb-vault${enc.available && !enc.weak ? '' : ' is-warn'}`}>
        <Ico d={B.lock} size={18} />
        <span>
          {enc.available && !enc.weak
            ? <>Os logins ficam <strong>só neste computador</strong>, num arquivo criptografado pelo sistema ({enc.backend === 'dpapi' ? 'Windows DPAPI' : enc.backend === 'keychain' ? 'Chaveiro do macOS' : `chaveiro do sistema: ${enc.backend || 'ativo'}`}). Nada vai para o servidor do Project Club.</>
            : enc.available
              ? <>Os logins ficam <strong>só neste computador</strong>, mas este sistema não tem chaveiro configurado, então a proteção do arquivo é <strong>básica</strong> (como no Chrome sem chaveiro). Instale/ative o chaveiro do sistema para proteção completa.</>
              : <>O cofre do sistema não está disponível neste computador, então o navegador <strong>não salva senhas novas</strong>.</>}
        </span>
      </div>
      {data && !list.length && <p className="pcb-empty">{q ? 'Nada encontrado.' : 'Quando você entrar num site, o navegador pergunta se quer salvar o login aqui.'}</p>}
      {list.map((x) => (
        <div key={x.id} className="pcb-row pcb-pw-row">
          <Favicon tab={{ url: x.origin, loading: false }} size={18} />
          <span className="pcb-pw-site" data-no-translate>{hostOf(x.origin)}</span>
          <span className="pcb-pw-user" data-no-translate>{x.username || '(sem usuário)'}</span>
          <span className="pcb-pw-pass" data-no-translate>{shown[x.id] || '••••••••••'}</span>
          <button type="button" className="pcb-mini" onClick={() => reveal(x.id)}>{shown[x.id] ? 'Ocultar' : 'Mostrar'}</button>
          <button type="button" className="pcb-mini" onClick={() => copy(x.id)}>{copied === x.id ? 'Copiado!' : 'Copiar'}</button>
          <button type="button" className="pcb-mini is-danger" onClick={async () => { await pw.remove(x.id); reload(); }}>Excluir</button>
        </div>
      ))}
      {data?.never?.length > 0 && (
        <section className="pcb-card" style={{ marginTop: 18 }}>
          <h3>Nunca salvar nestes sites</h3>
          {data.never.map((o) => (
            <div key={o} className="pcb-row"><span className="pcb-row-t" data-no-translate>{hostOf(o) || o}</span>
              <button type="button" className="pcb-btn" onClick={async () => { await pw.forgetNever(o); reload(); }}>Remover</button></div>
          ))}
        </section>
      )}
      {data?.entries?.length > 0 && (
        <p style={{ marginTop: 18 }}><button type="button" className="pcb-btn is-danger" onClick={async () => { if (window.confirm('Apagar todas as senhas salvas neste computador?')) { await pw.removeAll(); reload(); } }}>Apagar todas as senhas</button></p>
      )}
    </div>
  );
}

// ---------------- Configurações ----------------
const PRIVACY = [
  ['adblock', 'Bloquear anúncios, rastreadores, malware e phishing', 'As mesmas listas que o LibreWolf usa no uBlock Origin: uBlock, EasyList, EasyPrivacy, AdGuard (PT/ES), URLhaus e phishing.'],
  ['cookieBanners', 'Esconder avisos de cookies', 'Remove os pop-ups de “aceitar cookies” (listas EasyList Cookies e uBlock Cookies).'],
  ['httpsOnly', 'Modo só HTTPS', 'Sempre tenta a versão segura do site. Se ele não tiver, você decide se continua.'],
  ['stripTracking', 'Remover rastreio dos links', 'Tira utm_, fbclid, gclid e afins dos endereços antes de abrir.'],
  ['block3pCookies', 'Bloquear cookies de terceiros', 'Sites de fora (anunciantes, redes sociais) não leem nem gravam cookies na página que você está vendo.'],
  ['trimReferrer', 'Não contar de onde você veio', 'Para outros sites, envia só o domínio da página anterior, nunca o endereço completo.'],
  ['gpc', 'Pedir “não venda meus dados”', 'Envia o sinal Global Privacy Control (e Do Not Track) para todos os sites.'],
];
const ANDROID_PRIVACY = ['adblock', 'httpsOnly', 'stripTracking', 'block3pCookies'];
function SettingsPage() {
  const prefs = useBrowser((s) => s.prefs);
  const engine = useBrowser((s) => s.engine);
  const siteAllow = useBrowser((s) => s.siteAllow);
  const total = useBrowser((s) => s.totalBlocked);
  const profileDir = useBrowser((s) => s.profileDir);
  const userSettings = useStore((s) => s.userSettings);
  const updateUserSetting = useStore((s) => s.updateUserSetting);
  const [perms, setPerms] = useState(null);
  const [busy, setBusy] = useState('');
  const nb = engineApi();
  const platform = browserPlatform();
  const st = useBrowser.getState;
  useEffect(() => { if (nb?.listPermissions) nb.listPermissions().then(setPerms).catch(() => setPerms([])); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const updateLists = async () => { setBusy('lists'); try { const e = await nb?.updateLists?.(); if (e) useBrowser.setState({ engine: e }); } finally { setBusy(''); } };
  const clearAll = async () => { if (!window.confirm('Apagar cookies, cache e dados dos sites? Você será desconectado dos sites.')) return; setBusy('clear'); try { await nb?.clearData?.({ cookies: true, cache: true, storage: true }); } finally { setBusy(''); } };
  return (
    <div className="pcb-page pcb-settings">
      <header className="pcb-page-h"><h2><Ico d={B.settings} size={20} /> Configurações do navegador</h2></header>

      {platform === 'android' && (
        <section className="pcb-card pcb-local">
          <h3>Seus dados ficam neste celular</h3>
          <p className="pcb-muted">Favoritos, histórico, abas abertas e preferências ficam em arquivos na pasta de dados do app no celular. Logins e cookies dos sites ficam no próprio Android. Nada disso vai para o servidor do Project Club. Senhas: use o preenchimento automático do Android.</p>
          <div className="pcb-local-files">{['favoritos.json', 'historico.json', 'abas.json', 'interface.json', 'preferencias.json'].map((f) => <code key={f}>{f}</code>)}</div>
        </section>
      )}
      {platform === 'web' && (
        <section className="pcb-card pcb-local">
          <h3>Navegador na versão site</h3>
          <p className="pcb-muted">Aqui o navegador usa o seu navegador de verdade por baixo. Sites que permitem ser abertos dentro de outro site aparecem nesta aba; os que não permitem (Google, YouTube, bancos, redes sociais…) abrem numa guia nova — é uma proteção desses sites. Favoritos e histórico ficam só neste navegador. No app para computador e no app do celular, todos os sites abrem aqui dentro, com bloqueador de anúncios.</p>
          <label className="pcb-switch-row">
            <span><strong>Abrir numa guia nova automaticamente</strong><small>Quando o site não deixa ser aberto aqui, abre direto numa guia nova (em vez de mostrar o aviso).</small></span>
            <input type="checkbox" className="pcb-switch" checked={prefs.webAutoNewTab !== false} onChange={(e) => st().setPrefs({ webAutoNewTab: e.target.checked })} />
          </label>
        </section>
      )}
      {platform === 'desktop' && <section className="pcb-card pcb-local">
        <h3>Seus dados ficam neste computador</h3>
        <p className="pcb-muted">Favoritos, histórico, abas abertas, downloads, senhas (criptografadas), permissões e logins/cookies dos sites são guardados em arquivos na pasta do app, no seu computador. Nada disso é enviado ao servidor do Project Club.</p>
        <div className="pcb-local-files">
          {['favoritos.json', 'historico.json', 'abas.json', 'downloads.json', 'senhas.json (criptografado)', 'interface.json'].map((f) => <code key={f}>{f}</code>)}
        </div>
        <div className="pcb-clear-a">
          {nb?.profile && <button type="button" className="pcb-btn" onClick={() => nb.profile.openFolder()}>Abrir a pasta dos dados</button>}
          <button type="button" className="pcb-btn" onClick={() => st().openTab('pc://senhas')}>Senhas salvas</button>
        </div>
        {profileDir && <p className="pcb-muted" data-no-translate><small>{profileDir}</small></p>}
      </section>}

      <section className="pcb-card">
        <h3>Busca</h3>
        <label className="pcb-field"><span>Buscador padrão</span>
          <select className="pcb-input" value={prefs.searchEngine} onChange={(e) => st().setPrefs({ searchEngine: e.target.value })}>
            {Object.entries(SEARCH_ENGINES).map(([id, e]) => <option key={id} value={id}>{e.name}{id === 'ddg' ? ' (recomendado, privado)' : ''}</option>)}
          </select>
        </label>
        {userSettings && platform !== 'web' && (
          <label className="pcb-switch-row">
            <span><strong>Abrir links do Project Club aqui</strong><small>Links do chat, posts e perfis abrem em uma aba deste navegador em vez do navegador do sistema.</small></span>
            <input type="checkbox" className="pcb-switch" checked={userSettings.openLinksInApp !== false} onChange={(e) => updateUserSetting('openLinksInApp', e.target.checked)} />
          </label>
        )}
      </section>

      {platform !== 'web' && <section className="pcb-card">
        <h3>Privacidade e proteção <small>inspiradas no LibreWolf</small></h3>
        {PRIVACY.filter(([k]) => platform === 'desktop' || ANDROID_PRIVACY.includes(k)).map(([k, title, desc]) => (
          <label key={k} className="pcb-switch-row">
            <span><strong>{title}</strong><small>{desc}</small></span>
            <input type="checkbox" className="pcb-switch" checked={!!prefs[k]} onChange={(e) => st().setPrefs({ [k]: e.target.checked })} />
          </label>
        ))}
        <p className="pcb-muted">{platform === 'android' ? 'No celular o bloqueio é por endereço (EasyList, EasyPrivacy e Peter Lowe) e sites de phishing/malware são avisados antes de abrir. Sempre ligados: sem conteúdo misto, identificação como um Chrome comum, nenhuma telemetria.' : 'Sempre ligados: WebRTC sem expor seu IP local, identificação como um Chrome comum, nenhuma telemetria.'}</p>
        <div className="pcb-engine">
          <span className={`pcb-dot is-${engine.state}`} />
          <span>{engine.state === 'on' ? `${engine.lists} listas ativas${engine.updatedAt ? ` · atualizadas ${timeAgo(engine.updatedAt)}` : ''}` : engine.state === 'loading' ? 'Carregando listas…' : engine.state === 'error' ? 'Não consegui baixar as listas agora' : 'Bloqueador desligado'} · {total.toLocaleString('pt-BR')} bloqueios</span>
          <button type="button" className="pcb-btn" disabled={busy === 'lists'} onClick={updateLists}>{busy === 'lists' ? 'Atualizando…' : 'Atualizar listas'}</button>
        </div>
      </section>}

      {platform !== 'web' && <section className="pcb-card">
        <h3>Sites com o bloqueador desligado</h3>
        {!siteAllow.length && <p className="pcb-muted">Nenhum. Use o escudo da barra de endereço para desligar em um site.</p>}
        {siteAllow.map((h) => (
          <div key={h} className="pcb-row"><span className="pcb-row-t" data-no-translate>{h}</span>
            <button type="button" className="pcb-btn" onClick={async () => { await nb?.setSiteAdblock?.(h, true); st().loadNative(); }}>Voltar a bloquear</button></div>
        ))}
      </section>}

      {feat('permissionsList') && <section className="pcb-card">
        <h3>Permissões dos sites</h3>
        {perms && !perms.length && <p className="pcb-muted">Nenhuma permissão salva.</p>}
        {(perms || []).map((p) => (
          <div key={`${p.origin}|${p.permission}`} className="pcb-row">
            <span className="pcb-row-t" data-no-translate>{hostOf(p.origin) || p.origin}</span>
            <span className="pcb-row-s">{p.permission.split(':')[0]} · {p.allow ? 'permitido' : 'bloqueado'}</span>
            <button type="button" className="pcb-btn" onClick={async () => { await nb?.forgetPermissions(p.origin); setPerms(await nb?.listPermissions()); }}>Esquecer</button>
          </div>
        ))}
      </section>}

      <section className="pcb-card">
        <h3>Dados de navegação</h3>
        <div className="pcb-clear-a">
          <button type="button" className="pcb-btn" onClick={() => st().clearHistory(null)}>Limpar histórico</button>
          {platform !== 'web' && <button type="button" className="pcb-btn is-danger" disabled={busy === 'clear'} onClick={clearAll}>{busy === 'clear' ? 'Limpando…' : 'Apagar cookies, cache e dados dos sites'}</button>}
        </div>
      </section>
    </div>
  );
}

// ---------------- erros ----------------
const NET_TEXT = {
  '-105': 'Não encontrei esse endereço. Confira se está escrito certo.',
  '-106': 'Você está sem internet.',
  '-102': 'O site recusou a conexão.',
  '-118': 'O site demorou demais para responder.',
  '-109': 'O site não está respondendo.',
  '-201': 'O certificado de segurança do site é inválido ou expirou.',
  '-202': 'O certificado de segurança do site não é confiável.',
  '-200': 'O certificado de segurança do site é inválido.',
  '-20': 'Este endereço foi bloqueado.',
  '-21': 'A rede mudou. Tente de novo.',
};
export function ErrorPage({ tab }) {
  const e = tab.error;
  const st = useBrowser.getState;
  const wv = wvOf(tab.id);
  const retry = () => { st().update(tab.id, { error: null }); if (wv) { try { wv.loadURL(e.url || tab.url)?.catch?.(() => {}); } catch { wv.reload(); } } else st().navigate(tab.id, e.url || tab.url); };
  if (e.kind === 'danger') {
    return (
      <div className="pcb-page pcb-error is-danger">
        <Ico d={B.shield} size={44} />
        <h2>Site perigoso bloqueado</h2>
        <p><strong data-no-translate>{e.host}</strong> está nas listas de malware/phishing. Ele pode tentar roubar senhas, dados de cartão ou instalar programas maliciosos.</p>
        <div className="pcb-err-a">
          <button type="button" className="pcb-btn is-primary" onClick={() => { st().update(tab.id, { error: null }); if (wv?.canGoBack()) wv.goBack(); else st().navigate(tab.id, NEW_TAB); }}>Voltar para a segurança</button>
          <button type="button" className="pcb-link" onClick={async () => { await engineApi()?.allowDangerous?.(e.host); retry(); }}>Entendo o risco, abrir mesmo assim</button>
        </div>
      </div>
    );
  }
  if (e.kind === 'https') {
    return (
      <div className="pcb-page pcb-error">
        <Ico d={B.unlock} size={44} />
        <h2>Este site não tem conexão segura</h2>
        <p>O modo só-HTTPS tentou abrir <strong data-no-translate>{e.host}</strong> com segurança, mas o site não oferece HTTPS. Na versão comum (HTTP), o que você enviar pode ser visto por outros na rede.</p>
        <div className="pcb-err-a">
          <button type="button" className="pcb-btn is-primary" onClick={() => { if (wv?.canGoBack()) { st().update(tab.id, { error: null }); wv.goBack(); } else st().navigate(tab.id, NEW_TAB); }}>Voltar</button>
          <button type="button" className="pcb-btn" onClick={async () => { await engineApi()?.allowHttp?.(e.host); st().update(tab.id, { error: null, upgradedHost: null }); st().navigate(tab.id, `http://${String(e.url).replace(/^https?:\/\//, '')}`); }}>Continuar no site sem HTTPS</button>
        </div>
      </div>
    );
  }
  if (e.kind === 'noframe') {
    const self = e.reason === 'self';
    const open = () => { const w = window.open(e.url, '_blank'); if (w) { try { w.opener = null; } catch { /* ok */ } } };
    return (
      <div className="pcb-page pcb-error is-noframe">
        <Favicon tab={{ url: e.url, loading: false }} size={44} />
        <h2>{self ? 'Esse link é do próprio Project Club' : e.opened ? 'Aberto numa guia nova' : 'Este site abre numa guia nova'}</h2>
        <p>{self
          ? 'Ele abre direto no app, fora do navegador.'
          : e.reason === 'blocked'
            ? 'Esse endereço não pode ser aberto aqui dentro.'
            : <><strong data-no-translate>{e.host}</strong> não permite ser aberto dentro de outro site (é uma proteção do próprio site contra golpes). {e.opened ? 'Abrimos ele numa guia nova do seu navegador.' : 'Abra numa guia nova do seu navegador.'}</>}</p>
        <p className="pcb-muted" data-no-translate>{displayUrl(e.url)}</p>
        <div className="pcb-err-a">
          {self
            ? <button type="button" className="pcb-btn is-primary" onClick={() => { try { const u = new URL(e.url); window.location.assign(u.pathname + u.search + u.hash); } catch { /* ok */ } }}>Abrir no Project Club</button>
            : <button type="button" className="pcb-btn is-primary" onClick={open}>{e.opened ? 'Abrir de novo' : 'Abrir em nova guia'}</button>}
          <button type="button" className="pcb-btn" onClick={() => { st().update(tab.id, { error: null }); if (wv?.canGoBack()) wv.goBack(); else st().navigate(tab.id, NEW_TAB); }}>Voltar</button>
        </div>
        {!self && <p className="pcb-muted"><small>No app para computador e no app do celular, todos os sites abrem aqui dentro.</small></p>}
      </div>
    );
  }
  if (e.kind === 'crash') {
    return (
      <div className="pcb-page pcb-error">
        <Ico d={B.reload} size={44} />
        <h2>Esta aba parou de funcionar</h2>
        <p>A página travou ou ficou sem memória. O resto do Project Club continua normal.</p>
        <div className="pcb-err-a"><button type="button" className="pcb-btn is-primary" onClick={retry}>Recarregar</button></div>
      </div>
    );
  }
  return (
    <div className="pcb-page pcb-error">
      <Ico d={B.globe} size={44} />
      <h2>Não consegui abrir a página</h2>
      <p>{NET_TEXT[String(e.code)] || 'O site não pôde ser carregado.'}</p>
      <p className="pcb-muted" data-no-translate>{displayUrl(e.url)} · {e.desc || e.code}</p>
      <div className="pcb-err-a">
        <button type="button" className="pcb-btn is-primary" onClick={retry}>Tentar de novo</button>
        <button type="button" className="pcb-btn" onClick={() => engineApi()?.openSystem?.(e.url)}>{browserPlatform() === 'web' ? 'Abrir em nova guia' : 'Abrir no navegador do sistema'}</button>
      </div>
    </div>
  );
}

export function InternalPage({ tab }) {
  if (tab.url === 'pc://historico') return <HistoryPage tab={tab} />;
  if (tab.url === 'pc://favoritos') return <BookmarksPage tab={tab} />;
  if (tab.url === 'pc://downloads') return <DownloadsPage />;
  if (tab.url === 'pc://config') return <SettingsPage />;
  if (tab.url === 'pc://senhas') return <PasswordsPage />;
  return <NewTabPage tab={tab} />;
}
