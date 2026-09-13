import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useAuth } from '../context/AuthContext.jsx';
import {
  listPublicClans, createClan, joinClan, leaveClan, getMyClan, listClanIcons,
  listMyClanInvites, respondClanInvite,
} from '../api/endpoints';
import ClanIcon from '../components/ClanIcon.jsx';

// Item pedido: "a cor inicial/padrão de todos os ícones deve ser um
// cinza neutro" — mesmo tom usado no backend (User.clanIcon default),
// primeira opção da lista (ICON_COLORS[0], usado como valor inicial).
const ICON_COLORS = ['#80848E', '#5865F2', '#EB459E', '#ED4245', '#FEE75C', '#57F287', '#00B0F4', '#9147FF', '#F0883E'];

const CREATE_LEVEL_REQUIREMENT = 10;

// Item pedido: "renomear o sistema atual de Clãs para Clubes... dentro
// de Social, criar as abas: Amigos / Mensagens / Clubes" — antes era
// uma página própria (rota /clans); agora é renderizado como o
// conteúdo da aba "Clubes" dentro de AmigosPage.jsx (Social). "A aba
// Encontrar Clubes deve aparecer somente quando o usuário não estiver
// em nenhum Clube" — não é mais uma aba separada de verdade: quando
// já está em um clube, esta mesma tela mostra só o resumo dele (sem a
// lista de "Encontrar Clubes" nem o formulário de criar); quando sai,
// a lista some/volta sozinha, guiada só por myClan existir ou não.
export default function ClansPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const myClan = useStore((s) => s.myClan);
  const setMyClan = useStore((s) => s.setMyClan);
  const [clans, setClans] = useState(null);
  const [icons, setIcons] = useState([]);
  const [invites, setInvites] = useState([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', description: '', privacyType: 'PUBLIC', iconId: '', iconColor: ICON_COLORS[0] });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [joiningId, setJoiningId] = useState(null);

  const refresh = () => listPublicClans().then((d) => setClans(d.clans));
  const refreshInvites = () => listMyClanInvites().then((d) => setInvites(d.invites)).catch(() => {});
  useEffect(() => { refresh(); refreshInvites(); listClanIcons().then((d) => setIcons(d.icons)).catch(() => {}); }, []);

  const refreshMyClan = () => getMyClan().then((d) => setMyClan(d));

  // Item pedido: "Usuários poderão criar um Clube somente após atingir
  // o nível 10" — o servidor já valida isso de qualquer forma (rede
  // de segurança real); aqui é só pra nem mostrar o formulário como
  // opção pra quem ainda não tem nível, evitando um erro previsível.
  const canCreate = (user.accountLevel || 0) >= CREATE_LEVEL_REQUIREMENT;

  const onCreate = async () => {
    setError('');
    if (!form.name.trim()) { setError('Dê um nome ao clube.'); return; }
    setBusy(true);
    try {
      await createClan({ name: form.name.trim(), description: form.description.trim() || undefined, privacyType: form.privacyType, iconId: form.iconId || undefined, iconColor: form.iconColor });
      setShowCreate(false);
      setForm({ name: '', description: '', privacyType: 'PUBLIC', iconId: '', iconColor: ICON_COLORS[0] });
      await Promise.all([refresh(), refreshMyClan()]);
      navigate('/clans/mine');
    } catch (err) {
      setError(err?.response?.data?.error || 'Não foi possível criar o clube.');
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
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível entrar no clube.');
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
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível sair do clube.');
    } finally {
      setBusy(false);
    }
  };

  const onRespondInvite = async (invite, accept) => {
    try {
      const result = await respondClanInvite(invite.id, accept);
      await refreshInvites();
      if (result.accepted) { await refreshMyClan(); navigate('/clans/mine'); }
    } catch (err) {
      useStore.getState().pushNotice(err?.response?.data?.error || 'Não foi possível responder o convite.');
    }
  };

  // Item pedido: "Como cada usuário só pode participar de um clã, o
  // sistema deve impedir que ele entre em outro enquanto já estiver
  // participando de um" — reforçado aqui também (o servidor já
  // rejeita de qualquer forma, mas nem mostrar o botão como clicável
  // evita a pessoa tentar e levar um erro à toa).
  const alreadyInClan = !!myClan;

  // Item pedido: "A aba Encontrar Clubes deve aparecer somente quando
  // o usuário não estiver em nenhum Clube" — já em um clube: mostra só
  // o resumo dele com a opção de sair, sem lista/criação.
  if (alreadyInClan) {
    return (
      <div className="clans-page">
        <div className="clan-mine-section">
          <div className="permission-group-label">SEU CLUBE</div>
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
      </div>
    );
  }

  return (
    <div className="clans-page">
      <div className="clans-page-header">
        <h1>⚔️ Encontrar Clubes</h1>
        <p className="dim">Crie seu próprio clube ou entre em um já existente — cada pessoa participa de só um por vez.</p>
        {canCreate ? (
          <button className="btn-primary" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? 'Cancelar' : '+ Criar clube'}
          </button>
        ) : (
          <p className="dim">Você precisa estar no nível {CREATE_LEVEL_REQUIREMENT} pra criar um clube.</p>
        )}
      </div>

      {/* Item pedido: "Somente por convite — entrada apenas através de
          convite" — convites recebidos aparecem aqui, já que clubes
          "somente por convite" nunca entram na lista de baixo. */}
      {invites.length > 0 && (
        <>
          <div className="permission-group-label">CONVITES PENDENTES</div>
          <div className="clans-grid">
            {invites.map((invite) => (
              <div key={invite.id} className="clan-card">
                <div className="clan-icon-preview"><ClanIcon icon={invite.clan.icon} color={invite.clan.iconColor} /></div>
                <div className="clan-card-body">
                  <div className="clan-card-name">{invite.clan.name}</div>
                  <div className="dim">Convite de {invite.invitedBy.displayName}</div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button className="btn-primary" onClick={() => onRespondInvite(invite, true)}>Aceitar</button>
                  <button className="btn-secondary" onClick={() => onRespondInvite(invite, false)}>Recusar</button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {showCreate && canCreate && (
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
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={40} placeholder="Nome do clube" />
          </label>
          <label>
            DESCRIÇÃO (opcional)
            <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={200} placeholder="Sobre o que é o seu clube" rows={2} />
          </label>
          {/* Item pedido: "Clubes poderão ser Públicos ou Privados.
              Clubes privados terão duas opções: Exclusivo para amigos
              ... Somente por convite" — 3 opções em vez do antigo
              checkbox público/privado simples. */}
          <label>
            PRIVACIDADE
            <select value={form.privacyType} onChange={(e) => setForm({ ...form, privacyType: e.target.value })}>
              <option value="PUBLIC">Público — qualquer um pode entrar direto</option>
              <option value="FRIENDS_ONLY">Exclusivo para amigos — só amigos do dono podem entrar</option>
              <option value="INVITE_ONLY">Somente por convite — entrada só com convite</option>
            </select>
          </label>
          {error && <div className="form-error">{error}</div>}
          <button className="btn-primary" onClick={onCreate} disabled={busy}>{busy ? 'Criando...' : 'Criar clube'}</button>
        </div>
      )}

      <div className="permission-group-label">CLUBES PÚBLICOS</div>
      {!clans ? (
        <div className="dim">Carregando clubes...</div>
      ) : clans.length === 0 ? (
        <div className="dim">Nenhum clube público ainda — seja o primeiro a criar um!</div>
      ) : (
        <div className="clans-grid">
          {clans.map((clan) => (
            <div key={clan.id} className="clan-card">
              <div className="clan-icon-preview">
                <ClanIcon icon={clan.icon} color={clan.iconColor} />
              </div>
              <div className="clan-card-body">
                <div className="clan-card-name">
                  {clan.name}
                  {/* Item pedido: "Clubes configurados como Exclusivo
                      para amigos também aparecerão em Encontrar
                      Clubes, mostrando uma tag indicando qual amigo do
                      usuário pertence àquele Clube." */}
                  {clan.friendMember && <span className="clan-private-badge">👥 amigo: {clan.friendMember.displayName}</span>}
                </div>
                {clan.description && <div className="dim clan-card-desc">{clan.description}</div>}
                <div className="dim">{clan.memberCount} membro{clan.memberCount === 1 ? '' : 's'}</div>
              </div>
              <button
                className="btn-primary" disabled={alreadyInClan || joiningId === clan.id}
                onClick={() => onJoin(clan)}
                title={alreadyInClan ? 'Saia do seu clube atual antes de entrar em outro' : undefined}
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
