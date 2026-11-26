import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import Modal from '../../components/Modal.jsx';
import UserAvatar from '../../components/UserAvatar.jsx';
import { useVoice } from '../../context/VoiceContext.jsx';
import { useStore } from '../../store/useStore';
import { channelPath } from '../../utils/prettyLinks';
import { useLiveRefresh } from '../../utils/liveRefresh';
import {
  closeParty, createParty, inviteToParty, joinParty, kickFromParty, leaveParty, listParties, partyCall,
} from '../../api/gameHub';
import { HubPage } from './GameHubShell.jsx';
import { EmptyState, GameCover, GamePicker, Ico, errText, useLoad, whenLabel } from './shared.jsx';

// Game Hub → Partidas: abrir uma partida (agora ou marcada), chamar os
// amigos e ir todo mundo pra call da partida.

const notice = (m) => useStore.getState().pushNotice(m);

function useCallJoin() {
  const voice = useVoice();
  const navigate = useNavigate();
  return async (party) => {
    try {
      const ch = await partyCall(party.id);
      navigate(channelPath(ch));
      voice?.joinChannel(null, ch.id, ch.name, 'VOICE');
    } catch (err) { notice(errText(err, 'Não consegui abrir a call agora.')); }
  };
}

export function PartyCard({ party, onChange, onInvite, highlight = false, compact = false }) {
  const goCall = useCallJoin();
  const [busy, setBusy] = useState(false);
  const run = async (fn, okMsg) => {
    if (busy) return;
    setBusy(true);
    try { const r = await fn(); if (okMsg) notice(okMsg); onChange?.(r); } catch (err) { notice(errText(err, 'Não deu certo agora.')); } finally { setBusy(false); }
  };
  const full = party.filled >= party.slots;
  const mine = party.myStatus === 'host';
  const inIt = mine || party.myStatus === 'joined';
  const open = Array.from({ length: Math.max(0, party.slots - party.filled) });
  return (
    <article className={`gh-party${highlight ? ' is-hl' : ''}${compact ? ' is-compact' : ''}`} id={`partida-${party.id}`}>
      <div className="gh-party-art"><GameCover appId={party.game.steamAppId} src={party.game.cover} tall={party.game.coverTall} name={party.game.name} /></div>
      <div className="gh-party-body">
        <div className="gh-party-top">
          <span className={`gh-when${party.startsAt ? '' : ' is-now'}`}>{party.startsAt ? <Ico name="clock" size={13} /> : <span className="gh-live-dot" />}{whenLabel(party.startsAt)}</span>
          <span className="gh-party-game truncate">{party.game.name}</span>
        </div>
        <h3 className="gh-party-title">{party.title}</h3>
        {party.note && !compact && <p className="gh-party-note">{party.note}</p>}
        <div className="gh-party-seats" aria-label={`${party.filled} de ${party.slots} vagas preenchidas`}>
          {party.members.map((u) => (
            <span key={u.id} className={`gh-seat${u.id === party.host?.id ? ' is-host' : ''}`} title={u.id === party.host?.id ? `${u.displayName} (abriu)` : u.displayName}>
              <UserAvatar user={u} size={30} />
              {mine && u.id !== party.host?.id && !compact && (
                <button type="button" className="gh-seat-x" aria-label={`Tirar ${u.displayName}`} onClick={() => run(() => kickFromParty(party.id, u.id))}><Ico name="close" size={10} /></button>
              )}
            </span>
          ))}
          {open.map((_, i) => <span key={`v${i}`} className="gh-seat is-free" aria-hidden="true" />)}
          <span className="gh-party-count">{party.filled}/{party.slots}</span>
        </div>
      </div>
      <div className="gh-party-actions">
        {inIt ? (
          <>
            <button type="button" className="gh-btn is-primary" disabled={busy} onClick={() => goCall(party)}><Ico name="mic" size={16} /> {party.hasCall ? 'Entrar na call' : 'Abrir a call'}</button>
            {!compact && <button type="button" className="gh-btn" disabled={busy} onClick={() => onInvite?.(party)}><Ico name="send" size={15} /> Convidar</button>}
            {!compact && (mine
              ? <button type="button" className="gh-btn is-quiet" disabled={busy} onClick={() => run(() => closeParty(party.id), 'Partida fechada.')}>Fechar</button>
              : <button type="button" className="gh-btn is-quiet" disabled={busy} onClick={() => run(() => leaveParty(party.id), 'Você saiu da partida.')}>Sair</button>)}
          </>
        ) : (
          <button type="button" className="gh-btn is-primary" disabled={busy || full} onClick={() => run(() => joinParty(party.id), party.myStatus === 'invited' ? 'Convite aceito!' : 'Você entrou na partida.')}>
            {full ? 'Cheia' : party.myStatus === 'invited' ? 'Aceitar convite' : 'Entrar'}
          </button>
        )}
      </div>
    </article>
  );
}

// Data/hora local "AAAA-MM-DDTHH:MM" pro <input type="datetime-local">.
const localInput = (d) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); };

export function CreatePartyModal({ onClose, onCreated, presetGame = null }) {
  const friends = useStore((s) => s.friends) || [];
  const [game, setGame] = useState(presetGame);
  const [title, setTitle] = useState('');
  const [slots, setSlots] = useState(4);
  const [when, setWhen] = useState('now');
  const [at, setAt] = useState(() => { const d = new Date(Date.now() + 60 * 60000); d.setMinutes(0, 0, 0); return localInput(d); });
  const [note, setNote] = useState('');
  const [invite, setInvite] = useState([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const accepted = friends.filter((f) => f.status === 'ACCEPTED' && f.user);
  const submit = async (e) => {
    e.preventDefault();
    if (!game) { setError('Escolha o jogo.'); return; }
    setSaving(true); setError('');
    try {
      const party = await createParty({
        gameName: game.name, steamAppId: game.steamAppId, title: title.trim(), slots, note: note.trim(),
        startsAt: when === 'later' ? new Date(at).toISOString() : null, invite,
      });
      onCreated?.(party);
      onClose();
    } catch (err) { setError(errText(err, 'Não consegui abrir a partida.')); } finally { setSaving(false); }
  };
  return (
    <Modal title="Abrir partida" onClose={onClose} width="520px">
      <form onSubmit={submit} className="auth-form gh-form">
        <GamePicker value={game} onChange={setGame} autoFocus={!presetGame} />
        <label>
          <span>TÍTULO <span className="gh-opt">(opcional)</span></span>
          <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={game ? `${game.name} — ranqueada, casual…` : 'Ranqueada, casual, campanha…'} />
        </label>
        <div className="gh-form-row">
          <fieldset className="gh-seg">
            <legend>QUANDO</legend>
            <label className={when === 'now' ? 'on' : ''}><input type="radio" name="when" value="now" checked={when === 'now'} onChange={() => setWhen('now')} /> Agora</label>
            <label className={when === 'later' ? 'on' : ''}><input type="radio" name="when" value="later" checked={when === 'later'} onChange={() => setWhen('later')} /> Marcar horário</label>
          </fieldset>
          <label className="gh-slots">
            VAGAS
            <input type="number" min={2} max={16} value={slots} onChange={(e) => setSlots(Math.max(2, Math.min(16, Number(e.target.value) || 2)))} />
          </label>
        </div>
        {when === 'later' && (
          <label>
            DIA E HORA
            <input type="datetime-local" value={at} min={localInput(new Date())} onChange={(e) => setAt(e.target.value)} required />
          </label>
        )}
        <label>
          <span>RECADO <span className="gh-opt">(opcional)</span></span>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} placeholder="Ex.: precisa de microfone, rank ouro pra cima…" />
        </label>
        {accepted.length > 0 && (
          <div className="gh-invite-pick">
            <span className="gh-field-label">CHAMAR AMIGOS <span className="gh-opt">(recebem um aviso)</span></span>
            <div className="gh-friend-grid">
              {accepted.slice(0, 30).map((f) => {
                const on = invite.includes(f.user.id);
                return (
                  <button key={f.user.id} type="button" aria-pressed={on} className={`gh-friend${on ? ' on' : ''}`} onClick={() => setInvite((l) => (on ? l.filter((x) => x !== f.user.id) : [...l, f.user.id].slice(0, 15)))}>
                    <UserAvatar user={f.user} size={26} /><span className="truncate">{f.user.displayName}</span>{on && <Ico name="check" size={14} />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {error && <div className="auth-error">{error}</div>}
        <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Abrindo…' : 'Abrir partida'}</button>
      </form>
    </Modal>
  );
}

export function InviteModal({ party, onClose }) {
  const friends = useStore((s) => s.friends) || [];
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState([]);
  const [saving, setSaving] = useState(false);
  const inParty = new Set(party.members.map((u) => u.id));
  const list = friends.filter((f) => f.status === 'ACCEPTED' && f.user && !inParty.has(f.user.id)
    && (!q.trim() || `${f.user.displayName} ${f.user.username}`.toLowerCase().includes(q.trim().toLowerCase())));
  const send = async () => {
    setSaving(true);
    try {
      const r = await inviteToParty(party.id, picked);
      notice(r.invited ? `${r.invited} ${r.invited === 1 ? 'convite enviado' : 'convites enviados'}.` : 'Essas pessoas já tinham sido chamadas.');
      onClose();
    } catch (err) { notice(errText(err, 'Não consegui convidar agora.')); } finally { setSaving(false); }
  };
  return (
    <Modal title={`Chamar pra ${party.game.name}`} onClose={onClose} width="460px">
      <div className="auth-form gh-form">
        <label className="gh-search">
          <Ico name="search" size={16} />
          <span className="sr-only">Buscar amigo</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} placeholder="Buscar amigo" autoFocus />
        </label>
        {list.length === 0 ? (
          <p className="gh-hint">{friends.length ? 'Ninguém pra chamar com esse nome.' : 'Adicione amigos pra chamar pras partidas.'}</p>
        ) : (
          <div className="gh-friend-grid is-tall">
            {list.map((f) => {
              const on = picked.includes(f.user.id);
              return (
                <button key={f.user.id} type="button" aria-pressed={on} className={`gh-friend${on ? ' on' : ''}`} onClick={() => setPicked((l) => (on ? l.filter((x) => x !== f.user.id) : [...l, f.user.id].slice(0, 15)))}>
                  <UserAvatar user={f.user} size={26} /><span className="truncate">{f.user.displayName}</span>{on && <Ico name="check" size={14} />}
                </button>
              );
            })}
          </div>
        )}
        <button type="button" className="btn-primary" disabled={saving || picked.length === 0} onClick={send}>
          {saving ? 'Enviando…' : picked.length ? `Chamar ${picked.length}` : 'Escolha quem chamar'}
        </button>
      </div>
    </Modal>
  );
}

export default function PartiesTab() {
  const { data, loading, error, reload, setData } = useLoad(() => listParties(), []);
  const [params, setParams] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(null);
  const [filter, setFilter] = useState('all');
  const focusId = params.get('p');
  useLiveRefresh(({ put }) => listParties().then((l) => put(setData)(l)), { enabled: !!data });

  // Veio de um convite (/jogos/partidas?p=...): rola até a partida.
  useEffect(() => {
    if (!focusId || !data) return undefined;
    const t = setTimeout(() => document.getElementById(`partida-${focusId}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 150);
    return () => clearTimeout(t);
  }, [focusId, data]);

  const replace = (party) => {
    if (!party?.id) { reload(); return; }
    setData((l) => (l || []).map((p) => (p.id === party.id ? party : p)));
  };
  const list = useMemo(() => (data || []).filter((p) => {
    if (filter === 'mine') return p.myStatus === 'host' || p.myStatus === 'joined' || p.myStatus === 'invited';
    if (filter === 'now') return !p.startsAt;
    if (filter === 'later') return !!p.startsAt;
    return true;
  }), [data, filter]);
  const invites = (data || []).filter((p) => p.myStatus === 'invited').length;

  return (
    <HubPage>
      <div className="gh-head">
        <div>
          <h1 className="gh-h1">Partidas</h1>
          <p className="gh-sub">Abra uma partida, chame a galera e vão todos pra call juntos.</p>
        </div>
        <button type="button" className="gh-btn is-primary is-lg" onClick={() => setCreating(true)}><Ico name="plus" size={17} /> Abrir partida</button>
      </div>
      <div className="gh-chips" role="tablist" aria-label="Filtrar partidas">
        {[['all', 'Todas'], ['now', 'Agora'], ['later', 'Marcadas'], ['mine', invites ? `Minhas e convites (${invites})` : 'Minhas e convites']].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={filter === id} className={`gh-chip${filter === id ? ' on' : ''}`} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>
      {loading && !data ? (
        <div className="gh-party-list">{[0, 1, 2].map((i) => <span key={i} className="gh-skel gh-party-skel" />)}</div>
      ) : error && !data ? (
        <EmptyState icon="users" title="As partidas não carregaram" action={<button type="button" className="gh-btn" onClick={reload}>Tentar de novo</button>} />
      ) : list.length === 0 ? (
        <EmptyState icon="users" title={filter === 'all' ? 'Nenhuma partida aberta' : 'Nada com esse filtro'} action={<button type="button" className="gh-btn is-primary" onClick={() => setCreating(true)}><Ico name="plus" size={16} /> Abrir a primeira</button>}>
          Abra uma e chame seus amigos — eles recebem um aviso.
        </EmptyState>
      ) : (
        <div className="gh-party-list">
          {list.map((p) => <PartyCard key={p.id} party={p} highlight={p.id === focusId} onChange={(r) => (r?.id ? replace(r) : reload())} onInvite={setInviting} />)}
        </div>
      )}
      {creating && <CreatePartyModal onClose={() => setCreating(false)} onCreated={(p) => { setData((l) => [p, ...(l || [])]); setParams({ p: p.id }, { replace: true }); }} />}
      {inviting && <InviteModal party={inviting} onClose={() => { setInviting(null); reload(); }} />}
    </HubPage>
  );
}
