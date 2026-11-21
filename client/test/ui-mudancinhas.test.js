// Mudancinhas: número vermelho de não lidas, insígnias como ícones
// coloridos e a chave de aviso de anúncio/evento.
import test from 'node:test';
import assert from 'node:assert/strict';
import { channelUnreadBadge, sumUnread } from '../src/utils/unreadCount.js';
import { badgeVisual, badgeCustomImage, BADGE_TYPE_ICONS, BADGE_ICON_PATHS } from '../src/utils/badgeIcons.js';
import { wantsBroadcastNotify } from '../src/utils/broadcastNotify.js';

test('badge de não lidas: número, 99+, menção destacada, some quando lido/aberto', () => {
  assert.equal(channelUnreadBadge({ unreadCount: 0 }), null);
  assert.deepEqual(
    { ...channelUnreadBadge({ unreadCount: 5 }), title: undefined },
    { count: 5, mentions: 0, label: '5', title: undefined, mention: false },
  );
  assert.equal(channelUnreadBadge({ unreadCount: 250 }).label, '99+');
  const m = channelUnreadBadge({ unreadCount: 1, unreadMentions: 2 });
  assert.equal(m.count, 2, 'menção conta como mensagem nova');
  assert.equal(m.mention, true);
  assert.match(m.title, /2 menções/);
  assert.equal(channelUnreadBadge({ unreadCount: 7 }, { active: true }), null, 'canal aberto não mostra');
  assert.equal(channelUnreadBadge({ unreadCount: 7 }, { muted: true }), null, 'silenciado sem menção não mostra');
  assert.equal(channelUnreadBadge({ unreadCount: 7, unreadMentions: 1 }, { muted: true }).count, 7, 'menção aparece mesmo silenciado');
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
