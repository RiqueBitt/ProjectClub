//! Código de 6 dígitos do app autenticador (TOTP, RFC 6238) — igual ao
//! `otplib` 13 que o Node usa: SHA-1, 6 dígitos, passo de 30 s, segredo em
//! base32 (aceita minúsculas; `=` no fim é erro, como no plugin do otplib),
//! segredo de pelo menos 10 bytes (`legacyGuardrails`) e tolerância de ±30 s.

use hmac::{Hmac, Mac};

const STEP: i64 = 30;
const MIN_SECRET_BYTES: usize = 10;

#[derive(Debug, PartialEq)]
pub enum TotpError {
    /// Segredo inválido (não é base32, tem `=`, ou é curto demais).
    Secret,
    /// `afterTimeStep` além da janela (o otplib lança erro nesse caso).
    AfterTimeStep,
}

/// Base32 (RFC 4648) sem `=`, maiúsculas ou minúsculas.
pub fn base32_decode(input: &str) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity(input.len() * 5 / 8);
    let (mut buf, mut bits) = (0u64, 0u32);
    for c in input.bytes() {
        let v = match c.to_ascii_uppercase() {
            b'A'..=b'Z' => c.to_ascii_uppercase() - b'A',
            b'2'..=b'7' => c - b'2' + 26,
            _ => return None,
        } as u64;
        buf = (buf << 5) | v;
        bits += 5;
        if bits >= 8 {
            bits -= 8;
            out.push((buf >> bits) as u8);
            buf &= (1 << bits) - 1;
        }
    }
    Some(out)
}

fn key(secret: &str) -> Result<Vec<u8>, TotpError> {
    let k = base32_decode(secret).ok_or(TotpError::Secret)?;
    if k.len() < MIN_SECRET_BYTES {
        return Err(TotpError::Secret);
    }
    Ok(k)
}

fn hotp(key: &[u8], counter: i64) -> String {
    let mut m = Hmac::<sha1::Sha1>::new_from_slice(key).expect("hmac aceita qualquer chave");
    m.update(&(counter as u64).to_be_bytes());
    let h = m.finalize().into_bytes();
    let off = (h[19] & 0x0f) as usize;
    let bin = (u32::from(h[off] & 0x7f) << 24)
        | (u32::from(h[off + 1]) << 16)
        | (u32::from(h[off + 2]) << 8)
        | u32::from(h[off + 3]);
    format!("{:06}", bin % 1_000_000)
}

/// O código de um momento (`epoch` em segundos).
pub fn generate(secret: &str, epoch: i64) -> Result<String, TotpError> {
    Ok(hotp(&key(secret)?, epoch.div_euclid(STEP)))
}

/// `verify({ secret, token, epochTolerance: 30, afterTimeStep })`: devolve o
/// passo (contador) aceito, ou `None` se o código não vale.
pub fn verify(
    secret: &str,
    token: &str,
    epoch: i64,
    after_step: Option<i64>,
) -> Result<Option<i64>, TotpError> {
    let key = key(secret)?;
    let min = (epoch - 30).max(0).div_euclid(STEP);
    let max = (epoch + 30).div_euclid(STEP);
    if after_step.is_some_and(|a| a > max) {
        return Err(TotpError::AfterTimeStep);
    }
    for counter in min..=max {
        if after_step.is_some_and(|a| counter <= a) {
            continue;
        }
        let code = hotp(&key, counter);
        if subtle::ConstantTimeEq::ct_eq(code.as_bytes(), token.as_bytes()).into() {
            return Ok(Some(counter));
        }
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn igual_ao_otplib_do_node() {
        let cases: Vec<(String, i64, String)> =
            serde_json::from_str(include_str!("../tests/fixtures/totp_node.json")).unwrap();
        assert!(!cases.is_empty());
        for (secret, epoch, code) in cases {
            assert_eq!(
                generate(&secret, epoch).unwrap(),
                code,
                "{secret} @ {epoch}"
            );
        }
    }

    #[test]
    fn janela_de_30s_e_sem_reuso() {
        let s = "JBSWY3DPEHPK3PXP";
        let code = generate(s, 1_795_200_000).unwrap();
        // código do passo anterior ainda vale 30 s depois (como o Node: delta -1)
        assert_eq!(
            verify(s, &code, 1_795_200_030, None).unwrap(),
            Some(59_840_000)
        );
        // mas não se esse passo já foi usado
        assert_eq!(
            verify(s, &code, 1_795_200_030, Some(59_840_000)).unwrap(),
            None
        );
        assert_eq!(verify(s, "000000", 1_795_200_030, None).unwrap(), None);
        assert_eq!(
            verify(s, &code, 1_795_200_030, Some(99_999_999_999)),
            Err(TotpError::AfterTimeStep)
        );
    }

    #[test]
    fn segredo_invalido() {
        assert_eq!(generate("JBSWY3DPEHPK3PXP====", 0), Err(TotpError::Secret));
        assert_eq!(generate("JBSWY3DP", 0), Err(TotpError::Secret)); // 5 bytes
        assert!(generate("jbswy3dpehpk3pxp", 0).is_ok());
    }
}
