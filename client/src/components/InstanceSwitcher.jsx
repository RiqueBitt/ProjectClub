import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { getCommunity, setCurrentInstance } from '../api/endpoints';
import { errText } from '../api/community';
import '../styles/instance-switcher.css';

// Seletor de instância (Pública, Amigos, Empresarial...): cada instância
// tem as próprias categorias, canais e calls; o resto do app é igual.
// Só aparece pra quem tem acesso a mais de uma (a equipe libera em
// Painel da Equipe → Instâncias).
export default function InstanceSwitcher({ className = '' }) {
  const navigate = useNavigate();
  const community = useStore((s) => s.community);
  const list = community?.instances || [];
  const currentId = community?.instance || 'publica';
  const current = list.find((i) => i.id === currentId) || list[0];
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('pointerdown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);

  if (list.length < 2 || !current) return null;

  const choose = async (id) => {
    if (id === currentId) { setOpen(false); return; }
    setBusy(id);
    setError('');
    try {
      await setCurrentInstance(id);
      const data = await getCommunity();
      useStore.getState().setCommunityStructure({
        categories: data.categories, channels: data.channels, members: data.members, roles: data.roles, community: data.community,
      });
      setOpen(false);
      // O canal aberto era da outra instância: volta pro início do chat.
      navigate('/');
    } catch (err) {
      setError(errText ? errText(err) : 'Não deu pra trocar de instância.');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={`instance-switcher ${className}`} ref={ref}>
      <button
        type="button"
        className={`instance-switcher-btn${current.isPublic ? '' : ' is-private'}`}
        aria-haspopup="listbox" aria-expanded={open}
        aria-label={`Instância: ${current.name}. Trocar de instância`}
        onClick={(e) => { e.stopPropagation(); setOpen((v) => !v); }}
      >
        {current.icon && <span className="instance-switcher-icon" aria-hidden="true">{current.icon}</span>}
        <span className="instance-switcher-name">{current.name}</span>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open && (
        <div className="instance-switcher-menu" role="listbox" aria-label="Escolher instância" onClick={(e) => e.stopPropagation()}>
          <p className="instance-switcher-title">Instância</p>
          {list.map((i) => (
            <button
              key={i.id} type="button" role="option" aria-selected={i.id === currentId}
              className={`instance-switcher-item${i.id === currentId ? ' is-current' : ''}`}
              disabled={!!busy} onClick={() => choose(i.id)}
            >
              <span className="instance-switcher-icon" aria-hidden="true">{i.icon || '•'}</span>
              <span className="instance-switcher-item-text">
                <strong>{i.name}</strong>
                <small>{i.isPublic ? 'Todo mundo' : 'Privada'}</small>
              </span>
              {busy === i.id ? <span className="instance-switcher-busy" aria-hidden="true" /> : i.id === currentId && <span className="instance-switcher-check" aria-hidden="true">✓</span>}
            </button>
          ))}
          {error && <p className="instance-switcher-error" role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
