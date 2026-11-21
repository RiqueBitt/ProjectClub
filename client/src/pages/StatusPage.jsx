import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import '../styles/status-page.css';

// Página pública de status (/status): mostra se o site, o banco, o tempo
// real e as chamadas de voz estão funcionando, a disponibilidade dos últimos
// 30 dias e as quedas recentes. Dados: GET /api/platform/health-status
// (services/statusMonitor.js, que confere tudo a cada minuto).
const LABEL = { ok: 'Funcionando', degraded: 'Lento', down: 'Fora do ar' };
const HEADLINE = { ok: 'Tudo funcionando', degraded: 'Alguns serviços estão lentos', down: 'Estamos com problemas' };

function fmtWhen(d) { return new Date(d).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }); }
function fmtDur(a, b) {
  const min = Math.max(1, Math.round(((b ? new Date(b) : new Date()) - new Date(a)) / 60000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${min % 60} min`;
}

export default function StatusPage() {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    document.title = 'Status · Project Club';
    let alive = true;
    const load = () => fetch('/api/platform/health-status', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((d) => { if (alive) { setData(d); setFailed(false); } })
      .catch(() => { if (alive) setFailed(true); });
    load();
    const t = setInterval(load, 30000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const overall = failed ? 'down' : data?.overall || 'ok';
  return (
    <div className="st-page">
      <header className="st-head">
        <Link to="/" className="st-brand">Project Club</Link>
        <span className="st-sub">Status</span>
      </header>
      <main className="st-main">
        <section className={`st-hero is-${overall}`} aria-live="polite">
          <span className="st-dot" />
          <div>
            <h1>{!data && !failed ? 'Conferindo…' : failed ? 'Não conseguimos falar com o servidor' : HEADLINE[overall]}</h1>
            {data?.checkedAt && <p>Última verificação: {fmtWhen(data.checkedAt)} · atualiza sozinho</p>}
          </div>
        </section>

        <section className="st-list">
          {(data?.components || []).map((c) => (
            <div key={c.id} className="st-row">
              <div className="st-name">
                <strong>{c.label}</strong>
                <span>{c.uptime30d != null ? `${c.uptime30d.toLocaleString('pt-BR')}% nos últimos 30 dias` : ''}</span>
              </div>
              <span className={`st-pill is-${c.status}`}>{LABEL[c.status] || c.status}</span>
            </div>
          ))}
        </section>

        <section className="st-incidents">
          <h2>Quedas recentes</h2>
          {!data?.incidents?.length ? <p className="st-muted">Nenhuma queda registrada. 🎉</p> : (
            <ul>
              {data.incidents.map((i) => (
                <li key={i.id}>
                  <strong>{i.component}</strong>
                  <span>{fmtWhen(i.startedAt)} · {i.endedAt ? `durou ${fmtDur(i.startedAt, i.endedAt)}` : `em andamento há ${fmtDur(i.startedAt)}`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
