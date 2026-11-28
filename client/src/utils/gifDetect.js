// GIF de verdade pelo CONTEÚDO (primeiros bytes "GIF87a"/"GIF89a"), não só
// pelo tipo/extensão que o navegador informa. BUG CORRIGIDO ("foto de perfil
// em GIF não funciona"): no app Android (e em alguns navegadores) o arquivo
// escolhido da galeria pode vir com `type` vazio e nome sem extensão
// ("image:1234") — o GIF não era reconhecido, caía no recortador de imagem
// estática (canvas) e virava uma foto parada de 1 quadro.
export const GIF_AVATAR_MAX_MB = 8; // mesmo limite do servidor (imageOptimizer.AVATAR_GIF_MAX_BYTES)

export function looksLikeGif(file) {
  return !!file && (file.type === 'image/gif' || /\.gif$/i.test(file.name || ''));
}

export async function isGifByContent(file) {
  if (!file) return false;
  if (looksLikeGif(file)) return true;
  // Tipo declarado de outra imagem conhecida: confia.
  if (/^image\/(png|jpe?g|webp)$/i.test(file.type || '')) return false;
  try {
    const head = new Uint8Array(await file.slice(0, 6).arrayBuffer());
    const sig = String.fromCharCode(...head);
    return sig === 'GIF87a' || sig === 'GIF89a';
  } catch {
    return false;
  }
}
