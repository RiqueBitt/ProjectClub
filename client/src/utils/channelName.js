// Limpeza leve de nomes de canal/categoria (espelha
// server/src/utils/channelNames.js): maiúsculas e espaços normais valem;
// só tira caracteres de controle, junta espaços repetidos e apara as pontas.
export const CHANNEL_NAME_MAX = 100;

export function cleanChannelName(value) {
  return Array.from(
    String(value || '')
      .replace(/[\r\n\t]+/g, ' ')
      .replace(/[\p{Cc}\p{Cf}]/gu, (ch) => (ch === '‍' ? ch : ''))
      .replace(/\s+/g, ' ')
      .trim(),
  ).slice(0, CHANNEL_NAME_MAX).join('').trim();
}
