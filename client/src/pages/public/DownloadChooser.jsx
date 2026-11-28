import { useEffect, useRef, useState } from 'react';

// Janela "Qual versão baixar?" do site de download (LandingPage.jsx).
//
// Windows: 64 bits (app completo, Windows 10 e 11) ou o Project Club Lite
// (32 bits — serve no Windows 7, 8, 10 e 11, de 32 ou 64 bits, PC antigo).
// Android: o .apk universal (todo celular) ou o de 64/32 bits (menor, só com o
// código do processador do celular).
//
// A versão indicada vem do navegador: Windows NT 6.x (7/8) ou 32 bits → Lite;
// "bitness" do navegador (Chrome/Edge) quando ele informa.

const BASE = 'https://github.com/RiqueBitt/ProjectClub/releases/latest/download';
export const DOWNLOAD_FILES = {
  windows: `${BASE}/ProjectClub-Setup-Windows.exe`,
  lite: `${BASE}/ProjectClub-Lite-Setup-Windows.exe`,
  linux: `${BASE}/ProjectClub-Linux.AppImage`,
  android: `${BASE}/ProjectClub.apk`,
  arm64: `${BASE}/ProjectClub-arm64.apk`,
  arm32: `${BASE}/ProjectClub-arm32.apk`,
};

const OPTIONS = {
  windows: [
    { key: 'windows', title: '64 bits', tag: 'App completo', desc: 'Windows 10 e 11. Com Mod Manager, Apps, navegador e VPN.', size: 'Instalador pequeno, baixa o resto na hora' },
    { key: 'lite', title: '32 bits ou PC antigo', tag: 'Lite', desc: 'Windows 7, 8, 10 e 11, de 32 ou 64 bits. Leve: 1 núcleo e 2 GB de RAM. Chat, voz e tela.', size: 'Instalador completo: instala sem precisar de internet' },
  ],
  android: [
    { key: 'android', title: 'Universal', tag: 'Qualquer celular', desc: 'Funciona em todo Android 6 ou mais novo. Na dúvida, baixe este.' },
    { key: 'arm64', title: '64 bits', tag: 'ARM64', desc: 'Arquivo menor, só pra celulares de 64 bits (quase todos de 2017 pra cá).' },
    { key: 'arm32', title: '32 bits', tag: 'ARMv7', desc: 'Arquivo menor, pra celular antigo ou bem simples.' },
  ],
};

const HELP = {
  windows: 'Não sabe qual é o seu? No Windows, abra Configurações → Sistema → Sobre (ou aperte Windows + Pause) e veja "Tipo de sistema".',
  android: 'Não sabe qual é o seu? Baixe o Universal: ele serve em qualquer celular.',
};

/** Palpite do navegador: 'windows' | 'lite' (Windows) ou 'android' | 'arm64' | 'arm32'. */
async function guess(family) {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  let bits = '';
  try {
    const hi = await navigator.userAgentData?.getHighEntropyValues?.(['bitness', 'architecture']);
    bits = hi?.bitness || '';
  } catch { /* navegador sem essa informação */ }
  if (family === 'windows') {
    if (/windows nt 6\./i.test(ua)) return { key: 'lite', why: 'Seu Windows é o 7 ou 8: vai o Lite.' };
    if (bits === '32' || (!bits && /windows/i.test(ua) && !/win64|wow64|x64|amd64/i.test(ua))) return { key: 'lite', why: 'Seu Windows é de 32 bits: vai o Lite.' };
    if (bits === '64' || /win64|wow64|x64|amd64/i.test(ua)) return { key: 'windows', why: 'Seu Windows é de 64 bits.' };
    return { key: 'windows', why: '' };
  }
  if (bits === '64' || /aarch64|arm64/i.test(ua)) return { key: 'android', why: 'Seu celular é de 64 bits: o Universal ou o de 64 bits servem.' };
  if (bits === '32' || /armv7|armv8l/i.test(ua)) return { key: 'android', why: 'Seu celular é de 32 bits: o Universal ou o de 32 bits servem.' };
  return { key: 'android', why: '' };
}

export default function DownloadChooser({ family, onClose, onPick, Icon }) {
  const [hint, setHint] = useState({ key: family === 'windows' ? 'windows' : 'android', why: '' });
  const boxRef = useRef(null);
  const lastFocus = useRef(null);

  useEffect(() => {
    let alive = true;
    guess(family).then((g) => { if (alive) setHint(g); });
    return () => { alive = false; };
  }, [family]);

  // Esc fecha; o foco entra na janela e volta pro botão ao fechar.
  useEffect(() => {
    lastFocus.current = document.activeElement;
    const t = setTimeout(() => boxRef.current?.querySelector('.dc-opt.is-rec, .dc-opt')?.focus(), 30);
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
      if (e.key !== 'Tab' || !boxRef.current) return;
      const els = [...boxRef.current.querySelectorAll('a, button')];
      const first = els[0]; const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); lastFocus.current?.focus?.(); };
  }, [onClose]);

  const options = OPTIONS[family] || [];
  return (
    <div className="dc-back" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="dc-box" ref={boxRef} role="dialog" aria-modal="true" aria-labelledby="dc-titulo" aria-describedby="dc-ajuda">
        <header className="dc-head">
          <span className="dc-ico" aria-hidden="true">{Icon && <Icon name={family} size={22} />}</span>
          <div>
            <h2 id="dc-titulo">{family === 'windows' ? 'Qual Windows você usa?' : 'Qual .apk baixar?'}</h2>
            <p>{hint.why || (family === 'windows' ? 'Escolha a versão do seu computador.' : 'Escolha a versão do seu celular.')}</p>
          </div>
          <button type="button" className="dc-x" onClick={onClose} aria-label="Fechar">×</button>
        </header>
        <ul className="dc-list">
          {options.map((o) => {
            const rec = o.key === hint.key;
            return (
              <li key={o.key}>
                <a className={`dc-opt lc-spot${rec ? ' is-rec' : ''}`} href={DOWNLOAD_FILES[o.key]} download onClick={(e) => onPick(e, o.key)}>
                  <span className="dc-opt-top">
                    <strong>{o.title}</strong>
                    <em>{o.tag}</em>
                    {rec && <b className="dc-rec">Indicado pra você</b>}
                  </span>
                  <span className="dc-desc">{o.desc}</span>
                  {o.size && <small>{o.size}</small>}
                  <span className="dc-go" aria-hidden="true">{Icon && <Icon name="download" size={18} />}</span>
                </a>
              </li>
            );
          })}
        </ul>
        <p id="dc-ajuda" className="dc-help">{HELP[family]}</p>
      </div>
    </div>
  );
}
