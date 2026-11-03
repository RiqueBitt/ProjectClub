import { useEffect, useState } from 'react';
import {
  adminListCoupons, adminCreateCoupon, adminSetCouponActive,
  adminListGoals, adminSaveGoal, adminRemoveGoal, setRoleInterestFlag, errText,
} from '../../api/community';
import { listRoles } from '../../api/endpoints';
import '../../styles/community4.css';

// Painel da equipe — ferramentas da Fase 4: cupons da Loja, metas coletivas
// da semana e cargos por interesse. O servidor confere permissão de tudo.

function useMsg() {
  const [msg, setMsg] = useState('');
  const flash = (t) => { setMsg(t); setTimeout(() => setMsg(''), 3000); };
  return [msg, flash];
}

// ---------- Cupons ----------
const EMPTY_COUPON = { code: '', kind: 'PERCENT', value: '', maxUses: '', minPrice: '', expiresAt: '', note: '' };

function couponStatus(c) {
  if (!c.active) return 'Desativado';
  if (c.expiresAt && new Date(c.expiresAt) <= new Date()) return 'Vencido';
  if (c.maxUses !== null && c.uses >= c.maxUses) return 'Esgotado';
  return 'Ativo';
}

export function CouponsAdmin() {
  const [list, setList] = useState(null);
  const [form, setForm] = useState(EMPTY_COUPON);
  const [busy, setBusy] = useState(false);
  const [msg, flash] = useMsg();
  const load = () => adminListCoupons().then((d) => setList(d.coupons)).catch((e) => { setList([]); flash(errText(e)); });
  useEffect(() => { load(); }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const create = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminCreateCoupon({
        ...form, code: form.code.trim().toUpperCase(), value: Number(form.value),
        maxUses: form.maxUses ? Number(form.maxUses) : null, minPrice: form.minPrice ? Number(form.minPrice) : null,
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : null,
      });
      setForm(EMPTY_COUPON);
      flash('Cupom criado.');
      load();
    } catch (err) { flash(errText(err)); } finally { setBusy(false); }
  };
  const toggle = async (c) => {
    try { await adminSetCouponActive(c.id, !c.active); load(); } catch (err) { flash(errText(err)); }
  };

  return (
    <div className="c4-admin">
      <form className="settings-block c4-admin-form" onSubmit={create}>
        <h3>Novo cupom</h3>
        <p className="dim">Vale nas compras com moedas da Loja (itens e coleções). Cada pessoa usa cada cupom uma vez só.</p>
        <div className="c4-admin-grid">
          <label>Código<input value={form.code} onChange={set('code')} maxLength={32} placeholder="NATAL25" required /></label>
          <label>Tipo
            <select value={form.kind} onChange={set('kind')}>
              <option value="PERCENT">Porcentagem (%)</option>
              <option value="FIXED">Valor fixo (moedas)</option>
            </select>
          </label>
          <label>{form.kind === 'PERCENT' ? 'Desconto (%)' : 'Desconto (moedas)'}<input type="number" min={1} max={form.kind === 'PERCENT' ? 100 : undefined} value={form.value} onChange={set('value')} required /></label>
          <label>Limite de usos <small>(vazio = sem limite)</small><input type="number" min={1} value={form.maxUses} onChange={set('maxUses')} /></label>
          <label>Compra mínima <small>(moedas)</small><input type="number" min={1} value={form.minPrice} onChange={set('minPrice')} /></label>
          <label>Validade <small>(vazio = não vence)</small><input type="datetime-local" value={form.expiresAt} onChange={set('expiresAt')} /></label>
        </div>
        <label>Anotação interna<input value={form.note} onChange={set('note')} maxLength={120} placeholder="Ex.: sorteio da live de sexta" /></label>
        <div className="c4-form-actions"><button type="submit" className="btn-primary" disabled={busy}>Criar cupom</button></div>
        {msg && <p className="c4-admin-msg" role="status">{msg}</p>}
      </form>
      <section className="settings-block">
        <h3>Cupons</h3>
        {list === null && <p className="dim">Carregando…</p>}
        {list?.length === 0 && <p className="dim">Nenhum cupom criado ainda.</p>}
        {list?.length > 0 && (
          <div className="c4-table-wrap">
            <table className="c4-table">
              <thead><tr><th>Código</th><th>Desconto</th><th>Usos</th><th>Validade</th><th>Status</th><th /></tr></thead>
              <tbody>
                {list.map((c) => (
                  <tr key={c.id}>
                    <td><code>{c.code}</code>{c.note && <small className="dim"> · {c.note}</small>}</td>
                    <td>{c.kind === 'PERCENT' ? `${c.value}%` : `${c.value} moedas`}{c.minPrice ? ` (mín. ${c.minPrice})` : ''}</td>
                    <td>{c.uses}{c.maxUses !== null ? ` / ${c.maxUses}` : ''}</td>
                    <td>{c.expiresAt ? new Date(c.expiresAt).toLocaleString('pt-BR') : '—'}</td>
                    <td>{couponStatus(c)}</td>
                    <td><button type="button" className="btn-secondary" onClick={() => toggle(c)}>{c.active ? 'Desativar' : 'Reativar'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

// ---------- Metas coletivas ----------
const METRIC_LABEL = { MESSAGES: 'Mensagens', VOICE_MINUTES: 'Minutos em call', FORUM_POSTS: 'Posts no Fórum' };

export function GoalsAdmin() {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({ week: 'current', metric: 'MESSAGES', target: '', rewardCoins: '40', title: '' });
  const [busy, setBusy] = useState(false);
  const [msg, flash] = useMsg();
  const load = () => adminListGoals().then(setData).catch((e) => { setData({ goals: [] }); flash(errText(e)); });
  useEffect(() => { load(); }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await adminSaveGoal({ ...form, target: Number(form.target), rewardCoins: Number(form.rewardCoins || 0) });
      flash('Meta salva.');
      load();
    } catch (err) { flash(errText(err)); } finally { setBusy(false); }
  };
  const remove = async (g) => {
    if (!window.confirm('Remover essa meta?')) return;
    try { await adminRemoveGoal(g.id); load(); } catch (err) { flash(errText(err)); }
  };
  const edit = (g) => setForm({ week: g.weekKey === data.next ? 'next' : 'current', metric: g.metric, target: String(g.target), rewardCoins: String(g.rewardCoins), title: g.title || '' });

  return (
    <div className="c4-admin">
      <form className="settings-block c4-admin-form" onSubmit={save}>
        <h3>Definir meta</h3>
        <p className="dim">Uma meta por tipo por semana (salvar de novo o mesmo tipo edita). Sem metas definidas, a semana usa as padrão. Quem participar da semana ganha a recompensa de cada meta batida.</p>
        <div className="c4-admin-grid">
          <label>Semana
            <select value={form.week} onChange={set('week')}>
              <option value="current">Esta semana ({data?.current || '…'})</option>
              <option value="next">Próxima semana ({data?.next || '…'})</option>
            </select>
          </label>
          <label>Tipo
            <select value={form.metric} onChange={set('metric')}>
              {Object.entries(METRIC_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Meta<input type="number" min={1} value={form.target} onChange={set('target')} required /></label>
          <label>Recompensa (moedas)<input type="number" min={0} max={1000} value={form.rewardCoins} onChange={set('rewardCoins')} /></label>
        </div>
        <label>Título<input value={form.title} onChange={set('title')} maxLength={120} placeholder="Ex.: Semana do bate-papo" /></label>
        <div className="c4-form-actions"><button type="submit" className="btn-primary" disabled={busy}>Salvar meta</button></div>
        {msg && <p className="c4-admin-msg" role="status">{msg}</p>}
      </form>
      <section className="settings-block">
        <h3>Metas desta semana e da próxima</h3>
        {!data && <p className="dim">Carregando…</p>}
        {data?.goals?.length === 0 && <p className="dim">Nenhuma meta.</p>}
        <ul className="c4-list">
          {(data?.goals || []).map((g) => (
            <li key={g.id} className="c4-list-row">
              <div className="c4-list-main">
                <strong>{g.title || METRIC_LABEL[g.metric]}</strong>
                <small>{g.weekKey} · {METRIC_LABEL[g.metric]}: {g.target.toLocaleString('pt-BR')} · {g.rewardCoins} moedas{g.reachedAt ? ' · batida' : ''}{g.rewardedAt ? ' · paga' : ''}</small>
              </div>
              {!g.rewardedAt && <button type="button" className="btn-secondary" onClick={() => edit(g)}>Editar</button>}
              {!g.rewardedAt && <button type="button" className="btn-secondary" onClick={() => remove(g)}>Remover</button>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------- Cargos por interesse ----------
export function InterestRolesAdmin() {
  const [roles, setRoles] = useState(null);
  const [busy, setBusy] = useState('');
  const [msg, flash] = useMsg();
  const load = () => listRoles().then((d) => setRoles((d.roles || []).filter((r) => !r.isDefault))).catch(() => setRoles([]));
  useEffect(() => { load(); }, []);
  const toggle = async (r) => {
    setBusy(r.id);
    try {
      await setRoleInterestFlag(r.id, !r.selfAssignable);
      flash(!r.selfAssignable ? `"${r.name}" agora é um cargo de interesse.` : `"${r.name}" não é mais de interesse.`);
      load();
    } catch (err) { flash(errText(err)); } finally { setBusy(''); }
  };
  const hasPerms = (r) => { try { return BigInt(r.permissions || '0') !== 0n; } catch { return true; } };
  return (
    <div className="c4-admin">
      <section className="settings-block">
        <h3>Cargos por interesse</h3>
        <p className="dim">Os membros escolhem esses cargos sozinhos em Participar → Interesses (ex.: jogos que curtem). Por segurança, só cargos <b>sem nenhuma permissão</b> podem ser de interesse — se você der permissão a um deles depois, ele deixa de ser de interesse automaticamente.</p>
        {msg && <p className="c4-admin-msg" role="status">{msg}</p>}
        {roles === null && <p className="dim">Carregando…</p>}
        <ul className="c4-list">
          {(roles || []).map((r) => (
            <li key={r.id} className="c4-list-row">
              <span className="c4-role-dot" style={{ background: String(r.color || '').startsWith('linear') ? r.color : r.color || '#99AAB5' }} />
              <div className="c4-list-main">
                <strong>{r.name}</strong>
                <small>{hasPerms(r) ? 'Tem permissões — não pode ser de interesse' : r.selfAssignable ? 'Cargo de interesse' : 'Cargo normal'}</small>
              </div>
              <button type="button" className={r.selfAssignable ? 'btn-secondary' : 'btn-primary'} disabled={busy === r.id || (hasPerms(r) && !r.selfAssignable)} onClick={() => toggle(r)}>
                {r.selfAssignable ? 'Tirar de interesse' : 'Marcar como interesse'}
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
