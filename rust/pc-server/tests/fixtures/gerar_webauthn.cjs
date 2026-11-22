// Como gerar de novo: cd server && node ../rust/pc-server/tests/fixtures/gerar_webauthn.cjs > ../rust/pc-server/tests/fixtures/webauthn_node.json
// Gera respostas WebAuthn de verdade (chaves criadas aqui) e confere cada
// uma com o @simplewebauthn/server do Node: fixture pro teste do Rust.
const crypto = require('crypto');
const sw = require(require.resolve('@simplewebauthn/server', { paths: [process.cwd()] }));
const { isoCBOR } = require(require.resolve('@simplewebauthn/server', { paths: [process.cwd()] }).replace(/index\.js$/, 'helpers/index.js'));
const b64u = (b) => Buffer.from(b).toString('base64url');
const sha = (b) => crypto.createHash('sha256').update(b).digest();
const rpId = 'projectclub.shardweb.app';
const origin = 'https://projectclub.shardweb.app';

function coseOf(kind, keyObj) {
  const jwk = keyObj.export({ format: 'jwk' });
  const m = new Map();
  if (kind === 'es256') { m.set(1, 2); m.set(3, -7); m.set(-1, 1); m.set(-2, Buffer.from(jwk.x, 'base64url')); m.set(-3, Buffer.from(jwk.y, 'base64url')); }
  if (kind === 'ed25519') { m.set(1, 1); m.set(3, -8); m.set(-1, 6); m.set(-2, Buffer.from(jwk.x, 'base64url')); }
  if (kind === 'rs256') { m.set(1, 3); m.set(3, -257); m.set(-1, Buffer.from(jwk.n, 'base64url')); m.set(-2, Buffer.from(jwk.e, 'base64url')); }
  return Buffer.from(isoCBOR.encode(m));
}
function sign(kind, priv, data) {
  if (kind === 'ed25519') return crypto.sign(null, data, priv);
  return crypto.sign('sha256', data, priv); // ES256 sai em DER; RSA PKCS1
}
function counterBuf(n) { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; }

async function make(kind, fmt) {
  const { publicKey, privateKey } = kind === 'es256' ? crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' })
    : kind === 'ed25519' ? crypto.generateKeyPairSync('ed25519') : crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const credId = crypto.randomBytes(16);
  const cose = coseOf(kind, publicKey);
  const len = Buffer.alloc(2); len.writeUInt16BE(credId.length);
  const authData = Buffer.concat([sha(rpId), Buffer.from([0x45]), counterBuf(0), Buffer.alloc(16), len, credId, cose]);
  const regChallenge = b64u(crypto.randomBytes(32));
  const cdReg = Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: regChallenge, origin, crossOrigin: false }));
  const attStmt = new Map();
  if (fmt === 'packed') {
    attStmt.set('alg', kind === 'es256' ? -7 : kind === 'ed25519' ? -8 : -257);
    attStmt.set('sig', sign(kind, privateKey, Buffer.concat([authData, sha(cdReg)])));
  }
  const att = new Map([['fmt', fmt], ['attStmt', attStmt], ['authData', authData]]);
  const id = b64u(credId);
  const registration = { id, rawId: id, type: 'public-key', response: { clientDataJSON: b64u(cdReg), attestationObject: b64u(isoCBOR.encode(att)), transports: ['internal', 'hybrid'] }, clientExtensionResults: {} };
  const v = await sw.verifyRegistrationResponse({ response: registration, expectedChallenge: regChallenge, expectedOrigin: origin, expectedRPID: rpId, requireUserVerification: false });
  if (!v.verified) throw new Error('node recusou o cadastro');
  const assertion = async (counter) => {
    const ad = Buffer.concat([sha(rpId), Buffer.from([0x05]), counterBuf(counter)]);
    const challenge = b64u(crypto.randomBytes(32));
    const cd = Buffer.from(JSON.stringify({ type: 'webauthn.get', challenge, origin, crossOrigin: false }));
    const sig = sign(kind, privateKey, Buffer.concat([ad, sha(cd)]));
    const response = { id, rawId: id, type: 'public-key', response: { clientDataJSON: b64u(cd), authenticatorData: b64u(ad), signature: b64u(sig), userHandle: b64u(Buffer.from('cel')) }, clientExtensionResults: {} };
    const a = await sw.verifyAuthenticationResponse({ response, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpId, requireUserVerification: false,
      credential: { id, publicKey: v.registrationInfo.credential.publicKey, counter: counter - 1 } });
    if (!a.verified) throw new Error('node recusou a entrada');
    return { challenge, response, newCounter: a.authenticationInfo.newCounter };
  };
  return {
    kind, fmt, regChallenge, registration,
    credentialId: v.registrationInfo.credential.id,
    publicKey: b64u(v.registrationInfo.credential.publicKey),
    counter: v.registrationInfo.credential.counter,
    auth1: await assertion(1), auth2: await assertion(2),
  };
}

(async () => {
  const out = { rpId, origin, cases: [await make('es256', 'none'), await make('ed25519', 'none'), await make('rs256', 'packed'), await make('es256', 'packed')] };
  process.stdout.write(JSON.stringify(out, null, 1));
})().catch((e) => { console.error(e); process.exit(1); });
