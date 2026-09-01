const multer = require('multer');
const path = require('path');
const fs = require('fs');
const env = require('../config/env');
const { storeFile } = require('../services/fileStorage');
const { detectImageMime } = require('../utils/imageSignature');

const uploadRoot = path.resolve(__dirname, '../../', env.UPLOAD_DIR);
if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });

// SEGURANÇA (Zero Trust em upload — nunca confiar só no Content-Type que o
// NAVEGADOR declarou): antes, attachmentFileFilter/imageFileFilter só
// olhavam `file.mimetype`, que é um HEADER que o cliente escolhe livremente
// — um script malicioso podia mandar um arquivo HTML/JS de verdade
// declarando "Content-Type: image/png" e passar direto pelo filtro.
// `detectImageMime` (utils/imageSignature.js) checa os PRIMEIROS BYTES DE
// VERDADE do arquivo (magic bytes) — o jeito confiável de saber o que um
// arquivo realmente é, já que esses bytes não vêm de nenhum header
// controlável pelo cliente, só do conteúdo binário em si. Testado
// isoladamente em server/test/upload-security.test.js (positivo: PNG/
// JPEG/GIF/WEBP de verdade continuam passando; negativo: HTML/texto
// disfarçado de imagem é rejeitado).

// Motor de armazenamento customizado do multer — em vez de gravar em
// disco (diskStorage antigo), sobe pro Backblaze B2 (ou cai pro disco
// local se o B2 não estiver configurado, ver services/fileStorage.js) e
// já registra o metadado no MySQL. Fazer isso AQUI, dentro do próprio
// motor do multer, significa que toda rota que já usa
// `uploadImage.single('campo')` continua funcionando exatamente igual —
// não precisa mexer nas ~17 rotas que fazem upload, `req.file.url` já
// chega pronto no controller.
class ManagedStorage {
  _handleFile(req, file, cb) {
    const chunks = [];
    file.stream.on('data', (chunk) => chunks.push(chunk));
    file.stream.on('error', cb);
    file.stream.on('end', async () => {
      try {
        const buffer = Buffer.concat(chunks);

        // SEGURANÇA: com o buffer completo em mãos, valida de verdade o
        // que foi enviado ANTES de subir pro storage — mesmo já tendo
        // passado pelo fileFilter (que só via o header declarado).
        // Aplica só quando o multer usado é o `uploadImage` (marcado via
        // req._requireImageMagicBytes, ver abaixo) — os attachments de
        // mensagem continuam aceitando qualquer tipo de arquivo (exceto
        // os explicitamente perigosos), como já era o comportamento
        // esperado (estilo Discord).
        if (file._requireImageMagicBytes) {
          const detected = detectImageMime(buffer);
          if (!detected) {
            return cb(Object.assign(new Error('O arquivo enviado não é uma imagem válida (PNG, JPG, GIF ou WEBP) — o conteúdo real não bate com nenhum desses formatos.'), { status: 400 }));
          }
          // O tipo REAL detectado pelos magic bytes é o que vale daqui
          // pra frente — nunca o que o navegador declarou — tanto pra
          // salvar quanto pro Content-Type devolvido depois.
          file.mimetype = detected;
        }

        const asset = await storeFile({
          buffer, originalName: file.originalname, mimeType: file.mimetype, ownerId: req.user?.id,
        });
        // `filename` também é preenchido (igual o diskStorage antigo)
        // como rede de segurança pra qualquer código que ainda espere
        // esse campo — mas o certo agora é usar `req.file.url`.
        cb(null, { filename: asset.storageKey, url: asset.url, size: asset.sizeBytes });
      } catch (err) {
        cb(err);
      }
    });
  }

  _removeFile(req, file, cb) {
    cb(null); // best-effort — não há nada síncrono útil a desfazer aqui
  }
}

const storage = new ManagedStorage();

// Message attachments intentionally allow most file types (Discord-style —
// "any file" behaviour, see Message.jsx's generic 📎 attachment fallback),
// but a handful of types are actively dangerous to ever serve back from
// /uploads: an uploaded HTML/SVG/XHTML file with an embedded <script> would
// execute in-browser (same-origin as the app) if someone opens its URL
// directly — a classic stored-XSS-via-upload vector. Those are blocked
// outright; everything else is allowed. (app.js also forces
// Content-Disposition: attachment on non-media uploads as a second layer.)
const DANGEROUS_MIME_RE = /^(text\/html|application\/xhtml\+xml|image\/svg\+xml)$/i;
const IMAGE_MIME_RE = /^image\/(png|jpe?g|gif|webp)$/i;
// Item pedido: álbum de fotos aceita foto OU vídeo (o Orkut original só
// tinha foto, mas isso é uma melhoria natural) — regex própria, mais
// ampla que IMAGE_MIME_RE mas ainda restrita a formatos de mídia de
// verdade (não abre pra qualquer arquivo arbitrário).
const PHOTO_OR_VIDEO_MIME_RE = /^(image\/(png|jpe?g|gif|webp)|video\/(mp4|webm|quicktime|x-matroska))$/i;

function attachmentFileFilter(req, file, cb) {
  if (DANGEROUS_MIME_RE.test(file.mimetype)) {
    const err = new Error('Este tipo de arquivo não é permitido por segurança.');
    err.status = 400;
    return cb(err);
  }
  cb(null, true);
}

function imageFileFilter(req, file, cb) {
  if (!IMAGE_MIME_RE.test(file.mimetype)) {
    const err = new Error('Envie apenas imagens (PNG, JPG, GIF ou WEBP).');
    err.status = 400;
    return cb(err);
  }
  // Marca o arquivo pra ManagedStorage.handleFile validar os magic bytes
  // de verdade assim que o buffer completo estiver disponível (ver
  // acima) — o fileFilter do multer só recebe os primeiríssimos bytes
  // do stream nesse ponto, cedo demais pra checar a assinatura inteira
  // com segurança.
  file._requireImageMagicBytes = true;
  cb(null, true);
}

// Item pedido: álbum de fotos aceita foto OU vídeo, até 20MB — filtro
// próprio, sem mexer no imageFileFilter acima (compartilhado por
// avatar/banner/ícone de cargo/emoji, que devem continuar só imagem).
function photoOrVideoFileFilter(req, file, cb) {
  if (!PHOTO_OR_VIDEO_MIME_RE.test(file.mimetype)) {
    const err = new Error('Envie apenas fotos (PNG, JPG, GIF, WEBP) ou vídeos (MP4, WEBM, MOV, MKV).');
    err.status = 400;
    return cb(err);
  }
  if (file.mimetype.startsWith('image/')) file._requireImageMagicBytes = true;
  cb(null, true);
}

const AUDIO_MIME_RE = /^audio\/(mpeg|mp3|wav|wave|x-wav|ogg|webm|aac|mp4|x-m4a)$/i;
function audioFileFilter(req, file, cb) {
  if (!AUDIO_MIME_RE.test(file.mimetype)) {
    const err = new Error('Envie apenas áudio (MP3, WAV, OGG, WEBM, AAC ou M4A).');
    err.status = 400;
    return cb(err);
  }
  cb(null, true);
}

// The highest possible per-server ceiling across every Impulsos tier is
// 100MB (Nível 3) — multer's own hard cap has to be set to that so it never
// rejects a boosted server's upload before the request even reaches the
// controller. The *actual* ceiling for this particular server (25/50/100MB
// depending on its boost level) is enforced in messageController.createMessage,
// where the serverId is known. Same reasoning applies to uploadImage below
// (server icon/banner uploads don't have a size perk gate, but there's no
// reason to keep them capped to the historical 25MB default either).
const HARD_MAX_UPLOAD_MB = 100;

const upload = multer({
  storage,
  limits: { fileSize: HARD_MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: attachmentFileFilter,
});

// Stricter variant for anything that's always meant to be an image (avatars,
// banners, server/role icons, custom emoji) — no reason those should ever
// accept arbitrary files.
const uploadImage = multer({
  storage,
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024 },
  fileFilter: imageFileFilter,
});

// Soundboard clips (server/src/controllers/soundboardController.js) — kept
// small on purpose (max 5 seconds of audio, enforced in the controller via
// ffprobe-free duration parsing) so a generous byte ceiling here is fine;
// the real limit that matters for these is the 5-second duration cap, not size.
const uploadAudio = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: audioFileFilter,
});

// Item pedido: "limite os vídeos, png etc pra 20MB o máximo" — específico
// pro álbum de fotos (que aceita foto OU vídeo, ver photoOrVideoFileFilter
// acima).
const uploadPhotoOrVideo = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: photoOrVideoFileFilter,
});

module.exports = { upload, uploadImage, uploadAudio, uploadPhotoOrVideo, uploadRoot };
