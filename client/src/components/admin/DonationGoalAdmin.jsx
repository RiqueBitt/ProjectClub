import { useEffect, useState } from 'react';
import { getDonationGoal, updateDonationGoal, listDonationEntries, addDonationEntry, removeDonationEntry } from '../../api/endpoints';
import { brl } from '../../utils/money';
import UiIcon from '../UiIcon.jsx';
import '../../styles/donation-goal.css';

// Painel da equipe → Economia → Meta de doações.
// Define a meta (título, valor, texto) e lança cada doação recebida — a
// barrinha verde no topo da barra lateral atualiza na hora pra todo mundo.
const reais = (cents) => ((Number(cents) || 0) / 100).toFixed(2).replace('.', ',');
const parseReais = (txt) => Number(String(txt).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.'));

export default function DonationGoalAdmin() {
  const [goal, setGoal] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', target: '', enabled: false, showDonors: true });
  const [entries, setEntries] = useState([]);
  const [add, setAdd] = useState({ amount: '', donorName: '', note: '' });
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const apply = (g) => {
    setGoal(g);
    setForm({ title: g.title || '', description: g.description || '', target: g.target ? reais(g.target) : '', enabled: !!g.enabled, showDonors: g.showDonors !== false });
  };
  const loadEntries = () => listDonationEntries().then((d) => setEntries(d.entries || [])).catch(() => {});
  useEffect(() => { getDonationGoal().then(apply).catch(() => {}); loadEntries(); }, []);

  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 2500); };
  const run = async (fn, ok) => {
    setBusy(true);
    try { const g = await fn(); if (g) apply(g); await loadEntries(); flash(ok); } catch (e) { flash(e?.response?.data?.error || 'Não deu certo. Tente de novo.'); } finally { setBusy(false); }
  };

  const save = (e) => {
    e.preventDefault();
    const target = parseReais(form.target);
    if (!(target > 0)) { flash('Coloque o valor da meta.'); return; }
    run(() => updateDonationGoal({ title: form.title, description: form.description, target, enabled: form.enabled, showDonors: form.showDonors }), 'Meta salva.');
  };
  const addDonation = (e) => {
    e.preventDefault();
    const amount = parseReais(add.amount);
    if (!amount) { flash('Coloque o valor da doação.'); return; }
    run(async () => { const g = await addDonationEntry({ amount, donorName: add.donorName, note: add.note }); setAdd({ amount: '', donorName: '', note: '' }); return g; }, 'Doação adicionada.');
  };
  const undo = (entry) => {
    if (!window.confirm(`Desfazer o lançamento de ${brl(entry.amount)}${entry.donorName ? ` (${entry.donorName})` : ''}?`)) return;
    run(() => removeDonationEntry(entry.id), 'Lançamento desfeito.');
  };
  const reset = () => {
    if (!window.confirm('Zerar o valor arrecadado? O histórico continua guardado.')) return;
    run(() => updateDonationGoal({ resetRaised: true }), 'Arrecadado zerado.');
  };

  const pct = goal?.target ? Math.min(100, (goal.raised / goal.target) * 100) : 0;

  return (
    <div className="dga">
      <section className="settings-block">
        <h3>Prévia</h3>
        <div className="dga-preview">
          <div className="dg">
            <div className="dg-head"><span className="dg-title"><span className="truncate">{form.title || 'Meta do mês'}</span></span><span className="dg-pct">{Math.floor(pct)}%</span></div>
            <div className="dg-track"><div className="dg-fill" style={{ width: `${Math.max(pct, goal?.raised > 0 ? 3 : 0)}%` }} /></div>
            <div className="dg-amounts"><b>{brl(goal?.raised || 0)}</b><span>de {brl(goal?.target || 0)}</span></div>
          </div>
          <p className="dim">{goal?.enabled ? 'Aparecendo para todos, entre o banner e o menu.' : 'Desligada: ninguém está vendo a barra.'}</p>
        </div>
      </section>

      <form className="settings-block dga-form" onSubmit={save}>
        <h3>Meta</h3>
        <label className="dga-check"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Mostrar a barra para todos</label>
        <label>Título<input value={form.title} maxLength={80} placeholder="Meta do mês" onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <label>Valor da meta (R$)<input inputMode="decimal" value={form.target} placeholder="300,00" onChange={(e) => setForm({ ...form, target: e.target.value })} /></label>
        <label>Texto (aparece ao clicar na barra)<textarea rows={2} maxLength={200} value={form.description} placeholder="Ex.: pagar o servidor de voz e o domínio deste mês" onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <label className="dga-check"><input type="checkbox" checked={form.showDonors} onChange={(e) => setForm({ ...form, showDonors: e.target.checked })} /> Mostrar os nomes das últimas doações</label>
        <div className="dga-actions">
          <button type="submit" className="btn-primary" disabled={busy}>Salvar meta</button>
          <button type="button" className="btn-secondary" disabled={busy || !goal?.raised} onClick={reset}>Zerar arrecadado</button>
          {msg && <span className="dga-msg" role="status">{msg}</span>}
        </div>
      </form>

      <form className="settings-block dga-form" onSubmit={addDonation}>
        <h3>Adicionar doação</h3>
        <div className="dga-row">
          <label>Valor (R$)<input inputMode="decimal" value={add.amount} placeholder="25,00" onChange={(e) => setAdd({ ...add, amount: e.target.value })} /></label>
          <label>Nome de quem doou (opcional)<input value={add.donorName} maxLength={60} placeholder="Anônimo" onChange={(e) => setAdd({ ...add, donorName: e.target.value })} /></label>
        </div>
        <label>Observação (só a equipe vê)<input value={add.note} maxLength={200} placeholder="Ex.: Pix de 17/10" onChange={(e) => setAdd({ ...add, note: e.target.value })} /></label>
        <div className="dga-actions">
          <button type="submit" className="btn-primary" disabled={busy}><UiIcon name="plus" size={16} /> Adicionar</button>
          <span className="dim">Para corrigir, use um valor negativo ou desfaça na lista abaixo.</span>
        </div>
      </form>

      <section className="settings-block">
        <h3>Histórico</h3>
        {entries.length === 0 ? <p className="dim">Nenhuma doação lançada ainda.</p> : (
          <ul className="dga-list">
            {entries.map((e) => (
              <li key={e.id}>
                <b className={e.amount < 0 ? 'neg' : ''}>{brl(e.amount)}</b>
                <span className="dga-who">{e.donorName || 'Anônimo'}{e.note && <span className="dim"> · {e.note}</span>}</span>
                <span className="dim dga-meta">{new Date(e.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}{e.actorName ? ` · ${e.actorName}` : ''}</span>
                <button type="button" className="btn-link dga-undo" onClick={() => undo(e)} disabled={busy}>Desfazer</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
