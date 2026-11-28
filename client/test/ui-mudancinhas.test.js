// Mudancinhas: número vermelho de não lidas, insígnias como ícones
// coloridos e a chave de aviso de anúncio/evento.
import test from 'node:test';
import assert from 'node:assert/strict';
import { channelUnreadBadge, sumUnread } from '../src/utils/unreadCount.js';
import { badgeVisual, badgeCustomImage, BADGE_TYPE_ICONS, BADGE_ICON_PATHS } from '../src/utils/badgeIcons.js';
import { wantsBroadcastNotify } from '../src/utils/broadcastNotify.js';

test('bolinha vermelha do canal: só menção ou resposta pra você; mensagem comum não acende', () => {
  assert.equal(channelUnreadBadge({ unreadCount: 0 }), null);
  // Mensagem comum de outra pessoa (sem me marcar nem me responder): nada de vermelho.
  assert.equal(channelUnreadBadge({ unreadCount: 5 }), null);
  assert.equal(channelUnreadBadge({ unreadCount: 250 }), null);
  // Menções e respostas pendentes: o número é quantas são, não o total de mensagens.
  const m = channelUnreadBadge({ unreadCount: 40, unreadMentions: 2 });
  assert.deepEqual({ count: m.count, mentions: m.mentions, label: m.label, mention: m.mention }, { count: 2, mentions: 2, label: '2', mention: true });
  assert.match(m.title, /2 menções ou respostas/);
  assert.match(channelUnreadBadge({ unreadMentions: 1 }).title, /^1 menção ou resposta/);
  assert.equal(channelUnreadBadge({ unreadMentions: 130 }).label, '99+');
  assert.equal(channelUnreadBadge({ unreadCount: 7, unreadMentions: 3 }, { active: true }), null, 'canal aberto não mostra');
  assert.equal(channelUnreadBadge({ unreadCount: 7 }, { muted: true }), null);
  assert.equal(channelUnreadBadge({ unreadCount: 7, unreadMentions: 1 }, { muted: true }).count, 1, 'menção aparece mesmo silenciado');
  assert.deepEqual(sumUnread([{ unreadCount: 3 }, { unreadMentions: 2 }, {}]), { count: 5, mentions: 2 });
});

test('insígnias: cada tipo oficial tem ícone e cor; PNG padrão vira ícone', () => {
  for (const [key, v] of Object.entries(BADGE_TYPE_ICONS)) {
    assert.ok(BADGE_ICON_PATHS[v.icon]?.length, `${key} tem desenho`);
    assert.match(v.color, /^#[0-9a-f]{6}$/i);
  }
  const staff = badgeVisual({ key: 'STAFF', iconUrl: '/badges/STAFF.png' });
  assert.equal(staff.kind, 'icon');
  assert.equal(staff.icon, 'wrench');
  assert.equal(badgeCustomImage({ iconUrl: '/badges/STAFF.png' }), null);
  assert.equal(badgeCustomImage({ iconUrl: 'https://cdn.x/badges/BETA_TESTER.png' }), null);
  // Insígnia criada pela equipe com imagem própria continua com a imagem.
  assert.deepEqual(badgeVisual({ key: 'EVENTO_X', iconUrl: 'https://cdn.x/up/abc.webp' }), { kind: 'image', url: 'https://cdn.x/up/abc.webp' });
  assert.equal(badgeVisual({ key: 'ANOS_2', ageYears: 2 }).icon, 'cake');
  const generic = badgeVisual({ key: 'QUALQUER', rarity: 'LEGENDARY' });
  assert.equal(generic.icon, 'award');
  assert.equal(generic.color, '#f0b232');
});

test('aviso de anúncio/evento: ligado por padrão, cada um com sua chave', () => {
  assert.equal(wantsBroadcastNotify({}, 'announcement'), true);
  assert.equal(wantsBroadcastNotify({ notifyAnnouncements: false }, 'announcement'), false);
  assert.equal(wantsBroadcastNotify({ notifyAnnouncements: false }, 'event'), true);
  assert.equal(wantsBroadcastNotify({ notifyEvents: false }, 'event'), false);
  assert.equal(wantsBroadcastNotify({}, 'outro'), false);
});
