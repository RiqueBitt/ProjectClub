import { useEffect, useState } from 'react';
import { addPasskey, isCancel, listPasskeys, passkeysSupported, removePasskey } from '../../utils/passkeys';

// Configurações → Segurança → Chaves de acesso.
export default function PasskeysBlock() {
  const [keys, setKeys] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [ok, setOk] = useState('');
  const supported = passkeysSupported();

  useEffect(() => { listPasskeys().then(setKeys).catch(() => setKeys([])); }, []);

  const add = async () => {
    setBusy(true); setError(''); setOk('');
    try {
      const k = await addPasskey();
      setKeys((cur) => [k, ...(cur || [])]);
      setOk('Chave de acesso criada! Na próxima vez, toque em "Entrar com chave de acesso" no login.');
    } catch (e) {
      if (!isCancel(e)) setError(e?.response?.data?.error || 'Não deu pra criar a chave de acesso neste aparelho.');
    }
    setBusy(false);
  };
  const remove = async (k) => {
    if (!window.confirm(`Apagar a chave "${k.name}"? Você não vai mais conseguir entrar com ela.`)) return;
    await removePasskey(k.id).catch(() => {});
    setKeys((cur) => (cur || []).filter((x) => x.id !== k.id));
  };
  const when = (d) => (d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : 'nunca');

  return (
    <div className="settings-block">
      <h4 className="settings-h4-row">Chaves de acesso {keys?.length ? <span className="settings-chip">{keys.length}</span> : null}</h4>
      <p className="dim">Entre sem senha, com a digital, o rosto ou o PIN deste aparelho (Windows Hello, Android, iPhone). Mais seguro que senha: não dá pra ser roubada por site falso.</p>
      {!supported && <p className="dim">Este navegador não aceita chaves de acesso.</p>}
      {keys?.length > 0 && (
        <ul className="pk-list">
          {keys.map((k) => (
            <li key={k.id}>
              <div>
                <strong>{k.name}</strong>
                <span className="dim">Criada em {when(k.createdAt)} · último uso: {when(k.lastUsedAt)}</span>
              </div>
              <button type="button" className="btn-danger" onClick={() => remove(k)}>Apagar</button>
            </li>
          ))}
        </ul>
      )}
      {error && <div className="auth-error">{error}</div>}
      {ok && <div className="dim">{ok}</div>}
      {supported && <button type="button" className="btn-primary" disabled={busy} onClick={add}>{busy ? 'Aguardando o aparelho…' : 'Criar chave de acesso'}</button>}
    </div>
  );
}
