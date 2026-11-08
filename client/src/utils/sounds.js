// Sons do app. Os eventos clássicos (mensagem, entrar/sair de call, tocar
// chamada...) usam os arquivos de client/public/sounds/; os demais (mutar,
// câmera, transmissão, alguém entrou...) e os pacotes temáticos são
// sintetizados na hora com WebAudio (sem arquivo, sem download).
//
// Preferências (Configurações → Notificações / Voz e vídeo):
// - notificationSounds (geral) desliga os sons de "algo aconteceu";
// - extraPrefs.soundsOff: lista de sons desligados um por um;
// - extraPrefs.soundPack: clássico, Dia das Bruxas, Natal, Retrô, Suave ou
//   automático (pacote da estação);
// - extraPrefs.sfxVolume: volume dos efeitos;
// - modo streamer pode silenciar tudo.
import { useStore } from '../store/useStore';
import { getExtra, streamerQuiet } from './extraPrefs';
import { isQuietHoursActive } from './notificationLevels';

const SOUND_FILES = {
  join: '/sounds/call-join.wav',
  leave: '/sounds/call-leave.wav',
  message: '/sounds/notification.wav',
  mention: '/sounds/notification.wav',
  friendRequest: '/sounds/notification.wav',
  incomingCall: '/sounds/dm-call-ringing.mp3',
  appOpen: '/sounds/app-open.wav',
  switchChannel: '/sounds/switch.wav',
};
// Nomes antigos usados pelo resto do app.
const ALIASES = { callJoin: 'join', callLeave: 'leave', dmCallRinging: 'incomingCall' };

// Lista mostrada em Configurações (ordem e rótulos).
export const SOUND_EVENTS = [
  { key: 'message', label: 'Nova mensagem', group: 'notify' },
  { key: 'messageActive', label: 'Mensagem na conversa aberta', group: 'notify' },
  { key: 'mention', label: 'Menção', group: 'notify' },
  { key: 'friendRequest', label: 'Pedido de amizade', group: 'notify' },
  { key: 'notice', label: 'Aviso (presente, missão, lembrete)', group: 'notify' },
  { key: 'incomingCall', label: 'Chamada recebida', group: 'notify' },
  { key: 'outgoingCall', label: 'Chamando alguém', group: 'call' },
  { key: 'mute', label: 'Microfone silenciado', group: 'call' },
  { key: 'unmute', label: 'Microfone ativado', group: 'call' },
  { key: 'deafen', label: 'Áudio desativado', group: 'call' },
  { key: 'undeafen', label: 'Áudio reativado', group: 'call' },
  { key: 'join', label: 'Você entrou na call', group: 'call' },
  { key: 'leave', label: 'Você saiu da call', group: 'call' },
  { key: 'userJoin', label: 'Alguém entrou na call', group: 'call' },
  { key: 'userLeave', label: 'Alguém saiu da call', group: 'call' },
  { key: 'userMoved', label: 'Você foi movido de canal', group: 'call' },
  { key: 'camOn', label: 'Câmera ligada', group: 'call' },
  { key: 'camOff', label: 'Câmera desligada', group: 'call' },
  { key: 'streamStart', label: 'Transmissão iniciada', group: 'call' },
  { key: 'streamStop', label: 'Transmissão encerrada', group: 'call' },
  { key: 'streamUserJoin', label: 'Alguém começou a assistir', group: 'call' },
  { key: 'streamUserLeave', label: 'Alguém parou de assistir', group: 'call' },
  { key: 'pttActivate', label: 'Apertar para falar: ativo', group: 'call' },
  { key: 'pttDeactivate', label: 'Apertar para falar: solto', group: 'call' },
  { key: 'disconnect', label: 'Conexão de voz caiu', group: 'call' },
  { key: 'reconnect', label: 'Voz reconectada', group: 'call' },
];
const NOTIFY_KEYS = new Set(SOUND_EVENTS.filter((e) => e.group === 'notify').map((e) => e.key));
const CALL_KEYS = new Set(SOUND_EVENTS.filter((e) => e.group === 'call').map((e) => e.key));

export const SOUND_PACKS = [
  { id: 'auto', name: 'Automático (da estação)' },
  { id: 'classic', name: 'Clássico' },
  { id: 'halloween', name: 'Dia das Bruxas 🎃' },
  { id: 'natal', name: 'Natal 🎄' },
  { id: 'retro', name: 'Retrô 8-bit' },
  { id: 'suave', name: 'Suave' },
];

export function currentPack(pref = getExtra().soundPack) {
  if (pref && pref !== 'auto') return pref;
  const m = new Date().getMonth();
  if (m === 9) return 'halloween';
  if (m === 11) return 'natal';
  return 'classic';
}

// Notas (Hz) de cada evento: [freq, duração(s), atraso(s)].
const N = (f, d = 0.09, t = 0) => [f, d, t];
const MELODIES = {
  message: [N(880, 0.08), N(1175, 0.12, 0.08)],
  messageActive: [N(988, 0.07)],
  mention: [N(988, 0.08), N(1319, 0.08, 0.09), N(1568, 0.14, 0.18)],
  friendRequest: [N(784, 0.1), N(988, 0.1, 0.1), N(1175, 0.16, 0.2)],
  notice: [N(1047, 0.1), N(1319, 0.16, 0.1)],
  incomingCall: [N(659, 0.18), N(784, 0.18, 0.2), N(659, 0.18, 0.6), N(784, 0.18, 0.8)],
  outgoingCall: [N(523, 0.3), N(523, 0.3, 0.9)],
  mute: [N(523, 0.07), N(392, 0.1, 0.07)],
  unmute: [N(392, 0.07), N(523, 0.1, 0.07)],
  deafen: [N(440, 0.07), N(330, 0.07, 0.07), N(262, 0.12, 0.14)],
  undeafen: [N(262, 0.07), N(330, 0.07, 0.07), N(440, 0.12, 0.14)],
  join: [N(523, 0.08), N(659, 0.08, 0.08), N(784, 0.14, 0.16)],
  leave: [N(784, 0.08), N(659, 0.08, 0.08), N(523, 0.14, 0.16)],
  userJoin: [N(659, 0.07), N(880, 0.12, 0.07)],
  userLeave: [N(880, 0.07), N(659, 0.12, 0.07)],
  userMoved: [N(587, 0.08), N(784, 0.08, 0.1), N(587, 0.1, 0.2)],
  camOn: [N(740, 0.06), N(988, 0.1, 0.06)],
  camOff: [N(988, 0.06), N(740, 0.1, 0.06)],
  streamStart: [N(523, 0.08), N(784, 0.08, 0.08), N(1047, 0.16, 0.16)],
  streamStop: [N(1047, 0.08), N(784, 0.08, 0.08), N(523, 0.16, 0.16)],
  streamUserJoin: [N(1175, 0.08)],
  streamUserLeave: [N(880, 0.08)],
  pttActivate: [N(1319, 0.04)],
  pttDeactivate: [N(988, 0.04)],
  disconnect: [N(330, 0.15), N(247, 0.25, 0.15)],
  reconnect: [N(392, 0.08), N(587, 0.14, 0.09)],
};
// Cada pacote muda timbre, oitava e "efeito".
// BUG CORRIGIDO ("os efeitos estão robóticos e agudos demais"): antes eram
// ondas puras com ataque de 12 ms, notas até 1,5 kHz e — em outubro — o
// pacote do Dia das Bruxas com onda dente-de-serra (a mais áspera). Agora:
// uma oitava abaixo, ataque mais macio, cauda suave, um harmônico leve pra
// soar "de verdade" (tipo marimba/sininho) e um filtro passa-baixa que corta
// o chiado agudo. Nenhuma nota passa de ~1,2 kHz.
const PACKS = {
// BUG CORRIGIDO ("efeitos abafados"): o passa-baixa ficava praticamente EM
// CIMA do som — corte entre 1,3 e 2,6 kHz com Q 0,5 (que já atenua ~6 dB no
// próprio corte) tirava o 2º harmônico e todo o "ar" das notas. Como as notas
// já ficam abaixo de ~1,2 kHz, o filtro agora só corta o chiado de verdade
// (bem acima do 3º harmônico) com resposta plana (Q 0,707, Butterworth).
  classic: { wave: 'sine', mult: 0.5, gain: 0.2, attack: 0.016, release: 0.2, lowpass: 6000, harm: 0.16 },
  suave: { wave: 'sine', mult: 0.5, gain: 0.15, slow: 1.35, attack: 0.03, release: 0.32, lowpass: 4500, harm: 0.08 },
  retro: { wave: 'square', mult: 0.5, gain: 0.045, attack: 0.008, release: 0.08, lowpass: 5000 },
  halloween: { wave: 'triangle', mult: 0.5, gain: 0.17, minor: true, vibrato: 5, vibDepth: 0.012, attack: 0.025, release: 0.28, lowpass: 4000, harm: 0.1 },
  natal: { wave: 'sine', mult: 1, gain: 0.15, bell: true, attack: 0.01, release: 0.5, lowpass: 7000 },
};
const MAX_FREQ = 1200; // acima disso fica estridente: desce uma oitava

let ctx = null;
function audioCtx() {
  if (!ctx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    ctx = new C();
  }
  if (ctx.state === 'suspended') ctx.resume().catch(() => {});
  return ctx;
}

function synth(key, packId, volume, customNotes) {
  const ac = audioCtx();
  const notes = customNotes || MELODIES[key];
  if (!ac || !notes) return;
  const pk = PACKS[packId] || PACKS.classic;
  const now = ac.currentTime + 0.01;
  const master = ac.createGain();
  master.gain.value = volume;
  // Passa-baixa suave: tira a aspereza (sem deixar abafado).
  const lp = ac.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = pk.lowpass || 6000;
  lp.Q.value = Math.SQRT1_2;
  master.connect(lp);
  lp.connect(ac.destination);
  const attack = pk.attack || 0.016;
  const release = pk.release || 0.2;
  notes.forEach(([f0, d0, t0]) => {
    const slow = pk.slow || 1;
    const t = now + t0 * slow;
    const d = d0 * slow;
    let f = f0 * pk.mult;
    if (pk.minor) f *= 0.944; // meio tom abaixo: soa "assombrado"
    while (f > MAX_FREQ) f /= 2;
    const end = t + d + release;
    const voice = (type, freq, level) => {
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (pk.vibrato) {
        const lfo = ac.createOscillator();
        const lg = ac.createGain();
        lfo.frequency.value = pk.vibrato; lg.gain.value = freq * (pk.vibDepth || 0.012);
        lfo.connect(lg); lg.connect(osc.frequency);
        lfo.start(t); lfo.stop(end + 0.05);
      }
      // Envelope macio: sobe em rampa linear e morre em curva natural.
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + attack);
      g.gain.setValueAtTime(level, t + Math.max(attack, d * 0.4));
      g.gain.exponentialRampToValueAtTime(0.0001, end);
      osc.connect(g); g.connect(master);
      osc.start(t); osc.stop(end + 0.05);
    };
    voice(pk.wave, f, pk.gain);
    if (pk.harm) voice('sine', f * 2, pk.gain * pk.harm); // corpo: um pouco do 2º harmônico
    if (pk.bell) voice('sine', f * 2.76, pk.gain * 0.22); // brilho de sininho, baixinho
  });
}

function playFile(src, volume) {
  try {
    const el = new Audio(src);
    el.volume = Math.max(0, Math.min(1, volume));
    // BUG CORRIGIDO ("efeitos abafados"): os WAV/MP3 originais (16 bits,
    // 44,1 kHz) passavam por um passa-baixa em 3,2 kHz via
    // createMediaElementSource — e só quando o AudioContext já estava
    // "running", então o MESMO som às vezes saía limpo e às vezes abafado.
    // Os arquivos já são masterizados: tocam direto, sem filtro nenhum.
    el.preload = 'auto';
    el.play().catch(() => {});
  } catch { /* som é só enfeite */ }
}

// Pode tocar este som agora?
export function soundAllowed(key) {
  const prefs = getExtra();
  if (streamerQuiet('sound')) return false;
  if ((prefs.soundsOff || []).includes(key)) return false;
  if (NOTIFY_KEYS.has(key)) {
    const settings = useStore.getState().userSettings;
    if (settings && settings.notificationSounds === false) return false;
    // "Não perturbe" agendado: sons de notificação ficam quietos.
    if (isQuietHoursActive(prefs.quietHours)) return false;
  }
  return true;
}

export function playSound(name, volume = 0.5, { force = false, pack } = {}) {
  const key = ALIASES[name] || name;
  if (!force && !soundAllowed(key)) return;
  const prefs = getExtra();
  const sfx = CALL_KEYS.has(key) ? (prefs.sfxVolume ?? 100) / 100 : 1;
  const vol = volume * sfx;
  if (vol <= 0) return;
  const p = pack || currentPack(prefs.soundPack);
  // No modo "Automático (da estação)" o pacote sazonal (ex.: Dia das Bruxas
  // em outubro) trocava TODOS os sons — inclusive os que têm gravação de boa
  // qualidade — por síntese. Agora o automático só "fantasia" os sons que
  // não têm arquivo; quem escolhe um pacote explicitamente continua ouvindo
  // o pacote inteiro.
  const autoPack = !pack && (!prefs.soundPack || prefs.soundPack === 'auto');
  if (SOUND_FILES[key] && (p === 'classic' || autoPack)) return playFile(SOUND_FILES[key], vol);
  if (!MELODIES[key]) { if (SOUND_FILES[key]) playFile(SOUND_FILES[key], vol); return; }
  try { synth(key, p, vol); } catch { /* sem áudio */ }
}

// Prévia nas Configurações (toca mesmo se estiver desligado).
export function previewSound(key, pack) {
  playSound(key, 0.5, { force: true, pack: pack ? currentPack(pack) : undefined });
}

// ---------- Sons de entrada (tocam pra todo mundo da call) ----------
export const ENTRY_SOUNDS = [
  { id: 'tada', name: 'Tcharã!', pack: 'classic', notes: [N(523, 0.08), N(659, 0.08, 0.08), N(784, 0.08, 0.16), N(1047, 0.3, 0.24)] },
  { id: 'oi', name: 'Oi!', pack: 'classic', notes: [N(880, 0.06), N(1320, 0.1, 0.08)] },
  { id: 'fanfarra', name: 'Fanfarra', pack: 'retro', notes: [N(392, 0.1), N(392, 0.1, 0.12), N(392, 0.1, 0.24), N(523, 0.35, 0.36)] },
  { id: 'moeda', name: 'Moeda', pack: 'retro', notes: [N(988, 0.05), N(1319, 0.25, 0.05)] },
  { id: 'portal', name: 'Portal', pack: 'suave', notes: [300, 400, 520, 680, 880, 1150].map((f, i) => N(f, 0.06, i * 0.05)) },
  { id: 'sino', name: 'Sininho', pack: 'natal', notes: [N(784, 0.15), N(1047, 0.3, 0.15)] },
  { id: 'buzina', name: 'Buzina', pack: 'halloween', notes: [N(440, 0.2), N(440, 0.3, 0.25)] },
  { id: 'pulo', name: 'Pulo', pack: 'retro', notes: [N(392, 0.05), N(523, 0.05, 0.05), N(784, 0.08, 0.1)] },
  { id: 'magia', name: 'Magia', pack: 'natal', notes: [N(1047, 0.05), N(1319, 0.05, 0.06), N(1568, 0.05, 0.12), N(2093, 0.2, 0.18)] },
  { id: 'tambor', name: 'Tambor', pack: 'classic', notes: [N(110, 0.08), N(110, 0.08, 0.15), N(165, 0.2, 0.3)] },
];
export function playEntrySound(id, { force = false } = {}) {
  const def = ENTRY_SOUNDS.find((e) => e.id === id);
  if (!def) return;
  if (!force && streamerQuiet('sound')) return;
  const vol = 0.45 * ((getExtra().sfxVolume ?? 100) / 100);
  if (vol <= 0) return;
  try { synth(id, def.pack, vol, def.notes); } catch { /* sem áudio */ }
}
