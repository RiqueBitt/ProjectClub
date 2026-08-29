// Item pedido: "com VPN as imagens não aparecem" — reescreve qualquer
// URL de imagem que aponte direto pro Backblaze B2 (o provedor de
// armazenamento usado pra fotos de perfil, banners, ícones de Clube
// etc) pra passar pelo NOSSO PRÓPRIO servidor no meio do caminho (ver
// server/src/routes/imageProxy.js). VPNs e bloqueadores embutidos
// costumam falhar especificamente em domínios de CDN de terceiros,
// mesmo com o resto da internet (incluindo o nosso próprio site)
// funcionando normal — como o navegador passa a falar só com o nosso
// domínio, esse problema específico deixa de existir.
//
// Não decodifica nem quebra URLs de OUTRAS origens (ícones locais do
// app, avatar de pinguim, GIFs do Klipy etc) — só reescreve o que
// reconhece como sendo do nosso bucket B2.
export function proxyImage(url) {
  if (!url || typeof url !== 'string') return url;
  if (!/backblazeb2\.com/i.test(url)) return url; // não é do B2 — devolve como veio
  return `/api/proxy/image?url=${encodeURIComponent(url)}`;
}
