import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import UserAvatar from '../components/UserAvatar.jsx';
import { createConversation, sendMessage } from '../api/endpoints';
import { Icon, UI } from './CardView.jsx';
import BotPortrait from './BotPortrait.jsx';
import { BoardThumb } from './BoardScene.jsx';
import { UserPicker } from './Trades.jsx';
import {
  cardsCreateLobby, cardsLobby, cardsJoinLobby, cardsLeaveLobby, cardsLobbySlot, cardsLobbyInvite, cardsStartLobby, errMsg,
} from './api';

// Salas de batalha: cria (1v1 ou 2v2, normal ou personalizada), gera o link
// pra copiar/mandar no chat, convida amigos (aviso + DM) e o dono começa.

const BOT_LEVELS = [['FACIL', 'Fácil'], ['MEDIO', 'Médio'], ['DIFICIL', 'Difícil'], ['LENDARIO', 'Lendário']];
const DEFAULT_RULES = { startHp: 30, startHand: 4, maxHand: 8, maxEnergy: 10, startEnergy: 0, drawPerTurn: 1, boardSize: 5, turnSeconds: 75, elementBonus: 1, cardLevel: 1, deckMode: 'OWN' };
export const PRESETS = [
  { key: 'padrao', label: 'Padrão', desc: 'Regras normais do jogo.', rules: {} },
  { key: 'relampago', label: 'Relâmpago', desc: 'Partida curta: 15 de vida, 3 de energia logo no início e 30s por turno.', rules: { startHp: 15, startEnergy: 2, turnSeconds: 30 } },
  { key: 'caos', label: 'Caos', desc: 'Baralhos aleatórios com TODAS as cartas, compra 2 por turno.', rules: { deckMode: 'ALL', drawPerTurn: 2, cardLevel: 3, maxHand: 10 } },
  { key: 'gigantes', label: 'Gigantes', desc: '60 de vida, campo com 7 lugares e energia até 12.', rules: { startHp: 60, boardSize: 7, maxEnergy: 12 } },
  { key: 'lendario', label: 'Tudo lendário', desc: 'Todas as cartas liberadas no nível máximo.', rules: { deckMode: 'ALL', cardLevel: 5 } },
];
const FIELDS = [
  ['startHp', 'Vida inicial', 10, 80], ['startHand', 'Cartas na mão inicial', 2, 7], ['maxHand', 'Limite da mão', 5, 10],
  ['startEnergy', 'Energia extra no início', 0, 9], ['maxEnergy', 'Energia máxima', 3, 15], ['drawPerTurn', 'Compras por turno', 1, 3],
  ['boardSize', 'Lugares no campo', 3, 8], ['turnSeconds', 'Segundos por turno', 20, 240], ['elementBonus', 'Bônus de elemento', 0, 3],
];

function RulesEditor({ rules, onChange }) {
  const set = (k, v) => onChange({ ...rules, [k]: v });
  return (
    <div className="tcgl-rules">
      <div className="tcgl-presets">
        {PRESETS.map((p) => (
          <button key={p.key} type="button" className="tcgl-preset" onClick={() => onChange({ ...DEFAULT_RULES, ...p.rules })} title={p.desc}>
            <b>{p.label}</b><small>{p.desc}</small>
          </button>
        ))}
      </div>
      <div className="tcgl-fields">
        {FIELDS.map(([k, label, min, max]) => (
          <label key={k} className="tcgl-field">
            <span>{label} <b>{rules[k]}</b></span>
            <input type="range" min={min} max={max} value={rules[k]} onChange={(e) => set(k, Number(e.target.value))} />
          </label>
        ))}
        <label className="tcgl-field">
          <span>Baralhos</span>
          <select className="tcg-select" value={rules.deckMode} onChange={(e) => set('deckMode', e.target.value)}>
            <option value="OWN">Cada um usa o seu baralho</option>
            <option value="ALL">Aleatório com TODAS as cartas</option>
          </select>
        </label>
        {rules.deckMode === 'ALL' && (
          <label className="tcgl-field">
            <span>Nível das cartas <b>{rules.cardLevel}</b></span>
            <input type="range" min={1} max={5} value={rules.cardLevel} onChange={(e) => set('cardLevel', Number(e.target.value))} />
          </label>
        )}
      </div>
    </div>
  );
}

function CreateForm({ boards, onCreated, onClose, initialFormat = '1V1', initialCustom = false }) {
  const [format, setFormat] = useState(initialFormat);
  const [custom, setCustom] = useState(initialCustom);
  const [rules, setRules] = useState(DEFAULT_RULES);
  const [boardId, setBoardId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const create = async () => {
    setBusy(true); setErr('');
    try { const d = await cardsCreateLobby({ format, custom, rules: custom ? rules : undefined, boardId: boardId || undefined }); onCreated(d.lobby); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return (
    <div className="tcgl-create">
      <h2>Criar batalha</h2>
      <p className="tcg-dim">Monte a sala, copie o link e mande no chat ou na DM de quem você quer chamar.</p>
      <div className="tcgl-choice">
        {[['1V1', '1 vs 1', 'Duelo clássico'], ['2V2', '2 vs 2', 'Em dupla: herói e campo do time são compartilhados; cada um joga na sua vez com a própria mão']].map(([k, t, d]) => (
          <button key={k} type="button" className={`tcgl-opt${format === k ? ' on' : ''}`} onClick={() => setFormat(k)}>
            <span className="tcgl-opt-icon"><Icon d={k === '1V1' ? UI.sword : UI.users} size={22} /></span><b>{t}</b><small>{d}</small>
          </button>
        ))}
      </div>
      <div className="tcgl-choice">
        {[[false, 'Normal', 'Regras oficiais. Vale moedas como uma partida PvP.'], [true, 'Personalizada', 'Você escolhe as regras. Ninguém ganha moedas nem nada — é só diversão.']].map(([k, t, d]) => (
          <button key={String(k)} type="button" className={`tcgl-opt${custom === k ? ' on' : ''}`} onClick={() => setCustom(k)}>
            <span className="tcgl-opt-icon"><Icon d={k ? UI.wand : UI.trophy} size={22} /></span><b>{t}</b><small>{d}</small>
          </button>
        ))}
      </div>
      {custom && <RulesEditor rules={rules} onChange={setRules} />}
      {boards?.length > 0 && (
        <>
          <h4 className="tca-h4">Mesa</h4>
          <div className="tcgl-boards">
            <button type="button" className={`tcgl-board${!boardId ? ' on' : ''}`} onClick={() => setBoardId('')}><span className="tcgl-board-rand"><Icon d={UI.swap} size={20} /></span><small>Sorteada</small></button>
            {boards.map((b) => (
              <button key={b.id} type="button" className={`tcgl-board${boardId === b.id ? ' on' : ''}`} onClick={() => setBoardId(b.id)}><BoardThumb board={b} /><small>{b.name}</small></button>
            ))}
          </div>
        </>
      )}
      {err && <p className="tcg-error">{err}</p>}
      <div className="tcgl-actions">
        <button type="button" className="tcg-btn ghost" onClick={onClose}>Cancelar</button>
        <button type="button" className="tcg-btn primary tcg-btn-xl" disabled={busy} onClick={create}><Icon d={UI.plus} />{busy ? 'Criando…' : 'Criar sala'}</button>
      </div>
    </div>
  );
}

function Slot({ s, lobby, me, onJoin, onBot, onKick }) {
  const mine = s.user?.id === me?.id;
  return (
    <div className={`tcgl-slot${mine ? ' is-me' : ''}${!s.user && !s.bot ? ' is-empty' : ''}`}>
      {s.user ? <UserAvatar user={s.user} size={46} /> : s.bot ? <BotPortrait name={s.bot.name} size={46} /> : <span className="tcgl-slot-empty"><Icon d={UI.plus} size={20} /></span>}
      <span className="tcgl-slot-name">
        <b data-no-translate>{s.user?.displayName || (s.bot ? `${s.bot.name}` : 'Lugar livre')}</b>
        <small>{s.index === 0 ? 'Dono da sala' : s.bot ? `Bot · ${s.bot.label}` : s.user ? (mine ? 'Você' : 'Pronto') : 'Esperando alguém'}</small>
      </span>
      <span className="tcgl-slot-acts">
        {!s.user && !s.bot && lobby.mySlot !== 0 && lobby.status === 'OPEN' && <button type="button" className="tcg-btn tcg-btn-sm" onClick={() => onJoin(s.index)}>{lobby.mySlot >= 0 ? 'Mudar pra cá' : 'Entrar'}</button>}
        {lobby.isHost && s.index > 0 && lobby.status === 'OPEN' && !s.user && (
          <select className="tcg-select tcgl-bot-select" value={s.bot?.difficulty || ''} onChange={(e) => onBot(s.index, e.target.value || null)} aria-label="Bot neste lugar">
            <option value="">{s.bot ? 'Tirar bot' : '+ Bot'}</option>
            {BOT_LEVELS.map(([k, l]) => <option key={k} value={k}>Bot {l}</option>)}
          </select>
        )}
        {lobby.isHost && s.index > 0 && s.user && lobby.status === 'OPEN' && <button type="button" className="tcg-icon-btn" onClick={() => onKick(s.index)} aria-label="Remover da sala"><Icon d={UI.close} size={14} /></button>}
      </span>
    </div>
  );
}

const ruleText = (r) => {
  if (!r) return [];
  const out = [`${r.startHp} de vida`, `${r.startHand} cartas na mão`, `${r.turnSeconds}s por turno`];
  if (r.startEnergy) out.push(`+${r.startEnergy} de energia no início`);
  if (r.drawPerTurn > 1) out.push(`compra ${r.drawPerTurn} por turno`);
  if (r.maxEnergy !== 10) out.push(`energia até ${r.maxEnergy}`);
  if (r.boardSize !== 5) out.push(`${r.boardSize} lugares no campo`);
  if (r.deckMode === 'ALL') out.push(`baralho aleatório (nível ${r.cardLevel})`);
  return out;
};

export default function LobbyRoom({ code: initialCode, me, boards, onClose, onStarted, onStartMatch, createDefaults }) {
  const { socket } = useSocket() || {};
  const [code, setCode] = useState(initialCode || null);
  const [lobby, setLobby] = useState(null);
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState(false);
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    if (!code) return;
    try {
      const d = await cardsLobby(code);
      setLobby(d.lobby);
      if (d.lobby.status === 'STARTED' && d.lobby.matchId && d.lobby.mySlot >= 0 && !startedRef.current) { startedRef.current = true; onStarted?.(d.lobby.matchId); }
    } catch (e) { setErr(errMsg(e)); }
  }, [code, onStarted]);
  useEffect(() => { load(); const t = setInterval(load, 2500); return () => clearInterval(t); }, [load]);
  useEffect(() => {
    if (!socket) return undefined;
    const on = (msg) => {
      if (msg?.code !== code) return;
      if (msg.kicked) { setErr('O dono da sala tirou você da sala.'); setLobby(null); return; }
      load();
    };
    socket.on('cards:lobby', on);
    return () => socket.off('cards:lobby', on);
  }, [socket, code, load]);

  const link = useMemo(() => (lobby ? `${window.location.origin}${lobby.link}` : ''), [lobby]);
  const run = async (fn, okMsg) => {
    setErr(''); setNote('');
    try { const r = await fn(); if (r?.lobby) setLobby(r.lobby); if (okMsg) setNote(okMsg); return r; } catch (e) { setErr(errMsg(e)); return null; }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(link); setNote('Link copiado! Cole no chat ou na DM.'); } catch { setNote(link); }
  };
  const inviteUser = async (u) => {
    setInviting(false);
    await run(() => cardsLobbyInvite(lobby.code, u.id));
    // Também manda na DM: lá vira um cartão com "Entrar na batalha".
    try {
      const { conversation } = await createConversation([u.id]);
      const fd = new FormData();
      fd.append('conversationId', conversation.id);
      fd.append('content', `⚔️ Bora uma batalha ${lobby.format === '2V2' ? '2 vs 2' : '1 vs 1'}${lobby.custom ? ' personalizada' : ''} na Guerra das Cartas? ${link}`);
      await sendMessage(fd);
      setNote(`Convite enviado pra ${u.displayName} (aviso + DM).`);
    } catch { setNote(`Aviso enviado pra ${u.displayName}.`); }
  };
  const start = async () => {
    setBusy(true);
    const m = await run(() => cardsStartLobby(lobby.code));
    setBusy(false);
    if (m?.id) { startedRef.current = true; onStartMatch?.(m); }
  };
  const leave = async () => { if (lobby?.mySlot >= 0) await cardsLeaveLobby(lobby.code).catch(() => {}); onClose(); };

  if (!code) {
    return (
      <div className="tcg-modal tcgl-modal" onClick={onClose}>
        <div className="tcgl-box" onClick={(e) => e.stopPropagation()}>
          <CreateForm boards={boards} onClose={onClose} onCreated={(l) => { setLobby(l); setCode(l.code); }} {...(createDefaults || {})} />
        </div>
      </div>
    );
  }

  const teams = lobby ? (lobby.format === '2V2' ? [[0, 2], [1, 3]] : [[0], [1]]) : [];
  return (
    <div className="tcg-modal tcgl-modal" onClick={onClose}>
      <div className="tcgl-box" onClick={(e) => e.stopPropagation()}>
        {!lobby ? (
          <div className="tcgl-loading">{err ? <><p className="tcg-error">{err}</p><button type="button" className="tcg-btn" onClick={onClose}>Fechar</button></> : 'Abrindo a sala…'}</div>
        ) : (
          <>
            <header className="tcgl-head">
              <span className="tcgl-crest"><Icon d={lobby.format === '2V2' ? UI.users : UI.sword} size={24} /></span>
              <div>
                <h2>{lobby.format === '2V2' ? 'Batalha 2 vs 2' : 'Batalha 1 vs 1'}</h2>
                <p className="tcg-dim">Sala de <b data-no-translate>{lobby.host?.displayName}</b> · código <b className="tcgl-code">{lobby.code}</b></p>
              </div>
              <span className="tcgb-spacer" />
              {lobby.custom && <span className="tcgl-tag is-custom">Personalizada</span>}
              <span className={`tcgl-tag${lobby.rewards === 'none' ? ' is-none' : ''}`}>{lobby.rewards === 'none' ? 'Sem recompensas' : 'Vale moedas'}</span>
              <button type="button" className="tcg-icon-btn" onClick={onClose} aria-label="Fechar"><Icon d={UI.close} /></button>
            </header>

            {lobby.status === 'OPEN' && (
              <div className="tcgl-link">
                <Icon d="M10 14a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1M14 10a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1" size={16} />
                <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Link da sala" />
                <button type="button" className="tcg-btn primary" onClick={copy}>Copiar link</button>
                {lobby.mySlot >= 0 && <button type="button" className="tcg-btn" onClick={() => setInviting((v) => !v)}><Icon d={UI.users} />Convidar</button>}
              </div>
            )}
            {inviting && <div className="tcgl-invite"><UserPicker meId={me?.id} actionLabel="Convidar" onPick={inviteUser} /></div>}

            <div className={`tcgl-teams is-${lobby.format}`}>
              {teams.map((idxs, t) => (
                <div key={t} className={`tcgl-team is-t${t}`}>
                  <h4>{lobby.format === '2V2' ? `Time ${t === 0 ? 'Azul' : 'Vermelho'}` : t === 0 ? 'Desafiante' : 'Oponente'}</h4>
                  {idxs.map((i) => (
                    <Slot key={i} s={lobby.slots[i]} lobby={lobby} me={me}
                      onJoin={(slot) => run(() => cardsJoinLobby(lobby.code, slot))}
                      onBot={(slot, bot) => run(() => cardsLobbySlot(lobby.code, slot, bot))}
                      onKick={(slot) => run(() => cardsLobbySlot(lobby.code, slot, null))}
                    />
                  ))}
                </div>
              ))}
              <span className="tcgl-vs">VS</span>
            </div>

            {(lobby.rules || lobby.board) && (
              <div className="tcgl-summary">
                {lobby.board && <span className="tcgl-chip"><Icon d={UI.star} size={12} />Mesa: {lobby.board.name}</span>}
                {ruleText(lobby.rules).map((t) => <span key={t} className="tcgl-chip">{t}</span>)}
              </div>
            )}
            {lobby.format === '2V2' && <p className="tcg-dim tcgl-hint">No 2 vs 2 o time divide o herói e o campo. A ordem é: Azul 1, Vermelho 1, Azul 2, Vermelho 2… Cada um joga com a própria mão e vê a do parceiro.</p>}

            {err && <p className="tcg-error">{err}</p>}
            {note && <p className="tcg-ok">{note}</p>}
            <div className="tcgl-actions">
              {lobby.status === 'OPEN' ? (
                <>
                  <button type="button" className="tcg-btn ghost danger" onClick={leave}>{lobby.isHost ? 'Fechar sala' : lobby.mySlot >= 0 ? 'Sair da sala' : 'Fechar'}</button>
                  {lobby.mySlot < 0 && <button type="button" className="tcg-btn primary tcg-btn-xl" onClick={() => run(() => cardsJoinLobby(lobby.code))}><Icon d={UI.sword} />Entrar na batalha</button>}
                  {lobby.isHost && <button type="button" className="tcg-btn primary tcg-btn-xl" disabled={!lobby.full || busy} onClick={start}><Icon d={UI.sword} />{busy ? 'Começando…' : lobby.full ? 'Começar batalha' : 'Esperando jogadores…'}</button>}
                  {!lobby.isHost && lobby.mySlot >= 0 && <span className="tcgl-wait"><i />Esperando o dono começar…</span>}
                </>
              ) : lobby.status === 'STARTED' ? (
                <>
                  <span className="tcg-dim">A batalha já começou.</span>
                  {lobby.matchId && lobby.mySlot < 0 && <button type="button" className="tcg-btn primary" onClick={() => onStarted?.(lobby.matchId, true)}>Assistir</button>}
                  <button type="button" className="tcg-btn" onClick={onClose}>Fechar</button>
                </>
              ) : (
                <><span className="tcg-dim">Essa sala foi fechada ou expirou.</span><button type="button" className="tcg-btn" onClick={onClose}>Fechar</button></>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
