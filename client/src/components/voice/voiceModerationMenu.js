// Menu de moderação de voz (igual ao Discord): Silenciar no servidor,
// Ensurdecer no servidor, Mover para… e Desconectar. Usado nos blocos da
// call (VoiceChannelView) e na lista de quem está na voz da barra lateral
// (ChannelSidebar). Só aparece com a permissão certa — o servidor confere de
// novo (permissão no canal + hierarquia de cargos) e responde com erro se
// não puder (ver server/src/services/voiceModeration.js).
import { hasPermission } from '../../utils/permissions';
import { useStore } from '../../store/useStore';
import { VOICE_TYPES } from '../../utils/channelMentions';

// Canais de voz/palco da comunidade (pra "Mover para…").
export function voiceChannelsForMove(excludeId) {
  const s = useStore.getState();
  const all = [...(s.channels || []), ...(s.categories || []).flatMap((c) => c.channels || [])];
  const seen = new Set();
  return all.filter((c) => {
    if (!c || seen.has(c.id) || !VOICE_TYPES.includes(c.type) || c.id === excludeId) return false;
    seen.add(c.id);
    return true;
  });
}

// Itens do menu (vazio = sem permissão nenhuma / chamada sem moderação).
// `target`: { userId, serverMuted?, serverDeafened? }.
export function buildVoiceModerationItems({ voice, channelId, target, myPerms, myUserId }) {
  if (!voice || !channelId || !target?.userId) return [];
  if (String(channelId).startsWith('dm:') || String(channelId).startsWith('clan:')) return [];
  const items = [];
  const uid = target.userId;
  const isMe = uid === myUserId;
  if (hasPermission(myPerms, 'MUTE_MEMBERS')) {
    items.push({
      label: 'Silenciar no servidor', checked: !!target.serverMuted,
      onClick: () => voice.serverMuteMember?.(uid, !target.serverMuted, channelId),
    });
  }
  if (hasPermission(myPerms, 'DEAFEN_MEMBERS')) {
    items.push({
      label: 'Ensurdecer no servidor', checked: !!target.serverDeafened,
      onClick: () => voice.serverDeafenMember?.(uid, !target.serverDeafened, channelId),
    });
  }
  if (hasPermission(myPerms, 'MOVE_MEMBERS')) {
    const dests = voiceChannelsForMove(channelId);
    if (dests.length) {
      items.push({
        label: 'Mover para…',
        submenu: dests.map((c) => ({ label: c.name, onClick: () => voice.moveMember?.(uid, c.id, channelId) })),
      });
    }
    if (!isMe) {
      items.push({ divider: true });
      items.push({ label: 'Desconectar', danger: true, onClick: () => voice.disconnectMember?.(uid, channelId) });
    }
  }
  return items;
}
