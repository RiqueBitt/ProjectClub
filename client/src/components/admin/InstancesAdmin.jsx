import { useCallback, useEffect, useState } from 'react';
import UserAvatar from '../UserAvatar.jsx';
import UserPicker from '../shop/UserPicker.jsx';
import {
  adminListInstances, adminCreateInstance, adminUpdateInstance, adminDeleteInstance,
  adminAddInstanceMember, adminRemoveInstanceMember,
} from '../../api/endpoints';
import { errText } from '../../api/community';
import '../../styles/shop.css';
import '../../styles/instances-admin.css';

// Painel da Equipe → Instâncias. Cada instância tem as próprias categorias,
// canais de texto e calls; a Pública é de todo mundo e as outras só de quem
// for liberado aqui. Administradores entram em todas.
export default function InstancesAdmin() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(null);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => adminListInstances()
    .then((d) => {
      setData(d);
      setSelected((cur) => (cur && d.instances.some((i) => i.id === cur) ? cur : d.instances[0]?.id || null));
    })
    .catch((e) => setError(errText(e, 'Não deu pra carregar as instâncias.'))), []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn) => {
    setBusy(true);
    setError('');
    try { await fn(); await load(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };

  const create = (e) => {
    e.preventDefault();
    if (!newName.trim()) return;
    run(async () => {
      const { instance } = await adminCreateInstance({ name: newName.trim(), icon: newIcon.trim() || null });
      setNewName(''); setNewIcon('');
      setSelected(instance.id);
    });
  };

  if (!data) return error ? <p className="inst-error" role="alert">{error}</p> : <p className="staff-empty">Carregando…</p>;
  const inst = data.instances.find((i) => i.id === selected);

  return (
    <div className="inst-admin">
      <p className="inst-intro">
        Cada instância tem <strong>as próprias categorias, canais de texto e calls</strong>. Os canais em destaque,
        DMs, Loja e o resto do app são iguais em todas. A <strong>Pública</strong> é de todo mundo; nas outras só
        entra quem você liberar aqui. Quem tem acesso troca de instância pelo seletor ao lado de “Comunidade”, no topo.
      </p>

      <div className="inst-layout">
        <aside className="inst-list" aria-label="Instâncias">
          <div className="inst-card is-public" aria-disabled="true">
            <span className="inst-card-icon">{data.public.icon}</span>
            <span className="inst-card-text">
              <strong>{data.public.name}</strong>
              <small>Todo mundo · {data.public.categories} categorias · {data.public.channels} canais</small>
            </span>
          </div>
          {data.instances.map((i) => (
            <button
              key={i.id} type="button"
              className={`inst-card${selected === i.id ? ' active' : ''}`}
              onClick={() => setSelected(i.id)}
            >
              <span className="inst-card-icon">{i.icon || '🔒'}</span>
              <span className="inst-card-text">
                <strong>{i.name}</strong>
                <small>{i.members.length} {i.members.length === 1 ? 'pessoa' : 'pessoas'} · {i.categories} categorias · {i.channels} canais</small>
              </span>
            </button>
          ))}
          <form className="inst-new" onSubmit={create}>
            <input className="inst-new-icon" value={newIcon} onChange={(e) => setNewIcon(e.target.value)} placeholder="🙂" aria-label="Emoji da nova instância" maxLength={4} />
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Nova instância" aria-label="Nome da nova instância" maxLength={40} />
            <button type="submit" className="btn-primary" disabled={busy || !newName.trim()}>Criar</button>
          </form>
        </aside>

        {inst ? (
          <InstanceDetail key={inst.id} inst={inst} busy={busy} run={run} onDeleted={() => setSelected(null)} />
        ) : (
          <p className="staff-empty">Crie uma instância pra começar.</p>
        )}
      </div>
      {error && <p className="inst-error" role="alert">{error}</p>}
    </div>
  );
}

function InstanceDetail({ inst, busy, run, onDeleted }) {
  const [name, setName] = useState(inst.name);
  const [icon, setIcon] = useState(inst.icon || '');
  const [picked, setPicked] = useState(null);
  const dirty = name.trim() !== inst.name || (icon.trim() || null) !== (inst.icon || null);
  const memberIds = new Set(inst.members.map((m) => m.user.id));

  const save = () => run(() => adminUpdateInstance(inst.id, { name: name.trim(), icon: icon.trim() || null }));
  const add = () => {
    if (!picked || memberIds.has(picked.id)) return;
    run(async () => { await adminAddInstanceMember(inst.id, { userId: picked.id }); setPicked(null); });
  };
  const remove = (u) => run(() => adminRemoveInstanceMember(inst.id, u.id));
  const del = () => {
    if (!window.confirm(`Apagar a instância "${inst.name}"? Quem estava nela volta pra Pública.`)) return;
    run(async () => { await adminDeleteInstance(inst.id); onDeleted(); });
  };

  return (
    <section className="inst-detail" aria-label={`Instância ${inst.name}`}>
      <div className="inst-detail-head">
        <input className="inst-new-icon" value={icon} onChange={(e) => setIcon(e.target.value)} placeholder="🔒" aria-label="Emoji" maxLength={4} />
        <input className="inst-name-input" value={name} onChange={(e) => setName(e.target.value)} aria-label="Nome da instância" maxLength={40} />
        <button type="button" className="btn-primary" disabled={busy || !dirty || !name.trim()} onClick={save}>Salvar</button>
      </div>
      <p className="inst-meta">
        {inst.categories} categorias · {inst.channels} canais. Pra criar canais nela, troque pra
        “{inst.name}” no seletor do topo e use “Criar categoria”/“Criar canal” como sempre.
      </p>

      <h3 className="inst-subtitle">Quem pode entrar</h3>
      <div className="inst-add">
        <div className="inst-add-picker">
          <UserPicker value={picked} onChange={setPicked} includeSelf placeholder="Nome ou @ de quem vai poder entrar" />
        </div>
        <button type="button" className="btn-primary" disabled={busy || !picked || memberIds.has(picked?.id)} onClick={add}>
          {picked && memberIds.has(picked.id) ? 'Já tem acesso' : 'Liberar acesso'}
        </button>
      </div>

      {inst.members.length === 0 ? (
        <p className="staff-empty">Ninguém liberado ainda — só administradores entram.</p>
      ) : (
        <ul className="inst-members">
          {inst.members.map(({ user }) => (
            <li key={user.id}>
              <UserAvatar user={user} size={32} />
              <span className="inst-member-name">
                <strong>{user.displayName || user.username}</strong>
                <small>@{user.username}{user.platformRole === 'ADMIN' ? ' · administrador' : ''}</small>
              </span>
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => remove(user)} aria-label={`Tirar ${user.displayName || user.username} da instância`}>
                Tirar
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="inst-danger">
        <button type="button" className="btn-danger" disabled={busy} onClick={del}>Apagar instância</button>
        <small>Só dá pra apagar depois de apagar ou mover as categorias e canais dela.</small>
      </div>
    </section>
  );
}
