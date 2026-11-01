import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../../api/client';
import {
  adminBanUser, adminUnbanUser, adminSuspendUser, adminUnsuspendUser, adminSetPlatformRole,
} from '../../api/endpoints';
import { useLiveRefresh } from '../../utils/liveRefresh';
import { useStore } from '../../store/useStore';
import UserAvatar from '../UserAvatar.jsx';
import UserSecurityInfoModal from '../modals/UserSecurityInfoModal.jsx';
import '../../styles/staff-tools.css';

// Ferramentas novas do Painel da Equipe:
//  - StaffHealthTab: "Saúde" do servidor (online, conexões, chamadas,
//    erros recentes, banco/Redis, memória) — atualiza a cada 15s.
//  - StaffUserSearchTab + StaffUserDrawer: busca rápida de usuário e
//    gaveta com a ficha completa e as ações de sempre (mesmas rotas).

// Ícones de traço (sem emoji).
const PATHS = {
  pulse: 'M3 12h4l2-6 4 12 2-6h6',
  db: 'M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Zm-8 3v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  bolt: 'M13 3 5 13h6l-1 8 8-10h-6l1-8Z',
  users: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM21 19v-1a4 4 0 0 0-3-3.87M15.5 4.13a3 3 0 0 1 0 5.74',
  plug: 'M9 3v5M15 3v5M7 8h10v3a5 5 0 0 1-10 0V8ZM12 16v5',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z',
  chip: 'M8 8h8v8H8zM4 10h2M4 14h2M18 10h2M18 14h2M10 4v2M14 4v2M10 18v2M14 18v2',
  clock: 'M12 7v5l3 2M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z',
  alert: 'M12 9v4M12 17h.01M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z',
  refresh: 'M20 11a8 8 0 0 0-14.9-3.9L4 9M4 4v5h5M4 13a8 8 0 0 0 14.9 3.9L20 15M20 20v-5h-5',
  search: 'm20 20-4.2-4.2M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14Z',
  close: 'M6 6l12 12M18 6 6 18',
  copy: 'M9 9h10v10H9zM5 15V5h10',
  shield: 'M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6l-7-3Z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM4 21a8 8 0 0 1 16 0',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  check: 'm5 12 5 5 9-10',
};
function Ic({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

const nf = (n) => (typeof n === 'number' ? n.toLocaleString('pt-BR') : '—');

function formatUptime(sec) {
  if (!Number.isFinite(sec)) return '—';
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return 'agora';
  if (diff < 3600) return `há ${Math.floor(diff / 60)} min`;
  if (diff < 86400) return `há ${Math.floor(diff / 3600)} h`;
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}

const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

// ============================================================
// Saúde
// ============================================================
const ERROR_KIND = { server: 'Servidor', client: 'Tela', process: 'Processo' };
const STATUS_ROWS = [
  { key: 'ONLINE', label: 'Online' },
  { key: 'IDLE', label: 'Ausente' },
  { key: 'DND', label: 'Não perturbe' },
  { key: 'INVISIBLE', label: 'Invisível' },
  { key: 'OFFLINE', label: 'Offline' },
];

function latencyLevel(check, slowMs) {
  if (!check) return 'unknown';
  if (!check.ok) return 'bad';
  return check.ms > slowMs ? 'warn' : 'good';
}

function PingCard({ icon, title, check, slowMs, extra }) {
  const level = latencyLevel(check, slowMs);
  return (
    <div className={`sth-ping sth-${level}`}>
      <span className="sth-ping-icon"><Ic name={icon} size={18} /></span>
      <div className="sth-ping-body">
        <span className="sth-ping-title">{title}</span>
        {!check && <strong className="sth-ping-value">—</strong>}
        {check?.ok && <strong className="sth-ping-value">{check.ms} ms</strong>}
        {check && !check.ok && <strong className="sth-ping-value">Sem resposta</strong>}
        {check && !check.ok && check.error && <span className="sth-ping-extra">{check.error}</span>}
        {extra && <span className="sth-ping-extra">{extra}</span>}
      </div>
      <span className="sth-dot" aria-hidden="true" />
    </div>
  );
}

export function StaffHealthTab() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [, setTick] = useState(0);

  const load = useCallback(() => api.get('/admin/health').then((r) => { setData(r.data); setError(''); }), []);
  const refresh = () => {
    setLoading(true);
    load().catch((err) => setError(err.response?.data?.error || 'Não foi possível carregar a saúde do servidor.')).finally(() => setLoading(false));
  };
  useEffect(() => { refresh(); }, []);
  // Atualiza sozinho a cada 15s enquanto a aba está aberta.
  useLiveRefresh((ctx) => load().then(() => { if (ctx.ok()) setError(''); }), { interval: 15000 });
  // Relógio do "atualizado há".
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 5000); return () => clearInterval(t); }, []);

  const p = data?.process;
  const calls = data?.calls;
  const totalCalls = calls ? calls.channels + calls.dms + calls.clans : null;
  const memPct = p ? Math.min(100, Math.round((p.heapUsedMb / Math.max(1, p.heapTotalMb)) * 100)) : 0;

  return (
    <div className="sth">
      <div className="sth-toolbar">
        <span className="sth-live"><span className="sth-live-dot" aria-hidden="true" /> Ao vivo, a cada 15s</span>
        {data && <span className="sth-updated">Atualizado {timeAgo(data.at)}</span>}
        <button type="button" className="sth-btn" onClick={refresh} disabled={loading}>
          <Ic name="refresh" size={15} /> Atualizar agora
        </button>
      </div>

      {error && <div className="sth-error-banner"><Ic name="alert" size={16} /> {error}</div>}

      {!data && !error && (
        <div className="sth-skeleton" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((i) => <span key={i} />)}</div>
      )}

      {data && (
        <>
          <section className="sth-pings">
            <PingCard icon="db" title="Banco de dados" check={data.db} slowMs={150} />
            <PingCard icon="bolt" title="Redis" check={data.redis} slowMs={60} extra={data.redis?.status && data.redis.status !== 'ready' ? `Estado: ${data.redis.status}` : null} />
          </section>

          <section className="sth-grid">
            <div className="sth-card">
              <span className="sth-card-icon"><Ic name="users" size={18} /></span>
              <span className="sth-card-label">Online agora</span>
              <strong className="sth-card-value">{nf(data.presence?.online)}</strong>
              <span className="sth-card-hint">pessoas com o app aberto</span>
            </div>
            <div className="sth-card">
              <span className="sth-card-icon"><Ic name="plug" size={18} /></span>
              <span className="sth-card-label">Conexões</span>
              <strong className="sth-card-value">{nf(data.sockets?.connected)}</strong>
              <span className="sth-card-hint">abas e apps conectados</span>
            </div>
            <div className="sth-card">
              <span className="sth-card-icon"><Ic name="phone" size={18} /></span>
              <span className="sth-card-label">Chamadas ativas</span>
              <strong className="sth-card-value">{nf(totalCalls)}</strong>
              <span className="sth-card-hint">
                {calls ? `${nf(calls.participants)} pessoa(s) em call` : 'sem dados de voz'}
              </span>
            </div>
            <div className="sth-card">
              <span className="sth-card-icon"><Ic name="chip" size={18} /></span>
              <span className="sth-card-label">Memória</span>
              <strong className="sth-card-value">{p ? `${nf(p.rssMb)} MB` : '—'}</strong>
              <span className="sth-meter" aria-hidden="true"><span style={{ width: `${memPct}%` }} /></span>
              <span className="sth-card-hint">{p ? `heap ${nf(p.heapUsedMb)} de ${nf(p.heapTotalMb)} MB` : ''}</span>
            </div>
            <div className="sth-card">
              <span className="sth-card-icon"><Ic name="clock" size={18} /></span>
              <span className="sth-card-label">No ar há</span>
              <strong className="sth-card-value">{formatUptime(p?.uptimeSec)}</strong>
              <span className="sth-card-hint">{p ? `Node ${p.node}` : ''}</span>
            </div>
            <div className="sth-card">
              <span className="sth-card-icon"><Ic name="pulse" size={18} /></span>
              <span className="sth-card-label">Carga do servidor</span>
              <strong className="sth-card-value">{p?.loadAvg ? p.loadAvg[0] : '—'}</strong>
              <span className="sth-card-hint">{p?.cpus ? `média de 1 min, ${p.cpus} núcleo(s)` : 'média de 1 min'}</span>
            </div>
          </section>

          {data.voiceUsage && (
            <section className="sth-section">
              <h2>Minutos de voz no mês</h2>
              <div className="sth-statuses">
                {data.voiceUsage.map((v) => (
                  <div key={v.id} className="sth-status" title={v.unlimited ? 'Sem limite' : v.limit ? `Limite mensal: ${nf(v.limit)} min` : 'Limite não configurado'}>
                    <span className="sth-status-dot" aria-hidden="true" style={{ background: v.limit && v.minutes >= v.limit ? '#ed4245' : v.limit && v.minutes >= v.limit * 0.8 ? '#f0b232' : '#3ba55d' }} />
                    <span>{v.label}</span>
                    <strong>{nf(v.minutes)}{v.limit ? ` / ${nf(v.limit)}` : v.unlimited ? ' · ilimitado' : ''}</strong>
                  </div>
                ))}
              </div>
              {data.push && <p className="sth-hint dim">Push: {nf(data.push.android)} aparelho(s) Android · {nf(data.push.web)} navegador(es)</p>}
            </section>
          )}

          <section className="sth-section">
            <h2>Status das contas</h2>
            <div className="sth-statuses">
              {STATUS_ROWS.map((s) => (
                <div key={s.key} className={`sth-status sth-status-${s.key.toLowerCase()}`}>
                  <span className="sth-status-dot" aria-hidden="true" />
                  <span>{s.label}</span>
                  <strong>{nf(data.presence?.byStatus?.[s.key] || 0)}</strong>
                </div>
              ))}
            </div>
            <p className="sth-note">Status salvo em cada conta. "Online agora" acima conta só quem tem conexão viva neste momento.</p>
          </section>

          <section className="sth-section">
            <div className="sth-section-head">
              <h2>Erros recentes</h2>
              <span className="sth-chip">{nf(data.errors?.lastHour)} na última hora</span>
              <span className="sth-chip sth-chip-muted">{nf(data.errors?.total)} desde o último reinício</span>
            </div>
            {data.errors?.recent?.length ? (
              <ol className="sth-errors">
                {data.errors.recent.map((e, i) => (
                  <li key={`${e.at}-${i}`} className={`sth-err sth-err-${e.kind}`}>
                    <div className="sth-err-head">
                      <span className="sth-err-kind">{ERROR_KIND[e.kind] || e.kind}</span>
                      {e.status && <span className="sth-err-status">{e.status}</span>}
                      <span className="sth-err-where">{e.path || e.where || '—'}</span>
                      <time dateTime={e.at}>{timeAgo(e.at)}</time>
                    </div>
                    <p className="sth-err-msg">{e.message}</p>
                    {e.stack && (
                      <details className="sth-err-stack">
                        <summary>Detalhes técnicos</summary>
                        <pre>{e.stack}</pre>
                      </details>
                    )}
                  </li>
                ))}
              </ol>
            ) : (
              <div className="sth-empty">
                <span className="sth-empty-icon"><Ic name="check" size={20} /></span>
                <strong>Nenhum erro desde o último reinício</strong>
                <span>Erros do servidor e das telas aparecem aqui assim que acontecem.</span>
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

// ============================================================
// Busca rápida de usuário + gaveta de detalhes
// ============================================================
const ROLE_LABEL = { USER: 'Usuário', MODERATOR: 'Moderador', ADMIN: 'Administrador' };

const isFuture = (iso) => !!iso && new Date(iso).getTime() > Date.now();

function UserFlags({ user, communityBan }) {
  return (
    <span className="stu-flags">
      {user.isPlatformBanned && <span className="stu-flag stu-flag-bad">Banido</span>}
      {isFuture(user.suspendedUntil) && <span className="stu-flag stu-flag-warn">Suspenso</span>}
      {isFuture(user.timeoutUntil) && <span className="stu-flag stu-flag-warn">Silenciado</span>}
      {communityBan && <span className="stu-flag stu-flag-bad">Banido da comunidade</span>}
      {user.platformRole && user.platformRole !== 'USER' && <span className="stu-flag stu-flag-role">{ROLE_LABEL[user.platformRole]}</span>}
    </span>
  );
}

export function StaffUserSearchTab() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [openId, setOpenId] = useState(null);
  const inputRef = useRef(null);
  const reqRef = useRef(0);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const search = useCallback((text) => {
    const term = text.trim();
    if (!term) { setResults(null); setLoading(false); return; }
    const n = ++reqRef.current;
    setLoading(true);
    api.get('/admin/staff/users/search', { params: { q: term } })
      .then((r) => { if (reqRef.current === n) setResults(r.data.users || []); })
      .catch(() => { if (reqRef.current === n) setResults([]); })
      .finally(() => { if (reqRef.current === n) setLoading(false); });
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(q), 250);
    return () => clearTimeout(t);
  }, [q, search]);

  return (
    <div className="stu">
      <label className="stu-search">
        <Ic name="search" size={18} />
        <input
          ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="Nome, @usuário, ID ou e-mail" aria-label="Buscar usuário"
          onKeyDown={(e) => { if (e.key === 'Enter' && results?.[0]) setOpenId(results[0].id); }}
        />
        {loading && <span className="stu-spinner" aria-hidden="true" />}
      </label>

      {results === null && (
        <div className="sth-empty">
          <span className="sth-empty-icon"><Ic name="user" size={20} /></span>
          <strong>Encontre qualquer conta</strong>
          <span>Busque pelo nome, @usuário, ID (interno ou público) ou e-mail. Enter abre o primeiro resultado.</span>
        </div>
      )}
      {results?.length === 0 && !loading && (
        <div className="sth-empty">
          <span className="sth-empty-icon"><Ic name="search" size={20} /></span>
          <strong>Ninguém encontrado</strong>
          <span>Confira a grafia ou tente outro dado da conta.</span>
        </div>
      )}
      {results?.length > 0 && (
        <ul className="stu-results">
          {results.map((u) => (
            <li key={u.id}>
              <button type="button" className="stu-row" onClick={() => setOpenId(u.id)}>
                <span className="stu-avatar">
                  <UserAvatar user={u} size={38} />
                  <span className={`stu-online ${u.online ? 'on' : ''}`} title={u.online ? 'Conectado agora' : 'Desconectado'} />
                </span>
                <span className="stu-row-main">
                  <span className="stu-row-name">{u.displayName}</span>
                  <span className="stu-row-sub">@{u.username}{u.email ? ` · ${u.email}` : ''}</span>
                </span>
                <UserFlags user={u} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {openId && <StaffUserDrawer userId={openId} onClose={() => setOpenId(null)} onChanged={() => search(q)} />}
    </div>
  );
}

const HISTORY_TEXT = {
  MEMBER_WARN: 'Advertência',
  MEMBER_BAN: 'Banido da comunidade',
  MEMBER_UNBAN: 'Banimento da comunidade removido',
  MEMBER_TIMEOUT: 'Silenciado',
  MEMBER_TIMEOUT_REMOVE: 'Silêncio removido',
  MEMBER_WARN_CLEAR: 'Advertências limpas',
  MEMBER_KICK: 'Expulso',
  MESSAGE_DELETE: 'Mensagem apagada pela moderação',
  USER_BAN: 'Banido da plataforma',
  USER_UNBAN: 'Banimento da plataforma removido',
  USER_SUSPEND: 'Suspenso',
  USER_UNSUSPEND: 'Suspensão cancelada',
  USER_ROLE_CHANGE: 'Cargo da plataforma alterado',
  USER_EDIT: 'Perfil editado pela equipe',
  USER_SET_LEVEL: 'Nível alterado',
  USER_ADD_XP: 'XP adicionado',
  USER_ADD_CURRENCY: 'Moedas adicionadas',
  BADGE_GRANT: 'Insígnia concedida',
  BADGE_REVOKE: 'Insígnia removida',
  AUTOMOD_TRIGGER: 'Filtro automático disparou',
};
const PUNISHMENT_ACTIONS = new Set(['MEMBER_WARN', 'MEMBER_BAN', 'MEMBER_TIMEOUT', 'MEMBER_KICK', 'USER_BAN', 'USER_SUSPEND', 'AUTOMOD_TRIGGER', 'MESSAGE_DELETE']);
const historyText = (a) => HISTORY_TEXT[a] || String(a || '').replaceAll('_', ' ').toLowerCase();

const REPORT_STATUS = { PENDING: 'Pendente', ACTIONED: 'Punida', DISMISSED: 'Descartada' };

// Formulários curtos dentro da gaveta (sem prompt() — não funciona no app de PC).
const FORMS = {
  ban: { title: 'Banir da plataforma', reasonLabel: 'Motivo (opcional)', confirm: 'Banir', danger: true },
  suspend: { title: 'Suspender conta', amountLabel: 'Por quantas horas', amountDefault: '24', reasonLabel: 'Motivo (opcional)', confirm: 'Suspender', danger: true },
  timeout: { title: 'Silenciar no chat', amountLabel: 'Por quantos minutos', amountDefault: '60', reasonLabel: 'Motivo (opcional)', confirm: 'Silenciar', danger: true },
  warn: { title: 'Advertir', reasonLabel: 'Motivo (obrigatório)', confirm: 'Enviar advertência', danger: false, reasonRequired: true },
};

export function StaffUserDrawer({ userId, onClose, onChanged }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [form, setForm] = useState(null); // { kind, amount, reason }
  const [securityOpen, setSecurityOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const panelRef = useRef(null);

  const load = useCallback(() => api.get(`/admin/staff/users/${userId}`)
    .then((r) => { setData(r.data); setError(''); })
    .catch((err) => setError(err.response?.data?.error || 'Não foi possível carregar esta conta.')), [userId]);

  useEffect(() => { setData(null); load(); }, [load]);
  useEffect(() => { panelRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !securityOpen) onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, securityOpen]);

  const run = async (fn) => {
    setBusy(true);
    setActionError('');
    try {
      await fn();
      setForm(null);
      await load();
      onChanged?.();
    } catch (err) {
      setActionError(err.response?.data?.error || 'Não foi possível concluir a ação.');
    } finally {
      setBusy(false);
    }
  };

  const submitForm = (e) => {
    e.preventDefault();
    const reason = form.reason.trim() || undefined;
    const amount = Number(form.amount);
    if (form.kind === 'ban') return run(() => adminBanUser(userId, reason));
    if (form.kind === 'suspend') return run(() => adminSuspendUser(userId, amount > 0 ? amount : 24, reason));
    if (form.kind === 'timeout') return run(() => api.post(`/community/members/${userId}/timeout`, { minutes: amount > 0 ? amount : 60, reason }));
    if (form.kind === 'warn') {
      if (!reason) { setActionError('Escreva o motivo da advertência.'); return undefined; }
      return run(() => api.post(`/community/members/${userId}/warnings`, { reason }));
    }
    return undefined;
  };

  const openForm = (kind) => {
    setActionError('');
    setForm({ kind, amount: FORMS[kind].amountDefault || '', reason: '' });
  };

  const copyId = () => {
    navigator.clipboard?.writeText(userId).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => {});
  };

  const u = data?.user;
  const suspended = isFuture(u?.suspendedUntil);
  const timedOut = isFuture(u?.timeoutUntil);
  const punishments = data?.history?.filter((h) => PUNISHMENT_ACTIONS.has(h.action)).length || 0;
  const f = form ? FORMS[form.kind] : null;

  return createPortal(
    <div className="stu-drawer-layer">
      <div className="stu-drawer-backdrop" onClick={onClose} />
      <aside className="stu-drawer" role="dialog" aria-modal="true" aria-label="Detalhes da conta" tabIndex={-1} ref={panelRef}>
        <header className="stu-drawer-head">
          {u ? (
            <>
              <span className="stu-avatar">
                <UserAvatar user={u} size={56} />
                <span className={`stu-online ${u.online ? 'on' : ''}`} />
              </span>
              <div className="stu-drawer-title">
                <strong>{u.displayName}</strong>
                <span>@{u.username}</span>
                <span className={`stu-conn ${u.online ? 'on' : ''}`}>{u.online ? 'Conectado agora' : 'Desconectado'}</span>
              </div>
            </>
          ) : (
            <div className="stu-drawer-title"><strong>Detalhes da conta</strong></div>
          )}
          <button type="button" className="stu-icon-btn" onClick={onClose} aria-label="Fechar"><Ic name="close" size={18} /></button>
        </header>

        <div className="stu-drawer-body">
          {error && <div className="sth-error-banner"><Ic name="alert" size={16} /> {error}</div>}
          {!data && !error && <div className="sth-skeleton sth-skeleton-list" aria-hidden="true">{[0, 1, 2, 3].map((i) => <span key={i} />)}</div>}

          {u && (
            <>
              <UserFlags user={u} communityBan={data.communityBan} />

              <dl className="stu-facts">
                <div>
                  <dt>ID</dt>
                  <dd className="stu-mono">
                    <span className="stu-ellipsis">{u.id}</span>
                    <button type="button" className="stu-icon-btn sm" onClick={copyId} title="Copiar ID" aria-label="Copiar ID"><Ic name={copied ? 'check' : 'copy'} size={14} /></button>
                  </dd>
                </div>
                {u.publicId && <div><dt>ID público</dt><dd className="stu-mono">{u.publicId}</dd></div>}
                <div>
                  <dt>E-mail</dt>
                  <dd><span className="stu-ellipsis">{u.email || '—'}</span>{u.emailVerified && <span className="stu-verified">verificado</span>}</dd>
                </div>
                <div><dt>Conta criada</dt><dd>{fmtDate(u.createdAt)}</dd></div>
                <div><dt>Mensagens</dt><dd>{nf(data.messageCount)}</dd></div>
                <div><dt>Denúncias recebidas</dt><dd>{nf(data.reports?.total)}</dd></div>
                {suspended && <div><dt>Suspensa até</dt><dd>{fmtDate(u.suspendedUntil)}</dd></div>}
                {timedOut && <div><dt>Silenciada até</dt><dd>{fmtDate(u.timeoutUntil)}</dd></div>}
                {u.isPlatformBanned && u.platformBanReason && <div><dt>Motivo do banimento</dt><dd>{u.platformBanReason}</dd></div>}
              </dl>

              <section className="stu-block">
                <h3>Ações</h3>
                <label className="stu-role">
                  <span>Cargo da plataforma</span>
                  <select value={u.platformRole} disabled={busy} onChange={(e) => run(() => adminSetPlatformRole(userId, e.target.value))}>
                    <option value="USER">Usuário</option>
                    <option value="MODERATOR">Moderador</option>
                    <option value="ADMIN">Administrador</option>
                  </select>
                </label>
                <div className="stu-actions">
                  {u.isPlatformBanned
                    ? <button type="button" className="sth-btn" disabled={busy} onClick={() => run(() => adminUnbanUser(userId))}>Desbanir</button>
                    : <button type="button" className="sth-btn danger" disabled={busy} onClick={() => openForm('ban')}>Banir</button>}
                  {suspended
                    ? <button type="button" className="sth-btn" disabled={busy} onClick={() => run(() => adminUnsuspendUser(userId))}>Cancelar suspensão</button>
                    : <button type="button" className="sth-btn danger" disabled={busy} onClick={() => openForm('suspend')}>Suspender</button>}
                  {timedOut
                    ? <button type="button" className="sth-btn" disabled={busy} onClick={() => run(() => api.delete(`/community/members/${userId}/timeout`))}>Tirar silêncio</button>
                    : <button type="button" className="sth-btn" disabled={busy} onClick={() => openForm('timeout')}>Silenciar</button>}
                  <button type="button" className="sth-btn" disabled={busy} onClick={() => openForm('warn')}>Advertir</button>
                  <button type="button" className="sth-btn" onClick={() => setSecurityOpen(true)}><Ic name="lock" size={14} /> Informações confidenciais</button>
                  <button type="button" className="sth-btn" onClick={() => { useStore.getState().openProfile?.(userId); }}><Ic name="user" size={14} /> Abrir perfil</button>
                </div>

                {f && (
                  <form className="stu-form" onSubmit={submitForm}>
                    <strong>{f.title}</strong>
                    {f.amountLabel && (
                      <label>
                        <span>{f.amountLabel}</span>
                        <input type="number" min="1" inputMode="numeric" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
                      </label>
                    )}
                    <label>
                      <span>{f.reasonLabel}</span>
                      <input value={form.reason} maxLength={500} onChange={(e) => setForm({ ...form, reason: e.target.value })} autoFocus />
                    </label>
                    <div className="stu-form-buttons">
                      <button type="button" className="sth-btn" onClick={() => setForm(null)} disabled={busy}>Cancelar</button>
                      <button type="submit" className={`sth-btn ${f.danger ? 'danger solid' : 'primary'}`} disabled={busy || (f.reasonRequired && !form.reason.trim())}>{f.confirm}</button>
                    </div>
                  </form>
                )}
                {actionError && <p className="stu-action-error">{actionError}</p>}
              </section>

              <section className="stu-block">
                <div className="stu-block-head">
                  <h3>Histórico de punições e ações</h3>
                  <span className="sth-chip">{punishments} punição(ões)</span>
                </div>
                {data.history.length === 0 ? (
                  <p className="stu-muted">Nenhuma advertência, punição ou ação da equipe registrada.</p>
                ) : (
                  <ol className="stu-timeline">
                    {data.history.map((h) => (
                      <li key={h.id} className={PUNISHMENT_ACTIONS.has(h.action) ? 'is-punishment' : ''}>
                        <span className="stu-tl-dot" aria-hidden="true" />
                        <div className="stu-tl-body">
                          <div className="stu-tl-head">
                            <strong>{historyText(h.action)}</strong>
                            <time dateTime={h.at} title={fmtDate(h.at)}>{timeAgo(h.at)}</time>
                          </div>
                          <span className="stu-tl-by">por {h.by?.displayName || 'Equipe'}</span>
                          {h.reason && <p className="stu-tl-reason">{h.reason}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section className="stu-block">
                <h3>Denúncias recentes contra a conta</h3>
                {data.reports?.recent?.length ? (
                  <ul className="stu-reports">
                    {data.reports.recent.map((r) => (
                      <li key={r.id}>
                        <div className="stu-tl-head">
                          <span className={`stu-flag ${r.status === 'PENDING' ? 'stu-flag-warn' : ''}`}>{REPORT_STATUS[r.status] || r.status}</span>
                          <time dateTime={r.createdAt}>{timeAgo(r.createdAt)}</time>
                        </div>
                        <p className="stu-tl-reason">{r.reason}</p>
                        {r.snippet && <blockquote>{r.snippet}</blockquote>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="stu-muted">Nenhuma denúncia.</p>
                )}
              </section>
            </>
          )}
        </div>
      </aside>
      {securityOpen && <UserSecurityInfoModal userId={userId} onClose={() => setSecurityOpen(false)} />}
    </div>,
    document.body,
  );
}
