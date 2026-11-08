import { useCallback, useEffect, useMemo, useState } from 'react';
import { listPlayGroups, createPlayGroup, joinPlayGroup, leavePlayGroup, cancelPlayGroup, errText } from '../../api/community';
import { useSocket } from '../../context/SocketContext.jsx';
import { EmptyState, Ico, Skeleton } from '../PagesKit.jsx';
import UserAvatar from '../UserAvatar.jsx';
import { Dialog, SectionCard, useFlash } from './CommunityBits.jsx';

// "Bora Jogar": grupos pra jogar junto num horário marcado.

function whenText(iso) {
  const d = new Date(iso);
  const today = new Date();
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1);
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `Hoje, ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Amanhã, ${time}`;
  return `${d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })}, ${time}`;
}

// Valor inicial do campo datetime-local: daqui a 1 hora, minutos redondos.
function defaultWhen() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function CreateGroupDialog({ rules, onClose, onCreated }) {
  const [form, setForm] = useState({ game: '', startsAt: defaultWhen(), slots: 4, description: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const { group } = await createPlayGroup({ ...form, slots: Number(form.slots), startsAt: new Date(form.startsAt).toISOString() });
      onCreated(group);
    } catch (err) { setError(errText(err)); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Criar grupo" onClose={onClose}>
      <form className="c4-form" onSubmit={submit}>
        <label>Jogo
          <input value={form.game} onChange={set('game')} maxLength={80} placeholder="Ex.: Minecraft, Valorant, Among Us" required autoFocus />
        </label>
        <div className="c4-form-row">
          <label>Quando
            <input type="datetime-local" value={form.startsAt} onChange={set('startsAt')} required />
          </label>
          <label>Vagas (com você)
            <input type="number" min={rules?.minSlots || 2} max={rules?.maxSlots || 50} value={form.slots} onChange={set('slots')} required />
          </label>
        </div>
        <label>Descrição <small>(opcional)</small>
          <textarea value={form.description} onChange={set('description')} maxLength={500} rows={3} placeholder="Servidor, modo de jogo, nível, se vai ter call…" />
        </label>
        {error && <p className="c4-error" role="alert">{error}</p>}
        <div className="c4-form-actions">
          <button type="button" className="pk-btn" onClick={onClose}>Cancelar</button>
          <button type="submit" className="pk-btn primary" disabled={busy}>{busy ? 'Criando…' : 'Criar grupo'}</button>
        </div>
      </form>
    </Dialog>
  );
}

function GroupCard({ g, busy, onJoin, onLeave, onCancel }) {
  const full = g.count >= g.slots;
  return (
    <article className={`c4-group ${g.joined ? 'is-joined' : ''}`}>
      <header>
        <span className="c4-group-game"><Ico name="bolt" size={16} /> <strong className="truncate">{g.game}</strong></span>
        <span className={`pk-chip ${full ? '' : 'green'}`}>{full ? 'Completo' : `${g.slots - g.count} vaga${g.slots - g.count === 1 ? '' : 's'}`}</span>
      </header>
      <p className="c4-group-when"><Ico name="calendar" size={15} /> {whenText(g.startsAt)}</p>
      {g.description && <p className="c4-group-desc">{g.description}</p>}
      <div className="c4-group-people" aria-label={`${g.count} de ${g.slots} pessoas`}>
        <span className="c4-avatars">
          {g.members.slice(0, 6).map((u) => <UserAvatar key={u.id} user={u} size={26} />)}
          {g.members.length > 6 && <span className="c4-avatars-more">+{g.members.length - 6}</span>}
        </span>
        <small>{g.count}/{g.slots} · criado por {g.owner?.displayName || 'alguém'}</small>
      </div>
      <footer>
        {g.isOwner && <button type="button" className="pk-btn sm danger" disabled={busy} onClick={() => onCancel(g)}>Cancelar grupo</button>}
        {!g.isOwner && g.joined && <button type="button" className="pk-btn sm" disabled={busy} onClick={() => onLeave(g)}>Sair</button>}
        {!g.joined && <button type="button" className="pk-btn sm primary" disabled={busy || full} onClick={() => onJoin(g)}>{full ? 'Sem vagas' : 'Entrar'}</button>}
      </footer>
    </article>
  );
}

export default function PlayGroupsTab() {
  const [groups, setGroups] = useState(null);
  const [rules, setRules] = useState(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState('');
  const [filter, setFilter] = useState('todos');
  const [flash, show] = useFlash();
  const { socket } = useSocket() || {};

  const load = useCallback(() => listPlayGroups().then((d) => { setGroups(d.groups); setRules(d.rules); }).catch(() => setGroups([])), []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!socket) return undefined;
    socket.on('playgroup:update', load);
    return () => socket.off('playgroup:update', load);
  }, [socket, load]);

  const act = async (g, fn, okText) => {
    setBusy(g.id);
    try { await fn(g.id); show(okText); await load(); } catch (e) { show(errText(e), 'bad'); } finally { setBusy(''); }
  };
  const shown = useMemo(() => (groups || []).filter((g) => (filter === 'meus' ? g.joined : true)), [groups, filter]);

  return (
    <SectionCard
      icon="bolt" title="Bora Jogar"
      aside={<button type="button" className="pk-btn primary sm" onClick={() => setCreating(true)}><Ico name="plus" size={16} /> Criar grupo</button>}
    >
      <p className="pk-muted">Marque um horário, diga o jogo e quantas vagas tem. Quando o grupo enche, todo mundo recebe um aviso — e 15 minutos antes chega um lembrete.</p>
      <div className="pk-filters c4-filters" role="group" aria-label="Filtro">
        {[['todos', 'Próximos'], ['meus', 'Meus grupos']].map(([id, label]) => (
          <button key={id} type="button" className={`pk-filter ${filter === id ? 'active' : ''}`} aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>
      {groups === null && <Skeleton rows={3} height={120} grid />}
      {groups !== null && shown.length === 0 && (
        <EmptyState compact icon="bolt" title={filter === 'meus' ? 'Você não está em nenhum grupo' : 'Nenhum grupo marcado'} text="Crie o primeiro e chame a galera." />
      )}
      {shown.length > 0 && (
        <div className="c4-groups">
          {shown.map((g) => (
            <GroupCard
              key={g.id} g={g} busy={busy === g.id}
              onJoin={(x) => act(x, joinPlayGroup, `Você entrou no grupo de ${x.game}.`)}
              onLeave={(x) => act(x, leavePlayGroup, 'Você saiu do grupo.')}
              onCancel={(x) => { if (window.confirm(`Cancelar o grupo de ${x.game}? Todo mundo vai ser avisado.`)) act(x, cancelPlayGroup, 'Grupo cancelado.'); }}
            />
          ))}
        </div>
      )}
      {creating && <CreateGroupDialog rules={rules} onClose={() => setCreating(false)} onCreated={(g) => { setCreating(false); show(`Grupo de ${g.game} criado!`); load(); }} />}
      {flash}
    </SectionCard>
  );
}
