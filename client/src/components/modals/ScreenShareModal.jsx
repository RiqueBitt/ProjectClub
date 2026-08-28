import { useEffect, useState } from 'react';
import Modal from '../Modal.jsx';
import monitorIcon from '../../assets/icons/video-call.png';
import windowIcon from '../../assets/icons/menu-circled.png';
import cameraIcon from '../../assets/icons/phone.png';

const QUALITIES = [
  { value: '1080p', label: '1080p — mais nítido', hint: 'Usa mais internet' },
  { value: '720p', label: '720p — equilibrado', hint: 'Recomendado' },
];
const FRAME_RATES = [
  { value: 15, label: '15 FPS', hint: 'Ideal para texto/planilhas' },
  { value: 30, label: '30 FPS', hint: 'Ideal para vídeo/jogos' },
  { value: 60, label: '60 FPS', hint: 'Movimento mais fluido — usa mais internet' },
];

const CATEGORIES = [
  { key: 'APPS', label: 'Aplicativos', icon: windowIcon, hint: 'Escolha uma janela aberta (Steam, um app, etc.) no seletor do navegador.' },
  { key: 'FULLSCREEN', label: 'Tela Inteira', icon: monitorIcon, hint: 'Transmite um monitor inteiro — se você tiver mais de um, o navegador deixa escolher qual.' },
  { key: 'DEVICES', label: 'Dispositivos', icon: cameraIcon, hint: 'Câmeras e outros dispositivos de vídeo conectados neste computador.' },
];

// A web page can't build its own live thumbnail grid of open windows or
// monitors — that's a privacy boundary only the browser itself is allowed to
// cross (see VoiceContext.jsx's toggleScreenShare comment). Aplicativos/Tela
// Inteira each still have to hand off to the browser's own native
// screen/window picker — this menu just hints which category to
// pre-filter to (displaySurface) and, importantly, tells the browser to
// drop "this tab" from ever being offered there (selfBrowserSurface:
// 'exclude'), which is what actually removes the old "share this
// browser tab" option. Dispositivos is the one category that CAN be a
// real, fully custom in-app list, since enumerating capture *devices*
// (cameras, connected phones acting as a webcam, etc.) — unlike
// enumerating open windows — is something JS is allowed to do directly.
export default function ScreenShareModal({ onClose, onShare }) {
  const [category, setCategory] = useState('APPS');
  const [quality, setQuality] = useState('1080p');
  const [frameRate, setFrameRate] = useState(30);
  const [devices, setDevices] = useState([]);
  const [devicesError, setDevicesError] = useState('');

  useEffect(() => {
    if (category !== 'DEVICES') return;
    let cancelled = false;
    navigator.mediaDevices?.enumerateDevices?.()
      .then((list) => {
        if (cancelled) return;
        const cams = list.filter((d) => d.kind === 'videoinput');
        setDevices(cams);
        if (cams.length === 0) setDevicesError('Nenhuma câmera ou dispositivo de vídeo encontrado.');
      })
      .catch(() => { if (!cancelled) setDevicesError('Não foi possível listar os dispositivos.'); });
    return () => { cancelled = true; };
  }, [category]);

  const share = () => {
    const displaySurface = category === 'FULLSCREEN' ? 'monitor' : 'window';
    onShare({ quality, frameRate, displaySurface });
    onClose();
  };

  const shareDevice = (device) => {
    onShare({ deviceId: device.deviceId, quality: '720p', frameRate: 30 });
    onClose();
  };

  return (
    <Modal title="Compartilhar tela" onClose={onClose} width="560px">
      <div className="screen-share-form screen-share-form-wide">
        <div className="screen-share-categories">
          {CATEGORIES.map((c) => (
            <button
              key={c.key}
              type="button"
              className={`screen-share-category ${category === c.key ? 'active' : ''}`}
              onClick={() => setCategory(c.key)}
            >
              <img className="ui-icon" src={c.icon} alt="" />
              <span>{c.label}</span>
            </button>
          ))}
        </div>

        <div className="screen-share-hint dim">
          {CATEGORIES.find((c) => c.key === category)?.hint}
        </div>

        {category !== 'DEVICES' ? (
          <>
            <label>QUALIDADE</label>
            <div className="screen-share-option-group">
              {QUALITIES.map((q) => (
                <button
                  key={q.value}
                  type="button"
                  className={`screen-share-option ${quality === q.value ? 'active' : ''}`}
                  onClick={() => setQuality(q.value)}
                >
                  <span>{q.label}</span>
                  <span className="dim">{q.hint}</span>
                </button>
              ))}
            </div>

            <label>TAXA DE QUADROS</label>
            <div className="screen-share-option-group">
              {FRAME_RATES.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  className={`screen-share-option ${frameRate === f.value ? 'active' : ''}`}
                  onClick={() => setFrameRate(f.value)}
                >
                  <span>{f.label}</span>
                  <span className="dim">{f.hint}</span>
                </button>
              ))}
            </div>

            <div className="modal-actions">
              <button className="btn-link" onClick={onClose}>Cancelar</button>
              <button className="btn-primary" onClick={share}>🖥️ Compartilhar</button>
            </div>
          </>
        ) : (
          <>
            {devicesError && <div className="dim">{devicesError}</div>}
            <div className="screen-share-device-list">
              {devices.map((d, i) => (
                <button
                  key={d.deviceId || i}
                  type="button"
                  className="screen-share-device"
                  onClick={() => shareDevice(d)}
                >
                  <img className="ui-icon" src={cameraIcon} alt="" />
                  <span className="truncate">{d.label || `Câmera ${i + 1}`}</span>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button className="btn-link" onClick={onClose}>Cancelar</button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
