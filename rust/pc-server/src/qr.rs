//! QR Code em PNG (`data:image/png;base64,...`) — como o `qrcode.toDataURL`
//! do Node na tela de ativar o 2FA: correção M, margem de 4 módulos, 4
//! pixels por módulo, preto no branco.

use base64::Engine;
use qrcode::{EcLevel, QrCode};

const MARGIN: usize = 4;
const SCALE: usize = 4;

pub fn data_url(text: &str) -> anyhow::Result<String> {
    let code = QrCode::with_error_correction_level(text.as_bytes(), EcLevel::M)?;
    let n = code.width();
    let colors = code.to_colors();
    let side = (n + 2 * MARGIN) * SCALE;
    let mut pixels = vec![255u8; side * side];
    for y in 0..n {
        for x in 0..n {
            if colors[y * n + x] == qrcode::Color::Dark {
                for dy in 0..SCALE {
                    let row = ((y + MARGIN) * SCALE + dy) * side;
                    for dx in 0..SCALE {
                        pixels[row + (x + MARGIN) * SCALE + dx] = 0;
                    }
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
