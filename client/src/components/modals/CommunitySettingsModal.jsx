import { useEffect, useState } from 'react';
import Modal from '../Modal.jsx';
import { useStore } from '../../store/useStore';
import { getCommunitySettings, updateCommunitySettings, uploadCommunityIcon, uploadCommunityBanner } from '../../api/endpoints';

export default function CommunitySettingsModal({ onClose }) {
  const setCommunityStructure = useStore((s) => s.setCommunityStructure);
  const [settings, setSettings] = useState(null);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    const { settings: s } = await getCommunitySettings();
    setSettings(s);
    setName(s.communityName || '');
    setCommunityStructure({ community: { name: s.communityName, iconUrl: s.communityIconUrl, bannerUrl: s.communityBannerUrl } });
  };
  useEffect(() => { refresh(); }, []);

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

  if (!settings) return null;

  return (
    <Modal title="Configurações da comunidade" onClose={onClose} width="520px">
      <div className="settings-grid">
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
      </div>
    </Modal>
  );
}
