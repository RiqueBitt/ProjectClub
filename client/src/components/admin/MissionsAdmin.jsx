import { useEffect, useState } from 'react';
import { adminListMissions, adminCreateMission, adminUpdateMission, adminDeleteMission } from '../../api/endpoints';
import { ShopItemSelect } from '../shop/ShopAdminExtras.jsx';
import '../../styles/missions-admin.css';
import '../../styles/shop.css';

// Admin → Economia → Missões: a staff cria, edita, liga/desliga e exclui
// as missões diárias e semanais. Cada campo salva sozinho ao sair dele.
const PERIOD_LABEL = { DAILY: 'Diária', WEEKLY: 'Semanal' };
const EMPTY = { title: '', description: '', period: 'DAILY', type: 'MESSAGES', target: 10, rewardCoins: 20, rewardGems: 0, rewardXp: 0 };

function NumberField({ label, value, onCommit, min = 0 }) {
  return (
    <label className="ma-field ma-num">
      <span>{label}</span>
      <input type="number" min={min} defaultValue={value} onBlur={(e) => { const v = parseInt(e.target.value, 10); if (v !== value) onCommit(Number.isFinite(v) ? v : min); }} />
    </label>
  );
}

export default function MissionsAdmin() {
  const [data, setData] = useState(null); // { missions, types, periods }
  const [draft, setDraft] = useState(EMPTY);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [savedId, setSavedId] = useState(null);

  const refresh = () => adminListMissions().then(setData).catch((e) => setError(e?.response?.data?.error || 'Não foi possível carregar as missões.'));
  useEffect(() => { refresh(); }, []);

  const flashSaved = (id) => { setSavedId(id); setTimeout(() => setSavedId((cur) => (cur === id ? null : cur)), 1500); };

  const update = async (m, patch) => {
    setError('');
    try {
      await adminUpdateMission(m.id, patch);
      flashSaved(m.id);
      refresh();
    } catch (e) { setError(e?.response?.data?.error || 'Não foi possível salvar.'); }
  };

  const remove = async (m) => {
    if (!confirm(`Excluir a missão "${m.title}"? O progresso dela também some.`)) return;
    try { await adminDeleteMission(m.id); refresh(); } catch (e) { setError(e?.response?.data?.error || 'Não foi possível excluir.'); }
  };

  const create = async (e) => {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      await adminCreateMission(draft);
      setDraft(EMPTY);
      refresh();
    } catch (err) { setError(err?.response?.data?.error || 'Não foi possível criar.'); } finally { setCreating(false); }
  };

  const types = data?.types || {};
  const typeOptions = Object.entries(types);

  return (
    <section className="ma">
      <h4>Missões diárias e semanais</h4>
      <p className="dim" style={{ fontSize: 13 }}>
        Assinantes ganham 1,2x e Super Assinantes 1,5x das moedas de cada missão. Dá pra dar um item da Loja (com prazo) como recompensa.
        O progresso é contado sozinho pelo servidor (mensagens em canais, reações, minutos em call com outra pessoa, posts e comentários no Fórum, visita à Loja, baú diário).
        Diárias renovam à meia-noite e semanais na segunda-feira (horário de Brasília). Mudanças valem na hora para todo mundo.
      </p>
      {error && <div className="ma-error" role="alert">{error}</div>}

      <form className="ma-create" onSubmit={create}>
        <label className="ma-field ma-grow">
          <span>Nome</span>
          <input value={draft.title} maxLength={120} placeholder="Ex.: Bate-papo do dia" onChange={(e) => setDraft({ ...draft, title: e.target.value })} required />
        </label>
        <label className="ma-field">
          <span>Período</span>
          <select value={draft.period} onChange={(e) => setDraft({ ...draft, period: e.target.value })}>
            <option value="DAILY">Diária</option><option value="WEEKLY">Semanal</option>
          </select>
        </label>
        <label className="ma-field">
          <span>Tipo</span>
          <select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value })}>
            {typeOptions.map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
          </select>
        </label>
        <label className="ma-field ma-num"><span>Meta</span><input type="number" min={1} value={draft.target} onChange={(e) => setDraft({ ...draft, target: e.target.value })} /></label>
        <label className="ma-field ma-num"><span>Moedas</span><input type="number" min={0} value={draft.rewardCoins} onChange={(e) => setDraft({ ...draft, rewardCoins: e.target.value })} /></label>
        <label className="ma-field ma-num"><span>Gemas</span><input type="number" min={0} value={draft.rewardGems} onChange={(e) => setDraft({ ...draft, rewardGems: e.target.value })} /></label>
        <label className="ma-field ma-num"><span>XP</span><input type="number" min={0} value={draft.rewardXp} onChange={(e) => setDraft({ ...draft, rewardXp: e.target.value })} /></label>
        <label className="ma-field ma-full">
          <span>Descrição (opcional)</span>
          <input value={draft.description} maxLength={500} placeholder="Ex.: Mande 10 mensagens nos canais." onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </label>
        <button type="submit" className="btn-primary ma-add" disabled={creating || !draft.title.trim()}>{creating ? 'Criando...' : '+ Criar missão'}</button>
      </form>

      {!data ? <div className="dim">Carregando...</div> : data.missions.length === 0 ? (
        <div className="dim">Nenhuma missão ainda. Crie a primeira acima.</div>
      ) : (
        <div className="ma-list">
          {data.missions.map((m) => (
            <div key={m.id} className={`ma-card${m.enabled ? '' : ' off'}`}>
              <div className="ma-card-head">
                <span className={`ma-period ${m.period === 'WEEKLY' ? 'weekly' : ''}`}>{PERIOD_LABEL[m.period] || m.period}</span>
                <input className="ma-title" defaultValue={m.title} maxLength={120} aria-label="Nome da missão" onBlur={(e) => { if (e.target.value.trim() && e.target.value !== m.title) update(m, { title: e.target.value }); }} />
                {savedId === m.id && <span className="ma-saved">Salvo</span>}
              </div>
              <input className="ma-desc" defaultValue={m.description || ''} maxLength={500} placeholder="Descrição" aria-label="Descrição" onBlur={(e) => { if (e.target.value !== (m.description || '')) update(m, { description: e.target.value }); }} />
              <div className="ma-row">
                <label className="ma-field">
                  <span>Período</span>
                  <select value={m.period} onChange={(e) => update(m, { period: e.target.value })}>
                    <option value="DAILY">Diária</option><option value="WEEKLY">Semanal</option>
                  </select>
                </label>
                <label className="ma-field">
                  <span>Tipo</span>
                  <select value={m.type} onChange={(e) => update(m, { type: e.target.value })}>
                    {typeOptions.map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
                  </select>
                </label>
                <NumberField label="Meta" value={m.target} min={1} onCommit={(v) => update(m, { target: v })} />
                <NumberField label="Moedas" value={m.rewardCoins} onCommit={(v) => update(m, { rewardCoins: v })} />
                <NumberField label="Gemas" value={m.rewardGems} onCommit={(v) => update(m, { rewardGems: v })} />
                <NumberField label="XP" value={m.rewardXp} onCommit={(v) => update(m, { rewardXp: v })} />
                <NumberField label="Ordem" value={m.position} onCommit={(v) => update(m, { position: v })} />
              </div>
              <details className="ma-item-reward" open={!!m.rewardItemId}>
                <summary>Item da Loja como recompensa{m.rewardItemId ? ' (ligado)' : ' (opcional)'}</summary>
                <ShopItemSelect
                  value={m.rewardItemId ? { kind: m.rewardItemKind, id: m.rewardItemId } : null}
                  onChange={(it) => update(m, it ? { rewardItemKind: it.kind, rewardItemId: it.id } : { rewardItemKind: null, rewardItemId: null })}
                />
                {m.rewardItemId && <NumberField label="Dias com o item (0 = pra sempre)" value={m.rewardItemDays || 0} onCommit={(v) => update(m, { rewardItemDays: v || null })} />}
              </details>
              <div className="ma-card-foot">
                <label className="checkbox-row"><input type="checkbox" checked={m.enabled} onChange={(e) => update(m, { enabled: e.target.checked })} /> Ativa</label>
                <button type="button" className="btn-link danger" onClick={() => remove(m)}>Excluir</button>
              </div>
            </div>
          ))}
        </div>
      )}
      <hr className="ma-sep" />
    </section>
  );
}
