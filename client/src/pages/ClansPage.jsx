import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import {
  listPublicClans, createClan, joinClan, leaveClan, getMyClan, listClanIcons,
  listMyClanInvites, respondClanInvite,
} from '../api/endpoints';
import UserAvatar from '../components/UserAvatar.jsx';
import PageIcon from '../components/PageIcons.jsx';
import { ClubTile, PrivacyChip, ClubForm, ICON_COLORS } from '../components/ClubBits.jsx';
import '../styles/clubs.css';
import { useLiveRefresh } from '../utils/liveRefresh';

const CREATE_LEVEL_REQUIREMENT = 10;
const EMPTY_FORM = { name: '', description: '', privacyType: 'PUBLIC', iconId: '', iconColor: ICON_COLORS[0] };
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Aba "Clubes" do Social. Quem já está num clube vê o cartão dele; quem
// não está vê convites, a busca, os clubes abertos e o botão de criar.
// Cada pessoa participa de um clube por vez (o servidor também garante isso).
export default function ClansPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const myClan = useStore((s) => s.myClan);
  const myClanRole = useStore((s) => s.myClanRole);
  const setMyClan = useStore((s) => s.setMyClan);
  const [clans, setClans] = useState(null);
  const [icons, setIcons] = useState([]);
  const [invites, setInvites] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [joiningId, setJoiningId] = useState(null);
  const [query, setQuery] = useState('');

  const refresh = () => listPublicClans().then((d) => setClans(d.clans)).catch(() => setClans([]));
  const refreshInvites = () => listMyClanInvites().then((d) => setInvites(d.invites)).catch(() => {});
  useEffect(() => { refresh(); refreshInvites(); listClanIcons().then((d) => setIcons(d.icons)).catch(() => {}); }, []);
  const refreshMyClan = () => getMyClan().then((d) => setMyClan(d));

  // Tempo real (11s): lista de clubes e convites (busca digitada fica).
  useLiveRefresh(async ({ put }) => {
    await Promise.allSettled([
      listPublicClans().then((d) => put(setClans)(d.clans)),
      listMyClanInvites().then((d) => put(setInvites)(d.invites)),
    ]);
  }, { enabled: clans !== null });

  const level = user.accountLevel || 0;
  const canCreate = level >= CREATE_LEVEL_REQUIREMENT;

  const visible = useMemo(() => {
    if (!clans) return [];
    const q = query.trim().toLowerCase();
    const list = q ? clans.filter((c) => c.name.toLowerCase().includes(q) || c.description?.toLowerCase().includes(q)) : clans;
    // Clubes com amigos primeiro, depois os maiores.
    return [...list].sort((a, b) => (!!b.friendMember - !!a.friendMember) || (b.memberCount - a.memberCount));
  }, [clans, query]);

  const onCreate = async () => {
    setError('');
    if (!form.name.trim()) { setError('Dê um nome ao clube.'); return; }
    setBusy(true);
    try {
      await createClan({ name: form.name.trim(), description: form.description.trim() || undefined, privacyType: form.privacyType, iconId: form.iconId || undefined, iconColor: form.iconColor });
      setShowCreate(false);
      setForm(EMPTY_FORM);
      await Promise.all([refresh(), refreshMyClan()]);
      navigate('/clans/mine');
    } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível criar o clube.');
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async (clan) => {
    setJoiningId(clan.id);
    try {
      const result = await joinClan(clan.id);
      await refreshMyClan();
      if (result.joined) navigate('/clans/mine');
      else { useStore.getState().pushNotice('Pedido enviado! Você entra assim que aprovarem.'); await refresh(); }
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível entrar no clube.');
    } finally {
      setJoiningId(null);
    }
  };

  const onLeave = async () => {
    if (!confirm(myClanRole === 'OWNER' ? 'Sair do clube? Se houver outros membros, transfira a liderança antes.' : 'Sair do clube?')) return;
    setBusy(true);
    try {
      await leaveClan();
      await Promise.all([refresh(), refreshMyClan()]);
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível sair do clube.');
    } finally {
      setBusy(false);
    }
  };

  const onRespondInvite = async (invite, accept) => {
    try {
      const result = await respondClanInvite(invite.id, accept);
      await refreshInvites();
      if (result.accepted) { await refreshMyClan(); navigate('/clans/mine'); }
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível responder o convite.');
    }
  };

  /* ---------- Já está num clube ---------- */
  if (myClan) {
    const members = myClan.members || [];
    return (
      <div className="cb">
        <article className="cb-mine" style={{ '--club-color': myClan.iconColor || ICON_COLORS[0] }}>
          <div className="cb-mine-glow" aria-hidden="true" />
          <ClubTile clan={myClan} size={88} />
          <div className="cb-mine-info">
            <span className="cb-eyebrow">Seu clube</span>
            <h2 className="truncate">{myClan.name}</h2>
            {myClan.description && <p className="cb-mine-desc">{myClan.description}</p>}
            <div className="cb-chips">
              <span className="cb-chip"><PageIcon name="user" size={13} /> {plural(myClan.memberCount, 'membro', 'membros')}</span>
              <PrivacyChip clan={myClan} />
            </div>
            {members.length > 0 && (
              <div className="cb-stack" aria-label="Alguns membros">
                {members.slice(0, 6).map((m) => <UserAvatar key={m.id} user={m} size={30} />)}
                {members.length > 6 && <span className="cb-stack-more">+{members.length - 6}</span>}
              </div>
            )}
          </div>
          <div className="cb-mine-actions">
            <button type="button" className="cb-btn primary" onClick={() => navigate('/clans/mine')}>
              <PageIcon name="chat" size={17} /> Abrir clube
            </button>
            <button type="button" className="cb-btn ghost danger" onClick={onLeave} disabled={busy}>Sair</button>
          </div>
        </article>
        <p className="cb-note">Você só pode participar de um clube por vez. Para entrar em outro, saia deste primeiro.</p>
      </div>
    );
  }

  /* ---------- Sem clube ---------- */
  return (
    <div className="cb">
      <div className="cb-bar">
        <label className="cb-search">
          <PageIcon name="search" size={16} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar clubes" />
        </label>
        {canCreate ? (
          <button type="button" className={`cb-btn primary${showCreate ? ' active' : ''}`} onClick={() => setShowCreate((v) => !v)}>
            <PageIcon name={showCreate ? 'close' : 'plus'} size={17} /> {showCreate ? 'Fechar' : 'Criar clube'}
          </button>
        ) : (
          <div className="cb-locked" title={`Criar clube libera no nível ${CREATE_LEVEL_REQUIREMENT}`}>
            <PageIcon name="lock" size={15} />
            <span>Criar clube libera no nível {CREATE_LEVEL_REQUIREMENT}</span>
            <span className="cb-locked-bar"><span style={{ width: `${Math.min(100, (level / CREATE_LEVEL_REQUIREMENT) * 100)}%` }} /></span>
          </div>
        )}
      </div>

      {showCreate && canCreate && (
        <section className="cb-panel cb-create">
          <header className="cb-panel-head">
            <h3>Criar clube</h3>
            <p>Escolha nome, ícone e quem pode entrar. Dá para mudar tudo depois.</p>
          </header>
          <ClubForm form={form} setForm={setForm} icons={icons} />
          {error && <p className="cb-error" role="alert">{error}</p>}
          <div className="cb-panel-foot">
            <button type="button" className="cb-btn ghost" onClick={() => { setShowCreate(false); setError(''); }}>Cancelar</button>
            <button type="button" className="cb-btn primary" onClick={onCreate} disabled={busy}>{busy ? 'Criando…' : 'Criar clube'}</button>
          </div>
        </section>
      )}

      {invites.length > 0 && (
        <section className="cb-section">
          <h3 className="cb-section-title"><PageIcon name="inbox" size={16} /> Convites <span>{invites.length}</span></h3>
          <div className="cb-grid">
            {invites.map((invite) => (
              <article key={invite.id} className="cb-card is-invite" style={{ '--club-color': invite.clan.iconColor || ICON_COLORS[0] }}>
                <div className="cb-card-top">
                  <ClubTile clan={invite.clan} size={52} />
                  <div className="cb-card-title">
                    <strong className="truncate">{invite.clan.name}</strong>
                    <span className="truncate">Convite de {invite.invitedBy.displayName}</span>
                  </div>
                </div>
                <div className="cb-card-actions">
                  <button type="button" className="cb-btn primary" onClick={() => onRespondInvite(invite, true)}><PageIcon name="check" size={16} /> Aceitar</button>
                  <button type="button" className="cb-btn ghost" onClick={() => onRespondInvite(invite, false)}>Recusar</button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="cb-section">
        <h3 className="cb-section-title"><PageIcon name="grid" size={16} /> Clubes abertos {clans && <span>{clans.length}</span>}</h3>
        {!clans ? (
          <div className="cb-grid">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="cb-card cb-skeleton" />)}</div>
        ) : visible.length === 0 ? (
          <div className="cb-empty">
            <span className="cb-empty-icon"><PageIcon name="shield" size={30} /></span>
            <h3>{query ? 'Nenhum clube encontrado' : 'Nenhum clube aberto ainda'}</h3>
            <p>{query ? 'Tente outro nome.' : canCreate ? 'Que tal criar o primeiro?' : `Chegue ao nível ${CREATE_LEVEL_REQUIREMENT} para criar o primeiro clube.`}</p>
          </div>
        ) : (
          <div className="cb-grid">
            {visible.map((clan) => (
              <article key={clan.id} className="cb-card" style={{ '--club-color': clan.iconColor || ICON_COLORS[0] }}>
                <div className="cb-card-top">
                  <ClubTile clan={clan} size={52} />
                  <div className="cb-card-title">
                    <strong className="truncate">{clan.name}</strong>
                    <span>{plural(clan.memberCount, 'membro', 'membros')}</span>
                  </div>
                </div>
                {clan.description ? <p className="cb-card-desc">{clan.description}</p> : <p className="cb-card-desc muted">Sem descrição.</p>}
                <div className="cb-chips">
                  <PrivacyChip clan={clan} />
                  {clan.friendMember && <span className="cb-chip friend"><PageIcon name="user" size={13} /> {clan.friendMember.displayName} está aqui</span>}
                </div>
                <div className="cb-card-actions">
                  <button type="button" className="cb-btn primary" disabled={joiningId === clan.id} onClick={() => onJoin(clan)}>
                    {joiningId === clan.id ? 'Entrando…' : 'Entrar'}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
