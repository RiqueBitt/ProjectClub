import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../../api/client';
import { useStore } from '../../store/useStore';
import '../../styles/integrations.css';

// Painel da Equipe → Sistema → Integrações: YouTube → Novidades, status do
// servidor de Minecraft e webhooks de canais (server/src/routes/integrations.js).

const errText = (e, f) => e?.response?.data?.error || f;

function Section({ title, desc, children }) {
  return (
    <section className="intg-card">
      <h3>{title}</h3>
      {desc && <p className="intg-desc">{desc}</p>}
      {children}
    </section>
  );
}

function YouTubeCard({ data, onSaved }) {
  const [enabled, setEnabled] = useState(!!data.enabled);
  const [channel, setChannel] = useState(data.channelId ? `https://www.youtube.com/channel/${data.channelId}` : '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setMsg('');
    try {
      const { data: r } = await api.put('/integrations/admin/youtube', { enabled, channel });
      setMsg(r.youtube.enabled ? `Ligado: vídeos novos de ${r.youtube.channelTitle || 'canal'} vão para Novidades.` : 'Desligado.');
      onSaved();
    } catch (er) { setMsg(errText(er, 'Não consegui salvar.')); } finally { setBusy(false); }
  };
  return (
    <Section title="YouTube → Novidades" desc="Cada vídeo novo do canal vira um anúncio em Novidades (com capa e link), e todo mundo é avisado. Shorts ficam de fora. Os vídeos que já existem não são postados.">
      <form className="intg-form" onSubmit={save}>
        <label>Canal do YouTube<input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="https://www.youtube.com/@seucanal" /></label>
        <label className="intg-check"><input type="checkbox" checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /> Publicar vídeos novos automaticamente</label>
        <div className="intg-row"><button type="submit" disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</button>{data.channelTitle && <span className="intg-muted">Canal atual: {data.channelTitle}</span>}</div>
        {msg && <p className="intg-msg" role="status">{msg}</p>}
      </form>
    </Section>
  );
}

function MinecraftCard({ data }) {
  const [form, setForm] = useState({ enabled: data.enabled !== false, host: data.host || '', port: data.port || 25565, name: data.name || '' });
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  useEffect(() => { api.get('/integrations/minecraft').then(({ data: r }) => setStatus(r.status)).catch(() => {}); }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setMsg('');
    try { const { data: r } = await api.put('/integrations/admin/minecraft', form); setStatus(r.status); setMsg('Salvo.'); } catch (er) { setMsg(errText(er, 'Não consegui salvar.')); } finally { setBusy(false); }
  };
  return (
    <Section title="Status do Minecraft" desc="Mostra no Início quantas pessoas estão jogando no servidor, ao vivo (consulta pública do jogo, sem plugin).">
      <form className="intg-form" onSubmit={save}>
        <div className="intg-grid">
          <label>Nome<input value={form.name} onChange={set('name')} placeholder="RedeSun" maxLength={40} /></label>
          <label>Endereço<input value={form.host} onChange={set('host')} placeholder="redesun.minesrv.net" required /></label>
          <label>Porta<input type="number" value={form.port} onChange={set('port')} min="1" max="65535" /></label>
        </div>
        <label className="intg-check"><input type="checkbox" checked={form.enabled} onChange={set('enabled')} /> Mostrar no Início</label>
        <div className="intg-row">
          <button type="submit" disabled={busy}>{busy ? 'Testando…' : 'Salvar e testar'}</button>
          {status && (status.online
            ? <span className="intg-ok">● Online · {status.players.online}/{status.players.max} jogando{status.version ? ` · ${status.version}` : ''}</span>
            : <span className="intg-bad">● Não respondeu</span>)}
        </div>
        {msg && <p className="intg-msg" role="status">{msg}</p>}
      </form>
    </Section>
  );
}

function WebhooksCard() {
  const categories = useStore((s) => s.categories);
  const looseChannels = useStore((s) => s.channels);
  const textChannels = useMemo(() => {
    const all = [...(looseChannels || []), ...(categories || []).flatMap((c) => c.channels || [])];
    return all.filter((c) => ['TEXT', 'ANNOUNCEMENT'].includes(c.type));
  }, [categories, looseChannels]);
  const [list, setList] = useState([]);
  const [channelId, setChannelId] = useState('');
  const [name, setName] = useState('');
  const [fresh, setFresh] = useState(null);
  const [msg, setMsg] = useState('');
  const load = useCallback(() => { api.get('/integrations/webhooks').then(({ data }) => setList(data.webhooks || [])).catch((e) => setMsg(errText(e, 'Sem permissão para ver webhooks.'))); }, []);
  useEffect(load, [load]);
  const chName = (id) => textChannels.find((c) => c.id === id)?.name || 'canal apagado';
  const create = async (e) => {
    e.preventDefault(); setMsg('');
    try { const { data } = await api.post('/integrations/webhooks', { channelId, name }); setFresh(data.webhook); setName(''); load(); } catch (er) { setMsg(errText(er, 'Não consegui criar.')); }
  };
  const rotate = async (w) => {
    if (!window.confirm(`Gerar um link novo para "${w.name}"? O link antigo para de funcionar na hora.`)) return;
    try { const { data } = await api.post(`/integrations/webhooks/${w.id}/rotate`); setFresh(data.webhook); load(); } catch (er) { setMsg(errText(er, 'Não consegui trocar.')); }
  };
  const remove = async (w) => {
    if (!window.confirm(`Apagar o webhook "${w.name}"?`)) return;
    try { await api.delete(`/integrations/webhooks/${w.id}`); load(); } catch (er) { setMsg(errText(er, 'Não consegui apagar.')); }
  };
  return (
    <Section title="Webhooks de canais" desc="Um serviço de fora (GitHub, formulários, painel do servidor, bots) manda mensagens num canal por um link secreto. Aceita o mesmo formato do Discord: { &quot;content&quot;: &quot;texto&quot;, &quot;embeds&quot;: [...] }.">
      <form className="intg-form intg-row" onSubmit={create}>
        <select value={channelId} onChange={(e) => setChannelId(e.target.value)} required aria-label="Canal">
          <option value="">Escolha o canal…</option>
          {textChannels.map((c) => <option key={c.id} value={c.id}># {c.name}</option>)}
        </select>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nome (ex.: GitHub)" required minLength={2} maxLength={80} aria-label="Nome do webhook" />
        <button type="submit">Criar webhook</button>
      </form>
      {fresh?.url && (
        <div className="intg-secret" role="alert">
          <strong>Link de "{fresh.name}" — copie agora, ele não aparece de novo:</strong>
          <code>{fresh.url}</code>
          <div className="intg-row">
            <button type="button" onClick={() => navigator.clipboard?.writeText(fresh.url)}>Copiar</button>
            <button type="button" className="intg-ghost" onClick={() => setFresh(null)}>Já guardei</button>
          </div>
        </div>
      )}
      {msg && <p className="intg-msg" role="status">{msg}</p>}
      {list.length > 0 ? (
        <table className="intg-table">
          <thead><tr><th scope="col">Nome</th><th scope="col">Canal</th><th scope="col">Envios</th><th scope="col">Último uso</th><th scope="col" /></tr></thead>
          <tbody>
            {list.map((w) => (
              <tr key={w.id}>
                <td>{w.name}</td><td># {chName(w.channelId)}</td><td>{w.uses}</td>
                <td>{w.lastUsedAt ? new Date(w.lastUsedAt).toLocaleString('pt-BR') : 'nunca'}</td>
                <td className="intg-actions"><button type="button" className="intg-ghost" onClick={() => rotate(w)}>Novo link</button><button type="button" className="intg-danger" onClick={() => remove(w)}>Apagar</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <p className="intg-muted">Nenhum webhook ainda.</p>}
    </Section>
  );
}

export default function IntegrationsAdmin() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  const load = useCallback(() => { api.get('/integrations/admin').then(({ data: d }) => setData(d)).catch((e) => setErr(errText(e, 'Não consegui carregar.'))); }, []);
  useEffect(load, [load]);
  if (err) return <p className="intg-msg">{err}</p>;
  if (!data) return <p className="intg-muted">Carregando…</p>;
  return (
    <div className="intg">
      <YouTubeCard data={data.youtube} onSaved={load} />
      <MinecraftCard data={data.minecraft} />
      <WebhooksCard />
    </div>
  );
}
