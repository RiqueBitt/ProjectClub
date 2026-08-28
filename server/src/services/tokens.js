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

function generateNumericCode(length = 6) {
  let code = '';
  for (let i = 0; i < length; i++) code += Math.floor(Math.random() * 10);
  return code;
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
};
