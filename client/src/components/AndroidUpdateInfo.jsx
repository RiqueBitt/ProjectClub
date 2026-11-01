import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { WEB_VERSION, getNativeVersion, checkAndroidUpdate } from '../utils/nativeUpdateCheck';

// Configurações > Sistema > "Sobre este aplicativo" no app Android:
// versão nativa (.apk) + versão do conteúdo (site, atualiza sozinho) e um
// botão de procurar atualização. Ver docs/android-updates.md.
export default function AndroidUpdateInfo() {
  const isAndroid = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  const [native, setNative] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!isAndroid) return;
    getNativeVersion().then(setNative).catch(() => {});
  }, [isAndroid]);

  if (!isAndroid) return null;

  const check = async () => {
    setBusy(true);
    setMsg('');
    try {
      const r = await checkAndroidUpdate({ reloadIfNewContent: true });
      if (r.action === 'native') setMsg(`Baixando a atualização do app (${r.latestNativeVersion || 'nova versão'})…`);
      else if (r.action === 'reload') setMsg('Conteúdo novo encontrado — atualizando…');
      else if (r.action === 'reload-later') setMsg('Conteúdo novo encontrado — será aplicado quando a chamada terminar e você reabrir o app.');
      else setMsg('Você já está na versão mais recente.');
    } catch {
      setMsg('Não foi possível procurar atualização agora. Verifique a internet e tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="settings-block">
      <h4>Sobre este aplicativo</h4>
      <p className="dim" style={{ fontSize: 13, wordBreak: 'break-all' }}>
        Versão do app (nativa) {native || '—'} · Conteúdo {WEB_VERSION || '—'}
      </p>
      <p className="dim" style={{ fontSize: 12 }}>
        O conteúdo atualiza sozinho. Um novo .apk só é baixado quando a parte nativa do app muda.
      </p>
      <button type="button" className="btn-secondary" disabled={busy} onClick={check} style={{ marginTop: 6 }}>
        {busy ? 'Procurando…' : 'Procurar atualização'}
      </button>
      {msg && <p className="dim" style={{ fontSize: 12, marginTop: 6 }} role="status">{msg}</p>}
    </div>
  );
}
