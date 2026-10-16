// Campos da vitrine no editor da staff (molduras, efeitos, fontes e estilos):
// descrição, destaque, exclusividade de apoio, desconto de Assinante e
// estoque de item limitado.
// O servidor valida tudo de novo (ver shopController.readShopFlags).
export const FLAGS_EMPTY = { description: '', featured: false, exclusiveTier: '', discountEligible: true, stock: '' };
export const flagsFrom = (d) => ({
  description: d?.description || '', featured: !!d?.featured,
  exclusiveTier: d?.exclusiveTier || '', discountEligible: d?.discountEligible !== false,
  stock: d?.stock ?? '', sold: d?.sold ?? 0,
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
      <label>Item limitado — estoque total (vazio = ilimitado)
        <input type="number" min="0" value={form.stock} onChange={set('stock')} placeholder="Ex.: 100 cópias" />
      </label>
      {String(form.stock || '') !== '' && Number(form.stock) > 0 && (
        <small className="shop-muted">
          Limitado: cada cópia vendida ganha um número (#1, #2…), fica fora dos pacotes de coleção e pode ser trocada entre jogadores.
          {form.sold > 0 ? ` Já vendidas: ${form.sold} (o estoque não pode ficar abaixo disso).` : ''}
        </small>
      )}
    </fieldset>
  );
}
