//! QR Code em PNG (`data:image/png;base64,...`) — como o `qrcode.toDataURL`
//! do Node na tela de ativar o 2FA: correção M, margem de 4 módulos, 4
//! pixels por módulo, preto no branco.

use base64::Engine;
use qrcode::{EcLevel, QrCode};

/// Padrão do `qrcode.toDataURL(texto)` (tela do 2FA).
pub fn data_url(text: &str) -> anyhow::Result<String> {
    data_url_with(text, 4, None)
}

/// `qrcode.toDataURL(texto, { margin, width })`: com `width`, a imagem tem
/// exatamente essa largura (escala fracionária, como o `qrcode` do Node).
pub fn data_url_with(text: &str, margin: usize, width: Option<usize>) -> anyhow::Result<String> {
    let code = QrCode::with_error_correction_level(text.as_bytes(), EcLevel::M)?;
    let n = code.width();
    let colors = code.to_colors();
    let full = (n + 2 * margin) as f64;
    let scale = match width {
        Some(w) if w as f64 >= full => w as f64 / full,
        _ => 4.0,
    };
    let side = (full * scale).floor() as usize;
    let m = margin as f64 * scale;
    let mut pixels = vec![255u8; side * side];
    for i in 0..side {
        for j in 0..side {
            let (fi, fj) = (i as f64, j as f64);
            if fi >= m && fj >= m && fi < side as f64 - m && fj < side as f64 - m {
                let si = ((fi - m) / scale).floor() as usize;
                let sj = ((fj - m) / scale).floor() as usize;
                if si < n && sj < n && colors[si * n + sj] == qrcode::Color::Dark {
                    pixels[i * side + j] = 0;
                }
            }
        }
    }
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, side as u32, side as u32);
        enc.set_color(png::ColorType::Grayscale);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::Best);
        let mut w = enc.write_header()?;
        w.write_image_data(&pixels)?;
    }
    Ok(format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(out)
    ))
}

#[cfg(test)]
mod tests {
    #[test]
    fn gera_png() {
        let url = super::data_url(
            "otpauth://totp/Project%20Club:a%40b.com?secret=JBSWY3DPEHPK3PXP&issuer=Project%20Club",
        )
        .unwrap();
        assert!(url.starts_with("data:image/png;base64,iVBORw0KGgo"));
    }
}
