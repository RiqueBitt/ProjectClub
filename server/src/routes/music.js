const express = require('express');
const music = require('../services/music');
const creds = require('../services/voiceCredentials');
const { requireAuth } = require('../middleware/auth');
const { requirePlatformAdmin } = require('../middleware/platformAdmin');

// Música (Atividades → Música): YouTube Music, Spotify e Last.fm.
// Ver services/music.js. A volta do login do Spotify não tem sessão (é o
// navegador voltando do spotify.com): quem é a pessoa vem no "state" assinado.
const router = express.Router();
const wrap = (fn) => async (req, res, next) => {
  try { await fn(req, res); } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    return next(err);
  }
};

router.get('/spotify/callback', async (req, res) => {
  const back = (q) => res.redirect(`/?musica=${q}`);
  if (req.query.error) return back('spotify-cancelado');
  try { await music.spotifyCallback(req.query.code, req.query.state); return back('spotify-ok'); } catch { return back('spotify-erro'); }
});

router.use(requireAuth);
router.get('/status', wrap(async (req, res) => res.json(await music.status(req.user.id))));
router.post('/resolve', wrap(async (req, res) => res.json(await music.resolve(req.body?.title, req.body?.artist))));
router.delete('/:service', wrap(async (req, res) => { await music.disconnect(req.user.id, req.params.service); res.json(await music.status(req.user.id)); }));

router.get('/spotify/search', wrap(async (req, res) => res.json({ tracks: await music.spotifySearch(String(req.query.q || '').slice(0, 120)) })));
router.get('/spotify/connect', wrap(async (req, res) => res.json({ url: music.spotifyAuthUrl(req.user.id) })));
router.get('/spotify/playlists', wrap(async (req, res) => res.json({ playlists: await music.spotifyPlaylists(req.user.id) })));
router.get('/spotify/playlists/:id', wrap(async (req, res) => res.json({ tracks: await music.spotifyPlaylistTracks(req.user.id, req.params.id) })));

router.get('/lastfm/search', wrap(async (req, res) => res.json({ tracks: await music.lastfmSearch(String(req.query.q || '').slice(0, 120)) })));
router.get('/lastfm/top', wrap(async (req, res) => res.json({ tracks: await music.lastfmTop() })));
router.post('/lastfm/connect', wrap(async (req, res) => { await music.lastfmConnect(req.user.id, req.body?.username); res.json(await music.status(req.user.id)); }));
router.get('/lastfm/lists/:id', wrap(async (req, res) => res.json({ tracks: await music.lastfmList(req.user.id, req.params.id) })));

router.post('/youtube/playlists', wrap(async (req, res) => { await music.youtubeAddPlaylist(req.user.id, req.body?.url); res.json(await music.status(req.user.id)); }));
router.delete('/youtube/playlists/:id', wrap(async (req, res) => { await music.youtubeRemovePlaylist(req.user.id, req.params.id); res.json(await music.status(req.user.id)); }));
router.get('/youtube/playlists/:id', wrap(async (req, res) => res.json({ tracks: await music.youtubePlaylistTracks(req.params.id) })));

// Painel da Equipe → Música: chaves do Spotify/Last.fm (segredos mascarados).
router.get('/admin/keys', requirePlatformAdmin, (req, res) => res.json({ fields: creds.describe('music'), redirectUri: music.SPOTIFY_REDIRECT() }));
router.post('/admin/keys', requirePlatformAdmin, wrap(async (req, res) => {
  const values = req.body?.values;
  if (!values || typeof values !== 'object' || Array.isArray(values)) return res.status(400).json({ error: 'Envie os valores das chaves.' });
  await creds.save('music', values);
  return res.json({ fields: creds.describe('music'), redirectUri: music.SPOTIFY_REDIRECT() });
}));

module.exports = router;
