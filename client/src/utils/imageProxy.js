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
// B2 + CDNs das fontes de mods e da Steam (item pedido: "os ícones dos
// mods não aparecem") — mesma lista que o servidor aceita
// (server/src/routes/imageProxy.js).
const PROXIED_HOSTS = /^https:\/\/([a-z0-9-]+\.)*(backblazeb2\.com|modcdn\.io|mod\.io|gamebanana\.com|thunderstore\.io|nexusmods\.com|nexus-cdn\.com|steamstatic\.com|steamusercontent\.com|akamaihd\.net)\//i;

export function proxyImage(url) {
  if (!url || typeof url !== 'string') return url;
  if (!PROXIED_HOSTS.test(url)) return url; // outra origem — devolve como veio
  return `/api/proxy/image?url=${encodeURIComponent(url)}`;
}
