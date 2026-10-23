// Links bonitos (parte pura, sem store): slugify igual ao servidor, montar
// endereços a partir do que está carregado e reconhecer os antigos.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  slugify, channelPathFrom, conversationPathFrom, userPathFrom, libraryPathFrom, eventPath, postPath,
  parseAppPath, roomFromPath, prettyPathFor, isChannelPath, isDmPath, isPostPath, findConversation,
} from '../src/utils/prettyPaths.js';

const UUID = 'bcec6258-a00a-419c-bf33-01c2984f4161';
const state = {
  channels: [{ id: 'solto', name: 'Solto', slug: null }],
  categories: [{ id: 'c', channels: [{ id: UUID, name: '🌎 | Chat geral', slug: 'chat-geral' }, { id: 'x2', name: 'Chat Geral', slug: 'chat-geral-2' }] }],
  conversations: [
    { id: 'dm1', isGroup: false, members: [{ id: 'me', username: 'Rique' }, { id: 'u2', username: 'Holanda' }] },
    { id: 'g1', isGroup: true, name: 'Amigos', slug: 'grupo-amigos', members: [] },
    { id: 'g2', isGroup: true, name: 'Velho', slug: null, members: [] },
  ],
  members: [{ user: { id: 'u2', username: 'Holanda' } }, { user: { id: 'u3', username: 'bia.x' } }],
};

test('slugify: igual ao servidor', () => {
  assert.equal(slugify('Chat geral'), 'chat-geral');
  assert.equal(slugify('🌎 | Ação & Reação!'), 'acao-reacao');
  assert.equal(slugify('☕'), '');
});

test('montar endereços: objeto ou só o id (procura no que está carregado)', () => {
  assert.equal(channelPathFrom(state, UUID), '/canal/chat-geral');
  assert.equal(channelPathFrom(state, { id: 'x2', slug: 'chat-geral-2' }), '/canal/chat-geral-2');
  assert.equal(channelPathFrom(state, 'solto'), '/canal/solto', 'sem slug ainda: usa o id');
  assert.equal(channelPathFrom(state, 'desconhecido'), '/canal/desconhecido');
  assert.equal(conversationPathFrom(state, 'dm1', 'me'), '/dm/holanda');
  assert.equal(conversationPathFrom(state, 'g1', 'me'), '/dm/grupo-amigos');
  assert.equal(conversationPathFrom(state, 'g2', 'me'), '/dm/g2');
  assert.equal(userPathFrom(state, 'u3'), '/perfil/bia.x');
  assert.equal(userPathFrom(state, { id: 'u9', username: 'Novo' }), '/perfil/novo');
  assert.equal(libraryPathFrom(state, 'u2'), '/jogos/biblioteca/holanda');
  assert.equal(eventPath({ id: 'e1', slug: 'noite-de-jogos' }), '/evento/noite-de-jogos');
  assert.equal(postPath('p1'), '/forum/p1');
});

test('reconhece endereços novos e antigos', () => {
  assert.deepEqual(parseAppPath('/canal/chat-geral'), { kind: 'channel', ref: 'chat-geral', legacy: false });
  assert.deepEqual(parseAppPath(`/channels/${UUID}?m=1`), { kind: 'channel', ref: UUID, legacy: true });
  assert.deepEqual(parseAppPath('/jogos/biblioteca/holanda'), { kind: 'library', ref: 'holanda', legacy: false });
  assert.equal(parseAppPath('/loja'), null);
  assert.ok(isChannelPath('/canal/x') && isChannelPath('/channels/x') && !isChannelPath('/canal/'));
  assert.ok(isDmPath('/dm/x') && isDmPath('/conversations/x'));
  assert.ok(isPostPath('/forum/x') && isPostPath('/posts/x') && !isPostPath('/forum'));
});

test('sala aberta na URL vira o id de verdade', () => {
  assert.deepEqual(roomFromPath('/canal/chat-geral', state, 'me'), { channelId: UUID, ref: 'chat-geral' });
  assert.deepEqual(roomFromPath('/dm/HOLANDA', state, 'me'), { conversationId: 'dm1', ref: 'HOLANDA' });
  assert.deepEqual(roomFromPath('/dm/grupo-amigos', state, 'me'), { conversationId: 'g1', ref: 'grupo-amigos' });
  assert.deepEqual(roomFromPath('/channels/nao-carregado', state, 'me'), { channelId: 'nao-carregado', ref: 'nao-carregado' }, 'antigo: o ref é o id');
  assert.equal(roomFromPath('/canal/nao-carregado', state, 'me').channelId, null, 'nome que ainda não chegou: sem id');
  assert.equal(findConversation(state, 'rique', 'me'), null, 'meu próprio @ não é DM');
});

test('endereço antigo → bonito (mantém ?m= e #)', () => {
  assert.equal(prettyPathFor(`/channels/${UUID}?m=9#x`, state, 'me'), '/canal/chat-geral?m=9#x');
  assert.equal(prettyPathFor('/conversations/dm1', state, 'me'), '/dm/holanda');
  assert.equal(prettyPathFor('/u/u2', state, 'me'), '/perfil/holanda');
  assert.equal(prettyPathFor('/eventos/e1', state, 'me'), '/evento/e1');
  assert.equal(prettyPathFor('/posts/p1', state, 'me'), '/forum/p1');
  assert.equal(prettyPathFor('/canal/chat-geral', state, 'me'), null, 'já é bonito');
  assert.equal(prettyPathFor('/loja', state, 'me'), null);
});
