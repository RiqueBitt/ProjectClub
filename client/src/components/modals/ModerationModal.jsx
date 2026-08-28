import { useEffect, useMemo, useState } from 'react';
import Modal from '../Modal.jsx';
import { useStore } from '../../store/useStore';
import {
  listBans, unbanMember, listAuditLog,
  listWarnings, warnMember, deleteWarning, removeTimeout,
  listAutoModRules, createAutoModRule, updateAutoModRule, deleteAutoModRule,
} from '../../api/endpoints';
import errorIcon from '../../assets/icons/error.png';
import speakerIcon from '../../assets/icons/speaker.png';
import trashIcon from '../../assets/icons/trash.png';
import cancelIcon from '../../assets/icons/cancel.png';

const AUTOMOD_TYPE_LABELS = {
  BANNED_WORDS: 'Palavras bloqueadas',
  SPAM_LINKS: 'Anti-spam de links',
  MENTION_SPAM: 'Anti-spam de menções',
  MESSAGE_RATE: 'Anti-spam (frequência de mensagens)',
  ANTI_RAID: 'Anti-raid',
};
const ACTION_LABELS = { DELETE: 'Apagar mensagem', WARN: 'Advertir', TIMEOUT: 'Silenciar', KICK: 'Expulsar', BAN: 'Banir' };

// Human labels + a small icon per audit action code, so the log reads like
// a real moderation history instead of raw enum values (MEMBER_BAN, etc.).
const AUDIT_ACTION_LABELS = {
  MEMBER_KICK: { label: 'Expulsou', icon: '👢' },
  MEMBER_BAN: { label: 'Baniu', icon: '🔨' },
  MEMBER_UNBAN: { label: 'Desbaniu', icon: '♻️' },
  MEMBER_TIMEOUT: { label: 'Silenciou', icon: '🔇' },
  MEMBER_TIMEOUT_REMOVE: { label: 'Removeu silêncio de', icon: <img className="ui-icon-sm" src={speakerIcon} alt="" /> },
  MEMBER_WARN: { label: 'Advertiu', icon: <img className="ui-icon-sm" src={errorIcon} alt="" /> },
  MEMBER_WARN_CLEAR: { label: 'Removeu advertência de', icon: '🧹' },
  MESSAGE_DELETE: { label: 'Apagou mensagem de', icon: <img className="ui-icon-sm" src={trashIcon} alt="" /> },
};

export default function ModerationModal({ onClose }) {
  const [tab, setTab] = useState('audit');

  return (
    <Modal title="Moderação da comunidade" onClose={onClose} width="760px">
      <div className="mod-tabs">
        <button className={`mod-tab ${tab === 'audit' ? 'active' : ''}`} onClick={() => setTab('audit')}>Registro de auditoria</button>
        <button className={`mod-tab ${tab === 'bans' ? 'active' : ''}`} onClick={() => setTab('bans')}>Banidos</button>
        <button className={`mod-tab ${tab === 'warnings' ? 'active' : ''}`} onClick={() => setTab('warnings')}>Advertências</button>
        <button className={`mod-tab ${tab === 'timeouts' ? 'active' : ''}`} onClick={() => setTab('timeouts')}>Silenciados</button>
        <button className={`mod-tab ${tab === 'automod' ? 'active' : ''}`} onClick={() => setTab('automod')}>AutoMod</button>
      </div>
      {tab === 'audit' && <AuditLogTab />}
      {tab === 'bans' && <BansTab />}
      {tab === 'warnings' && <WarningsTab />}
      {tab === 'timeouts' && <TimeoutsTab />}
      {tab === 'automod' && <AutoModTab />}
    </Modal>
  );
}

function AuditLogTab() {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    listAuditLog().then((d) => setEntries(d.entries)).finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="dim">Carregando...</div>;
  if (entries.length === 0) return <div className="empty-hint">Nenhuma ação registrada ainda.</div>;

  const filtered = filter ? entries.filter((e) => e.action === filter) : entries;
  const knownActions = [...new Set(entries.map((e) => e.action))];

  return (
    <div>
      {knownActions.length > 1 && (
        <div className="chip-choice-row" style={{ marginBottom: 10 }}>
          <button className={`chip-choice ${filter === '' ? 'active' : ''}`} onClick={() => setFilter('')}>Tudo</button>
          {knownActions.map((a) => (
            <button key={a} className={`chip-choice ${filter === a ? 'active' : ''}`} onClick={() => setFilter(a)}>
              {AUDIT_ACTION_LABELS[a]?.label || a}
            </button>
          ))}
        </div>
      )}
      <div className="audit-log-list">
        {filtered.map((e) => {
          const meta = AUDIT_ACTION_LABELS[e.action];
          return (
            <div key={e.id} className="audit-log-entry">
              <div>
                <span className="audit-action">{meta?.icon || '📋'} {meta?.label || e.action}</span>
                {' — '}
                {e.actorId === 'system' ? '🤖 AutoMod' : (e.actor?.displayName || e.actorId)}
                {e.targetId && ` → ${e.targetType?.toLowerCase() || ''} ${e.targetId}`}
              </div>
              {e.reason && <div className="audit-meta">Motivo: {e.reason}</div>}
              <div className="audit-meta">{new Date(e.createdAt).toLocaleString('pt-BR')}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function WarningsTab() {
  const members = useStore((s) => s.members);
  const [warnings, setWarnings] = useState([]);
  const [loading, setLoading] = useState(true);
  const [targetQuery, setTargetQuery] = useState('');
  const [targetId, setTargetId] = useState('');
  const [reason, setReason] = useState('');

  const load = () => listWarnings().then((d) => setWarnings(d.warnings)).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const matches = targetQuery.trim()
    ? members.filter((m) => (m.nickname || m.user.displayName).toLowerCase().includes(targetQuery.trim().toLowerCase())).slice(0, 6)
    : [];

  const addWarning = async () => {
    if (!targetId || !reason.trim()) return;
    await warnMember(targetId, reason.trim());
    setTargetQuery(''); setTargetId(''); setReason('');
    load();
  };

  const clear = async (id) => {
    if (!confirm('Remover esta advertência?')) return;
    await deleteWarning(id);
    load();
  };

  if (loading) return <div className="dim">Carregando...</div>;

  return (
    <div>
      <div className="mod-add-panel">
        <div className="mod-add-target">
          <input
            placeholder="Buscar membro para advertir..."
            value={targetId ? matches.find((m) => m.user.id === targetId)?.user.displayName || targetQuery : targetQuery}
            onChange={(e) => { setTargetQuery(e.target.value); setTargetId(''); }}
          />
          {targetQuery && !targetId && matches.length > 0 && (
            <ul className="mod-add-suggestions">
              {matches.map((m) => (
                <li key={m.user.id}>
                  <button type="button" onClick={() => { setTargetId(m.user.id); setTargetQuery(m.nickname || m.user.displayName); }}>
                    {m.nickname || m.user.displayName}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <input placeholder="Motivo da advertência" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn-secondary" onClick={addWarning} disabled={!targetId || !reason.trim()}>Advertir</button>
      </div>

      {warnings.length === 0 ? (
        <div className="empty-hint">Nenhuma advertência registrada.</div>
      ) : (
        <ul className="settings-member-list">
          {warnings.map((w) => (
            <li key={w.id}>
              <div>
                <b>{w.user?.displayName || w.userId}</b>
                <div className="dim">{w.reason}</div>
                <div className="audit-meta">{new Date(w.createdAt).toLocaleString('pt-BR')}</div>
              </div>
              <button className="btn-link danger" onClick={() => clear(w.id)}>Remover</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function TimeoutsTab() {
  const members = useStore((s) => s.members);
  const timedOut = useMemo(
    () => members.filter((m) => m.timeoutUntil && new Date(m.timeoutUntil) > new Date()),
    [members],
  );

  const lift = async (userId) => {
    await removeTimeout(userId);
  };

  if (timedOut.length === 0) return <div className="empty-hint">Ninguém está em silêncio temporário neste servidor.</div>;

  return (
    <ul className="settings-member-list">
      {timedOut.map((m) => (
        <li key={m.id}>
          <div>
            <b>{m.nickname || m.user.displayName}</b>
            <div className="dim">Silenciado até {new Date(m.timeoutUntil).toLocaleString('pt-BR')}</div>
          </div>
          <button className="btn-link" onClick={() => lift(m.user.id)}>Remover silêncio</button>
        </li>
      ))}
    </ul>
  );
}

function BansTab() {
  const [bans, setBans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');

  const load = () => listBans().then((d) => setBans(d.bans)).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const unban = async (userId) => {
    await unbanMember(userId);
    load();
  };

  if (loading) return <div className="dim">Carregando...</div>;
  if (bans.length === 0) return <div className="empty-hint">Ninguém banido neste servidor.</div>;

  const q = query.trim().toLowerCase();
  const filtered = q ? bans.filter((b) => (b.user?.displayName || b.userId).toLowerCase().includes(q)) : bans;

  return (
    <>
      {bans.length > 5 && <input className="mod-search-input" placeholder="Buscar banido..." value={query} onChange={(e) => setQuery(e.target.value)} />}
      <ul className="settings-member-list">
      {filtered.map((b) => (
        <li key={b.id}>
          <div>
            <b>{b.user?.displayName || b.userId}</b>
            {b.reason && <div className="dim">Motivo: {b.reason}</div>}
            {b.moderator && <div className="dim">Banido por {b.moderator.displayName}</div>}
          </div>
          <button className="btn-link" onClick={() => unban(b.userId)}>Desbanir</button>
        </li>
      ))}
      </ul>
    </>
  );
}

function AutoModTab() {
  const [rules, setRules] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => listAutoModRules().then((d) => setRules(d.rules)).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const addRule = async (type) => {
    await createAutoModRule({ type, action: 'DELETE', enabled: true, config: defaultConfigFor(type) });
    load();
  };

  const patchRule = async (id, patch) => {
    await updateAutoModRule(id, patch);
    load();
  };

  const removeRule = async (id) => {
    await deleteAutoModRule(id);
    load();
  };

  const missingTypes = Object.keys(AUTOMOD_TYPE_LABELS).filter((t) => !rules.some((r) => r.type === t));

  if (loading) return <div className="dim">Carregando...</div>;

  return (
    <div>
      {rules.map((rule) => (
        <AutoModRuleCard key={rule.id} rule={rule} onPatch={(p) => patchRule(rule.id, p)} onDelete={() => removeRule(rule.id)} />
      ))}
      {missingTypes.length > 0 && (
        <div className="settings-member-roles" style={{ marginTop: 12 }}>
          <span className="dim">Adicionar regra:</span>
          {missingTypes.map((t) => (
            <button key={t} className="btn-secondary" onClick={() => addRule(t)}>{AUTOMOD_TYPE_LABELS[t]}</button>
          ))}
        </div>
      )}
    </div>
  );
}

function defaultConfigFor(type) {
  if (type === 'BANNED_WORDS') return { words: [] };
  if (type === 'SPAM_LINKS') return { allowedDomains: [] };
  if (type === 'MENTION_SPAM') return { maxMentions: 5 };
  if (type === 'MESSAGE_RATE') return { maxMessages: 5, windowSeconds: 10 };
  if (type === 'ANTI_RAID') return { maxJoinsPerWindow: 10, windowSeconds: 60 };
  return {};
}

function AutoModRuleCard({ rule, onPatch, onDelete }) {
  const [config, setConfig] = useState(rule.config);

  const saveConfig = () => onPatch({ config });

  return (
    <div className="automod-rule">
      <div className="automod-rule-header">
        <span className="automod-rule-title">{AUTOMOD_TYPE_LABELS[rule.type] || rule.type}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            className={`toggle-switch ${rule.enabled ? 'on' : ''}`}
            onClick={() => onPatch({ enabled: !rule.enabled })}
            title={rule.enabled ? 'Desativar' : 'Ativar'}
          />
          <button className="icon-btn-small" onClick={onDelete}><img className="ui-icon-sm" src={cancelIcon} alt="x" /></button>
        </div>
      </div>
      <div className="automod-rule-body">
        <label>
          Ação ao disparar
          <select value={rule.action} onChange={(e) => onPatch({ action: e.target.value })}>
            {Object.entries(ACTION_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>

        {rule.type === 'BANNED_WORDS' && (
          <label>
            Palavras bloqueadas (separadas por vírgula)
            <textarea
              rows={2}
              defaultValue={(config.words || []).join(', ')}
              onBlur={(e) => { const words = e.target.value.split(',').map((w) => w.trim()).filter(Boolean); setConfig({ ...config, words }); onPatch({ config: { ...config, words } }); }}
            />
          </label>
        )}

        {rule.type === 'SPAM_LINKS' && (
          <label>
            Domínios permitidos (separados por vírgula, vazio = nenhum link permitido)
            <textarea
              rows={2}
              defaultValue={(config.allowedDomains || []).join(', ')}
              onBlur={(e) => { const allowedDomains = e.target.value.split(',').map((w) => w.trim()).filter(Boolean); setConfig({ ...config, allowedDomains }); onPatch({ config: { ...config, allowedDomains } }); }}
            />
          </label>
        )}

        {rule.type === 'MENTION_SPAM' && (
          <label>
            Máximo de menções por mensagem
            <input
              type="number" min="1" defaultValue={config.maxMentions ?? 5}
              onBlur={(e) => { const v = { ...config, maxMentions: parseInt(e.target.value, 10) || 1 }; setConfig(v); onPatch({ config: v }); }}
            />
          </label>
        )}

        {rule.type === 'MESSAGE_RATE' && (
          <>
            <label>
              Máximo de mensagens
              <input
                type="number" min="1" defaultValue={config.maxMessages ?? 5}
                onBlur={(e) => { const v = { ...config, maxMessages: parseInt(e.target.value, 10) || 1 }; setConfig(v); onPatch({ config: v }); }}
              />
            </label>
            <label>
              Janela de tempo (segundos)
              <input
                type="number" min="1" defaultValue={config.windowSeconds ?? 10}
                onBlur={(e) => { const v = { ...config, windowSeconds: parseInt(e.target.value, 10) || 1 }; setConfig(v); onPatch({ config: v }); }}
              />
            </label>
          </>
        )}

        {rule.type === 'ANTI_RAID' && (
          <>
            <label>
              Máximo de entradas
              <input
                type="number" min="1" defaultValue={config.maxJoinsPerWindow ?? 10}
                onBlur={(e) => { const v = { ...config, maxJoinsPerWindow: parseInt(e.target.value, 10) || 1 }; setConfig(v); onPatch({ config: v }); }}
              />
            </label>
            <label>
              Janela de tempo (segundos)
              <input
                type="number" min="1" defaultValue={config.windowSeconds ?? 60}
                onBlur={(e) => { const v = { ...config, windowSeconds: parseInt(e.target.value, 10) || 1 }; setConfig(v); onPatch({ config: v }); }}
              />
            </label>
          </>
        )}
      </div>
    </div>
  );
}
