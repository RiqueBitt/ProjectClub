// Configurações extras trazidas do Discord (Aparência, Acessibilidade,
// Notificações, Voz e vídeo, Privacidade). Tudo aplica na hora e salva na
// conta (UserSettings.extraPrefs — ver utils/extraPrefs.js).
import { useEffect, useRef, useState } from 'react';
import { clearMessageCache } from '../../utils/messageCache';
import {
  useExtra, setExtra, COLOR_THEMES, APP_ICONS, EXTRA_DEFAULTS, themeVars, themeDef, renderAppIcon,
} from '../../utils/extraPrefs';
import { SOUND_EVENTS, SOUND_PACKS, previewSound, currentPack, ENTRY_SOUNDS, playEntrySound } from '../../utils/sounds';
import { getPreferredMicId } from '../../utils/audioDevices';
import { useVoice } from '../../context/VoiceContext.jsx';
import { LiveMicMeter, VoiceConnectionPanel } from '../voice/VoiceExtras.jsx';
import { useStore } from '../../store/useStore';
import {
  browserTimeZone, isQuietHoursActive, parseHHMM, isOverrideMuted, normalizeLevel, muteRemainingLabel, LEVEL_LABELS,
} from '../../utils/notificationLevels';
import { unmuteTarget, setTargetLevel } from '../../utils/notificationPrefs';
import '../../styles/appearance.css';
import '../../styles/extra-prefs.css';

function Switch({ on, onChange, label }) {
  return <button type="button" role="switch" aria-checked={!!on} aria-label={label} className={`pc-switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />;
}
function Row({ title, hint, on, onChange }) {
  return (
    <div className="pc-switch-row">
      <div><strong>{title}</strong>{hint && <span>{hint}</span>}</div>
      <Switch on={on} onChange={onChange} label={title} />
    </div>
  );
}
function Seg({ value, options, onChange, label }) {
  return (
    <div className="pc-seg" role="radiogroup" aria-label={label}>
      {options.map(([v, l]) => (
        <button key={String(v)} type="button" role="radio" aria-checked={value === v} className={value === v ? 'active' : ''} onClick={() => onChange(v)}>{l}</button>
      ))}
    </div>
  );
}
function Panel({ id, title, hint, children, action }) {
  return (
    <section className="pc-layout-panel xp-panel" aria-labelledby={id}>
      <div className="pc-layout-head">
        <div><h4 id={id}>{title}</h4>{hint && <p>{hint}</p>}</div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Field({ label, children }) {
  return <div className="pc-field"><span className="pc-field-label">{label}</span>{children}</div>;
}
const Play = ({ onClick, label }) => (
  <button type="button" className="xp-play" onClick={onClick} aria-label={label} title={label}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z" /></svg>
  </button>
);

// ======================= Aparência =======================
function ThemePreview({ def }) {
  const vars = def ? themeVars(def) : null;
  const bg = vars ? vars['--pc-ct-grad'] : 'var(--bg-deepest)';
  return (
    <div className="xp-preview" aria-hidden="true" style={{ '--pv-accent': def?.accent || 'var(--brand)' }}>
      <div className="xp-preview-inner" style={{ background: bg }}>
        <div className="xp-preview-side" style={{ background: vars?.['--bg-secondary'] || 'var(--bg-secondary)' }}>
          <span className="on" /><span /><span /><span />
        </div>
        <div className="xp-preview-chat" style={{ background: vars?.['--bg-primary'] || 'var(--bg-primary)' }}>
          <div className="xp-preview-msg"><b /><span /></div>
          <div className="xp-preview-msg"><b /><span style={{ maxWidth: '45%' }} /></div>
          <div className="xp-preview-input" style={{ background: vars?.['--bg-elevated'] || 'var(--bg-elevated)' }} />
        </div>
      </div>
    </div>
  );
}

function ColorThemes() {
  const p = useExtra();
  const saved = p.customTheme || EXTRA_DEFAULTS.customTheme;
  // Rascunho local do tema personalizado: arrastar o seletor de cor muda só
  // a prévia (leve); o app inteiro só é repintado quando você para de
  // mexer (antes cada movimento repintava tudo e travava a tela).
  const [draft, setDraft] = useState(null);
  const custom = draft || saved;
  const commitTimer = useRef(null);
  useEffect(() => () => clearTimeout(commitTimer.current), []);
  const setCustom = (patch) => {
    const next = { ...custom, ...patch };
    setDraft(next);
    clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => { setExtra({ colorTheme: 'custom', customTheme: next }); setDraft(null); }, 450);
  };
  const def = p.colorTheme === 'custom' ? themeDef({ colorTheme: 'custom', customTheme: custom }) : themeDef(p);
  const swatch = (t) => `linear-gradient(${t.angle}deg, ${t.colors.join(', ')})`;
  return (
    <Panel id="xp-themes" title="Temas coloridos" hint="Pinte o Project Club inteiro com um degradê. Salvo na sua conta.">
      <ThemePreview def={def} />
      <div className="xp-themes" role="radiogroup" aria-label="Tema colorido">
        <button type="button" role="radio" aria-checked={p.colorTheme === 'none'} className={`xp-theme${p.colorTheme === 'none' ? ' on' : ''}`} onClick={() => setExtra({ colorTheme: 'none' })}>
          <span className="xp-theme-swatch none">∅</span> Nenhum
        </button>
        {COLOR_THEMES.map((t) => (
          <button key={t.id} type="button" role="radio" aria-checked={p.colorTheme === t.id} className={`xp-theme${p.colorTheme === t.id ? ' on' : ''}`} onClick={() => setExtra({ colorTheme: t.id })} title={t.name}>
            <span className="xp-theme-swatch" style={{ background: swatch(t) }}><i style={{ background: t.accent }} /></span>
            {t.name}
          </button>
        ))}
        <button type="button" role="radio" aria-checked={p.colorTheme === 'custom'} className={`xp-theme${p.colorTheme === 'custom' ? ' on' : ''}`} onClick={() => setExtra({ colorTheme: 'custom' })}>
          <span className="xp-theme-swatch custom" style={{ background: swatch(custom) }}>✎</span> Personalizado
        </button>
      </div>
      {p.colorTheme === 'custom' && (
        <div className="xp-custom">
          <div className="xp-custom-row">
            {custom.colors.map((c, i) => (
              <label key={i}>Cor {i + 1}
                <span className="xp-color"><input type="color" value={c} onChange={(e) => setCustom({ colors: custom.colors.map((x, j) => (j === i ? e.target.value : x)) })} aria-label={`Cor ${i + 1}`} /></span>
              </label>
            ))}
            <label>Destaque
              <span className="xp-color"><input type="color" value={custom.accent} onChange={(e) => setCustom({ accent: e.target.value })} aria-label="Cor de destaque" /></span>
            </label>
            {custom.colors.length < 5 && <button type="button" className="xp-mini-btn" onClick={() => setCustom({ colors: [...custom.colors, custom.colors[custom.colors.length - 1]] })}>+ Cor</button>}
            {custom.colors.length > 1 && <button type="button" className="xp-mini-btn" onClick={() => setCustom({ colors: custom.colors.slice(0, -1) })}>− Cor</button>}
          </div>
          <Field label="Ângulo do degradê">
            <div className="xp-range"><input type="range" min="0" max="360" step="5" value={custom.angle} onChange={(e) => setCustom({ angle: Number(e.target.value) })} aria-label="Ângulo" /><output>{custom.angle}°</output></div>
          </Field>
          <Field label="Intensidade da cor">
            <div className="xp-range"><input type="range" min="0" max="100" step="5" value={custom.mix} onChange={(e) => setCustom({ mix: Number(e.target.value) })} aria-label="Intensidade" /><output>{custom.mix}%</output></div>
          </Field>
        </div>
      )}
      <Row title="Sincronizar tema em meus aparelhos" hint="Desligado, o tema vale só neste aparelho." on={p.themeSync !== false} onChange={(v) => setExtra({ themeSync: v })} />
      <Row title="Mostrar estilos de perfil dos outros" hint="Desligado, perfis de outras pessoas abrem com o visual padrão (o seu continua igual)." on={p.themeOnProfiles !== false} onChange={(v) => setExtra({ themeOnProfiles: v })} />
    </Panel>
  );
}

function AppIcons() {
  const icon = useExtra('appIcon');
  const [urls, setUrls] = useState({});
  useEffect(() => {
    let alive = true;
    Promise.all(APP_ICONS.filter((i) => i.bg).map(async (i) => [i.id, await renderAppIcon(i.id, 96).catch(() => null)]))
      .then((list) => { if (alive) setUrls(Object.fromEntries(list)); });
    return () => { alive = false; };
  }, []);
  const desktop = typeof window !== 'undefined' && !!window.electronAPI;
  return (
    <Panel id="xp-icons" title="Ícone do app" hint={desktop ? 'Muda o ícone da janela/barra de tarefas e da aba.' : 'Muda o ícone da aba do navegador (no app de PC, também o da barra de tarefas).'}>
      <div className="xp-icons" role="radiogroup" aria-label="Ícone do app">
        {APP_ICONS.map((i) => (
          <button key={i.id} type="button" role="radio" aria-checked={icon === i.id} className={`xp-icon${icon === i.id ? ' on' : ''}`} onClick={() => setExtra({ appIcon: i.id })}>
            {i.id === 'default' ? <img src="/icon-192.png" alt="" /> : urls[i.id] ? <img src={urls[i.id]} alt="" /> : <span className="xp-icon-ph" />}
            {i.name}
          </button>
        ))}
      </div>
    </Panel>
  );
}

function StreamerMode() {
  const p = useExtra();
  return (
    <Panel id="xp-streamer" title="Modo streamer" hint="Esconde suas informações pessoais pra quem assiste sua transmissão.">
      <Row title="Ativar modo streamer" on={!!p.streamerMode} onChange={(v) => setExtra({ streamerMode: v })} />
      <Field label="Quando o modo streamer estiver ligado…">
        <Row title="Ocultar meus dados pessoais" hint="E-mail, contas conectadas e notas ficam borrados." on={p.streamerHidePersonal !== false} onChange={(v) => setExtra({ streamerHidePersonal: v })} />
        <Row title="Desativar todos os efeitos de som" on={p.streamerMuteSounds !== false} onChange={(v) => setExtra({ streamerMuteSounds: v })} />
        <Row title="Desativar notificações" hint="Sem alertas do sistema nem na sobreposição do jogo." on={p.streamerMuteNotifs !== false} onChange={(v) => setExtra({ streamerMuteNotifs: v })} />
      </Field>
    </Panel>
  );
}

function ChatOptions() {
  const p = useExtra();
  return (
    <Panel id="xp-chat" title="Mensagens e caixa de chat" hint="Como as mensagens aparecem e como você digita.">
      <Field label="Espaço entre grupos de mensagens">
        <Seg label="Espaço entre grupos" value={p.groupSpacing ?? 16} onChange={(v) => setExtra({ groupSpacing: v })} options={[[0, '0px'], [4, '4px'], [8, '8px'], [16, '16px'], [24, '24px']]} />
      </Field>
      <Field label="Mostrar spoilers">
        <Seg label="Mostrar spoilers" value={p.spoilers || 'click'} onChange={(v) => setExtra({ spoilers: v })} options={[['click', 'Ao clicar'], ['always', 'Sempre']]} />
      </Field>
      <Row title="Mostrar reações de emoji" on={p.showReactions !== false} onChange={(v) => setExtra({ showReactions: v })} />
      <Row title="Converter emoticons em emoji" hint="Ao enviar, :) vira 🙂, <3 vira ❤️, :D vira 😄…" on={p.emoticonsToEmoji !== false} onChange={(v) => setExtra({ emoticonsToEmoji: v })} />
      <Row title="Mostrar botão de enviar mensagem" hint="No PC; no celular o botão sempre aparece." on={p.showSendButton !== false} onChange={(v) => setExtra({ showSendButton: v })} />
    </Panel>
  );
}

export function AppearanceExtras() {
  return (<><ColorThemes /><AppIcons /><ChatOptions /><StreamerMode /></>);
}

// ======================= Acessibilidade =======================
export function AccessibilityMore() {
  const p = useExtra();
  const speak = () => {
    try {
      const s = window.speechSynthesis; s.cancel();
      const u = new SpeechSynthesisUtterance('Essa é a velocidade em que as mensagens serão lidas.');
      u.lang = 'pt-BR'; u.rate = p.ttsRate || 1; s.speak(u);
    } catch { /* sem voz */ }
  };
  return (
    <Panel id="xp-a11y" title="Legibilidade e leitura" hint="Ajustes finos pra ler e ouvir melhor.">
      <Row title="Sempre sublinhar links" hint="Faz os links se destacarem mais." on={!!p.underlineLinks} onChange={(v) => setExtra({ underlineLinks: v })} />
      <Row title="Mostrar indicadores de ligar/desligar" hint="Os interruptores ganham ✓ e ✕." on={!!p.toggleIcons} onChange={(v) => setExtra({ toggleIcons: v })} />
      <Field label="Duração mínima das notificações na tela">
        <Seg label="Duração mínima" value={p.minToastSec || 0} onChange={(v) => setExtra({ minToastSec: v })} options={[[0, 'Padrão'], [10, '10s'], [15, '15s'], [20, '20s']]} />
      </Field>
      {typeof window !== 'undefined' && window.speechSynthesis && (
        <Field label='Velocidade do "Falar mensagem"'>
          <div className="xp-range">
            <span className="dim">Devagar</span>
            <input type="range" min="0.5" max="2" step="0.1" value={p.ttsRate || 1} onChange={(e) => setExtra({ ttsRate: Math.round(Number(e.target.value) * 10) / 10 })} aria-label="Velocidade da fala" />
            <span className="dim">Rápido</span>
            <output>x{(p.ttsRate || 1).toFixed(1).replace('.', ',')}</output>
            <Play onClick={speak} label="Ouvir exemplo" />
          </div>
          <small className="dim">Clique com o botão direito numa mensagem → Falar mensagem.</small>
        </Field>
      )}
    </Panel>
  );
}

// ======================= Notificações =======================
function SoundList({ group }) {
  const p = useExtra();
  const off = new Set(p.soundsOff || []);
  const toggle = (key, on) => setExtra({ soundsOff: on ? [...off].filter((k) => k !== key) : [...off, key] });
  return (
    <div className="xp-sounds">
      {SOUND_EVENTS.filter((e) => e.group === group).map((e) => (
        <div key={e.key} className="xp-sound">
          <Play onClick={() => previewSound(e.key, p.soundPack)} label={`Ouvir: ${e.label}`} />
          <span>{e.label}</span>
          <Switch on={!off.has(e.key)} onChange={(v) => toggle(e.key, v)} label={e.label} />
        </div>
      ))}
    </div>
  );
}

// ---------- Notificações por canal + "Não perturbe" agendado ----------
const WEEK = [[0, 'Dom'], [1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb']];
const WEEK_FULL = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// Relógio que anda sozinho (pra "Ativo agora" e "Faltam X min" não ficarem parados).
function useMinuteClock() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function QuietHoursPanel() {
  const p = useExtra();
  const now = useMinuteClock();
  const deviceTz = browserTimeZone();
  const qh = { ...EXTRA_DEFAULTS.quietHours, ...(p.quietHours || {}) };
  const update = (patch) => setExtra({ quietHours: { ...qh, ...patch, timezone: patch.timezone || qh.timezone || deviceTz } });
  const toggleDay = (d) => update({ days: qh.days.includes(d) ? qh.days.filter((x) => x !== d) : [...qh.days, d].sort() });
  const active = isQuietHoursActive(qh, now);
  const overnight = (parseHHMM(qh.start) ?? 0) > (parseHHMM(qh.end) ?? 0);
  let summary = 'Escolha pelo menos um dia.';
  if (qh.days.length === 7) summary = 'Todos os dias';
  else if (qh.days.length) summary = qh.days.map((d) => WEEK_FULL[d]).join(', ');
  return (
    <Panel
      id="xp-quiet" title="Não perturbe agendado"
      hint="Nesse horário nada de notificação no desktop, push no celular ou som. As mensagens continuam chegando normalmente."
    >
      <Row
        title="Ativar horário silencioso"
        hint={qh.enabled ? (active ? 'Ativo agora.' : 'Aguardando o próximo horário.') : 'Desligado.'}
        on={qh.enabled} onChange={(v) => update({ enabled: v })}
      />
      <div className={`xp-quiet-grid${qh.enabled ? '' : ' is-off'}`}>
        <Field label="Começa às">
          <input type="time" className="xp-time" value={qh.start} onChange={(e) => e.target.value && update({ start: e.target.value })} aria-label="Início do horário silencioso" />
        </Field>
        <Field label={overnight ? 'Termina às (dia seguinte)' : 'Termina às'}>
          <input type="time" className="xp-time" value={qh.end} onChange={(e) => e.target.value && update({ end: e.target.value })} aria-label="Fim do horário silencioso" />
        </Field>
      </div>
      <Field label="Dias">
        <div className="xp-days" role="group" aria-label="Dias da semana">
          {WEEK.map(([d, l]) => (
            <button key={d} type="button" aria-pressed={qh.days.includes(d)} className={`xp-day${qh.days.includes(d) ? ' on' : ''}`} onClick={() => toggleDay(d)} title={WEEK_FULL[d]}>{l}</button>
          ))}
        </div>
      </Field>
      <p className="xp-quiet-note dim">
        {summary}{qh.start === qh.end ? ' (o dia inteiro)' : ''}. Fuso horário: <b>{qh.timezone || deviceTz}</b>
        {qh.timezone && qh.timezone !== deviceTz && (
          <> · <button type="button" className="xp-link-btn" onClick={() => update({ timezone: deviceTz })}>Usar o deste aparelho ({deviceTz})</button></>
        )}
      </p>
    </Panel>
  );
}

// Lista do que está silenciado agora, com o tempo que falta e "Reativar".
function MutedTargetsPanel() {
  const overrides = useStore((s) => s.notificationOverrides);
  const categories = useStore((s) => s.categories);
  const channels = useStore((s) => s.channels);
  const now = useMinuteClock();
  const allChannels = [...channels, ...categories.flatMap((c) => c.channels || [])];
  const rows = Object.values(overrides || {})
    .filter((o) => isOverrideMuted(o, now) || normalizeLevel(o.level))
    .map((o) => {
      const isCat = o.targetKey.startsWith('cat:');
      const id = o.targetKey.slice(isCat ? 4 : 3);
      const target = isCat ? categories.find((c) => c.id === id) : allChannels.find((c) => c.id === id);
      return { o, id, isCat, name: target?.name };
    })
    .filter((r) => r.name);
  return (
    <Panel id="xp-muted" title="Canais e categorias" hint="Clique com o botão direito num canal ou categoria pra silenciar ou mudar as notificações dele.">
      {rows.length === 0 ? <p className="dim xp-quiet-note">Nenhum canal ou categoria com configuração própria.</p> : (
        <ul className="xp-muted-list">
          {rows.map(({ o, id, isCat, name }) => {
            const muted = isOverrideMuted(o, now);
            const level = normalizeLevel(o.level);
            const type = isCat ? 'category' : 'channel';
            return (
              <li key={o.targetKey}>
                <span className="xp-muted-name">{isCat ? <b>{name}</b> : <># {name}</>}{isCat && <small> (categoria)</small>}</span>
                <span className="xp-muted-info dim">
                  {[muted ? `Silenciado · ${muteRemainingLabel(o.mutedUntil, { forever: o.muteForever, now }).toLowerCase()}` : null, level ? LEVEL_LABELS[level] : null].filter(Boolean).join(' · ')}
                </span>
                {muted && <button type="button" className="xp-mini-btn" onClick={() => unmuteTarget(type, id)}>Reativar</button>}
                {level && <button type="button" className="xp-mini-btn" onClick={() => setTargetLevel(type, id, null)}>Usar padrão</button>}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}

export function NotificationExtras() {
  const p = useExtra();
  const [showSounds, setShowSounds] = useState(false);
  return (
    <>
      <Panel id="xp-channels" title="Mensagens nos canais" hint="Padrão pra todos os canais. Uma categoria ou um canal podem ter o seu próprio (o do canal vale mais que o da categoria).">
        <Field label="Notificar">
          <Seg label="Padrão de notificação dos canais" value={p.notifyLevel || 'mentions'} onChange={(v) => setExtra({ notifyLevel: v })} options={[['all', 'Todas as mensagens'], ['mentions', 'Só @menções'], ['none', 'Nada']]} />
        </Field>
      </Panel>
      <MutedTargetsPanel />
      <QuietHoursPanel />
      <Panel id="xp-notify" title="Notifique-me quando…">
        <Row title="Amigos ficam online" on={!!p.notifyFriendOnline} onChange={(v) => setExtra({ notifyFriendOnline: v })} />
        <Row title="Um amigo e eu chegamos a um aniversário de amizade" on={p.notifyFriendAnniversary !== false} onChange={(v) => setExtra({ notifyFriendAnniversary: v })} />
        <Row title="Amigos atualizam o perfil deles" on={p.notifyFriendProfile !== false} onChange={(v) => setExtra({ notifyFriendProfile: v })} />
        <Field label="Alguém reage às minhas mensagens">
          <Seg label="Reações" value={p.notifyReactions || 'all'} onChange={(v) => setExtra({ notifyReactions: v })} options={[['all', 'Todas as mensagens'], ['dm', 'Só mensagens diretas'], ['none', 'Nunca']]} />
        </Field>
        <Row title="Resumo da semana" hint="Toda segunda: menções que você perdeu, eventos da semana e novidades da Loja." on={p.weeklyDigest !== false} onChange={(v) => setExtra({ weeklyDigest: v })} />
        <Row title="Avisar meus amigos quando eu atualizar meu perfil" on={p.shareProfileUpdates !== false} onChange={(v) => setExtra({ shareProfileUpdates: v })} />
        <Row title="Sai um anúncio novo" hint="Notificação no celular (push) e no PC quando a equipe publica em Novidades." on={p.notifyAnnouncements !== false} onChange={(v) => setExtra({ notifyAnnouncements: v })} />
        <Row title="Sai um evento novo" hint="Notificação no celular (push) e no PC quando um evento da comunidade é criado." on={p.notifyEvents !== false} onChange={(v) => setExtra({ notifyEvents: v })} />
        <Row title="Indicador de mensagens não lidas no ícone do app" hint="Bolinha vermelha na barra de tarefas (PC) e número no ícone (Android)." on={p.unreadBadge !== false} onChange={(v) => setExtra({ unreadBadge: v })} />
      </Panel>
      <Panel id="xp-sounds" title="Sons" hint={`Pacote em uso agora: ${SOUND_PACKS.find((s) => s.id === currentPack(p.soundPack))?.name}.`}>
        <Field label="Pacote de sons">
          <div className="xp-range">
            <select value={p.soundPack || 'auto'} onChange={(e) => setExtra({ soundPack: e.target.value })} aria-label="Pacote de sons" className="pc-select">
              {SOUND_PACKS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <Play onClick={() => previewSound('message', p.soundPack)} label="Ouvir pacote" />
          </div>
        </Field>
        <SoundList group="notify" />
        <button type="button" className="xp-mini-btn" onClick={() => setShowSounds((v) => !v)}>{showSounds ? 'Esconder sons de chamada' : `Mostrar ${SOUND_EVENTS.filter((e) => e.group === 'call').length} sons de chamada`}</button>
        {showSounds && <SoundList group="call" />}
      </Panel>
      <Panel id="xp-email" title="E-mails" hint="Escolha o que pode chegar no seu e-mail (vale quando você está offline).">
        <Row title="Comunicação" hint="Mensagens diretas e menções que você perdeu." on={p.emailComms !== false} onChange={(v) => setExtra({ emailComms: v })} />
        <Row title="Social" hint="Pedidos de amizade e aniversários de amizade." on={p.emailSocial !== false} onChange={(v) => setExtra({ emailSocial: v })} />
        <Row title="Novidades e anúncios" hint="Atualizações do Project Club." on={p.emailUpdates !== false} onChange={(v) => setExtra({ emailUpdates: v })} />
        <Row title="Dicas" hint="Recursos que você talvez não conheça." on={p.emailTips !== false} onChange={(v) => setExtra({ emailTips: v })} />
      </Panel>
    </>
  );
}

// ======================= Voz e vídeo =======================
function SensitivityMeter({ threshold }) {
  const [db, setDb] = useState(-100);
  const [on, setOn] = useState(false);
  const stop = useRef(() => {});
  useEffect(() => () => stop.current(), []);
  const start = async () => {
    stop.current();
    try {
      const id = getPreferredMicId();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: id ? { deviceId: { exact: id } } : true });
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const an = ctx.createAnalyser(); an.fftSize = 1024;
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      let raf = 0;
      const tick = () => {
        an.getFloatTimeDomainData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        setDb(rms > 0 ? Math.max(-100, 20 * Math.log10(rms)) : -100);
        raf = requestAnimationFrame(tick);
      };
      tick();
      setOn(true);
      stop.current = () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ctx.close().catch(() => {}); setOn(false); setDb(-100); };
    } catch { setOn(false); }
  };
  const pct = (v) => `${Math.max(0, Math.min(100, v + 100))}%`;
  return (
    <div className="xp-panel" style={{ gap: 6 }}>
      <div className="xp-meter" role="meter" aria-label="Nível do microfone" aria-valuemin={-100} aria-valuemax={0} aria-valuenow={Math.round(db)}>
        <div className={`xp-meter-fill${db < threshold ? ' below' : ''}`} style={{ width: pct(db) }} />
        <span className="xp-meter-mark" style={{ left: pct(threshold) }} />
      </div>
      <div className="xp-range">
        <button type="button" className="xp-mini-btn" onClick={on ? () => stop.current() : start}>{on ? 'Parar' : 'Testar com o microfone'}</button>
        <small className="dim">{on ? (db >= threshold ? 'Transmitindo: sua voz passa do limite.' : 'Abaixo do limite: nada é transmitido.') : 'O verde precisa passar da marca branca pra sua voz ir ao ar.'}</small>
      </div>
    </div>
  );
}

export function VoiceExtras({ prefs, updatePref }) {
  const p = useExtra();
  const voice = useVoice();
  const inCall = !!voice?.call;
  const inputVolume = Number.isFinite(p.inputVolume) ? p.inputVolume : 100;
  const profile = p.inputProfile || 'custom';
  const pickProfile = (v) => {
    setExtra({ inputProfile: v });
    if (v === 'isolation') { updatePref?.('noiseReduction', true); setExtra({ inputProfile: v, sensitivityAuto: true }); }
    if (v === 'studio') { updatePref?.('noiseReduction', false); setExtra({ inputProfile: v, sensitivityAuto: true }); }
  };
  const resetAll = () => {
    if (!window.confirm('Voltar todas as configurações de Voz e vídeo ao padrão?')) return;
    updatePref?.('noiseReduction', true);
    updatePref?.('autoLevelVolume', false);
    updatePref?.('pushToTalkEnabled', false);
    updatePref?.('captions', false);
    updatePref?.('pushToTalkReleaseMs', 200);
    setExtra({ inputProfile: 'custom', sensitivityAuto: true, sensitivityDb: -60, inputVolume: 100, sfxVolume: 100, joinSoundId: null, soundsOff: (p.soundsOff || []).filter((k) => !SOUND_EVENTS.some((e) => e.key === k && e.group === 'call')) });
  };
  return (
    <>
      <Panel id="xp-profile" title="Perfil de entrada" hint="Um atalho pra deixar o microfone do jeito certo.">
        <div className="xp-profiles" role="radiogroup" aria-label="Perfil de entrada">
          {[
            ['isolation', 'Isolamento de voz', 'Só a sua voz: o Project Club tira o ruído de fundo.'],
            ['studio', 'Estúdio', 'Áudio puro: microfone aberto, sem processamento.'],
            ['custom', 'Personalizado', 'Modo avançado: você escolhe cada opção.'],
          ].map(([v, t, h]) => (
            <button key={v} type="button" role="radio" aria-checked={profile === v} className={`xp-profile${profile === v ? ' on' : ''}`} onClick={() => pickProfile(v)}>
              <span className="xp-profile-dot" aria-hidden="true" />
              <strong>{t}</strong>
              <small>{h}</small>
            </button>
          ))}
        </div>
        {prefs && profile !== 'custom' && <small className="dim">Redutor de ruído: {prefs.noiseReduction ? 'ligado' : 'desligado'} (mudar à mão volta pro Personalizado).</small>}
      </Panel>
      {inCall && (
        <Panel id="xp-conn" title="Voz conectada" hint="Estado da sua conexão de voz agora: ping até o servidor de mídia e perda de pacotes no envio.">
          <VoiceConnectionPanel voice={voice} />
        </Panel>
      )}
      <Panel id="xp-input-volume" title="Volume de entrada" hint="Aumenta ou diminui o volume do seu microfone pra todo mundo da chamada.">
        <div className="xp-range">
          <input type="range" min="0" max="200" step="5" value={inputVolume} onChange={(e) => setExtra({ inputVolume: Number(e.target.value) })} aria-label="Volume de entrada do microfone" />
          <output>{inputVolume}%</output>
        </div>
        {inCall && typeof voice?.subscribeMicLevel === 'function'
          ? <LiveMicMeter voice={voice} />
          : <small className="dim">Entre numa chamada pra ver o nível do microfone ao vivo.</small>}
      </Panel>
      <Panel id="xp-sens" title="Sensibilidade de entrada" hint="Controla quanto som precisa ter pra seu microfone transmitir.">
        <Row title="Determinar automaticamente" on={p.sensitivityAuto !== false} onChange={(v) => setExtra({ sensitivityAuto: v })} />
        {p.sensitivityAuto === false && (
          <>
            <div className="xp-range">
              <input type="range" min="-100" max="0" step="1" value={p.sensitivityDb ?? -60} onChange={(e) => setExtra({ sensitivityDb: Number(e.target.value) })} aria-label="Limite em dB" />
              <output>{p.sensitivityDb ?? -60} dB</output>
            </div>
            <SensitivityMeter threshold={p.sensitivityDb ?? -60} />
          </>
        )}
      </Panel>
      <Panel id="xp-sfx" title="Efeitos sonoros" hint="Volume dos sons de chamada e o som que toca pra todos quando você entra numa call.">
        <Field label="Volume dos efeitos sonoros">
          <div className="xp-range"><input type="range" min="0" max="100" step="5" value={p.sfxVolume ?? 100} onChange={(e) => setExtra({ sfxVolume: Number(e.target.value) })} aria-label="Volume dos efeitos" /><output>{p.sfxVolume ?? 100}%</output></div>
        </Field>
        <Field label="Som de entrada">
          <div className="xp-entry-grid" role="radiogroup" aria-label="Som de entrada">
            <button type="button" role="radio" aria-checked={!p.joinSoundId} className={`xp-entry${!p.joinSoundId ? ' on' : ''}`} onClick={() => setExtra({ joinSoundId: null })}>Nenhum</button>
            {ENTRY_SOUNDS.map((s) => (
              <button key={s.id} type="button" role="radio" aria-checked={p.joinSoundId === s.id} className={`xp-entry${p.joinSoundId === s.id ? ' on' : ''}`}
                onClick={() => { setExtra({ joinSoundId: s.id }); playEntrySound(s.id, { force: true }); }}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M7 4v16l13-8z" /></svg>{s.name}
              </button>
            ))}
          </div>
          <small className="dim">Toca pra todo mundo da call quando você entra (no máximo a cada 20 segundos).</small>
        </Field>
        <Field label="Sons da chamada"><SoundList group="call" /></Field>
      </Panel>
      <div className="settings-block">
        <h4>Redefinir configurações de Voz e vídeo</h4>
        <p className="dim">Volta ao conjunto padrão (microfone e alto-falante escolhidos continuam).</p>
        <div className="settings-inline-actions"><button type="button" className="btn-danger" onClick={resetAll}>Redefinir</button></div>
      </div>
    </>
  );
}

// ======================= Privacidade =======================
export function PrivacyExtras() {
  const p = useExtra();
  return (
    <>
      <Panel id="xp-spam" title="Filtros de spam" hint="Mensagens suspeitas de spam vão pra pasta Spam das suas mensagens diretas.">
        <Seg label="Filtro de spam" value={p.spamFilter || 'strangers'} onChange={(v) => setExtra({ spamFilter: v })} options={[['all', 'Filtrar tudo'], ['strangers', 'Só de desconhecidos'], ['off', 'Não filtrar']]} />
      </Panel>
      <Panel id="xp-requests" title="Mensagens diretas e pedidos de amizade">
        <Row title="Solicitações de mensagem" hint="Conversas novas de quem não é seu amigo chegam como solicitação: você aceita antes de responder." on={p.messageRequests !== false} onChange={(v) => setExtra({ messageRequests: v })} />
        <Row title="Mostrar mensagens personalizadas nos pedidos de amizade" hint="Quem te adiciona pode mandar um recado junto." on={p.friendReqMessages !== false} onChange={(v) => setExtra({ friendReqMessages: v })} />
      </Panel>
      <Panel id="xp-local-cache" title="Dados neste aparelho">
        <Row
          title="Guardar mensagens recentes neste aparelho"
          hint="Abre canais e conversas na hora (e mostra as últimas mensagens mesmo sem internet). Desligar apaga a cópia salva. Sair da conta também apaga."
          on={p.cacheMessages !== false}
          onChange={(v) => { setExtra({ cacheMessages: v }); if (!v) clearMessageCache(); }}
        />
      </Panel>
      <Panel id="xp-clips" title="Gravações de chamada">
        <Row title="Permitir que minha voz seja gravada nos clipes" hint="Desligado, pedidos de gravação na call são recusados automaticamente por você." on={p.clipVoice !== false} onChange={(v) => setExtra({ clipVoice: v })} />
      </Panel>
    </>
  );
}
