import { useCallback, useEffect, useState } from 'react';
import { getStaffOpsHealth, runStaffBackup } from '../../api/conforto';
import { useLiveRefresh } from '../../utils/liveRefresh';
import { useAuth } from '../../context/AuthContext.jsx';
import UserAvatar from '../UserAvatar.jsx';
import '../../styles/staff-tools.css';
import '../../styles/staff-ops.css';

// Painel de saúde (uma tela só): banco/Redis/servidor de mídia, processo,
// versão publicada, backups, quem está em call agora e os erros agrupados
// do ErrorLog. Atualiza sozinho a cada 10s. Dados: GET /api/staff-ops/health
// (só ADMIN/MODERATOR — ver server/src/services/staffOps.js).
const PATHS = {
  db: 'M12 4c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3Zm-8 3v10c0 1.7 3.6 3 8 3s8-1.3 8-3V7M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3',
  bolt: 'M13 3 5 13h6l-1 8 8-10h-6l1-8Z',
  wave: 'M3 12h2M7 8v8M11 5v14M15 8v8M19 11v2',
  chip: 'M8 8h8v8H8zM4 10h2M4 14h2M18 10h2M18 14h2M10 4v2M14 4v2M10 18v2M14 18v2',
  refresh: 'M20 11a8 8 0 0 0-14.9-3.9L4 9M4 4v5h5M4 13a8 8 0 0 0 14.9 3.9L20 15M20 20v-5h-5',
  archive: 'M4 5h16v4H4zM6 9v10h12V9M10 13h4',
  alert: 'M12 9v4M12 17h.01M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0Z',
  phone: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1Z',
  micOff: 'M15 9.3V6a3 3 0 0 0-5.7-1.3M9 9v3a3 3 0 0 0 4.9 2.3M19 11a7 7 0 0 1-1.1 3.8M5 11a7 7 0 0 0 11 5.7M12 18v3M3 3l18 18',
  headOff: 'M4 15v-3a8 8 0 0 1 12.7-6.5M20 12v3M3 14h5v7H5a2 2 0 0 1-2-2zM16 16v3a2 2 0 0 0 2 2h1M3 3l18 18',
  screen: 'M3 5h18v11H3zM8 20h8M12 16v4',
  tag: 'M3 12V4h8l10 10-8 8L3 12ZM7.5 7.5h.01',
};
function Ic({ name, size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  );
}

const nf = (n) => (typeof n === 'number' ? n.toLocaleString('pt-BR') : '—');
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
function ago(iso) {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}
function uptime(sec) {
  if (!Number.isFinite(sec)) return '—';
  const d = Math.floor(sec / 86400); const h = Math.floor((sec % 86400) / 3600); const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}min` : `${m}min`;
}
function bytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
const level = (check, slow) => (!check ? 'unknown' : !check.ok ? 'bad' : check.ms > slow ? 'warn' : 'good');

function Ping({ icon, title, check, slow, extra, value }) {
  const lv = level(check, slow);
  return (
    <div className={`sth-ping sth-${lv}`}>
      <span className="sth-ping-icon"><Ic name={icon} size={18} /></span>
      <div className="sth-ping-body">
        <span className="sth-ping-title">{title}</span>
        <strong className="sth-ping-value">{value ?? (!check ? '—' : check.ok ? `${check.ms} ms` : 'Sem resposta')}</strong>
        {check && !check.ok && check.error && <span className="sth-ping-extra" title={check.error}>{check.error}</span>}
        {extra && <span className="sth-ping-extra">{extra}</span>}
      </div>
      <span className="sth-dot" aria-hidden="true" />
      <span className="pc-sr-only">{lv === 'good' ? 'Normal' : lv === 'warn' ? 'Lento' : lv === 'bad' ? 'Com problema' : 'Sem dados'}</span>
    </div>
  );
}

const STATUS_LABEL = { OK: 'Concluído', FAILED: 'Falhou', RUNNING: 'Rodando' };
const SOURCE_LABEL = { server: 'Servidor', client: 'Tela', process: 'Processo' };

export default function StaffOpsPanel() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [backupMsg, setBackupMsg] = useState('');
  const [backupBusy, setBackupBusy] = useState(false);
  const [, setTick] = useState(0);
  const isAdmin = user?.platformRole === 'ADMIN';

  const load = useCallback(() => getStaffOpsHealth().then((d) => { setData(d); setError(''); }), []);
  const refresh = useCallback(() => {
    setLoading(true);
    return load().catch((err) => setError(err?.response?.data?.error || 'Não foi possível carregar o painel de saúde.')).finally(() => setLoading(false));
  }, [load]);
  useEffect(() => { refresh(); }, [refresh]);
  useLiveRefresh(() => load().catch(() => {}), { interval: 11000 });
  useEffect(() => { const t = setInterval(() => setTick((n) => n + 1), 5000); return () => clearInterval(t); }, []);

  const doBackup = async () => {
    setBackupBusy(true);
    setBackupMsg('');
    try {
      const r = await runStaffBackup();
      setBackupMsg(r?.backup?.status === 'OK' ? 'Backup concluído.' : 'Backup iniciado. Ele roda em segundo plano; o resultado aparece aqui.');
      setTimeout(refresh, 1500);
    } catch (err) {
      setBackupMsg(err?.response?.data?.error || 'Não foi possível iniciar o backup.');
    } finally { setBackupBusy(false); }
  };

  const p = data?.process;
  const media = data?.media;
  const backup = data?.backup;
  const lastRun = backup?.recent?.[0];
  const memPct = p ? Math.min(100, Math.round((p.heapUsedMb / Math.max(1, p.heapTotalMb)) * 100)) : 0;
  const backupStale = backup?.config?.enabled && (!backup?.lastOk || Date.now() - new Date(backup.lastOk.startedAt).getTime() > 36 * 3600 * 1000);

  return (
    <div className="sth sop">
      <div className="sth-toolbar">
        <span className="sth-live"><span className="sth-live-dot" aria-hidden="true" /> Ao vivo, a cada 10s</span>
        {data && <span className="sth-updated">Atualizado {ago(data.at)}</span>}
        {data?.version && (
          <span className="sop-chip" title={data.version.builtAt ? `Publicado em ${fmtDate(data.version.builtAt)}` : undefined}>
            <Ic name="tag" size={13} /> Site {data.version.web?.web || 'sem build'} · Node {data.version.node}
            {data.version.commit ? ` · ${String(data.version.commit).slice(0, 7)}` : ''}
          </span>
        )}
        <button type="button" className="sth-btn" onClick={refresh} disabled={loading}>
          <Ic name="refresh" size={15} /> Atualizar agora
        </button>
      </div>

      {error && <div className="sth-error-banner" role="alert"><Ic name="alert" size={16} /> {error}</div>}
      {!data && !error && <div className="sth-skeleton" aria-hidden="true">{[0, 1, 2, 3].map((i) => <span key={i} />)}</div>}

      {data && (
        <>
          <section className="sth-pings" aria-label="Serviços">
            <Ping icon="db" title="Banco de dados (MySQL)" check={data.db} slow={150} />
            <Ping icon="bolt" title="Redis" check={data.redis} slow={60} extra={data.redis?.status && data.redis.status !== 'ready' ? `Estado: ${data.redis.status}` : null} />
            <Ping
              icon="wave" title="Servidor de mídia (voz)" slow={400}
              check={media?.configured ? media : null}
              value={!media?.configured ? 'Não configurado' : undefined}
              extra={media?.ok && media.summary ? `${nf(media.summary.workers)} worker(s) · ${nf(media.summary.rooms ?? media.rooms?.length)} sala(s) · ${nf(media.summary.peers)} conexão(ões)` : null}
            />
            <Ping
              icon="chip" title="Servidor do app" check={{ ok: true, ms: 0 }} slow={1e9}
              value={uptime(p?.uptimeSec)}
              extra={p ? `RAM ${nf(p.rssMb)} MB · heap ${memPct}% · ${nf(p.sockets)} conexão(ões)` : null}
            />
          </section>

          <section className="sth-section sop-backup" aria-labelledby="sop-bkp-title">
            <div className="sth-section-head">
              <h2 id="sop-bkp-title"><Ic name="archive" size={17} /> Backup do banco</h2>
              {backup?.config && (
                <span className={`sth-chip${backup.config.destination === 's3' ? '' : ' sth-chip-muted'}`}>
                  {backup.config.destination === 's3' ? 'Fora do servidor (S3)' : 'Disco do servidor'}
                </span>
              )}
              {backup?.config && <span className="sth-chip sth-chip-muted">{backup.config.enabled ? `Diário às ${backup.config.hour}h · guarda ${backup.config.keep}` : 'Automático desligado'}</span>}
              {isAdmin && (
                <button type="button" className="sth-btn primary sop-push" onClick={doBackup} disabled={backupBusy || backup?.running}>
                  {backup?.running ? 'Backup em andamento…' : backupBusy ? 'Iniciando…' : 'Fazer backup agora'}
                </button>
              )}
            </div>
            {backupMsg && <p className="sop-note" role="status">{backupMsg}</p>}
            {backup?.config?.destination === 'disk' && (
              <p className="sop-warn"><Ic name="alert" size={14} /> Sem S3 configurado: o arquivo fica em <code>{backup.config.target}</code> e some no próximo deploy. Configure BACKUP_S3_BUCKET para guardar fora do servidor.</p>
            )}
            {backup?.config?.s3Misconfigured && <p className="sop-warn"><Ic name="alert" size={14} /> BACKUP_S3_BUCKET está definido, mas faltam as chaves de acesso.</p>}
            {backupStale && <p className="sop-warn"><Ic name="alert" size={14} /> Nenhum backup concluído nas últimas 36 horas.</p>}
            <div className="sop-backup-grid">
              <div className="sop-kv"><span>Último backup bom</span><strong>{backup?.lastOk ? `${fmtDate(backup.lastOk.startedAt)} (${ago(backup.lastOk.startedAt)})` : 'Nenhum ainda'}</strong></div>
              <div className="sop-kv"><span>Tamanho</span><strong>{bytes(backup?.lastOk?.sizeBytes)}</strong></div>
              <div className="sop-kv"><span>Última execução</span><strong className={lastRun ? `sop-st-${lastRun.status.toLowerCase()}` : ''}>{lastRun ? `${STATUS_LABEL[lastRun.status] || lastRun.status} · ${ago(lastRun.startedAt)}` : '—'}</strong></div>
              <div className="sop-kv"><span>Método</span><strong>{backup?.lastOk?.method === 'mysqldump' ? 'mysqldump' : backup?.lastOk ? 'Dump em Node' : backup?.config?.mysqldump ? 'mysqldump' : 'Dump em Node'}</strong></div>
            </div>
            {lastRun?.status === 'FAILED' && lastRun.error && <pre className="sop-pre" aria-label="Erro do último backup">{lastRun.error}</pre>}
            {backup?.recent?.length > 0 && (
              <details className="sop-details">
                <summary>Histórico ({backup.recent.length})</summary>
                <table className="sop-table">
                  <thead><tr><th scope="col">Início</th><th scope="col">Situação</th><th scope="col">Origem</th><th scope="col">Tamanho</th><th scope="col">Duração</th></tr></thead>
                  <tbody>
                    {backup.recent.map((b) => (
                      <tr key={b.id}>
                        <td>{fmtDate(b.startedAt)}</td>
                        <td className={`sop-st-${b.status.toLowerCase()}`}>{STATUS_LABEL[b.status] || b.status}</td>
                        <td>{b.trigger === 'MANUAL' ? 'Manual' : 'Agendado'}</td>
                        <td>{bytes(b.sizeBytes)}</td>
                        <td>{b.durationMs != null ? `${Math.max(1, Math.round(b.durationMs / 1000))}s` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </section>

          <section className="sth-section" aria-labelledby="sop-voice-title">
            <div className="sth-section-head">
              <h2 id="sop-voice-title"><Ic name="phone" size={17} /> Em call agora</h2>
              <span className="sth-chip">{nf(data.voice?.rooms?.length || 0)} sala(s)</span>
              <span className="sth-chip sth-chip-muted">{nf(data.voice?.totalParticipants || 0)} pessoa(s)</span>
            </div>
            {data.voice?.error && <p className="sop-warn">Não deu para ler as salas: {data.voice.error}</p>}
            {!data.voice?.rooms?.length ? <p className="sop-empty">Ninguém em call neste momento.</p> : (
              <ul className="sop-rooms" role="list">
                {data.voice.rooms.map((r) => (
                  <li key={r.id} className="sop-room">
                    <div className="sop-room-head">
                      <strong>{r.name}</strong>
                      <span className="sop-room-meta">{r.kind === 'channel' ? 'Canal' : r.kind === 'dm' ? 'Privada' : 'Clube'} · {r.participants.length} pessoa(s){r.startedAt ? ` · começou ${ago(r.startedAt)}` : ''}</span>
                    </div>
                    <ul className="sop-people" role="list">
                      {r.participants.map((pp) => (
                        <li key={pp.userId} className="sop-person">
                          <UserAvatar user={{ id: pp.userId, displayName: pp.displayName, avatarUrl: pp.avatarUrl }} size={24} />
                          <span className="sop-person-name">{pp.displayName}</span>
                          {pp.muted && <span className="sop-flag" title="Mudo"><Ic name="micOff" size={13} /><span className="pc-sr-only">mudo</span></span>}
                          {pp.deafened && <span className="sop-flag" title="Ensurdecido"><Ic name="headOff" size={13} /><span className="pc-sr-only">ensurdecido</span></span>}
                          {pp.screenSharing && <span className="sop-flag is-live" title="Transmitindo a tela"><Ic name="screen" size={13} /><span className="pc-sr-only">transmitindo</span></span>}
                          {pp.serverMuted && <span className="sop-flag is-mod">MOD</span>}
                          {pp.provider && <span className="sop-provider">{pp.provider}</span>}
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {media?.configured && (
            <section className="sth-section" aria-labelledby="sop-media-title">
              <div className="sth-section-head">
                <h2 id="sop-media-title"><Ic name="wave" size={17} /> Servidor de mídia</h2>
                {media.ok ? <span className="sth-chip">{media.ms} ms</span> : <span className="sth-chip sop-chip-bad">{media.error || 'Sem resposta'}</span>}
              </div>
              {media.ok && !media.rooms?.length && <p className="sop-empty">Nenhuma sala aberta no servidor de mídia.</p>}
              {media.ok && media.rooms?.length > 0 && (
                <table className="sop-table">
                  <thead><tr><th scope="col">Sala</th><th scope="col">Pessoa</th><th scope="col">Envia/Recebe</th><th scope="col">Conexão (ICE/DTLS)</th><th scope="col">Áudio parado</th></tr></thead>
                  <tbody>
                    {media.rooms.flatMap((room) => room.peers.map((peer, i) => (
                      <tr key={`${room.room}-${peer.id}`}>
                        <td>{i === 0 ? <code>{room.room}</code> : ''}</td>
                        <td>{peer.name || peer.id}</td>
                        <td>{nf(peer.producers)} / {nf(peer.consumers)}</td>
                        <td>{peer.transports?.map((t) => `${t.dir || '?'}: ${t.ice || '?'}/${t.dtls || '?'}`).join(' · ') || '—'}</td>
                        <td className={peer.stalled ? 'sop-st-failed' : ''}>{peer.stalled ? `${peer.stalled} sem dados` : 'ok'}</td>
                      </tr>
                    )))}
                  </tbody>
                </table>
              )}
            </section>
          )}

          <section className="sth-section" aria-labelledby="sop-err-title">
            <div className="sth-section-head">
              <h2 id="sop-err-title"><Ic name="alert" size={17} /> Erros (agrupados)</h2>
              <span className="sth-chip">{nf(data.errors?.last24h)} nas últimas 24h</span>
              <span className="sth-chip sth-chip-muted">{nf(data.errors?.total)} grupos guardados</span>
            </div>
            {!data.errors?.groups?.length ? <p className="sop-empty">Nenhum erro registrado. Tudo tranquilo.</p> : (
              <ul className="sop-errors" role="list">
                {data.errors.groups.map((g) => (
                  <li key={g.id} className={`sop-err sop-err-${g.source}`}>
                    <details>
                      <summary>
                        <span className="sop-err-count" title="Ocorrências">{nf(g.count)}×</span>
                        <span className="sop-err-src">{SOURCE_LABEL[g.source] || g.source}</span>
                        <span className="sop-err-msg">{g.message}</span>
                        <span className="sop-err-when" title={`Primeira vez: ${fmtDate(g.firstSeen)}`}>{ago(g.lastSeen)}</span>
                      </summary>
                      <div className="sop-err-body">
                        <p className="sop-err-meta">Primeira vez {fmtDate(g.firstSeen)} · última {fmtDate(g.lastSeen)}{g.url ? ` · ${g.url}` : ''}</p>
                        {g.stack ? <pre className="sop-pre">{g.stack}</pre> : <p className="sop-empty">Sem pilha de chamadas.</p>}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
