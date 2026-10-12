import { useStore, withChannelStates } from '../store/useStore';
import { sameData } from './liveRefresh';

// Aplica no store as seções do pacote de abertura (utils/bootstrap.js).
// Cada seção tem o corpo da rota antiga, então isso faz exatamente o que
// MainApp/useGlobalLiveRefresh faziam com cada resposta separada — só
// grava o que mudou de verdade (evita re-render do app inteiro à toa).
const LIST_SECTIONS = [
  // seção, campo da resposta, chave no store, setter
  ['conversations', 'conversations', 'conversations', 'setConversations'],
  ['friends', 'friendships', 'friends', 'setFriends'],
  ['usableEmojis', 'emojis', 'usableEmojis', 'setUsableEmojis'],
  ['stickers', 'stickers', 'serverStickers', 'setServerStickers'],
  ['emojiCollections', 'collections', 'emojiCollections', 'setEmojiCollections'],
  ['stickerCollections', 'collections', 'stickerCollections', 'setStickerCollections'],
  ['favoriteGifs', 'gifs', 'favoriteGifs', 'setFavoriteGifs'],
  ['clubs', 'communities', 'clubs', 'setClubs'],
  ['settings', 'settings', 'userSettings', 'setUserSettings'],
];

export function applyBootData(data) {
  if (!data) return;
  const s = useStore.getState();
  // Estado de leitura dos canais primeiro — a estrutura da comunidade
  // logo abaixo já entra mesclada com ele.
  if (data.channelStates?.states && !sameData(s.channelStates, data.channelStates.states)) {
    s.setChannelStates(data.channelStates.states);
  }
  if (data.community) {
    const d = data.community;
    const cur = useStore.getState();
    // Compara já mesclado com o estado de leitura (é assim que está no store).
    const merged = {
      ...d,
      channels: d.channels && withChannelStates(d.channels, cur.channelStates, cur.channelReadAt),
      categories: d.categories && d.categories.map((cat) => ({ ...cat, channels: withChannelStates(cat.channels || [], cur.channelStates, cur.channelReadAt) })),
    };
    const patch = {};
    ['categories', 'channels', 'members', 'roles', 'community'].forEach((k) => {
      if (d[k] !== undefined && !sameData(cur[k], merged[k])) patch[k] = d[k];
    });
    if (Object.keys(patch).length) s.setCommunityStructure(patch);
  }
  LIST_SECTIONS.forEach(([section, field, key, setter]) => {
    const body = data[section];
    if (!body || body[field] === undefined) return;
    if (sameData(useStore.getState()[key], body[field])) return;
    useStore.getState()[setter](body[field]);
  });
  if (data.clan) {
    const d = data.clan;
    const cur = useStore.getState();
    const next = { clan: d.clan, myRole: d.myRole || null, myCapabilities: d.myCapabilities || {} };
    const prev = { clan: cur.myClan, myRole: cur.myClanRole, myCapabilities: cur.myClanCapabilities };
    if (!sameData(prev, next) || (d.pendingRequests !== undefined && !sameData(cur.myClanPendingRequests, d.pendingRequests))) s.setMyClan(d);
  }
  if (data.uiLayout && !sameData(useStore.getState().uiLayoutAll, data.uiLayout)) s.setUiLayoutAll(data.uiLayout);
}
