import { useEffect, useState } from 'react';
import { getMyEconomy, setWalletCardStyle } from '../../api/endpoints';
import WalletCard from '../WalletCard.jsx';
import { Ico } from '../PagesKit.jsx';

// Loja → "Cartão da carteira": escolhe o estilo do cartão (Economia e
// "Mostrar cartão" no chat). Azul é de todo mundo; o preto e dourado é do
// Assinante; o preto e arco-íris, do Super Assinante. Quem assina pode
// voltar pra qualquer estilo que a sua categoria libera. A permissão é
// conferida no servidor (services/walletCard.js).
const OPTIONS = [
  { id: 'DEFAULT', name: 'Clássico', desc: 'O cartão azul do Project Club.', need: null },
  { id: 'GOLD', name: 'Preto e dourado', desc: 'Exclusivo de Assinante.', need: 'Assinante' },
  { id: 'RAINBOW', name: 'Preto e arco-íris', desc: 'Exclusivo de Super Assinante.', need: 'Super Assinante' },
];

export default function WalletCardStyles({ user, flash, onPlans }) {
  const [eco, setEco] = useState(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => { getMyEconomy().then(setEco).catch(() => setError('Não foi possível carregar o seu cartão.')); }, []);

  const choose = async (id) => {
    setBusy(id); setError('');
    try {
      const r = await setWalletCardStyle(id);
      setEco((e) => (e ? { ...e, cardStyle: r.style, cardStyles: r.styles } : e));
      flash?.('Estilo do cartão atualizado.');
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível trocar o estilo.');
    } finally { setBusy(''); }
  };

  return (
    <div className="room-page wcs">
      <div className="room-page-head">
        <h1>Cartão da carteira</h1>
        <p>Escolha o visual do seu cartão na Economia e quando você mostrar ele no chat.</p>
      </div>
      {error && <p className="wcs-error">{error}</p>}
      {!eco ? (!error && <p className="room-muted">Carregando…</p>) : (
        <div className="wcs-grid">
          {OPTIONS.map((o) => {
            const unlocked = (eco.cardStyles || ['DEFAULT']).includes(o.id);
            const current = eco.cardStyle === o.id;
            return (
              <div key={o.id} className={`wcs-option${current ? ' is-current' : ''}${unlocked ? '' : ' is-locked'}`}>
                <WalletCard user={user} coins={eco.coins} gems={eco.gems} level={eco.accountLevel} variant={o.id} compact hint={false} />
                <div className="wcs-info">
                  <strong>{o.name}</strong>
                  <span>{o.desc}</span>
                </div>
                {current ? (
                  <span className="wcs-badge"><Ico name="check" size={14} /> Em uso</span>
                ) : unlocked ? (
                  <button type="button" className="room-btn primary" disabled={!!busy} onClick={() => choose(o.id)}>{busy === o.id ? 'Salvando…' : 'Usar este'}</button>
                ) : (
                  <button type="button" className="room-btn" onClick={onPlans}><Ico name="lock" size={14} /> Seja {o.need}</button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
