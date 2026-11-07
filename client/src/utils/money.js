// Centavos -> "R$ 1.234,50" (sem centavos quando é valor redondo).
export function brl(cents) {
  const v = (Number(cents) || 0) / 100;
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: Number.isInteger(v) ? 0 : 2, maximumFractionDigits: 2 });
}
