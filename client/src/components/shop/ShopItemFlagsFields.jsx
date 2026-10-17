// Campos da vitrine no editor da staff (molduras, efeitos, fontes e estilos):
// descrição, destaque, exclusividade de apoio, desconto de Assinante e
// estoque de item limitado.
// O servidor valida tudo de novo (ver shopController.readShopFlags).
export const FLAGS_EMPTY = { description: '', featured: false, exclusiveTier: '', discountEligible: true, stock: '', tags: '', color: '', variantGroup: '' };
// Filtros da Loja (iguais aos do servidor — shopController SHOP_TAGS/SHOP_COLORS).
export const SHOP_TAGS = [
  ['anime', 'Anime'], ['jogos', 'Jogos'], ['fofo', 'Fofo e aconchegante'], ['scifi', 'Ficção científica'], ['comida', 'Comida e bebidas'],
  ['fantasia', 'Fantasia'], ['animais', 'Animais'], ['natureza', 'Natureza'], ['filmes', 'Filmes e TV'], ['dark', 'Dark e taciturno'],
  ['terror', 'Terror'], ['esportes', 'Esportes'], ['musica', 'Música'], ['parceria', 'Parcerias'],
];
export const SHOP_COLORS = [
  ['roxo', '#8b5cf6'], ['azul', '#3b82f6'], ['verde', '#22c55e'], ['marrom', '#92400e'], ['amarelo', '#eab308'],
  ['laranja', '#f97316'], ['vermelho', '#ef4444'], ['rosa', '#ec4899'], ['branco', '#f4f4f5'], ['preto', '#18181b'],
];
export const flagsFrom = (d) => ({
  description: d?.description || '', featured: !!d?.featured,
  exclusiveTier: d?.exclusiveTier || '', discountEligible: d?.discountEligible !== false,
  stock: d?.stock ?? '', sold: d?.sold ?? 0,
  tags: Array.isArray(d?.tags) ? d.tags.join(',') : d?.tags || '', color: d?.color || '', variantGroup: d?.variantGroup || '',
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
      <div className="shopadm-filters">
        <span>Temas (filtro da Loja)</span>
        <div className="shopadm-tagpick">
          {SHOP_TAGS.map(([k, l]) => {
            const list = String(form.tags || '').split(',').filter(Boolean);
            const on = list.includes(k);
            return (
              <button key={k} type="button" className={on ? 'on' : ''} aria-pressed={on}
                onClick={() => set('tags')({ target: { value: (on ? list.filter((x) => x !== k) : [...list, k]).join(',') } })}
              >{l}</button>
            );
          })}
        </div>
        <span>Cor principal</span>
        <div className="shopadm-colorpick">
          <button type="button" className={!form.color ? 'on none' : 'none'} onClick={() => set('color')({ target: { value: '' } })} title="Sem cor">∅</button>
          {SHOP_COLORS.map(([k, hex]) => (
            <button key={k} type="button" className={form.color === k ? 'on' : ''} style={{ background: hex }} title={k} aria-label={k} onClick={() => set('color')({ target: { value: k } })} />
          ))}
        </div>
        <label>Grupo de variantes (mesmo nome = o mesmo item em cores diferentes)
          <input value={form.variantGroup || ''} onChange={set('variantGroup')} maxLength={64} placeholder="Ex.: lua-negra" />
        </label>
      </div>
    </fieldset>
  );
}
