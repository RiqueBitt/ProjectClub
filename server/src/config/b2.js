// Backblaze B2 fala o protocolo S3 — então usamos o SDK oficial da AWS
// (@aws-sdk/client-s3), só apontando pro endpoint do B2 em vez da AWS de
// verdade. Isso é o que a própria documentação do B2 recomenda pra quem
// já usa alguma lib compatível com S3, em vez de reimplementar tudo do
// zero com a API nativa do B2.
const { S3Client } = require('@aws-sdk/client-s3');
const { NodeHttpHandler } = require('@smithy/node-http-handler');
const { Agent: HttpsAgent } = require('https');
const env = require('./env');

// Só configurado de verdade se as variáveis do B2 estiverem definidas —
// sem isso, isB2Configured() volta false e o upload cai pro disco local
// (ver middleware/upload.js), pra continuar funcionando em desenvolvimento
// sem precisar de conta no B2.
function isB2Configured() {
  return !!(env.B2_ENDPOINT && env.B2_BUCKET && env.B2_KEY_ID && env.B2_APPLICATION_KEY);
}

let client = null;
function getB2Client() {
  if (!isB2Configured()) return null;
  if (!client) {
    client = new S3Client({
      endpoint: env.B2_ENDPOINT,
      region: env.B2_REGION,
      credentials: { accessKeyId: env.B2_KEY_ID, secretAccessKey: env.B2_APPLICATION_KEY },
      // B2 (e a maioria dos provedores S3-compatíveis fora da AWS de
      // verdade) precisa do estilo "path" (endpoint/bucket/chave) em vez
      // do estilo "virtual-hosted" (bucket.endpoint/chave) que a AWS usa
      // por padrão — sem isso os requests vão pro endereço errado.
      forcePathStyle: true,
      // BUG CORRIGIDO — "IncompleteBody: The request body was too small".
      // Versões recentes do @aws-sdk/client-s3 (a partir de ~3.729) passaram
      // a calcular e anexar um checksum (CRC32) automaticamente em TODO
      // upload, por padrão — e pra fazer isso sem precisar ler o arquivo
      // inteiro na memória antes, o SDK manda o corpo em "chunked transfer
      // encoding" com o checksum como um trailer no final (aws-chunked).
      // A AWS de verdade entende esse formato; o Backblaze B2 (e a maioria
      // dos outros provedores S3-compatíveis — MinIO, R2, Spaces, etc.)
      // ainda não — o B2 lê o corpo esperando só os bytes crus do arquivo,
      // vê menos bytes do que o Content-Length chunked prometia (porque o
      // resto era metadado do checksum, não dado de verdade) e recusa com
      // "corpo pequeno demais". 'WHEN_REQUIRED' volta pro comportamento
      // antigo (só calcula/manda checksum quando alguém pede explicitamente
      // um algoritmo, não em todo upload por padrão) — resolve tanto o
      // envio (requestChecksumCalculation) quanto a checagem de resposta
      // (responseChecksumValidation, mesmo problema no sentido contrário).
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
      // BUG CORRIGIDO (tentativa 2) — "IncompleteBody" continuava
      // acontecendo mesmo depois de desligar o checksum automático E de
      // trocar Upload por um PutObjectCommand direto (ver
      // services/fileStorage.js), o que descarta os dois como causa real.
      // Sobrou a camada de rede: por padrão o SDK reaproveita conexões
      // HTTPS entre requisições (keep-alive) — em ambientes atrás de um
      // proxy/NAT que lida mal com esse reaproveitamento (comum em
      // provedores PaaS como o Square Cloud, cujo egress passa por um
      // proxy próprio), uma conexão reciclada pode entregar o corpo da
      // requisição seguinte cortado, batendo exatamente com esse sintoma
      // (sempre o mesmo tamanho de erro, sempre no mesmo tipo de request).
      // Forçando keepAlive:false aqui, toda requisição ao B2 abre uma
      // conexão TCP/TLS nova do zero — um pouco mais lento, mas elimina
      // esse reaproveitamento como fonte do problema.
      requestHandler: new NodeHttpHandler({ httpsAgent: new HttpsAgent({ keepAlive: false }) }),
    });
  }
  return client;
}

module.exports = { getB2Client, isB2Configured };
