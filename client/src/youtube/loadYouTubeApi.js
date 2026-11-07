// Carrega a IFrame API do YouTube uma vez só. Módulo próprio (pequeno) para
// o player de música e o app do YouTube não puxarem junto o código inteiro
// do "Assistir juntos" (YouTubeWatch.jsx + YouTubeBrowser.jsx) no pacote
// inicial do site.
let apiPromise = null;
export function loadYouTubeApi() {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve, reject) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => { try { prev?.(); } catch { /* ignora */ } resolve(window.YT); };
    const s = document.createElement('script');
    s.src = 'https://www.youtube.com/iframe_api';
    s.async = true;
    s.onerror = () => { apiPromise = null; reject(new Error('Não consegui carregar o player do YouTube.')); };
    document.head.appendChild(s);
  });
  return apiPromise;
}
