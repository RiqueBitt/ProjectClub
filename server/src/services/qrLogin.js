// Fase 5 — "Entrar com o celular" (login por QR Code).
//
// Máquina de estados de um pareamento (tabela QrLoginPairing):
//
//   PENDING ──(celular logado abre o link)──▶ SCANNED ──(toca em Aprovar)──▶ APPROVED
//      │                                         │                              │
//      └──────────────(expira em 2 min)──────────┴──(Recusar)▶ DENIED           └─(PC troca o segredo)▶ CONSUMED
//
// Segredos (32 bytes aleatórios cada, só o hash sha256 fica no banco):
//   - code   → vai no QR (/entrar-qr?c=...). Quem tem o code só consegue VER
//              e APROVAR/RECUSAR, e só estando logado.
//   - secret → fica SÓ no PC que pediu (nunca no QR). É a única coisa que
//              troca um pareamento aprovado por uma sessão.
//
// Proteções:
//   - uso único: cada passo é um updateMany condicionado ao estado anterior
//     (só uma requisição "ganha"), e CONSUMED nunca volta;
//   - quem abriu o link primeiro "trava" o pareamento (scannedById): outra
//     conta não consegue aprovar depois, e aprovar exige ter visto a tela de
//     confirmação antes (SCANNED), não dá pra aprovar "às cegas" por outro
//     caminho;
//   - consultar o estado exige o secret (não dá pra enumerar pareamentos);
//   - a troca exige o MESMO navegador (user-agent) que pediu;
//   - 2 minutos de validade, inclusive pra troca depois de aprovado.
//
// Tudo recebe o `db` injetado (testes sem banco).
const crypto = require('crypto');

const getPrisma = () => require('../config/prisma');

const TTL_MS = 2 * 60 * 1000;
const STATUS = Object.freeze({
  PENDING: 'PENDING', SCANNED: 'SCANNED', APPROVED: 'APPROVED', DENIED: 'DENIED', CONSUMED: 'CONSUMED', EXPIRED: 'EXPIRED',
});

const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');
const randomToken = () => crypto.randomBytes(32).toString('base64url');
// 32 bytes em base64url = 43 caracteres [A-Za-z0-9_-].
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const isToken = (v) => typeof v === 'string' && TOKEN_RE.test(v);

class QrLoginError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

const ERR = {
  invalid: () => new QrLoginError('invalid', 'Código inválido ou expirado. Gere um novo QR no computador.', 404),
  expired: () => new QrLoginError('expired', 'Este QR Code expirou. Gere um novo no computador.', 410),
  taken: () => new QrLoginError('taken', 'Este QR Code já está sendo usado por outra conta.', 409),
  used: () => new QrLoginError('used', 'Este QR Code já foi usado.', 409),
  notScanned: () => new QrLoginError('not_scanned', 'Abra o link do QR Code de novo antes de aprovar.', 409),
  denied: () => new QrLoginError('denied', 'O acesso foi recusado no celular.', 403),
  notApproved: () => new QrLoginError('not_approved', 'O acesso ainda não foi aprovado no celular.', 409),
  device: () => new QrLoginError('device', 'Este pedido foi criado em outro navegador. Gere um novo QR aqui.', 403),
};

const isExpired = (row, now) => !row || new Date(row.expiresAt).getTime() <= now.getTime();

// Estado público (o que o PC vê enquanto espera). Expirado vira EXPIRED
// mesmo que a linha ainda diga PENDING/SCANNED/APPROVED.
function publicStatus(row, now = new Date()) {
  if (!row) return STATUS.EXPIRED;
  if (row.status === STATUS.CONSUMED || row.status === STATUS.DENIED) return row.status;
  if (isExpired(row, now)) return STATUS.EXPIRED;
  return row.status;
}

// PC: cria o pareamento. Devolve code (pro QR) e secret (só pro PC).
async function createPairing({ db = getPrisma(), ip = null, userAgent = null, now = new Date() } = {}) {
  const code = randomToken();
  const secret = randomToken();
  const expiresAt = new Date(now.getTime() + TTL_MS);
  const row = await db.qrLoginPairing.create({
    data: {
      codeHash: sha256(code),
      secretHash: sha256(secret),
      status: STATUS.PENDING,
      requesterIp: ip ? String(ip).slice(0, 64) : null,
      requesterUa: userAgent ? String(userAgent).slice(0, 400) : null,
      expiresAt,
      createdAt: now,
    },
  });
  return { code, secret, expiresAt, id: row.id };
}

async function findByCode(db, code) {
  if (!isToken(code)) return null;
  return db.qrLoginPairing.findUnique({ where: { codeHash: sha256(code) } });
}

async function findBySecret(db, secret) {
  if (!isToken(secret)) return null;
  return db.qrLoginPairing.findUnique({ where: { secretHash: sha256(secret) } });
}

// Celular (logado): abre o link → vê quem está pedindo. O primeiro a abrir
// trava o pareamento pra si (SCANNED). Abrir de novo pela mesma conta é ok.
async function scanPairing(code, approverId, { db = getPrisma(), now = new Date() } = {}) {
  if (!approverId) throw ERR.invalid();
  const row = await findByCode(db, code);
  if (!row) throw ERR.invalid();
  if (row.status === STATUS.CONSUMED || row.status === STATUS.APPROVED) throw ERR.used();
  if (row.status === STATUS.DENIED) throw ERR.denied();
  if (isExpired(row, now)) throw ERR.expired();
  if (row.status === STATUS.SCANNED) {
    if (row.scannedById !== approverId) throw ERR.taken();
    return row;
  }
  const claimed = await db.qrLoginPairing.updateMany({
    where: { id: row.id, status: STATUS.PENDING },
    data: { status: STATUS.SCANNED, scannedById: approverId, scannedAt: now },
  });
  if (claimed.count !== 1) {
    // Outra requisição ganhou a corrida: relê e decide pelo estado novo.
    const again = await db.qrLoginPairing.findUnique({ where: { codeHash: row.codeHash } });
    if (again?.status === STATUS.SCANNED && again.scannedById === approverId) return again;
    throw ERR.taken();
  }
  return { ...row, status: STATUS.SCANNED, scannedById: approverId, scannedAt: now };
}

// Celular: "Aprovar" (approve=true) ou "Recusar" (approve=false). Só quem
// travou o pareamento ao abrir o link, e só a partir de SCANNED.
async function decidePairing(code, approverId, approve, { db = getPrisma(), now = new Date() } = {}) {
  if (!approverId) throw ERR.invalid();
  const row = await findByCode(db, code);
  if (!row) throw ERR.invalid();
  if (row.status === STATUS.CONSUMED || row.status === STATUS.APPROVED) throw ERR.used();
  if (row.status === STATUS.DENIED) throw ERR.denied();
  if (isExpired(row, now)) throw ERR.expired();
  if (row.status !== STATUS.SCANNED) throw ERR.notScanned();
  if (row.scannedById !== approverId) throw ERR.taken();
  const data = approve
    ? { status: STATUS.APPROVED, userId: approverId, approvedAt: now }
    : { status: STATUS.DENIED };
  const done = await db.qrLoginPairing.updateMany({
    where: { id: row.id, status: STATUS.SCANNED, scannedById: approverId },
    data,
  });
  if (done.count !== 1) throw ERR.used();
  return { ...row, ...data };
}

// PC: consulta o estado (precisa do secret).
async function pollPairing(secret, { db = getPrisma(), now = new Date() } = {}) {
  const row = await findBySecret(db, secret);
  if (!row) throw ERR.invalid();
  return { status: publicStatus(row, now), expiresAt: row.expiresAt };
}

// PC: troca o secret de um pareamento APROVADO pelo id da conta (uma vez só).
// Quem chama emite a sessão (mesmo caminho do login normal).
async function consumePairing(secret, { db = getPrisma(), userAgent = null, now = new Date() } = {}) {
  const row = await findBySecret(db, secret);
  if (!row) throw ERR.invalid();
  if (row.status === STATUS.CONSUMED) throw ERR.used();
  if (row.status === STATUS.DENIED) throw ERR.denied();
  if (isExpired(row, now)) throw ERR.expired();
  if (row.status !== STATUS.APPROVED || !row.userId) throw ERR.notApproved();
  if ((row.requesterUa || null) !== (userAgent ? String(userAgent).slice(0, 400) : null)) throw ERR.device();
  const done = await db.qrLoginPairing.updateMany({
    where: { id: row.id, status: STATUS.APPROVED },
    data: { status: STATUS.CONSUMED, consumedAt: now },
  });
  if (done.count !== 1) throw ERR.used();
  return { userId: row.userId, pairingId: row.id };
}

module.exports = {
  TTL_MS, STATUS, QrLoginError, sha256, isToken, publicStatus,
  createPairing, scanPairing, decidePairing, pollPairing, consumePairing,
};
