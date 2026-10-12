const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const env = require('../config/env');

function signAccessToken(user) {
  return jwt.sign({ sub: user.id }, env.JWT_ACCESS_SECRET, { expiresIn: env.ACCESS_TOKEN_TTL });
}

function verifyAccessToken(token) {
  // SECURITY: sem `algorithms` explícito, a biblioteca decide sozinha
  // qual algoritmo aceitar com base no token recebido — em vez de travar
  // no único algoritmo que este servidor realmente usa pra assinar
  // (HS256). Travar isso aqui impede qualquer tentativa de "confusão de
  // algoritmo" (mandar um token assinado com outro algoritmo, ou sem
  // assinatura nenhuma, esperando que o verificador aceite por engano).
  return jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ['HS256'] });
}

function generateRefreshToken() {
  // Raw token sent to the client; only its hash is stored server-side.
  const raw = crypto.randomBytes(48).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  const expiresAt = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  return { raw, hash, expiresAt };
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// SECURITY: era Math.random() — não é um gerador criptográfico (dá pra
// prever a sequência a partir de saídas anteriores). crypto.randomInt usa
// a mesma fonte segura do resto dos tokens deste arquivo.
function generateNumericCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) code += crypto.randomInt(0, 10);
  return code;
}

// Códigos de recuperação do 2FA: 10 dígitos/letras legíveis em dois
// blocos ("abcde-fghij"), sem caracteres ambíguos (0/o, 1/l/i).
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
function generateRecoveryCode() {
  let out = '';
  for (let i = 0; i < 10; i++) out += RECOVERY_ALPHABET[crypto.randomInt(0, RECOVERY_ALPHABET.length)];
  return `${out.slice(0, 5)}-${out.slice(5)}`;
}

// Normaliza o que a pessoa digitou (maiúsculas, espaços, com ou sem o
// hífen) antes de comparar com o hash guardado.
function normalizeRecoveryCode(input) {
  const clean = String(input || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (clean.length !== 10) return null;
  return `${clean.slice(0, 5)}-${clean.slice(5)}`;
}

function generateOpaqueToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  generateRefreshToken,
  hashToken,
  generateNumericCode,
  generateOpaqueToken,
  generateRecoveryCode,
  normalizeRecoveryCode,
};
