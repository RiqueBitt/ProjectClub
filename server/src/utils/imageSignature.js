// Detecção de tipo de imagem pelos MAGIC BYTES (assinatura real do
// conteúdo binário), não pelo Content-Type que o cliente declarou no
// upload — ver a auditoria de segurança em middleware/upload.js. Fica em
// arquivo próprio, sem nenhuma dependência externa, pra poder ser testado
// isoladamente (server/test/upload-security.test.js) sem precisar de
// node_modules instalado nem subir nenhum servidor.
const IMAGE_SIGNATURES = [
  { mime: 'image/png', check: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a },
  { mime: 'image/jpeg', check: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/gif', check: (b) => b.length >= 6 && (b.slice(0, 6).toString('ascii') === 'GIF87a' || b.slice(0, 6).toString('ascii') === 'GIF89a') },
  { mime: 'image/webp', check: (b) => b.length >= 12 && b.slice(0, 4).toString('ascii') === 'RIFF' && b.slice(8, 12).toString('ascii') === 'WEBP' },
];

function detectImageMime(buffer) {
  const match = IMAGE_SIGNATURES.find((sig) => sig.check(buffer));
  return match ? match.mime : null;
}

module.exports = { detectImageMime, IMAGE_SIGNATURES };
