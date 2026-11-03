import { useEffect, useMemo, useState } from 'react';
import { getInterestRoles, setMyInterestRoles, errText } from '../../api/community';
import { EmptyState, Ico, Skeleton } from '../PagesKit.jsx';
import { SectionCard, useFlash } from './CommunityBits.jsx';

// Cargos por interesse: a pessoa escolhe os seus (ex.: jogos que curte).
// A lista vem do servidor — só cargos que a staff marcou e que não dão
// nenhuma permissão.
export default function InterestsTab() {
  const [roles, setRoles] = useState(null);
  const [max, setMax] = useState(15);
  const [picked, setPicked] = useState(new Set());
  const [saved, setSaved] = useState(new Set());
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');
  const [flash, show] = useFlash();

  useEffect(() => {
    getInterestRoles().then((d) => {
      setRoles(d.roles); setMax(d.max);
      const sel = new Set(d.roles.filter((r) => r.selected).map((r) => r.id));
      setPicked(sel); setSaved(sel);
    }).catch(() => setRoles([]));
  }, []);

  const dirty = useMemo(() => picked.size !== saved.size || [...picked].some((id) => !saved.has(id)), [picked, saved]);
  const toggle = (id) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else if (n.size < max) n.add(id);
    else show(`Escolha no máximo ${max} interesses.`, 'bad');
    return n;
  });
  const save = async () => {
    setBusy(true);
    try {
      await setMyInterestRoles([...picked]);
      setSaved(new Set(picked));
      show('Interesses salvos! Eles já aparecem no seu perfil.');
    } catch (e) { show(errText(e), 'bad'); } finally { setBusy(false); }
  };
  const shown = (roles || []).filter((r) => !q.trim() || r.name.toLowerCase().includes(q.trim().toLowerCase()));

  return (
    <SectionCard
      icon="tag" title="Seus interesses"
      aside={<button type="button" className="pk-btn primary sm" disabled={!dirty || busy} onClick={save}>{busy ? 'Salvando…' : 'Salvar'}</button>}
    >
      <p className="pk-muted">Escolha os jogos e assuntos que você curte. Vira um cargo no seu perfil e ajuda a galera a te achar (dá pra ser mencionado quando alguém chamar pra jogar).</p>
      {roles === null && <Skeleton rows={2} height={44} />}
      {roles?.length === 0 && <EmptyState compact icon="tag" title="Nenhum interesse disponível" text="A equipe ainda não criou cargos de interesse." />}
      {roles?.length > 8 && (
        <label className="c4-search">
          <Ico name="search" size={16} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Procurar interesse" aria-label="Procurar interesse" />
        </label>
      )}
      {shown.length > 0 && (
        <div className="c4-chips" role="group" aria-label="Interesses">
          {shown.map((r) => {
            const on = picked.has(r.id);
            return (
              <button
                key={r.id} type="button" className={`c4-interest ${on ? 'on' : ''}`} aria-pressed={on} onClick={() => toggle(r.id)}
                style={{ '--tint': r.color && !String(r.color).startsWith('linear') ? r.color : undefined }}
              >
                {on ? <Ico name="check" size={14} /> : <span className="c4-dot" />} {r.name}
              </button>
            );
          })}
        </div>
      )}
      {roles?.length > 0 && <p className="c4-small">{picked.size} de {max} escolhidos.</p>}
      {flash}
    </SectionCard>
  );
}
