// Campos da sala branca no editor da staff (molduras e efeitos):
// descrição, destaque, exclusividade de apoio e desconto de Assinante.
// O servidor valida tudo de novo (ver shopController.readShopFlags).
export const FLAGS_EMPTY = { description: '', featured: false, exclusiveTier: '', discountEligible: true };
export const flagsFrom = (d) => ({
  description: d?.description || '', featured: !!d?.featured,
  exclusiveTier: d?.exclusiveTier || '', discountEligible: d?.discountEligible !== false,
});

export default function ShopItemFlagsFields({ form, set }) {
  const exclusive = !!form.exclusiveTier;
  return (
    <fieldset className="shopadm-flags">
      <legend>Vitrine e apoio</legend>
      <label>Descrição (aparece no card e no detalhe)
        <textarea value={form.description} onChange={set('description')} maxLength={400} rows={2} placeholder="Ex.: Para quem chega pegando fogo no chat." />
      </label>
      <label>Disponibilidade
        <select value={form.exclusiveTier} onChange={set('exclusiveTier')}>
          <option value="">À venda para todos</option>
          <option value="SUBSCRIBER">Exclusivo de Assinante (Super também recebe)</option>
          <option value="SUPER">Exclusivo de Super Assinante</option>
        </select>
      </label>
      {exclusive && <small className="shop-muted">Exclusivos não são vendidos nem presenteados: ficam liberados automaticamente enquanto a pessoa tiver a categoria. Os preços são ignorados.</small>}
      <div className="deco-row">
        <label className="deco-check"><input type="checkbox" checked={form.featured} onChange={set('featured')} /> Em destaque na Loja</label>
        <label className="deco-check"><input type="checkbox" checked={form.discountEligible} onChange={set('discountEligible')} disabled={exclusive} /> Desconto de Assinante (15%)</label>
      </div>
    </fieldset>
  );
}
