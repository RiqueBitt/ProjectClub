import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import '../styles/vpn.css';

// VPN do Project Club — escudo ao lado do globo do Navegador (barra de título
// do app de Windows/Linux). Servidores grátis do VPN Gate; a conexão é feita
// pelo próprio app (desktop/vpnManager.js), sem outro programa.
// Escolher um país tenta os servidores mais rápidos dele, um de cada vez.

const vpnApi = () => (typeof window !== 'undefined' ? window.electronAPI?.vpn : null);
const regionNames = (() => { try { return new Intl.DisplayNames(['pt-BR'], { type: 'region' }); } catch { return null; } })();
const countryName = (code, fallback) => { try { return regionNames?.of(code) || fallback || code; } catch { return fallback || code; } };
const flag = (code) => (/^[A-Z]{2}$/.test(code || '') ? String.fromCodePoint(...[...code].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '🌐');
const TRIES_PER_COUNTRY = 3;

function formatBytes(n) {
  if (!n) return '0 MB';
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(n < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
function formatSince(ms) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}min` : `${m} min`;
}

export default function TitleBarVpn() {
  const vpn = vpnApi();
  const [open, setOpen] = useState(false);
  const [st, setSt] = useState(null);
  const [servers, setServers] = useState(null);
  const [listError, setListError] = useState('');
  const [trying, setTrying] = useState(null); // { country, attempt, total }
  const [, tick] = useState(0);
  const wrapRef = useRef(null);
  const cancelRef = useRef(false);

  useEffect(() => {
    if (!vpn) return undefined;
    vpn.getState().then(setSt).catch(() => {});
    return vpn.onState(setSt);
  }, [vpn]);

  // Fecha ao clicar fora / Esc (igual ao menuzinho dos apps).
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!wrapRef.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey, true); };
  }, [open]);

  const loadServers = () => {
    setListError('');
    api.get('/vpn/servers').then(({ data }) => setServers(data?.servers || [])).catch((e) => setListError(e?.response?.data?.error || 'Não deu para buscar os servidores agora.'));
  };
  useEffect(() => { if (open && !servers) loadServers(); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  // Relógio do "conectado há…" enquanto o menu está aberto.
  useEffect(() => {
    if (!open || st?.status !== 'connected') return undefined;
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, [open, st?.status]);

  const countries = useMemo(() => {
    const map = new Map();
    for (const s of servers || []) {
      if (!map.has(s.country)) map.set(s.country, { code: s.country, name: countryName(s.country, s.countryName), servers: [] });
      map.get(s.country).servers.push(s);
    }
    return [...map.values()].map((c) => ({ ...c, best: Math.max(...c.servers.map((s) => s.speedMbps || 0)) }));
  }, [servers]);

  if (!vpn || st?.supported === false) return null;
  const status = st?.status || 'off';
  const busy = status === 'connecting' || status === 'disconnecting' || !!trying;

  const connectCountry = async (c) => {
    cancelRef.current = false;
    const list = c.servers.slice().sort((a, b) => (b.speedMbps || 0) - (a.speedMbps || 0)).slice(0, TRIES_PER_COUNTRY);
    for (let i = 0; i < list.length; i += 1) {
      if (cancelRef.current) break;
      setTrying({ country: c.code, attempt: i + 1, total: list.length });
      let cfg;
      try {
        ({ data: cfg } = await api.get(`/vpn/servers/${encodeURIComponent(list[i].id)}/config`));
      } catch (e) {
        if (e?.response?.status === 404) continue; // saiu do ar: próximo
        setTrying(null); setSt((s) => ({ ...s, status: 'error', error: e?.response?.data?.error || 'Não deu para buscar o servidor.' })); return;
      }
      // Escuta ANTES de pedir: um erro logo de cara chega antes do connect() voltar.
      // eslint-disable-next-line no-await-in-loop
      const final = await new Promise((resolve) => {
        let started = false;
        const finish = (x) => { off(); resolve(x); };
        const off = vpn.onState((x) => { if (x.status === 'connecting') started = true; else if (started) finish(x); });
        vpn.connect(cfg.config, { id: cfg.id, country: cfg.country, countryName: countryName(cfg.country, cfg.countryName) })
          .then((x) => { if (x && x.status !== 'connecting') finish(x); })
          .catch(() => finish({ status: 'error', error: 'A VPN não abriu.' }));
      });
      // Recusou o aviso do Windows/sistema: não adianta tentar o próximo.
      if (final.status === 'connected' || cancelRef.current || /permit|permiss|Instale/i.test(final.error || '')) break;
    }
    setTrying(null);
    loadServers();
  };
  const cancel = () => { cancelRef.current = true; setTrying(null); vpn.disconnect(); };

  const label = status === 'connected' ? `VPN ligada — ${st?.server?.countryName || ''}` : status === 'connecting' || trying ? 'Conectando a VPN…' : 'VPN';
  return (
    <div className="tb-vpn-wrap" ref={wrapRef}>
      <button
        type="button"
        className={`tb-web tb-vpn is-${trying ? 'connecting' : status}${open ? ' is-active' : ''}`}
        title={label} aria-label={label} aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6l-7-3Z" />
          {status === 'connected' && <path d="m9 12 2 2 4-4" />}
        </svg>
        {status === 'connected' && <span className="tb-vpn-dot" aria-hidden="true" />}
      </button>

      {open && (
        <div className="tb-vpn-pop" role="dialog" aria-label="VPN">
          <div className="tb-vpn-head">
            <strong>VPN</strong>
            <span className={`tb-vpn-pill is-${trying ? 'connecting' : status}`}>
              {status === 'connected' ? 'Ligada' : status === 'connecting' || trying ? 'Conectando…' : status === 'disconnecting' ? 'Desligando…' : 'Desligada'}
            </span>
          </div>

          {status === 'connected' && (
            <div className="tb-vpn-now">
              <span className="tb-vpn-flag">{flag(st.server?.country)}</span>
              <div className="tb-vpn-now-text">
                <b>{st.server?.countryName || 'Servidor'}</b>
                <span>IP {st.ip || st.server?.ip} · há {formatSince(st.since)}</span>
                <span>↓ {formatBytes(st.bytesIn)} · ↑ {formatBytes(st.bytesOut)}</span>
              </div>
              <button type="button" className="tb-vpn-off" onClick={() => vpn.disconnect()}>Desligar</button>
            </div>
          )}

          {(status === 'connecting' || trying) && (
            <div className="tb-vpn-now">
              <span className="tb-vpn-spin" aria-hidden="true" />
              <div className="tb-vpn-now-text">
                <b>{flag(trying?.country || st?.server?.country)} {countryName(trying?.country || st?.server?.country, st?.server?.countryName)}</b>
                <span>{st?.firstTime ? 'Primeira vez: preparando o componente de rede…' : 'Confirme no aviso do sistema, se aparecer.'}{trying && trying.total > 1 ? ` Servidor ${trying.attempt} de ${trying.total}.` : ''}</span>
              </div>
              <button type="button" className="tb-vpn-off" onClick={cancel}>Cancelar</button>
            </div>
          )}

          {status === 'error' && st?.error && !trying && <div className="tb-vpn-error" role="alert">{st.error}</div>}

          {status !== 'connected' && !trying && status !== 'connecting' && (
            <>
              <div className="tb-vpn-sub">Escolha um país</div>
              {listError && <div className="tb-vpn-error">{listError} <button type="button" className="btn-link" onClick={loadServers}>Tentar de novo</button></div>}
              {!servers && !listError && <div className="tb-vpn-empty">Buscando servidores…</div>}
              {servers && countries.length === 0 && <div className="tb-vpn-empty">Nenhum servidor no ar agora.</div>}
              <ul className="tb-vpn-list">
                {countries.map((c) => (
                  <li key={c.code}>
                    <button type="button" disabled={busy} onClick={() => connectCountry(c)}>
                      <span className="tb-vpn-flag">{flag(c.code)}</span>
                      <span className="tb-vpn-name">{c.name}</span>
                      <span className="tb-vpn-meta">{c.servers.length} {c.servers.length === 1 ? 'servidor' : 'servidores'} · até {c.best} Mbps</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          <p className="tb-vpn-note">
            Servidores grátis do VPN Gate (voluntários). Eles guardam registro das conexões, então não é anônimo.
            {navigator.userAgent.includes('Windows') ? ' O Windows pede uma confirmação a cada conexão.' : ''}
          </p>
        </div>
      )}
    </div>
  );
}
