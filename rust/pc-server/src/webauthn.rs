//! Chaves de acesso (WebAuthn) — o que o `@simplewebauthn/server` 13 faz no
//! Node: gerar as opções e conferir as respostas do navegador.
//!
//! A chave pública fica guardada como a COSE key do autenticador (os mesmos
//! bytes que o `@simplewebauthn` grava), então uma chave criada pelo Node
//! entra pelo Rust e vice-versa. Assinaturas: EdDSA (-8), ES256 (-7),
//! ES384 (-35), RS256/384/512 (-257/-258/-259) e PS256/384/512 (-37/-38/-39).
//!
//! Atestado: o site pede `attestation: 'none'` (não confia em fabricante),
//! então aceita `none`, `packed` (própria ou com certificado) e `fido-u2f`,
//! conferindo a assinatura. Os formatos raros (`tpm`, `android-key`,
//! `android-safetynet`, `apple`) — que o navegador só manda quando o site
//! pede atestado — são recusados.

use base64::Engine;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use ciborium::Value as Cbor;
use ring::signature::{self, UnparsedPublicKey};
use serde_json::Value;
use sha2::{Digest, Sha256};

/// `isoBase64URL.toBuffer`: base64url com ou sem `=`.
const B64U: GeneralPurpose = GeneralPurpose::new(
    &base64::alphabet::URL_SAFE,
    GeneralPurposeConfig::new().with_decode_padding_mode(DecodePaddingMode::Indifferent),
);

pub fn b64u(bytes: &[u8]) -> String {
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

pub fn from_b64u(s: &str) -> Option<Vec<u8>> {
    B64U.decode(s).ok()
}

/// `isoBase64URL.isBase64URL`.
fn is_b64u(s: &str) -> bool {
    let body = s.trim_end_matches('=');
    s.len() - body.len() <= 2
        && !body.is_empty()
        && body
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

pub type Fail = &'static str;
type R<T> = Result<T, Fail>;

/// Os algoritmos que o site pede no cadastro (`defaultSupportedAlgorithmIDs`).
pub const REQUESTED_ALGS: [i64; 3] = [-8, -7, -257];

struct ClientData {
    kind: String,
    origin: String,
    challenge: String,
}

fn client_data(raw_b64: &Value) -> R<(ClientData, Vec<u8>)> {
    let s = raw_b64.as_str().ok_or("clientDataJSON não é texto")?;
    let raw = from_b64u(s).ok_or("clientDataJSON inválido")?;
    let v: Value = serde_json::from_slice(&raw).map_err(|_| "clientDataJSON inválido")?;
    let text = |k: &str| v.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    if let Some(tb) = v.get("tokenBinding").filter(|t| !t.is_null()) {
        let ok = tb.is_object()
            && matches!(
                tb.get("status").and_then(Value::as_str),
                Some("present" | "supported" | "not-supported" | "notSupported")
            );
        if !ok {
            return Err("tokenBinding inválido");
        }
    }
    Ok((
        ClientData {
            kind: text("type"),
            origin: text("origin"),
            challenge: text("challenge"),
        },
        raw,
    ))
}

pub struct AuthData {
    pub rp_id_hash: [u8; 32],
    pub up: bool,
    pub uv: bool,
    pub counter: u32,
    pub aaguid: Option<[u8; 16]>,
    pub credential_id: Option<Vec<u8>>,
    /// os bytes da COSE key, como vieram
    pub public_key: Option<Vec<u8>>,
}

/// Lê um item CBOR do começo de `bytes` e diz quantos bytes ele ocupa.
fn cbor_first(bytes: &[u8]) -> R<(Cbor, usize)> {
    let mut rest = bytes;
    let v: Cbor = ciborium::de::from_reader(&mut rest).map_err(|_| "CBOR inválido")?;
    Ok((v, bytes.len() - rest.len()))
}

pub fn parse_auth_data(data: &[u8]) -> R<AuthData> {
    if data.len() < 37 {
        return Err("authenticatorData curto");
    }
    let flags = data[32];
    let mut p = 37;
    let counter = u32::from_be_bytes([data[33], data[34], data[35], data[36]]);
    let (mut aaguid, mut credential_id, mut public_key) = (None, None, None);
    if flags & (1 << 6) != 0 {
        let take = |p: &mut usize, n: usize| -> R<&[u8]> {
            let s = data.get(*p..*p + n).ok_or("authenticatorData curto")?;
            *p += n;
            Ok(s)
        };
        aaguid = Some(<[u8; 16]>::try_from(take(&mut p, 16)?).map_err(|_| "aaguid")?);
        let len = take(&mut p, 2)?;
        let len = u16::from_be_bytes([len[0], len[1]]) as usize;
        credential_id = Some(take(&mut p, len)?.to_vec());
        // a COSE key Ed25519 sem o `x` de alguns autenticadores velhos
        // (a3 → a4), igual ao conserto do @simplewebauthn
        const BAD_EDDSA: [u8; 17] = [
            0xa3, 0x01, 0x63, 0x4f, 0x4b, 0x50, 0x03, 0x27, 0x20, 0x67, 0x45, 0x64, 0x32, 0x35,
            0x35, 0x31, 0x39,
        ];
        let rest = &data[p..];
        let (_, used) = if rest.starts_with(&BAD_EDDSA) {
            let mut fixed = rest.to_vec();
            fixed[0] = 0xa4;
            cbor_first(&fixed)?
        } else {
            cbor_first(rest)?
        };
        public_key = Some(rest[..used].to_vec());
        p += used;
    }
    if flags & (1 << 7) != 0 {
        let (_, used) = cbor_first(&data[p..])?;
        p += used;
    }
    if data.len() > p {
        return Err("sobra de bytes no authenticatorData");
    }
    let mut rp_id_hash = [0u8; 32];
    rp_id_hash.copy_from_slice(&data[..32]);
    Ok(AuthData {
        rp_id_hash,
        up: flags & 1 != 0,
        uv: flags & (1 << 2) != 0,
        counter,
        aaguid,
        credential_id,
        public_key,
    })
}

fn int_key(map: &[(Cbor, Cbor)], k: i64) -> Option<&Cbor> {
    map.iter()
        .find(|(key, _)| key.as_integer().and_then(|i| i64::try_from(i).ok()) == Some(k))
        .map(|(_, v)| v)
}

fn as_i64(v: Option<&Cbor>) -> Option<i64> {
    v?.as_integer().and_then(|i| i64::try_from(i).ok())
}

fn as_bytes(v: Option<&Cbor>) -> Option<&[u8]> {
    v?.as_bytes().map(Vec::as_slice)
}

/// O `alg` da COSE key.
pub fn cose_alg(cose: &[u8]) -> R<i64> {
    let (v, _) = cbor_first(cose)?;
    let map = v.as_map().ok_or("COSE key não é mapa")?;
    as_i64(int_key(map, 3)).ok_or("COSE key sem alg")
}

/// DER do `RSAPublicKey` (n, e) pro `ring`.
fn rsa_der(n: &[u8], e: &[u8]) -> Vec<u8> {
    fn len(n: usize) -> Vec<u8> {
        if n < 0x80 {
            vec![n as u8]
        } else {
            let b = n.to_be_bytes();
            let b: Vec<u8> = b.iter().copied().skip_while(|x| *x == 0).collect();
            let mut out = vec![0x80 | b.len() as u8];
            out.extend(b);
            out
        }
    }
    fn int(v: &[u8]) -> Vec<u8> {
        let v: Vec<u8> = v.iter().copied().skip_while(|x| *x == 0).collect();
        let mut body = if v.first().is_some_and(|b| b & 0x80 != 0) {
            vec![0]
        } else {
            vec![]
        };
        body.extend(if v.is_empty() { vec![0] } else { v });
        let mut out = vec![0x02];
        out.extend(len(body.len()));
        out.extend(body);
        out
    }
    let body = [int(n), int(e)].concat();
    let mut out = vec![0x30];
    out.extend(len(body.len()));
    out.extend(body);
    out
}

/// Confere `sig` sobre `data` com a COSE key (`verifySignature`).
pub fn verify_cose(cose: &[u8], data: &[u8], sig: &[u8]) -> bool {
    let Ok((v, _)) = cbor_first(cose) else {
        return false;
    };
    let Some(map) = v.as_map() else { return false };
    let kty = as_i64(int_key(map, 1));
    let alg = as_i64(int_key(map, 3));
    match (kty, alg) {
        // OKP / Ed25519
        (Some(1), _) => {
            let crv = as_i64(int_key(map, -1));
            let Some(x) = as_bytes(int_key(map, -2)) else {
                return false;
            };
            crv == Some(6)
                && UnparsedPublicKey::new(&signature::ED25519, x)
                    .verify(data, sig)
                    .is_ok()
        }
        // EC2
        (Some(2), alg) => {
            let crv = as_i64(int_key(map, -1));
            let (Some(x), Some(y)) = (as_bytes(int_key(map, -2)), as_bytes(int_key(map, -3)))
            else {
                return false;
            };
            let point = [&[0x04][..], x, y].concat();
            let algo: &dyn signature::VerificationAlgorithm = match (crv, alg) {
                (Some(1), Some(-7) | None) => &signature::ECDSA_P256_SHA256_ASN1,
                (Some(2), Some(-35) | None) => &signature::ECDSA_P384_SHA384_ASN1,
                _ => return false,
            };
            UnparsedPublicKey::new(algo, point)
                .verify(data, sig)
                .is_ok()
        }
        // RSA
        (Some(3), Some(alg)) => {
            let (Some(n), Some(e)) = (as_bytes(int_key(map, -1)), as_bytes(int_key(map, -2)))
            else {
                return false;
            };
            let algo: &dyn signature::VerificationAlgorithm = match alg {
                -257 => &signature::RSA_PKCS1_2048_8192_SHA256,
                -258 => &signature::RSA_PKCS1_2048_8192_SHA384,
                -259 => &signature::RSA_PKCS1_2048_8192_SHA512,
                -37 => &signature::RSA_PSS_2048_8192_SHA256,
                -38 => &signature::RSA_PSS_2048_8192_SHA384,
                -39 => &signature::RSA_PSS_2048_8192_SHA512,
                _ => return false,
            };
            UnparsedPublicKey::new(algo, rsa_der(n, e))
                .verify(data, sig)
                .is_ok()
        }
        _ => false,
    }
}

// ---------------------------------------------------------------- certificado (x5c)

/// Lê um elemento DER: (tag, conteúdo, tamanho total).
fn der(b: &[u8]) -> Option<(u8, &[u8], usize)> {
    let tag = *b.first()?;
    let first = *b.get(1)? as usize;
    let (len, head) = if first < 0x80 {
        (first, 2)
    } else {
        let n = first & 0x7f;
        if n == 0 || n > 4 {
            return None;
        }
        let mut len = 0usize;
        for i in 0..n {
            len = (len << 8) | *b.get(2 + i)? as usize;
        }
        (len, 2 + n)
    };
    Some((tag, b.get(head..head + len)?, head + len))
}

/// A chave pública do certificado folha: (OID do algoritmo, bytes da chave).
fn cert_public_key(cert: &[u8]) -> Option<(Vec<u8>, Vec<u8>)> {
    let (_, certificate, _) = der(cert)?;
    let (_, tbs, _) = der(certificate)?;
    let mut rest = tbs;
    // [0] versão (opcional)
    if rest.first() == Some(&0xa0) {
        rest = &rest[der(rest)?.2..];
    }
    // serial, algoritmo, emissor, validade, titular
    for _ in 0..5 {
        rest = &rest[der(rest)?.2..];
    }
    let (_, spki, _) = der(rest)?;
    let (_, alg, used) = der(spki)?;
    let (_, oid, _) = der(alg)?;
    let (tag, bits, _) = der(&spki[used..])?;
    if tag != 0x03 || bits.first() != Some(&0) {
        return None;
    }
    Some((oid.to_vec(), bits[1..].to_vec()))
}

const OID_EC: &[u8] = &[0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01];
const OID_RSA: &[u8] = &[0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01];

fn verify_cert(cert: &[u8], alg: i64, data: &[u8], sig: &[u8]) -> bool {
    let Some((oid, key)) = cert_public_key(cert) else {
        return false;
    };
    let algo: &dyn signature::VerificationAlgorithm = match (oid.as_slice(), alg) {
        (OID_EC, -7) => &signature::ECDSA_P256_SHA256_ASN1,
        (OID_EC, -35) => &signature::ECDSA_P384_SHA384_ASN1,
        (OID_RSA, -257) => &signature::RSA_PKCS1_2048_8192_SHA256,
        (OID_RSA, -258) => &signature::RSA_PKCS1_2048_8192_SHA384,
        (OID_RSA, -259) => &signature::RSA_PKCS1_2048_8192_SHA512,
        (OID_RSA, -37) => &signature::RSA_PSS_2048_8192_SHA256,
        _ => return false,
    };
    UnparsedPublicKey::new(algo, key).verify(data, sig).is_ok()
}

fn text_key<'a>(map: &'a [(Cbor, Cbor)], k: &str) -> Option<&'a Cbor> {
    map.iter()
        .find(|(key, _)| key.as_text() == Some(k))
        .map(|(_, v)| v)
}

// ---------------------------------------------------------------- respostas

/// O que vale nas duas respostas: `id === rawId`, `type: 'public-key'`.
fn check_credential(resp: &Value) -> R<String> {
    let id = resp
        .get("id")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or("sem id")?;
    if resp.get("rawId").and_then(Value::as_str) != Some(id) {
        return Err("rawId diferente do id");
    }
    if resp.get("type").and_then(Value::as_str) != Some("public-key") {
        return Err("type não é public-key");
    }
    Ok(id.to_string())
}

pub struct Expected<'a> {
    pub challenge: &'a str,
    pub origin: &'a str,
    pub rp_id: &'a str,
}

pub struct Registered {
    pub credential_id: String,
    pub public_key: Vec<u8>,
    pub counter: u32,
    pub transports: Vec<String>,
}

/// `verifyRegistrationResponse` (com `requireUserVerification: false`).
pub fn verify_registration(resp: &Value, exp: &Expected) -> R<Registered> {
    check_credential(resp)?;
    let inner = resp.get("response").ok_or("sem response")?;
    let (cd, cd_raw) = client_data(inner.get("clientDataJSON").unwrap_or(&Value::Null))?;
    if cd.kind != "webauthn.create" {
        return Err("type do clientData");
    }
    if cd.challenge != exp.challenge {
        return Err("desafio diferente");
    }
    if cd.origin != exp.origin {
        return Err("origem diferente");
    }
    let att = inner
        .get("attestationObject")
        .and_then(Value::as_str)
        .and_then(from_b64u)
        .ok_or("attestationObject inválido")?;
    let (obj, _) = cbor_first(&att)?;
    let obj = obj.as_map().ok_or("attestationObject não é mapa")?;
    let fmt = text_key(obj, "fmt")
        .and_then(Cbor::as_text)
        .ok_or("sem fmt")?;
    let auth_raw = as_bytes(text_key(obj, "authData")).ok_or("sem authData")?;
    let att_stmt = text_key(obj, "attStmt")
        .and_then(Cbor::as_map)
        .ok_or("sem attStmt")?;
    let ad = parse_auth_data(auth_raw)?;
    if ad.rp_id_hash[..] != Sha256::digest(exp.rp_id.as_bytes())[..] {
        return Err("rpId diferente");
    }
    if !ad.up {
        return Err("sem presença do usuário");
    }
    let cred_id = ad.credential_id.as_ref().ok_or("sem credentialId")?;
    let public_key = ad.public_key.clone().ok_or("sem chave pública")?;
    ad.aaguid.ok_or("sem aaguid")?;
    let alg = cose_alg(&public_key)?;
    if ![-8, -7, -36, -37, -38, -39, -257, -258, -259, -65535].contains(&alg) {
        return Err("algoritmo não aceito");
    }
    let client_hash = Sha256::digest(&cd_raw);
    let signed = [auth_raw, &client_hash[..]].concat();
    let ok = match fmt {
        "none" => {
            if !att_stmt.is_empty() {
                return Err("atestado none com conteúdo");
            }
            true
        }
        "packed" => {
            let sig = as_bytes(text_key(att_stmt, "sig")).ok_or("packed sem sig")?;
            let st_alg = as_i64(text_key(att_stmt, "alg")).ok_or("packed sem alg")?;
            match text_key(att_stmt, "x5c").and_then(Cbor::as_array) {
                Some(x5c) => {
                    let leaf = as_bytes(x5c.first()).ok_or("x5c vazio")?;
                    verify_cert(leaf, st_alg, &signed, sig)
                }
                None => st_alg == alg && verify_cose(&public_key, &signed, sig),
            }
        }
        "fido-u2f" => {
            let sig = as_bytes(text_key(att_stmt, "sig")).ok_or("u2f sem sig")?;
            let x5c = text_key(att_stmt, "x5c")
                .and_then(Cbor::as_array)
                .ok_or("u2f sem x5c")?;
            let leaf = as_bytes(x5c.first()).ok_or("x5c vazio")?;
            let (v, _) = cbor_first(&public_key)?;
            let map = v.as_map().ok_or("COSE key")?;
            let (Some(x), Some(y)) = (as_bytes(int_key(map, -2)), as_bytes(int_key(map, -3)))
            else {
                return Err("u2f sem x/y");
            };
            let base = [
                &[0u8][..],
                &ad.rp_id_hash,
                &client_hash,
                cred_id,
                &[0x04],
                x,
                y,
            ]
            .concat();
            verify_cert(leaf, -7, &base, sig)
        }
        _ => return Err("formato de atestado não aceito"),
    };
    if !ok {
        return Err("assinatura do atestado");
    }
    let transports = inner
        .get("transports")
        .and_then(Value::as_array)
        .map(|a| {
            a.iter()
                .filter_map(Value::as_str)
                .map(String::from)
                .collect()
        })
        .unwrap_or_default();
    Ok(Registered {
        credential_id: b64u(cred_id),
        public_key,
        counter: ad.counter,
        transports,
    })
}

/// `verifyAuthenticationResponse` (com `requireUserVerification: false`):
/// devolve o contador novo.
pub fn verify_authentication(
    resp: &Value,
    exp: &Expected,
    public_key: &[u8],
    counter: u32,
) -> R<u32> {
    check_credential(resp)?;
    let inner = resp.get("response").ok_or("sem response")?;
    let (cd, cd_raw) = client_data(inner.get("clientDataJSON").unwrap_or(&Value::Null))?;
    if cd.kind != "webauthn.get" {
        return Err("type do clientData");
    }
    if cd.challenge != exp.challenge {
        return Err("desafio diferente");
    }
    if cd.origin != exp.origin {
        return Err("origem diferente");
    }
    let text = |k: &str| inner.get(k).and_then(Value::as_str).filter(|s| is_b64u(s));
    let auth_raw = text("authenticatorData")
        .and_then(from_b64u)
        .ok_or("authenticatorData")?;
    let sig = text("signature").and_then(from_b64u).ok_or("signature")?;
    // `if (userHandle && typeof userHandle !== 'string')`
    let truthy = |v: &Value| match v {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(n) => n.as_f64().is_some_and(|f| f != 0.0),
        Value::String(s) => !s.is_empty(),
        _ => true,
    };
    if let Some(h) = inner.get("userHandle")
        && truthy(h)
        && !h.is_string()
    {
        return Err("userHandle");
    }
    let ad = parse_auth_data(&auth_raw)?;
    if ad.rp_id_hash[..] != Sha256::digest(exp.rp_id.as_bytes())[..] {
        return Err("rpId diferente");
    }
    if !ad.up {
        return Err("sem presença do usuário");
    }
    if (ad.counter > 0 || counter > 0) && ad.counter <= counter {
        return Err("contador voltou");
    }
    let signed = [&auth_raw[..], &Sha256::digest(&cd_raw)[..]].concat();
    if !verify_cose(public_key, &signed, &sig) {
        return Err("assinatura");
    }
    Ok(ad.counter)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url() {
        assert!(is_b64u("abc-_"));
        assert!(is_b64u("YQ=="));
        assert!(!is_b64u("a+b"));
        assert_eq!(from_b64u("YQ==").unwrap(), b"a");
        assert_eq!(from_b64u("YQ").unwrap(), b"a");
    }

    #[test]
    fn rsa_em_der() {
        // n = 0x80 (pede o zero na frente), e = 65537
        assert_eq!(
            rsa_der(&[0x80], &[1, 0, 1]),
            vec![
                0x30, 0x09, 0x02, 0x02, 0x00, 0x80, 0x02, 0x03, 0x01, 0x00, 0x01
            ]
        );
    }
}
