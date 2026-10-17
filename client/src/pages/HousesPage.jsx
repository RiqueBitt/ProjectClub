import { useEffect, useRef, useState } from 'react';
import {
  listHouseCatalog, buyHouse, listFurnitureCatalog, buyFurniture,
  listMyHouses, getHouseLayout, setActiveHouse, saveHouseLayout, getHouseGallery,
  listMapBackgrounds, setHouseMapBackground, buyMapBackground,
} from '../api/endpoints';
import UserAvatar from '../components/UserAvatar.jsx';
import HouseIcon from '../components/HouseIcon.jsx';
import { Ico, PageHero, PillTabs, EmptyState, Skeleton, Toast, Unavailable, Price } from '../components/PagesKit.jsx';
import '../styles/houses.css';
import { useLiveRefresh } from '../utils/liveRefresh';

const TABS = ['DECORAR', 'LOJA', 'GALERIA'];
const TAB_LABEL = { DECORAR: 'Decorar', LOJA: 'Imobiliária', GALERIA: 'Galeria' };
const TAB_ICON = { DECORAR: 'sofa', LOJA: 'store', GALERIA: 'image' };

function fmt(n) { return Math.floor(Number(n) || 0).toLocaleString('pt-BR'); }

export default function HousesPage() {
  const [tab, setTab] = useState('DECORAR');
  const [myHouses, setMyHouses] = useState(null);
  const [notice, setNotice] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const pushNotice = (msg) => { setNotice(msg); setTimeout(() => setNotice(null), 4000); };

  const refreshMyHouses = () => listMyHouses().then((d) => setMyHouses(d.houses)).catch((err) => {
    if (err?.response?.status === 503) setUnavailable(true);
  });
  useEffect(() => { refreshMyHouses(); }, []);

  // Tempo real (11s): lista das minhas casas, em silêncio.
  useLiveRefresh(({ put }) => listMyHouses().then((d) => put(setMyHouses)(d.houses)), { enabled: !unavailable });

  if (unavailable) return <Unavailable icon="house" />;

  const active = myHouses?.find((h) => h.isActive);

  return (
    <div className="pk-page hs">
      <div className="pk-inner">
        <PageHero
          icon="house" eyebrow="Seu cantinho" title="Casas"
          desc="Compre casas na Imobiliária, decore com móveis arrastando no quadro e mostre o resultado na Galeria."
          aside={myHouses && (
            <div className="hs-hero-stats">
              <div><small>Casas</small><strong>{myHouses.length}</strong></div>
              <div><small>Casa ativa</small><strong className="truncate">{active?.house?.name || '—'}</strong></div>
            </div>
          )}
        />
        <PillTabs
          label="Seções das casas" value={tab} onChange={setTab}
          tabs={TABS.map((t) => ({ id: t, label: TAB_LABEL[t], icon: TAB_ICON[t] }))}
        />

        {tab === 'DECORAR' && <DecorateTab myHouses={myHouses} onChanged={refreshMyHouses} pushNotice={pushNotice} goShop={() => setTab('LOJA')} />}
        {tab === 'LOJA' && <ShopTab onChanged={refreshMyHouses} pushNotice={pushNotice} />}
        {tab === 'GALERIA' && <GalleryTab />}
      </div>
      <Toast>{notice}</Toast>
    </div>
  );
}

function HouseSurface({ backgroundColor, backgroundImageUrl, items, width = 1000, height = 632, houseSprite, houseGroup, children }) {
  return (
    <div
      className="house-surface"
      style={{
        background: backgroundColor,
        backgroundImage: backgroundImageUrl ? `url(${backgroundImageUrl})` : undefined,
        backgroundSize: 'cover', backgroundPosition: 'center',
        aspectRatio: `${width} / ${height}`, position: 'relative', overflow: 'hidden', borderRadius: 16, border: '1px solid var(--border)', width: '100%', maxWidth: width,
      }}
    >
      {/* Casa com grupo (igual o bot Robbie tinha): a "imagem da casa"
          (sprite, sem fundo próprio) aparece por cima do mapa, na posição
          fixa que a staff configurou pro grupo dela — várias casas do
          catálogo no mesmo grupo compartilham essa mesma vaga visual. */}
      {houseSprite && houseGroup && (
        <img
          src={houseSprite}
          alt=""
          draggable={false}
          style={{
            position: 'absolute', left: `${(houseGroup.x / width) * 100}%`, top: `${(houseGroup.y / height) * 100}%`,
            width: `${(houseGroup.width / width) * 100}%`, height: `${(houseGroup.height / height) * 100}%`,
            zIndex: 0, pointerEvents: 'none',
          }}
        />
      )}
      {items.map((it) => (
        <img
          key={it.id}
          src={it.furniture.imageUrl}
          alt={it.furniture.name}
          draggable={false}
          style={{
            position: 'absolute', left: `${(it.x / width) * 100}%`, top: `${(it.y / height) * 100}%`,
            width: `${(it.width / width) * 100}%`, height: `${(it.height / height) * 100}%`, zIndex: it.zIndex, pointerEvents: 'none',
            transform: it.flipped ? 'scaleX(-1)' : undefined,
          }}
        />
      ))}
      {children}
    </div>
  );
}

function pointFromEvent(e) {
  if (e.touches && e.touches[0]) return { clientX: e.touches[0].clientX, clientY: e.touches[0].clientY };
  if (e.changedTouches && e.changedTouches[0]) return { clientX: e.changedTouches[0].clientX, clientY: e.changedTouches[0].clientY };
  return { clientX: e.clientX, clientY: e.clientY };
}

function DecorateTab({ myHouses, onChanged, pushNotice, goShop }) {
  const [houseId, setHouseId] = useState(null);
  const [layout, setLayout] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [maps, setMaps] = useState([]);
  const [mapPickerOpen, setMapPickerOpen] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [saving, setSaving] = useState(false);
  const surfaceRef = useRef(null);
  const dragState = useRef(null);

  useEffect(() => {
    if (myHouses?.length && !houseId) setHouseId(myHouses.find((h) => h.isActive)?.houseId || myHouses[0].houseId);
  }, [myHouses]);

  useEffect(() => {
    if (!houseId) return;
    getHouseLayout(houseId).then((d) => setLayout(d.userHouse));
    listFurnitureCatalog().then((d) => setInventory(d.categories));
  }, [houseId]);

  useEffect(() => { listMapBackgrounds().then((d) => setMaps(d.maps)); }, []);

  // Tempo real (11s): só catálogo/inventário e mapas — o layout é o
  // rascunho sendo arrastado, não pode ser sobrescrito no meio.
  useLiveRefresh(async ({ put }) => {
    await Promise.allSettled([
      houseId ? listFurnitureCatalog().then((d) => put(setInventory)(d.categories)) : null,
      listMapBackgrounds().then((d) => put(setMaps)(d.maps)),
    ]);
  });

  const pickMap = async (mapBackgroundId) => {
    const { userHouse } = await setHouseMapBackground(houseId, mapBackgroundId);
    setLayout((l) => ({ ...l, mapBackground: userHouse.mapBackground }));
    setMapPickerOpen(false);
  };

  const buyMap = async (map) => {
    if (!confirm(`Comprar o fundo "${map.name}" por ${map.price} moedas?`)) return;
    try {
      await buyMapBackground(map.id);
      setMaps((prev) => prev.map((m) => (m.id === map.id ? { ...m, owned: true } : m)));
      pushNotice(`Fundo "${map.name}" comprado!`);
    } catch (err) {
      pushNotice(err.response?.data?.error || 'Não foi possível comprar.');
    }
  };

  if (myHouses === null) return <DecorateSkeleton />;
  if (myHouses.length === 0) {
    return (
      <EmptyState
        icon="house" title="Você ainda não tem nenhuma casa"
        text="Vá até a aba Imobiliária para comprar uma!"
        action={<button className="pk-btn primary" onClick={goShop}><Ico name="store" size={17} /> Ir pra Imobiliária</button>}
      />
    );
  }
  if (!layout) return <DecorateSkeleton />;

  const items = layout.items;
  const refWidth = layout.house.groupId != null && layout.mapBackground ? layout.mapBackground.width : layout.house.width;
  const refHeight = layout.house.groupId != null && layout.mapBackground ? layout.mapBackground.height : layout.house.height;

  const addItem = (furniture) => {
    const newItem = {
      id: `new-${Date.now()}-${Math.random()}`, furniture,
      furnitureId: furniture.id, x: 20, y: 20, width: furniture.width, height: furniture.height,
      zIndex: items.length ? Math.max(...items.map((i) => i.zIndex)) + 1 : 0,
    };
    setLayout({ ...layout, items: [...items, newItem] });
  };

  const removeSelected = () => {
    if (!selectedId) return;
    setLayout({ ...layout, items: items.filter((i) => i.id !== selectedId) });
    setSelectedId(null);
  };

  const bumpLayer = (dir) => {
    if (!selectedId) return;
    setLayout({
      ...layout,
      items: items.map((i) => (i.id === selectedId ? { ...i, zIndex: i.zIndex + dir } : i)),
    });
  };

  // Redimensiona mantendo a proporção original do móvel (não deixa
  // espichar/achatar), com um piso mínimo pra não sumir de vista.
  const resizeSelected = (factor) => {
    if (!selectedId) return;
    setLayout({
      ...layout,
      items: items.map((i) => (i.id === selectedId
        ? { ...i, width: Math.max(20, Math.round(i.width * factor)), height: Math.max(20, Math.round(i.height * factor)) }
        : i)),
    });
  };

  const flipSelected = () => {
    if (!selectedId) return;
    setLayout({ ...layout, items: items.map((i) => (i.id === selectedId ? { ...i, flipped: !i.flipped } : i)) });
  };

  // Usa o tamanho REAL renderizado do quadro (via getBoundingClientRect) pra
  // converter posição do ponteiro em coordenadas de referência da casa —
  // funciona em qualquer tamanho de tela sem precisar de uma "escala" fixa,
  // e os mesmos handlers servem tanto pra mouse quanto pra toque (celular).
  const onItemPointerDown = (e, item) => {
    e.stopPropagation();
    setSelectedId(item.id);
    const rect = surfaceRef.current.getBoundingClientRect();
    const { clientX, clientY } = pointFromEvent(e);
    const scaleX = refWidth / rect.width;
    const scaleY = refHeight / rect.height;
    dragState.current = {
      id: item.id,
      offsetX: (clientX - rect.left) * scaleX - item.x,
      offsetY: (clientY - rect.top) * scaleY - item.y,
    };
  };

  const onSurfacePointerMove = (e) => {
    if (!dragState.current) return;
    if (e.touches) e.preventDefault();
    const rect = surfaceRef.current.getBoundingClientRect();
    const { clientX, clientY } = pointFromEvent(e);
    const scaleX = refWidth / rect.width;
    const scaleY = refHeight / rect.height;
    // Bug corrigido: lia dragState.current.id de dentro do updater do
    // setLayout, que o React só chama depois (às vezes só depois do
    // mouseup seguinte já ter zerado dragState.current) — quebrava com
    // "Cannot read properties of null" ao mover um móvel rápido. Captura o
    // ID aqui fora, de forma síncrona, antes que o ref possa mudar.
    const draggedId = dragState.current.id;
    const x = Math.max(0, Math.round((clientX - rect.left) * scaleX - dragState.current.offsetX));
    const y = Math.max(0, Math.round((clientY - rect.top) * scaleY - dragState.current.offsetY));
    setLayout((l) => ({ ...l, items: l.items.map((i) => (i.id === draggedId ? { ...i, x, y } : i)) }));
  };

  const onSurfacePointerUp = () => { dragState.current = null; };

  const save = async () => {
    setSaving(true);
    try {
      await saveHouseLayout(houseId, items.map((i) => ({
        furnitureId: i.furnitureId || i.furniture.id, x: i.x, y: i.y, width: i.width, height: i.height, zIndex: i.zIndex, flipped: !!i.flipped,
      })));
      pushNotice('Casa salva! Ela virou sua casa ativa.');
      onChanged();
      getHouseLayout(houseId).then((d) => setLayout(d.userHouse));
    } catch (err) {
      pushNotice(err.response?.data?.error || 'Não foi possível salvar.');
    } finally {
      setSaving(false);
    }
  };

  const selected = items.find((i) => i.id === selectedId);

  const owned = inventory?.filter((cat) => cat.items.some((it) => it.ownedQuantity > 0)) || [];

  return (
    <div className="hs-decorate">
      <div className="hs-editor">
        <div className="hs-switcher">
          <div className="hs-house-chips" role="list">
            {myHouses.map((h) => (
              <button key={h.houseId} role="listitem" className={`hs-house-chip ${houseId === h.houseId ? 'active' : ''}`} onClick={() => setHouseId(h.houseId)}>
                <HouseIcon color={h.house.backgroundColor} size={22} />
                <span className="truncate">{h.house.name}</span>
                {h.isActive && <span className="hs-active-dot" title="Casa ativa" />}
              </button>
            ))}
          </div>
          <button className={`pk-btn sm hs-bg-btn ${mapPickerOpen ? 'on' : ''}`} onClick={() => setMapPickerOpen((v) => !v)} aria-expanded={mapPickerOpen}>
            <Ico name="image" size={16} /> <span className="truncate">Fundo{layout?.mapBackground ? `: ${layout.mapBackground.name}` : ''}</span>
          </button>
        </div>
        {mapPickerOpen && (
          <div className="map-picker hs-map-picker">
            {!layout?.house?.groupId && (
              <button className={`map-picker-option ${!layout?.mapBackground ? 'active' : ''}`} onClick={() => pickMap(null)}>
                <div className="map-picker-swatch" style={{ background: layout?.house.backgroundColor }} />
                <span>Cor padrão</span>
              </button>
            )}
            {maps.map((m) => (
              <button
                key={m.id}
                className={`map-picker-option ${layout?.mapBackground?.id === m.id ? 'active' : ''} ${!m.owned ? 'locked' : ''}`}
                onClick={() => (m.owned ? pickMap(m.id) : buyMap(m))}
              >
                <span className="hs-map-thumb">
                  <img className="map-picker-swatch" src={m.imageUrl} alt="" />
                  {!m.owned && <span className="hs-map-lock"><Ico name="lock" size={14} /></span>}
                </span>
                <span className="truncate">{m.name}</span>
                {!m.owned && <span className="map-picker-price"><Price value={m.price} /></span>}
              </button>
            ))}
          </div>
        )}
        <div
          ref={surfaceRef}
          className="hs-surface-wrap"
          onMouseMove={onSurfacePointerMove}
          onMouseUp={onSurfacePointerUp}
          onMouseLeave={onSurfacePointerUp}
          onTouchMove={onSurfacePointerMove}
          onTouchEnd={onSurfacePointerUp}
          onClick={() => setSelectedId(null)}
        >
          <HouseSurface
            backgroundColor={layout.house.backgroundColor}
            backgroundImageUrl={layout.mapBackground?.imageUrl}
            items={[]}
            width={refWidth}
            height={refHeight}
            houseSprite={layout.house.groupId != null ? layout.house.imageUrl : null}
            houseGroup={layout.house.group}
          >
            {items.map((it) => (
              <img
                key={it.id}
                src={it.furniture.imageUrl}
                alt={it.furniture.name}
                draggable={false}
                onMouseDown={(e) => onItemPointerDown(e, it)}
                onTouchStart={(e) => onItemPointerDown(e, it)}
                style={{
                  position: 'absolute', left: `${(it.x / refWidth) * 100}%`, top: `${(it.y / refHeight) * 100}%`,
                  width: `${(it.width / refWidth) * 100}%`, height: `${(it.height / refHeight) * 100}%`, zIndex: it.zIndex,
                  cursor: 'grab', outline: selectedId === it.id ? '2px solid var(--brand)' : 'none', outlineOffset: 2, borderRadius: 4, touchAction: 'none',
                  transform: it.flipped ? 'scaleX(-1)' : undefined,
                }}
              />
            ))}
          </HouseSurface>
          {items.length === 0 && <span className="hs-surface-hint">Clique num móvel ao lado pra colocar na casa</span>}
        </div>
        <div className="hs-toolbar">
          <div className={`hs-tools ${selected ? 'on' : ''}`} role="toolbar" aria-label="Móvel selecionado">
            <span className="hs-tools-label">{selected ? selected.furniture.name : 'Selecione um móvel'}</span>
            <button className="pk-btn sm icon" title="Trazer p/ frente" aria-label="Trazer p/ frente" disabled={!selected} onClick={() => bumpLayer(1)}><Ico name="up" size={16} /></button>
            <button className="pk-btn sm icon" title="Mandar p/ trás" aria-label="Mandar p/ trás" disabled={!selected} onClick={() => bumpLayer(-1)}><Ico name="down" size={16} /></button>
            <button className="pk-btn sm icon" title="Aumentar" aria-label="Aumentar" disabled={!selected} onClick={() => resizeSelected(1.15)}><Ico name="plus" size={16} /></button>
            <button className="pk-btn sm icon" title="Diminuir" aria-label="Diminuir" disabled={!selected} onClick={() => resizeSelected(0.87)}><Ico name="minus" size={16} /></button>
            <button className="pk-btn sm icon" title="Virar" aria-label="Virar" disabled={!selected} onClick={flipSelected}><Ico name="flip" size={16} /></button>
            <button className="pk-btn sm icon danger" title="Remover" aria-label="Remover" disabled={!selected} onClick={removeSelected}><Ico name="trash" size={16} /></button>
          </div>
          <div className="hs-save">
            {houseId !== myHouses.find((h) => h.isActive)?.houseId && (
              <button className="pk-btn" onClick={async () => { await setActiveHouse(houseId); onChanged(); pushNotice('Casa ativa alterada.'); }}>
                <Ico name="star" size={16} /> Tornar ativa
              </button>
            )}
            <button className="pk-btn primary" onClick={save} disabled={saving}><Ico name="save" size={16} /> {saving ? 'Salvando...' : 'Salvar casa'}</button>
          </div>
        </div>
      </div>

      <aside className="pk-card hs-inventory">
        <h2 className="pk-section-title"><Ico name="sofa" /> Seus móveis</h2>
        {!inventory && <Skeleton rows={6} height={56} grid />}
        {owned.map((cat) => (
          <div key={cat.id} className="hs-inv-cat">
            <div className="hs-inv-cat-name">{cat.name}</div>
            <div className="hs-inv-grid">
              {cat.items.filter((it) => it.ownedQuantity > 0).map((it) => (
                <button key={it.id} className="hs-inv-item" title={`${it.name} (${it.ownedQuantity}x)`} onClick={() => addItem(it)}>
                  <img src={it.imageUrl} alt="" />
                  <span className="hs-inv-qty">{it.ownedQuantity}</span>
                </button>
              ))}
            </div>
          </div>
        ))}
        {inventory && inventory.every((cat) => cat.items.every((it) => it.ownedQuantity === 0)) && (
          <EmptyState compact icon="sofa" text="Você ainda não tem móveis — compre na Imobiliária." />
        )}
      </aside>
    </div>
  );
}

function DecorateSkeleton() {
  return (
    <div className="hs-decorate">
      <div className="hs-editor"><Skeleton rows={1} height={36} /><Skeleton rows={1} height={420} /></div>
      <Skeleton rows={1} height={460} />
    </div>
  );
}

function ShopTab({ onChanged, pushNotice }) {
  const [section, setSection] = useState('HOUSES');
  const [houses, setHouses] = useState([]);
  const [furniture, setFurniture] = useState([]);
  const [furnitureCategory, setFurnitureCategory] = useState(null);
  const [maps, setMaps] = useState([]);

  const refresh = () => {
    listHouseCatalog().then((d) => setHouses(d.houses));
    listFurnitureCatalog().then((d) => {
      setFurniture(d.categories);
      setFurnitureCategory((prev) => prev || d.categories[0]?.id || null);
    });
    listMapBackgrounds().then((d) => setMaps(d.maps));
  };
  useEffect(() => { refresh(); }, []);

  // Tempo real (11s): catálogo da loja (preços/estoque/novos itens).
  useLiveRefresh(async ({ put }) => {
    await Promise.allSettled([
      listHouseCatalog().then((d) => put(setHouses)(d.houses)),
      listFurnitureCatalog().then((d) => put(setFurniture)(d.categories)),
      listMapBackgrounds().then((d) => put(setMaps)(d.maps)),
    ]);
  });

  const doBuyHouse = async (h) => {
    try { await buyHouse(h.id); pushNotice(`Você comprou ${h.name}!`); refresh(); onChanged(); }
    catch (err) { pushNotice(err.response?.data?.error || 'Não foi possível comprar.'); }
  };
  const doBuyFurniture = async (it) => {
    try { await buyFurniture(it.id); pushNotice(`Você comprou ${it.name}!`); refresh(); }
    catch (err) { pushNotice(err.response?.data?.error || 'Não foi possível comprar.'); }
  };
  const doBuyMap = async (m) => {
    try { await buyMapBackground(m.id); pushNotice(`Fundo "${m.name}" comprado!`); refresh(); }
    catch (err) { pushNotice(err.response?.data?.error || 'Não foi possível comprar.'); }
  };

  const activeCategory = furniture.find((c) => c.id === furnitureCategory);

  return (
    <div className="hs-shop">
      <div className="hs-seg" role="tablist" aria-label="Seções da Imobiliária">
        {[['HOUSES', 'Casas', 'house'], ['FURNITURE', 'Móveis', 'sofa'], ['MAPS', 'Fundos', 'image']].map(([id, label, icon]) => (
          <button key={id} role="tab" aria-selected={section === id} className={`hs-seg-btn ${section === id ? 'active' : ''}`} onClick={() => setSection(id)}>
            <Ico name={icon} size={16} /> {label}
          </button>
        ))}
      </div>

      {section === 'HOUSES' && (
        houses.length === 0 ? <Skeleton rows={6} height={230} grid /> : (
          <div className="hs-grid">
            {houses.map((h) => (
              <article key={h.id} className={`hs-product ${h.owned ? 'owned' : ''}`}>
                <div className="hs-product-art" style={{ background: h.backgroundColor }}>
                  {h.imageUrl ? <img src={h.imageUrl} alt="" className="cover" /> : <HouseIcon color="#FFFFFF" size={64} />}
                  {h.owned && <span className="hs-owned-badge"><Ico name="check" size={13} strokeWidth={2.4} /> Sua</span>}
                </div>
                <div className="hs-product-body">
                  <h3 className="truncate">{h.name}</h3>
                  <Price value={h.price} />
                </div>
                <button className={`pk-btn block ${h.owned ? '' : 'primary'}`} disabled={h.owned} onClick={() => doBuyHouse(h)}>
                  {h.owned ? <><Ico name="check" size={16} /> Você já tem</> : 'Comprar'}
                </button>
              </article>
            ))}
          </div>
        )
      )}

      {section === 'FURNITURE' && (
        <div className="hs-shop-section">
          <div className="pk-filters">
            {furniture.map((cat) => (
              <button key={cat.id} className={`pk-filter ${furnitureCategory === cat.id ? 'active' : ''}`} onClick={() => setFurnitureCategory(cat.id)}>
                {cat.name}
              </button>
            ))}
          </div>
          {furniture.length === 0 ? <Skeleton rows={8} height={210} grid /> : (
            <div className="hs-grid compact">
              {activeCategory?.items.map((it) => (
                <article key={it.id} className="hs-product">
                  <div className="hs-product-art furniture">
                    <img src={it.imageUrl} alt="" />
                    {it.ownedQuantity > 0 && <span className="hs-owned-badge">Você tem {it.ownedQuantity}</span>}
                  </div>
                  <div className="hs-product-body">
                    <h3 className="truncate">{it.name}</h3>
                    <Price value={it.price} />
                  </div>
                  <button className="pk-btn primary block" onClick={() => doBuyFurniture(it)}>Comprar</button>
                </article>
              ))}
            </div>
          )}
        </div>
      )}

      {section === 'MAPS' && (
        maps.length === 0 ? <EmptyState icon="image" title="Nenhum fundo à venda" text="Novos fundos aparecem aqui quando a equipe adicionar." /> : (
          <div className="hs-grid wide">
            {maps.map((m) => (
              <article key={m.id} className={`hs-product ${m.owned ? 'owned' : ''}`}>
                <div className="hs-product-art map">
                  <img src={m.imageUrl} alt="" className="cover" />
                  {m.owned && <span className="hs-owned-badge"><Ico name="check" size={13} strokeWidth={2.4} /> Seu</span>}
                </div>
                <div className="hs-product-body">
                  <h3 className="truncate">{m.name}</h3>
                  <Price value={m.price} />
                </div>
                <button className={`pk-btn block ${m.owned ? '' : 'primary'}`} disabled={m.owned} onClick={() => doBuyMap(m)}>
                  {m.owned ? <><Ico name="check" size={16} /> Você já tem</> : 'Comprar'}
                </button>
              </article>
            ))}
          </div>
        )
      )}
    </div>
  );
}

function GalleryTab() {
  const [houses, setHouses] = useState(null);
  const [filterMapId, setFilterMapId] = useState('');
  useEffect(() => { getHouseGallery().then((d) => setHouses(d.houses)); }, []);

  // Tempo real (11s): galeria de casas.
  useLiveRefresh(({ put }) => getHouseGallery().then((d) => put(setHouses)(d.houses)), { enabled: houses !== null });

  if (houses === null) return <Skeleton rows={6} height={240} grid />;
  if (houses.length === 0) return <EmptyState icon="image" title="Galeria vazia" text="Ninguém decorou uma casa ainda." />;

  // Fundos usados por pelo menos uma casa aqui na Galeria — dá pra
  // filtrar só quem escolheu aquele mapa (casas com grupo, igual o bot
  // Robbie tinha, aparecem na posição fixa do grupo delas em cima dele).
  const usedMaps = [...new Map(houses.filter((h) => h.mapBackground).map((h) => [h.mapBackground.id, h.mapBackground])).values()];

  const visible = filterMapId ? houses.filter((h) => h.mapBackground?.id === filterMapId) : houses;

  return (
    <div className="hs-gallery-wrap">
      {usedMaps.length > 0 && (
        <div className="pk-filters">
          <button className={`pk-filter ${!filterMapId ? 'active' : ''}`} onClick={() => setFilterMapId('')}>Todas as casas</button>
          {usedMaps.map((m) => (
            <button key={m.id} className={`pk-filter ${filterMapId === m.id ? 'active' : ''}`} onClick={() => setFilterMapId(m.id)}>
              <Ico name="image" size={14} /> {m.name}
            </button>
          ))}
        </div>
      )}
      <div className="hs-gallery">
        {visible.map((h) => (
          <article key={h.id} className="hs-gallery-card">
            <HouseSurface
              backgroundColor={h.house.backgroundColor}
              backgroundImageUrl={h.mapBackground?.imageUrl}
              items={h.items}
              width={h.mapBackground ? h.mapBackground.width || h.house.width : h.house.width}
              height={h.mapBackground ? h.mapBackground.height || h.house.height : h.house.height}
              houseSprite={h.house.groupId != null ? h.house.imageUrl : null}
              houseGroup={h.house.group}
            />
            <div className="hs-gallery-foot">
              <UserAvatar user={h.user} size={28} />
              <div className="hs-gallery-who">
                <strong className="truncate">{h.user.displayName}</strong>
                <small className="truncate">{h.house.name}{h.mapBackground ? ` · ${h.mapBackground.name}` : ''}</small>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
