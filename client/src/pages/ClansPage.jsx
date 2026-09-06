import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { listPublicClans, createClan, joinClan, leaveClan, getMyClan, listClanIcons } from '../api/endpoints';
import ClanIcon from '../components/ClanIcon.jsx';

// Item pedido: "a cor inicial/padrão de todos os ícones deve ser um
// cinza neutro" — mesmo tom usado no backend (User.clanIcon default),
// primeira opção da lista (ICON_COLORS[0], usado como valor inicial).
const ICON_COLORS = ['#80848E', '#5865F2', '#EB459E', '#ED4245', '#FEE75C', '#57F287', '#00B0F4', '#9147FF', '#F0883E'];

// Item pedido: "nova aba Clans na barra lateral... lista de clans
// públicos disponíveis... seção mostrando o clan atual do usuário,
// caso ele esteja em um... botão para entrar/solicitar/sair."
export default function ClansPage() {
  const navigate = useNavigate();
  const myClan = useStore((s) => s.myClan);
  const setMyClan = useStore((s) => s.setMyClan);
  const [clans, setClans] = useState(null);
  const [icons, setIcons] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', isPublic: true, iconId: '', iconColor: ICON_COLORS[0] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [joiningId, setJoiningId] = useState(null);

  const refresh = () => listPublicClans().then((d) => setClans(d.clans));
  useEffect(() => { refresh(); listClanIcons().then((d) => setIcons(d.icons)).catch(() => {}); }, []);

  const refreshMyClan = () => getMyClan().then((d) => setMyClan(d));

  const onCreate = async () => {
    setError('');
    if (!form.name.trim()) { setError('Dê um nome ao clã.'); return; }
    setBusy(true);
    try {
      await createClan({ name: form.name.trim(), description: form.description.trim() || undefined, isPublic: form.isPublic, iconId: form.iconId || undefined, iconColor: form.iconColor });
      setShowCreate(false);
      setForm({ name: '', description: '', isPublic: true, iconId: '', iconColor: ICON_COLORS[0] });
      await Promise.all([refresh(), refreshMyClan()]);
      navigate('/clans/mine');
    } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível criar o clã.');
    } finally {
      setBusy(false);
    }
  };

  const onJoin = async (clan) => {
    setJoiningId(clan.id);
    try {
      const result = await joinClan(clan.id);
      await refreshMyClan();
      if (result.joined) navigate('/clans/mine');
      else await refresh(); // vira solicitação — nada muda na tela além de avisar
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível entrar no clã.');
    } finally {
      setJoiningId(null);
    }
  };

  const onLeave = async () => {
    setBusy(true);
    try {
      await leaveClan();
      await Promise.all([refresh(), refreshMyClan()]);
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível sair do clã.');
    } finally {
      setBusy(false);
    }
  };

  // Item pedido: "Como cada usuário só pode participar de um clã, o
  // sistema deve impedir que ele entre em outro enquanto já estiver
  // participando de um" — reforçado aqui também (o servidor já
  // rejeita de qualquer forma, mas nem mostrar o botão como clicável
  // evita a pessoa tentar e levar um erro à toa).
  const alreadyInClan = !!myClan;

  return (
    <div className="clans-page">
      <div className="clans-page-header">
        <h1>⚔️ Clãs</h1>
        <p className="dim">Crie seu próprio clã ou entre em um já existente — cada pessoa participa de só um por vez.</p>
        {!alreadyInClan && (
          <button className="btn-primary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'Cancelar' : '+ Criar clã'}
          </button>
        )}
      </div>

      {showCreate && (
        <div className="clan-create-form">
          <div className="clan-create-icon-row">
            <div className="clan-icon-preview">
              <ClanIcon icon={icons.find((i) => i.id === form.iconId)} color={form.iconColor} />
            </div>
            <div className="clan-create-icon-fields">
              <label>
                ÍCONE
                <select value={form.iconId} onChange={(e) => setForm({ ...form, iconId: e.target.value })}>
                  <option value="">Padrão</option>
                  {icons.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </label>
              <label>
                COR
                <div className="clan-color-swatches">
                  {ICON_COLORS.map((c) => (
                    <button
                      type="button" key={c}
                      className={`clan-color-swatch ${form.iconColor === c ? 'active' : ''}`}
                      style={{ background: c }}
                      onClick={() => setForm({ ...form, iconColor: c })}
                    />
                  ))}
                </div>
              </label>
            </div>
          </div>
          <label>
            NOME
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} placeholder="Nome do clã" />
          </label>
          <label>
            DESCRIÇÃO (opcional)
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={200} placeholder="Sobre o que é o seu clã" rows={2} />
          </label>
          <label className="clan-public-toggle">
            <input type="checkbox" checked={form.isPublic} onChange={(e) => setForm({ ...form, isPublic: e.target.checked })} />
            {form.isPublic ? 'Público — qualquer um pode entrar direto' : 'Privado — precisa de solicitação aprovada'}
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn-primary" onClick={onCreate} disabled={busy}>{busy ? 'Criando...' : 'Criar clã'}</button>
        </div>
      )}

      {myClan && (
        <div className="clan-mine-section">
          <div className="permission-group-label">SEU CLÃ</div>
          <div className="clan-card clan-card-mine" onClick={() => navigate('/clans/mine')}>
            <div className="clan-icon-preview">
              <ClanIcon icon={myClan.icon} color={myClan.iconColor} />
            </div>
            <div className="clan-card-body">
              <div className="clan-card-name">{myClan.name} {!myClan.isPublic && <span className="clan-private-badge">🔒 Privado</span>}</div>
              <div className="dim">{myClan.memberCount} membro{myClan.memberCount === 1 ? '' : 's'}</div>
            </div>
            <button className="btn-secondary" onClick={(e) => { e.stopPropagation(); onLeave(); }} disabled={busy}>Sair</button>
          </div>
        </div>
      )}

      <div className="permission-group-label">CLÃS PÚBLICOS</div>
      {!clans ? (
        <div className="dim">Carregando clãs...</div>
      ) : clans.length === 0 ? (
        <div className="dim">Nenhum clã público ainda — seja o primeiro a criar um!</div>
      ) : (
        <div className="clans-grid">
          {clans.filter((c) => c.id !== myClan?.id).map((clan) => (
            <div key={clan.id} className="clan-card">
              <div className="clan-icon-preview">
                <ClanIcon icon={clan.icon} color={clan.iconColor} />
              </div>
              <div className="clan-card-body">
                <div className="clan-card-name">{clan.name}</div>
                {clan.description && <div className="dim clan-card-desc">{clan.description}</div>}
                <div className="dim">{clan.memberCount} membro{clan.memberCount === 1 ? '' : 's'}</div>
              </div>
              <button
                className="btn-primary" disabled={alreadyInClan || joiningId === clan.id}
                onClick={() => onJoin(clan)}
                title={alreadyInClan ? 'Saia do seu clã atual antes de entrar em outro' : undefined}
              >
                {joiningId === clan.id ? '...' : 'Entrar'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
