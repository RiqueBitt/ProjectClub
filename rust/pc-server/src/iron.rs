//! Selo do `iron-session` (formato `Fe26.2` do iron-webcrypto) — o cookie
//! `pcKeep` ("lembrar login") é selado assim pelo Node
//! (`server/src/services/sessionKeep.js`). O Rust abre e fecha o MESMO
//! formato, então um cookie criado por um vale no outro.
//!
//! `Fe26.2*<id>*<sal-cifra>*<iv>*<cifrado>*<expira-ms>*<sal-hmac>*<hmac>~2`
//! - chaves: PBKDF2-SHA1 (1 iteração, 32 bytes) da senha, com o sal em hex
//!   usado como texto;
//! - cifra: AES-256-CBC (PKCS#7); integridade: HMAC-SHA256;
//! - binários em base64url sem `=`; `~2` no fim é só a versão (fora do HMAC,
//!   ignorada ao abrir).

use aes::cipher::{BlockDecryptMut, BlockEncryptMut, KeyIvInit, block_padding::Pkcs7};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD as B64;
use hmac::{Hmac, Mac};
use rand::RngCore;
use sha2::Sha256;

const PREFIX: &str = "Fe26.2";
const SKEW_MS: i64 = 60_000;

fn derive(password: &str, salt: &str) -> [u8; 32] {
    let mut key = [0u8; 32];
    pbkdf2::pbkdf2_hmac::<sha1::Sha1>(password.as_bytes(), salt.as_bytes(), 1, &mut key);
    key
}

fn random_salt() -> String {
    let mut b = [0u8; 32];
    rand::rng().fill_bytes(&mut b);
    hex::encode(b)
}

fn mac(password: &str, salt: &str, base: &str) -> Vec<u8> {
    let mut m = Hmac::<Sha256>::new_from_slice(&derive(password, salt))
        .expect("hmac aceita qualquer chave");
    m.update(base.as_bytes());
    m.finalize().into_bytes().to_vec()
}

/// Sela `json` com a senha de id `id`, valendo `ttl_secs` (como `sealData`).
pub fn seal(json: &str, id: &str, password: &str, ttl_secs: u64, now_ms: i64) -> String {
    let enc_salt = random_salt();
    let mut iv = [0u8; 16];
    rand::rng().fill_bytes(&mut iv);
    let encrypted =
        cbc::Encryptor::<aes::Aes256>::new(&derive(password, &enc_salt).into(), &iv.into())
            .encrypt_padded_vec_mut::<Pkcs7>(json.as_bytes());
    let expiration = now_ms + (ttl_secs as i64) * 1000;
    let base = format!(
        "{PREFIX}*{id}*{enc_salt}*{}*{}*{expiration}",
        B64.encode(iv),
        B64.encode(&encrypted)
    );
    let hmac_salt = random_salt();
    let digest = B64.encode(mac(password, &hmac_salt, &base));
    format!("{base}*{hmac_salt}*{digest}~2")
}

/// Abre um selo (como `unsealData`). `None` = inválido, vencido ou senha errada.
/// `passwords`: `(id, senha)` aceitos.
pub fn unseal(sealed: &str, passwords: &[(&str, &str)], now_ms: i64) -> Option<String> {
    let sealed = sealed.split('~').next()?;
    let parts: Vec<&str> = sealed.split('*').collect();
    let [
        prefix,
        id,
        enc_salt,
        iv,
        encrypted,
        expiration,
        hmac_salt,
        digest,
    ] = parts.as_slice()
    else {
        return None;
    };
    if *prefix != PREFIX {
        return None;
    }
    if !expiration.is_empty() {
        if !expiration.starts_with(|c: char| ('1'..='9').contains(&c))
            || !expiration.bytes().all(|b| b.is_ascii_digit())
        {
            return None;
        }
        let exp: i64 = expiration.parse().ok()?;
        if exp <= now_ms - SKEW_MS {
            return None;
        }
    }
    let wanted = if id.is_empty() { "default" } else { id };
    let password = passwords
        .iter()
        .find(|(pid, _)| *pid == wanted)
        .map(|(_, p)| *p)?;
    let base = format!("{prefix}*{id}*{enc_salt}*{iv}*{encrypted}*{expiration}");
    let expected = mac(password, hmac_salt, &base);
    let given = B64.decode(digest).ok()?;
    if !bool::from(subtle::ConstantTimeEq::ct_eq(
        expected.as_slice(),
        given.as_slice(),
    )) {
        return None;
    }
    let iv: [u8; 16] = B64.decode(iv).ok()?.try_into().ok()?;
    let plain = cbc::Decryptor::<aes::Aes256>::new(&derive(password, enc_salt).into(), &iv.into())
        .decrypt_padded_vec_mut::<Pkcs7>(&B64.decode(encrypted).ok()?)
        .ok()?;
    String::from_utf8(plain).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    const PW: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn fecha_e_abre() {
        let s = seal(r#"{"uid":"u1"}"#, "1", PW, 60, 1_000);
        assert!(s.starts_with("Fe26.2*1*") && s.ends_with("~2"));
        assert_eq!(
            unseal(&s, &[("1", PW)], 1_000).as_deref(),
            Some(r#"{"uid":"u1"}"#)
        );
        assert_eq!(
            unseal(
                &s,
                &[("1", "outra-senha-com-32-caracteres-ou-mais!!")],
                1_000
            ),
            None
        );
        assert_eq!(unseal(&s, &[("2", PW)], 1_000), None);
        // venceu em 61 s, com 60 s de folga: ainda vale em 120 s, não em 121 s
        assert!(unseal(&s, &[("1", PW)], 120_999).is_some());
        assert!(unseal(&s, &[("1", PW)], 121_000).is_none());
    }

    #[test]
    fn mexer_no_selo_invalida() {
        let s = seal(r#"{"uid":"u1"}"#, "1", PW, 60, 0);
        let mut parts: Vec<String> = s.split('*').map(String::from).collect();
        parts[5] = "99999999999999".into(); // estender o vencimento
        assert_eq!(unseal(&parts.join("*"), &[("1", PW)], 0), None);
    }

    #[test]
    fn abre_selo_feito_pelo_node() {
        // sealData({ uid: 'u1', iat: 1, rid: 'r1' }, { password: PW, ttl: 3153600000 }) no iron-session 9
        let from_node = include_str!("../tests/fixtures/iron_node_seal.txt").trim();
        assert_eq!(
            unseal(from_node, &[("1", PW)], 1_795_000_000_000).as_deref(),
            Some(r#"{"uid":"u1","iat":1,"rid":"r1"}"#)
        );
    }
}
