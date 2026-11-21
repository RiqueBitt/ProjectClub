const { HeadBucketCommand } = require('@aws-sdk/client-s3');
const { getB2Client, isB2Configured } = require('../config/b2');
const env = require('../config/env');

// Confere, uma vez ao subir o servidor, se as credenciais do Backblaze B2
// funcionam de verdade. Antes, uma chave errada só aparecia quando alguém
// tentava enviar um arquivo (e o upload falhava em silêncio pra pessoa).
async function checkB2() {
  if (!isB2Configured()) {
    console.log('[b2] não configurado — uploads vão para o disco local.');
    return;
  }
  try {
    await getB2Client().send(new HeadBucketCommand({ Bucket: env.B2_BUCKET }));
    console.log(`[b2] conectado ao bucket "${env.B2_BUCKET}"`);
  } catch (err) {
    const code = err?.Code || err?.name || 'erro';
    const status = err?.$metadata?.httpStatusCode;
    console.error(`[b2] FALHA ao acessar o bucket "${env.B2_BUCKET}": ${code}${status ? ` (HTTP ${status})` : ''} — confira B2_KEY_ID, B2_APPLICATION_KEY e B2_ENDPOINT.`);
  }
}

module.exports = { checkB2 };
