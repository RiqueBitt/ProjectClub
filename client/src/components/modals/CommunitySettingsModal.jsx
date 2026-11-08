import { useEffect, useMemo, useState } from 'react';
import Modal from '../Modal.jsx';
import { useStore } from '../../store/useStore';
import { getCommunitySettings, updateCommunitySettings, uploadCommunityIcon, uploadCommunityBanner, updateFeaturedChannels } from '../../api/endpoints';
import { FEATURED, FeaturedGlyph } from '../FeaturedChannels.jsx';
import '../../styles/channels.css';

// Liga/desliga os canais em destaque (Eventos, Feed, Galeria) do topo da
// lista de canais. Salva na hora, para toda a comunidade.
function FeaturedChannelsSettings() {
  const featured = useStore((s) => s.community?.featuredChannels);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');

  const toggle = async (key) => {
    const next = !(featured?.[key] !== false);
    setBusy(key); setError('');
    try {
      const { featuredChannels } = await updateFeaturedChannels({ [key]: next });
      const st = useStore.getState();
      st.setCommunityStructure({ community: { ...st.community, featuredChannels } });
    } catch (err) {
      setError(err.response?.data?.error || 'Não foi possível salvar.');
    } finally { setBusy(null); }
  };

  return (
    <div className="featured-settings">
      <h3>Canais em destaque</h3>
      <p className="dim">Ficam fixos no topo da lista de canais. Esconda os que a comunidade não usa.</p>
      <div className="featured-settings-list">
        {FEATURED.map((f) => {
          const on = featured?.[f.key] !== false;
          return (
            <div key={f.key} className={`featured-settings-row featured-${f.key}`}>
              <span className="featured-channel-icon"><FeaturedGlyph name={f.icon} /></span>
              <span className="featured-settings-text">
                <strong>{f.label}</strong>
                <span>{f.hint}</span>
              </span>
              <button
                type="button" role="switch" aria-checked={on} aria-label={`Mostrar ${f.label}`}
                className={`cx-switch${on ? ' on' : ''}`} onClick={() => toggle(f.key)} disabled={busy === f.key}
              ><span /></button>
            </div>
          );
        })}
      </div>
      {error && <div className="auth-error">{error}</div>}
    </div>
  );
}

// Canal AFK (igual ao Discord): quem fica parado na voz pelo tempo
// escolhido vai pra esse canal e fica mudo lá. Só staff (rota /admin).
export const AFK_TIMEOUT_OPTIONS = [
  { value: 60, label: '1 minuto' },
  { value: 300, label: '5 minutos' },
  { value: 900, label: '15 minutos' },
  { value: 1800, label: '30 minutos' },
  { value: 3600, label: '1 hora' },
];
function AfkSettings({ settings, onSaved }) {
  const channels = useStore((s) => s.channels);
  const categories = useStore((s) => s.categories);
  const voiceChannels = useMemo(() => [...(channels || []), ...(categories || []).flatMap((c) => c.channels || [])]
    .filter((c) => c && c.type === 'VOICE'), [channels, categories]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async (patch) => {
    setBusy(true); setError('');
    try { await updateCommunitySettings(patch); await onSaved(); }
    catch (err) { setError(err.response?.data?.error || 'Não foi possível salvar.'); }
    finally { setBusy(false); }
  };
  const seen = new Set();
  const unique = voiceChannels.filter((c) => (seen.has(c.id) ? false : seen.add(c.id)));
  return (
    <div className="afk-settings">
      <h3>Canal AFK</h3>
      <p className="dim">Quem ficar sem falar na voz pelo tempo escolhido é movido para este canal e fica mudo lá.</p>
      <label>
        CANAL AFK
        <select value={settings.afkChannelId || ''} disabled={busy} onChange={(e) => save({ afkChannelId: e.target.value || null })}>
          <option value="">Nenhum (desligado)</option>
          {unique.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </label>
      <label>
        TEMPO SEM ATIVIDADE
        <select value={settings.afkTimeoutSeconds || 300} disabled={busy || !settings.afkChannelId} onChange={(e) => save({ afkTimeoutSeconds: Number(e.target.value) })}>
          {AFK_TIMEOUT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {error && <div className="auth-error">{error}</div>}
    </div>
  );
}

export default function CommunitySettingsModal({ onClose }) {
  const setCommunityStructure = useStore((s) => s.setCommunityStructure);
  const [settings, setSettings] = useState(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    const { settings: s } = await getCommunitySettings();
    setSettings(s);
    setName(s.communityName || '');
    // Mantém o que já estava no store (ex.: featuredChannels) e só troca nome/ícone/banner.
    const current = useStore.getState().community;
    setCommunityStructure({ community: { ...current, name: s.communityName, iconUrl: s.communityIconUrl, bannerUrl: s.communityBannerUrl } });
  };
  useEffect(() => { refresh().catch(() => setLoadFailed(true)); }, []);

  const saveName = async () => {
    setSaving(true);
    try { await updateCommunitySettings({ communityName: name }); await refresh(); }
    finally { setSaving(false); }
  };

  const onIcon = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    await uploadCommunityIcon(file);
    await refresh();
  };

  const onBanner = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    await uploadCommunityBanner(file);
    await refresh();
  };

  // Sem acesso às configurações gerais (só staff), ainda dá pra mexer nos
  // canais em destaque se a pessoa gerencia canais.
  if (!settings && !loadFailed) return null;

  return (
    <Modal title="Configurações da comunidade" onClose={onClose} width="520px">
      <div className="settings-grid">
        {settings && (
          <>
            {settings.communityBannerUrl && (
              <div className="community-settings-banner-preview" style={{ backgroundImage: `url(${settings.communityBannerUrl})` }} />
            )}
            <label className="btn-secondary" style={{ width: 'fit-content' }}>
              {settings.communityBannerUrl ? 'Trocar banner' : 'Adicionar banner'}
              <input type="file" accept="image/*" hidden onChange={onBanner} />
            </label>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {settings.communityIconUrl && <img src={settings.communityIconUrl} alt="" style={{ width: 56, height: 56, borderRadius: 14, objectFit: 'cover' }} />}
              <label className="btn-secondary">
                {settings.communityIconUrl ? 'Trocar ícone' : 'Adicionar ícone'}
                <input type="file" accept="image/*" hidden onChange={onIcon} />
              </label>
            </div>

            <label>
              NOME DA COMUNIDADE
              <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
            </label>
            <button className="btn-primary" onClick={saveName} disabled={saving}>{saving ? 'Salvando...' : 'Salvar nome'}</button>
            <hr />
            <AfkSettings settings={settings} onSaved={refresh} />
            <hr />
          </>
        )}
        <FeaturedChannelsSettings />
      </div>
    </Modal>
  );
}
