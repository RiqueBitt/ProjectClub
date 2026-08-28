// Upload/exclusão de arquivo no Backblaze B2 + registro do metadado no
// MySQL (nunca o arquivo em si — só id/dono/nome/tamanho/tipo/data/
// endereço, como pedido). Se o B2 não estiver configurado (variáveis de
// ambiente vazias), cai automaticamente pro disco local — assim o projeto
// continua rodando em desenvolvimento sem precisar de conta no B2.
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { DeleteObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');
const { getB2Client, isB2Configured } = require('../config/b2');
const prisma = require('../config/prisma');
const env = require('../config/env');

const uploadRoot = path.resolve(__dirname, '../../', env.UPLOAD_DIR);
if (!fs.existsSync(uploadRoot)) fs.mkdirSync(uploadRoot, { recursive: true });

// Sobe um arquivo (Buffer, vindo do multer com memoryStorage) pro B2 —
// ou, se o B2 não estiver configurado, grava em disco local (mesmo
// comportamento de antes, serve como modo de desenvolvimento). Em
// qualquer um dos dois casos, registra o metadado no MySQL e devolve
// a URL pública final pra usar direto no site.
async function storeFile({ buffer, originalName, mimeType, ownerId }) {
  const ext = path.extname(originalName || '') || '';
  const key = `${uuidv4()}${ext}`;

  let url;
  if (isB2Configured()) {
    const client = getB2Client();
    // BUG CORRIGIDO — "IncompleteBody: The request body was too small"
    // (erro real do B2 em TODO upload, mesmo depois de corrigir a
    // credencial e desligar o checksum automático do SDK — ver
    // config/b2.js). A classe Upload (@aws-sdk/lib-storage) existe pra
    // lidar com arquivos GRANDES via multipart (múltiplas partes de 5MB+
    // enviadas em paralelo, com sua própria lógica de "juntar os chunks
    // recebidos em partes do tamanho certo") — só que ManagedStorage
    // (middleware/upload.js) já junta o arquivo INTEIRO num Buffer só
    // antes de chegar aqui, então a Upload nunca tinha nada de fato pra
    // paralelizar; ela só reempacotava um Buffer já pronto através da
    // própria lógica de "particionamento" pensada pra streams grandes —
    // e é exatamente nessa camada extra de repacotamento que o corpo
    // enviado pro B2 podia sair menor do que o Content-Length prometido.
    // Um PutObjectCommand direto manda o Buffer inteiro de uma vez, sem
    // essa camada — S3 (e B2) aceitam put de arquivo único até 5GB, bem
    // acima do limite de 100MB que este app já impõe (ver
    // HARD_MAX_UPLOAD_MB em middleware/upload.js), então não perde nada.
    await client.send(new PutObjectCommand({ Bucket: env.B2_BUCKET, Key: key, Body: buffer, ContentType: mimeType }));
    // BUG CORRIGIDO ("imagens não aparecem com VPN" + carregamento mais
    // rápido): antes isso apontava direto pro domínio do B2
    // (env.B2_PUBLIC_URL) — trocado pela rota /media/<chave> do nosso
    // próprio servidor (ver app.js), que busca no B2 por trás e entrega
    // pelo mesmo domínio do site. Ver o comentário completo em app.js.
    url = `/media/${key}`;
  } else {
    // Modo de desenvolvimento sem B2 configurado — grava em disco local,
    // igual o comportamento antigo, servido em /uploads/<chave>.
    await fs.promises.writeFile(path.join(uploadRoot, key), buffer);
    url = `/uploads/${key}`;
  }

  const asset = await prisma.fileAsset.create({
    data: {
      ownerId: ownerId || null, originalName: originalName || key, mimeType: mimeType || 'application/octet-stream',
      sizeBytes: buffer.length, storageKey: key, url,
    },
  });

  return asset;
}

async function deleteFile(storageKey) {
  if (!storageKey) return;
  try {
    if (isB2Configured()) {
      const client = getB2Client();
      await client.send(new DeleteObjectCommand({ Bucket: env.B2_BUCKET, Key: storageKey }));
    } else {
      await fs.promises.unlink(path.join(uploadRoot, storageKey)).catch(() => {});
    }
  } catch (err) {
    console.error('[fileStorage] falha ao excluir arquivo:', err.message);
  }
  await prisma.fileAsset.deleteMany({ where: { storageKey } }).catch(() => {});
}

module.exports = { storeFile, deleteFile, uploadRoot };
