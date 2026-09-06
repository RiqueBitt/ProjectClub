import { useEffect, useState } from 'react';
import Modal from '../Modal.jsx';
import { useStore } from '../../store/useStore';
import { getCommunitySettings, updateCommunitySettings, uploadCommunityIcon, uploadCommunityBanner } from '../../api/endpoints';

export default function CommunitySettingsModal({ onClose }) {
  const setCommunityStructure = useStore((s) => s.setCommunityStructure);
  const [settings, setSettings] = useState(null);
  const [name, setName] = useState('');
  const [tagEmoji, setTagEmoji] = useState('');
  const [tagText, setTagText] = useState('');
  const [saving, setSaving] = useState(false);

  const refresh = async () => {
    const { settings: s } = await getCommunitySettings();
    setSettings(s);
    setName(s.communityName || '');
    setTagEmoji(s.communityTagEmoji || '');
    setTagText(s.communityTagText || '');
    setCommunityStructure({ community: { name: s.communityName, iconUrl: s.communityIconUrl, bannerUrl: s.communityBannerUrl } });
  };
  useEffect(() => { refresh(); }, []);

  const saveName = async () => {
    setSaving(true);
    try { await updateCommunitySettings({ communityName: name }); await refresh(); }
    finally { setSaving(false); }
  };

  // Item pedido: "refaça esse sistema [de tag da comunidade]
  // bloqueando essa tag [PROJ] de aparecer ou removendo ele" — a
  // causa real era essa tag ser calculada sozinha a partir do NOME
  // da comunidade, sempre virando "PROJ" enquanto o nome continuasse
  // "Project Club". Agora é um texto configurável à parte — deixando
  // os dois campos em branco, o sistema usa um valor fixo seguro que
  // nunca é "PROJ" (ver setActiveTag em userController.js).
  const saveTag = async () => {
    setSaving(true);
    try { await updateCommunitySettings({ communityTagEmoji: tagEmoji.trim() || null, communityTagText: tagText.trim().toUpperCase() || null }); await refresh(); }
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

        <hr />
        <p className="dim">Tag que aparece do lado do nome de quem ativa "Tag da comunidade" em Configurações → Exibição.</p>
        <label>
          EMOJI DA TAG
          <input value={tagEmoji} onChange={(e) => setTagEmoji(e.target.value)} maxLength={4} placeholder="🏠" />
        </label>
        <label>
          TEXTO DA TAG (até 4 letras)
          <input value={tagText} onChange={(e) => setTagText(e.target.value.toUpperCase())} maxLength={4} placeholder="CLUBE" />
        </label>
        <button className="btn-primary" onClick={saveTag} disabled={saving}>{saving ? 'Salvando...' : 'Salvar tag'}</button>
      </div>
    </Modal>
  );
}
