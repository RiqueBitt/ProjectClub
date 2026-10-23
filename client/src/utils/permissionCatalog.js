// Catálogo de permissões no estilo do Discord: grupo, nome e uma explicação
// curta de cada uma. Usado pelo editor de cargos e pelo editor de permissões
// de canais/categorias. Os bits ficam em utils/permissions.js (espelho do
// servidor) — aqui é só a parte de exibição.
import { PERMISSIONS } from './permissions';

export const PERMISSION_INFO = {
  VIEW_CHANNEL: ['Ver canais', 'Permite que os membros vejam os canais (exceto canais privados).'],
  MANAGE_CHANNELS: ['Gerenciar canais', 'Permite que os membros criem, editem ou excluam canais e categorias.'],
  MANAGE_ROLES: ['Gerenciar cargos', 'Permite criar cargos e editar ou excluir os que estão abaixo do seu cargo mais alto. Também permite mudar permissões de canais.'],
  MANAGE_EMOJIS: ['Gerenciar emojis', 'Permite adicionar, editar ou remover emojis personalizados da comunidade.'],
  MANAGE_STICKERS: ['Gerenciar figurinhas', 'Permite adicionar ou remover figurinhas personalizadas da comunidade.'],
  MANAGE_CLAN_ICONS: ['Gerenciar ícones de clã', 'Permite criar e remover os ícones que os clãs podem usar.'],
  VIEW_AUDIT_LOG: ['Ver o registro de auditoria', 'Permite ver um registro de quem fez quais alterações e moderações na comunidade.'],
  MANAGE_COMMUNITY: ['Gerenciar comunidade', 'Permite mudar o nome, o ícone e as configurações gerais da comunidade.'],
  CHANGE_NICKNAME: ['Alterar apelido', 'Permite que os membros mudem o próprio apelido.'],
  MANAGE_NICKNAMES: ['Gerenciar apelidos', 'Permite que os membros mudem o apelido de outros membros.'],
  KICK_MEMBERS: ['Expulsar membros', 'Permite remover outros membros da comunidade.'],
  BAN_MEMBERS: ['Banir membros', 'Permite banir outros membros de forma permanente e apagar o histórico de mensagens deles.'],
  MODERATE_MEMBERS: ['Membros de castigo', 'Permite colocar membros de castigo (sem mandar mensagens, reagir ou falar por um tempo) e dar advertências.'],
  SEND_MESSAGES: ['Enviar mensagens', 'Permite mandar mensagens nos canais de texto.'],
  CREATE_TOPICS: ['Criar tópicos', 'Permite abrir tópicos a partir de mensagens e criar postagens em fóruns.'],
  ATTACH_FILES: ['Anexar arquivos', 'Permite enviar arquivos, imagens e vídeos nos canais de texto.'],
  ADD_REACTIONS: ['Adicionar reações', 'Permite reagir às mensagens com emojis novos. Sem ela, ainda dá para usar reações que já existem.'],
  MENTION_EVERYONE: ['Mencionar @everyone, @here e todos os cargos', 'Permite usar @everyone e @here e mencionar qualquer cargo, mesmo os que não permitem menção.'],
  MANAGE_MESSAGES: ['Gerenciar mensagens', 'Permite excluir e fixar mensagens de outros membros. Também ignora o modo lento.'],
  MANAGE_TOPICS: ['Gerenciar tópicos e postagens', 'Permite renomear, fixar, trancar e excluir tópicos e postagens de outros membros.'],
  CREATE_POLLS: ['Criar enquetes', 'Permite criar enquetes nos canais.'],
  CONNECT: ['Conectar', 'Permite entrar nos canais de voz e ouvir os outros.'],
  SPEAK: ['Falar', 'Permite falar nos canais de voz. Sem ela, o membro entra silenciado.'],
  VIDEO: ['Vídeo', 'Permite ligar a câmera e transmitir a tela nos canais de voz.'],
  USE_SOUNDBOARD: ['Usar efeitos sonoros', 'Permite tocar sons do painel de efeitos sonoros nos canais de voz.'],
  MUTE_MEMBERS: ['Silenciar membros', 'Permite silenciar outros membros para todos em um canal de voz.'],
  DEAFEN_MEMBERS: ['Ensurdecer membros', 'Permite ensurdecer outros membros: eles não ouvem nem falam no canal de voz.'],
  MOVE_MEMBERS: ['Mover membros', 'Permite desconectar membros ou movê-los entre canais de voz.'],
  ADMINISTRATOR: ['Administrador', 'Membros com esta permissão têm TODAS as outras e ignoram as restrições de canais (veem até os canais privados). Pense bem antes de conceder.'],
};

// Grupos da tela de cargos (na mesma ordem do Discord).
export const ROLE_GROUPS = [
  { label: 'Permissões gerais da comunidade', keys: ['VIEW_CHANNEL', 'MANAGE_CHANNELS', 'MANAGE_ROLES', 'MANAGE_EMOJIS', 'MANAGE_STICKERS', 'MANAGE_CLAN_ICONS', 'VIEW_AUDIT_LOG', 'MANAGE_COMMUNITY'] },
  { label: 'Permissões de membros', keys: ['CHANGE_NICKNAME', 'MANAGE_NICKNAMES', 'KICK_MEMBERS', 'BAN_MEMBERS', 'MODERATE_MEMBERS'] },
  { label: 'Permissões de canal de texto', keys: ['SEND_MESSAGES', 'CREATE_TOPICS', 'ATTACH_FILES', 'ADD_REACTIONS', 'MENTION_EVERYONE', 'MANAGE_MESSAGES', 'MANAGE_TOPICS', 'CREATE_POLLS'] },
  { label: 'Permissões de canal de voz', keys: ['CONNECT', 'SPEAK', 'VIDEO', 'USE_SOUNDBOARD', 'MUTE_MEMBERS', 'DEAFEN_MEMBERS', 'MOVE_MEMBERS'] },
  { label: 'Permissões avançadas', keys: ['ADMINISTRATOR'] },
];

const TEXT_KEYS = ['SEND_MESSAGES', 'CREATE_TOPICS', 'ATTACH_FILES', 'ADD_REACTIONS', 'MENTION_EVERYONE', 'MANAGE_MESSAGES', 'MANAGE_TOPICS', 'CREATE_POLLS'];
const VOICE_KEYS = ['CONNECT', 'SPEAK', 'VIDEO', 'USE_SOUNDBOARD', 'MUTE_MEMBERS', 'DEAFEN_MEMBERS', 'MOVE_MEMBERS'];
// Canal de voz também tem chat de texto embutido.
const VOICE_CHAT_KEYS = ['SEND_MESSAGES', 'ATTACH_FILES', 'ADD_REACTIONS', 'MENTION_EVERYONE', 'MANAGE_MESSAGES'];

// Grupos que fazem sentido num canal (ou categoria = tudo que um canal pode ter).
export function overwriteGroups(kind, channelType) {
  const general = { label: 'Permissões gerais do canal', keys: ['VIEW_CHANNEL'] };
  if (kind === 'category') {
    return [
      { ...general, label: 'Permissões gerais da categoria' },
      { label: 'Permissões de canal de texto', keys: TEXT_KEYS },
      { label: 'Permissões de canal de voz', keys: VOICE_KEYS },
    ];
  }
  if (channelType === 'VOICE' || channelType === 'STAGE') {
    return [general, { label: 'Permissões de canal de voz', keys: VOICE_KEYS }, { label: 'Chat de texto do canal de voz', keys: VOICE_CHAT_KEYS }];
  }
  return [general, { label: 'Permissões de canal de texto', keys: TEXT_KEYS }];
}

export const bits = (v) => { try { return BigInt(v ?? '0'); } catch { return 0n; } };
export const hasBit = (value, key) => (bits(value) & (PERMISSIONS[key] ?? 0n)) !== 0n;

// allow/deny (strings decimais) → { KEY: 'allow' | 'deny' }
export function overwriteToState(o) {
  const st = {};
  if (!o) return st;
  for (const key of Object.keys(PERMISSION_INFO)) {
    if (hasBit(o.allow, key)) st[key] = 'allow';
    else if (hasBit(o.deny, key)) st[key] = 'deny';
  }
  return st;
}

export function stateToLists(st) {
  const allow = []; const deny = [];
  for (const [k, v] of Object.entries(st || {})) { if (v === 'allow') allow.push(k); else if (v === 'deny') deny.push(k); }
  return { allow, deny };
}

export function matchesSearch(key, q) {
  if (!q) return true;
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const [name, desc] = PERMISSION_INFO[key] || [key, ''];
  return norm(`${name} ${desc}`).includes(norm(q));
}
