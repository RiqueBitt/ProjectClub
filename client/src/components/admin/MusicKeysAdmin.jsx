import { useEffect, useState } from 'react';
import { getMusicKeys, saveMusicKeys } from '../../api/endpoints';

// Painel da Equipe → Música: chaves do Spotify e do Last.fm (Atividades →
// Música). Ficam criptografadas no servidor (mesmo cofre do servidor de voz);
// os segredos nunca voltam pro navegador, só "definido" + 4 últimos caracteres.
export default function MusicKeysAdmin() {
  const [data, setData] = useState(null);
  const [values, setValues] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { getMusicKeys().then(setData).catch((e) => setError(e?.response?.data?.error || 'Não deu pra carregar.')); }, []);

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setMsg(''); setError('');
    try {
      // Campo vazio = não muda; só espaço = apaga a chave.
      const payload = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '').map(([k, v]) => [k, v.trim() ? v.trim() : '']));
      const d = await saveMusicKeys(payload);
      setData(d); setValues({}); setMsg('Salvo. Já vale agora, sem reiniciar.');
    } catch (err) { setError(err?.response?.data?.error || 'Não deu pra salvar.'); } finally { setBusy(false); }
  };
  if (!data) return error ? <p className="inst-error">{error}</p> : <p className="staff-empty">Carregando…</p>;

  return (
    <form className="mk-admin" onSubmit={save}>
      <p className="mk-intro">
        A atividade <strong>Música</strong> funciona sempre com o YouTube Music. Pra liberar o <strong>Spotify</strong> e o
        <strong> Last.fm</strong> (buscar e conectar a conta pra ver as playlists), cole as chaves abaixo. As músicas
        continuam tocando pelo YouTube, então ninguém precisa de Premium.
      </p>
      <div className="mk-fields">
        {data.fields.map((f) => (
          <label key={f.env} className="mk-field">
            <span>{f.label} {f.set ? <em className="mk-set">definido{f.source === 'hospedagem' ? ' (hospedagem)' : ''}</em> : <em className="mk-unset">vazio</em>}</span>
            <input
              type={f.secret ? 'password' : 'text'} autoComplete="off" spellCheck={false}
              placeholder={f.set ? f.value || '••••' : 'Cole aqui'}
              value={values[f.env] ?? ''} onChange={(e) => setValues((v) => ({ ...v, [f.env]: e.target.value }))}
            />
          </label>
        ))}
      </div>
      <details className="mk-help">
        <summary>Como conseguir as chaves</summary>
        <ol>
          <li><b>Spotify:</b> entre em developer.spotify.com/dashboard → <i>Create app</i>. Em <i>Redirect URIs</i> coloque exatamente:<br /><code>{data.redirectUri}</code><br />Marque <i>Web API</i>, salve e copie o <i>Client ID</i> e o <i>Client secret</i>.</li>
          <li>O app novo do Spotify fica em "modo de desenvolvimento": só as contas que você adicionar em <i>User Management</i> (até 25) conseguem conectar. A busca sem conta funciona pra todo mundo.</li>
          <li><b>Last.fm:</b> entre em last.fm/api/account/create, preencha nome e descrição e copie a <i>API key</i>.</li>
        </ol>
      </details>
      {error && <p className="inst-error" role="alert">{error}</p>}
      {msg && <p className="mk-ok" role="status">{msg}</p>}
      <div><button type="submit" className="btn-primary" disabled={busy || !Object.values(values).some((v) => v !== '')}>{busy ? 'Salvando…' : 'Salvar chaves'}</button></div>
      <p className="mk-note">Deixar um campo vazio e salvar não muda nada. Pra apagar uma chave, escreva um espaço e salve.</p>
    </form>
  );
}
