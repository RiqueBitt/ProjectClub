import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import { useSocket } from '../context/SocketContext.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { proxyImage } from '../utils/imageProxy';
import RichText from '../components/AnunciosRichText.jsx';
import '../styles/anuncios.css';
import { useMarkSectionSeen } from '../utils/sectionBadges';

const fmtDate = (d) => new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

function Ico({ d, size = 18 }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}
const I = {
  megaphone: 'M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12',
  plus: 'M12 5v14M5 12h14',
  pin: 'M12 17v5M5 17h14l-2-5V5h1V3H6v2h1v7z',
  edit: 'M4 20h4L19 9l-4-4L4 16v4zM14 6l4 4',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  link: 'M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1',
};

function Editor({ initial, onClose, onSaved }) {
  const [title, setTitle] = useState(initial?.title || '');
  const [body, setBody] = useState(initial?.body || '');
  const [linkUrl, setLinkUrl] = useState(initial?.linkUrl || '');
  const [linkLabel, setLinkLabel] = useState(initial?.linkLabel || '');
  const [pinned, setPinned] = useState(!!initial?.pinned);
  // datetime-local quer "AAAA-MM-DDTHH:MM" no horário local.
  const toLocal = (iso) => { if (!iso) return ''; const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const [publishAt, setPublishAt] = useState(initial?.published === false ? toLocal(initial.publishAt) : '');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(initial?.bannerUrl ? proxyImage(initial.bannerUrl) : '');
  const [removeBanner, setRemoveBanner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => () => { if (preview.startsWith('blob:')) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = async () => {
    if (!title.trim() || !body.trim()) { setError('Preencha o título e o texto.'); return; }
    setSaving(true); setError('');
    const fd = new FormData();
    fd.append('title', title); fd.append('body', body); fd.append('linkUrl', linkUrl); fd.append('linkLabel', linkLabel);
    fd.append('pinned', String(pinned));
    fd.append('publishAt', publishAt ? new Date(publishAt).toISOString() : '');
    if (removeBanner) fd.append('removeBanner', 'true');
    if (file) fd.append('banner', file);
    try {
      if (initial?.id) await api.patch(`/anuncios/${initial.id}`, fd); else await api.post('/anuncios', fd);
      onSaved();
    } catch (e) { setError(e?.response?.data?.error || 'Não deu pra salvar o anúncio.'); }
    setSaving(false);
  };

  return (
    <div className="an-modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="an-modal" role="dialog" aria-label={initial?.id ? 'Editar anúncio' : 'Novo anúncio'}>
        <h2>{initial?.id ? 'Editar anúncio' : 'Novo anúncio'}</h2>
        <label className="an-banner-pick">
          {preview && !removeBanner ? <img src={preview} alt="" /> : <span>Escolher banner (opcional, 1920×600 fica ótimo)</span>}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => {
            const f = e.target.files?.[0]; if (!f) return;
            setFile(f); setRemoveBanner(false); setPreview(URL.createObjectURL(f));
          }} />
        </label>
        {preview && !removeBanner && <button type="button" className="an-link-btn" onClick={() => { setRemoveBanner(true); setFile(null); }}>Remover banner</button>}
        <label>Título<input value={title} maxLength={160} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Evento de fim de semana!" /></label>
        <label>Texto<textarea value={body} maxLength={8000} rows={7} onChange={(e) => setBody(e.target.value)} placeholder="Escreva o anúncio. Linhas em branco viram parágrafos." /></label>
        <div className="an-row">
          <label>Link do botão (opcional)<input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://… ou /loja" /></label>
          <label>Texto do botão<input value={linkLabel} maxLength={60} onChange={(e) => setLinkLabel(e.target.value)} placeholder="Saiba mais" /></label>
        </div>
        <label className="an-check"><input type="checkbox" checked={pinned} onChange={(e) => setPinned(e.target.checked)} /> Fixar no topo</label>
        <label>Agendar para (opcional)<input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} /></label>
        {error && <p className="an-error">{error}</p>}
        <div className="an-actions">
          <button type="button" className="an-btn ghost" onClick={onClose} disabled={saving}>Cancelar</button>
          <button type="button" className="an-btn primary" onClick={save} disabled={saving}>{saving ? 'Salvando…' : publishAt ? 'Agendar' : (initial?.id ? 'Salvar' : 'Publicar')}</button>
        </div>
      </div>
    </div>
  );
}

export default function AnunciosPage() {
  const socket = useSocket()?.socket || null;
  useMarkSectionSeen('anuncios'); // abriu Anúncios: apaga a bolinha "novo"
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    api.get('/anuncios').then((r) => setData(r.data)).catch(() => setData((d) => d || { announcements: [], canManage: false }));
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!socket) return undefined;
    socket.on('announcements:update', load);
    return () => socket.off('announcements:update', load);
  }, [socket, load]);

  const remove = async (a) => {
    if (!window.confirm(`Apagar o anúncio "${a.title}"?`)) return;
    await api.delete(`/anuncios/${a.id}`).catch(() => {});
    load();
  };

  const list = data?.announcements || [];
  return (
    <div className="an-page">
      <div className="an-inner">
        <header className="an-head">
          <span className="an-head-icon"><Ico d={I.megaphone} size={22} /></span>
          <div>
            <h1>Anúncios</h1>
            <p>Novidades e avisos oficiais da staff do Project Club.</p>
          </div>
          {data?.canManage && (
            <button type="button" className="an-btn primary" onClick={() => setEditing({})}><Ico d={I.plus} /> Novo anúncio</button>
          )}
        </header>

        {!data ? (
          <div className="an-list">{[0, 1].map((i) => <div key={i} className="an-card an-skeleton" />)}</div>
        ) : list.length === 0 ? (
          <div className="an-empty">
            <Ico d={I.megaphone} size={34} />
            <strong>Nenhum anúncio por enquanto</strong>
            <span>Quando a staff publicar algo, aparece aqui.</span>
          </div>
        ) : (
          <div className="an-list">
            {list.map((a) => (
              <article key={a.id} className={`an-card${a.pinned ? ' is-pinned' : ''}`}>
                {a.bannerUrl && <img className="an-banner" src={proxyImage(a.bannerUrl)} alt="" loading="lazy" />}
                <div className="an-body">
                  <div className="an-meta">
                    {a.published === false && <span className="an-pin">Agendado · {new Date(a.publishAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</span>}
                    {a.pinned && <span className="an-pin"><Ico d={I.pin} size={13} /> Fixado</span>}
                    <UserAvatar user={a.author} size={22} />
                    <span className="an-author">{a.author?.displayName || 'Staff'}</span>
                    <span className="an-date">{fmtDate(a.createdAt)}</span>
                    {data.canManage && (
                      <span className="an-tools">
                        <button type="button" title="Editar" aria-label="Editar" onClick={() => setEditing(a)}><Ico d={I.edit} size={16} /></button>
                        <button type="button" title="Apagar" aria-label="Apagar" className="danger" onClick={() => remove(a)}><Ico d={I.trash} size={16} /></button>
                      </span>
                    )}
                  </div>
                  <h2>{a.title}</h2>
                  <RichText text={a.body} />
                  {a.linkUrl && (
                    <a className="an-btn primary an-cta" href={a.linkUrl} target={a.linkUrl.startsWith('/') ? undefined : '_blank'} rel="noreferrer">
                      <Ico d={I.link} size={15} /> {a.linkLabel || 'Saiba mais'}
                    </a>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </div>
      {editing && <Editor initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} />}
    </div>
  );
}
