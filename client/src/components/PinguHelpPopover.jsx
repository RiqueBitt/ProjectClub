import { useEffect, useState } from 'react';
import { getPinguHelp } from '../api/endpoints';
import { groupCommands } from '../utils/pinguMessage';
import { useOpenDM } from './DMQuick.jsx';
import '../styles/pingu.css';

// Pingu Turbo: "Comandos do Pingu" no miniperfil do Pingu. A lista vem do
// servidor (a mesma do "@pingu ajuda"), então nunca fica desatualizada.
let cached = null;

export default function PinguHelpPopover({ userId, onNavigate }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(cached);
  const [error, setError] = useState('');
  const openDM = useOpenDM();

  useEffect(() => {
    if (!open || data) return;
    getPinguHelp().then((r) => { cached = r; setData(r); }).catch(() => setError('Não deu pra carregar os comandos agora.'));
  }, [open, data]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const groups = groupCommands(data?.commands || []);
  return (
    <div className="pingu-help">
      <div className="pingu-help-actions">
        <button type="button" className="btn-secondary pingu-help-btn" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          🐧 Comandos do Pingu
        </button>
        <button type="button" className="btn-secondary pingu-help-btn" onClick={() => { onNavigate?.(); openDM(userId); }}>
          Conversar no privado
        </button>
      </div>
      {open && (
        <div className="pingu-help-pop" role="dialog" aria-label="Comandos do Pingu">
          {!data && !error && <p className="dim">Carregando…</p>}
          {error && <p className="pingu-eph-error">{error}</p>}
          {groups.map((g) => (
            <section key={g.name} className="pingu-help-group">
              <h4>{g.name}</h4>
              <ul>
                {g.items.map((c) => (
                  <li key={c.cmd}>
                    <code>{c.cmd}</code>
                    <span>{c.desc}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
          {data && !data.online && <p className="dim pingu-help-note">A IA está offline agora: as respostas instantâneas, imagens, lembretes e enquetes continuam funcionando.</p>}
        </div>
      )}
    </div>
  );
}
