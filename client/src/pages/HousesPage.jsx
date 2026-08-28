import { useEffect, useRef, useState } from 'react';
import {
  listHouseCatalog, buyHouse, listFurnitureCatalog, buyFurniture,
  listMyHouses, getHouseLayout, setActiveHouse, saveHouseLayout, getHouseGallery,
  listMapBackgrounds, setHouseMapBackground, buyMapBackground,
} from '../api/endpoints';
import UserAvatar from '../components/UserAvatar.jsx';
import HouseIcon from '../components/HouseIcon.jsx';
import SystemUnavailable from '../components/SystemUnavailable.jsx';

const TABS = ['DECORAR', 'LOJA', 'GALERIA'];
const TAB_LABEL = { DECORAR: '🏠 Decorar', LOJA: '🛍️ Imobiliária', GALERIA: '🖼️ Galeria' };

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

  if (unavailable) return <SystemUnavailable icon="🧊" />;

  return (
    <div className="economy-page">
      <div className="economy-header"><h1>🧊 Casas</h1></div>
      <div className="mod-tabs">
        {TABS.map((t) => (
          <button key={t} className={`mod-tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>{TAB_LABEL[t]}</button>
        ))}
      </div>
      {notice && <div className="economy-notice">{notice}</div>}

      {tab === 'DECORAR' && <DecorateTab myHouses={myHouses} onChanged={refreshMyHouses} pushNotice={pushNotice} />}
      {tab === 'LOJA' && <ShopTab onChanged={refreshMyHouses} pushNotice={pushNotice} />}
      {tab === 'GALERIA' && <GalleryTab />}
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

function DecorateTab({ myHouses, onChanged, pushNotice }) {
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

  const pickMap = async (mapBackgroundId) => {
    const { userHouse } = await setHouseMapBackground(houseId, mapBackgroundId);
    setLayout((l) => ({ ...l, mapBackground: userHouse.mapBackground }));
    setMapPickerOpen(false);
  };

  const buyMap = async (map) => {
    if (!confirm(`Comprar o fundo "${map.name}" por 🪙 ${map.price}?`)) return;
    try {
      await buyMapBackground(map.id);
      setMaps((prev) => prev.map((m) => (m.id === map.id ? { ...m, owned: true } : m)));
      pushNotice(`Fundo "${map.name}" comprado!`);
    } catch (err) {
      pushNotice(err.response?.data?.error || 'Não foi possível comprar.');
    }
  };

  if (myHouses === null) return <p className="dim">Carregando...</p>;
  if (myHouses.length === 0) {
    return <p className="dim">Você ainda não tem nenhuma casa. Vá até a aba Imobiliária para comprar uma!</p>;
  }
  if (!layout) return <p className="dim">Carregando casa...</p>;

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

  return (
    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
      <div style={{ flex: '1 1 320px', minWidth: 0 }}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
          {myHouses.map((h) => (
            <button key={h.houseId} className={`theme-swatch ${houseId === h.houseId ? 'active' : ''}`} onClick={() => setHouseId(h.houseId)} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <HouseIcon color={h.house.backgroundColor} size={20} /> {h.house.name}
            </button>
          ))}
          <button className="theme-swatch" onClick={() => setMapPickerOpen((v) => !v)}>🖼️ Fundo{layout?.mapBackground ? `: ${layout.mapBackground.name}` : ''}</button>
        </div>
        {mapPickerOpen && (
          <div className="map-picker">
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
                <img className="map-picker-swatch" src={m.imageUrl} alt="" />
                <span>{m.name}</span>
                {!m.owned && <span className="map-picker-price">🪙 {m.price}</span>}
              </button>
            ))}
          </div>
        )}
        <div
          ref={surfaceRef}
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
                  cursor: 'grab', outline: selectedId === it.id ? '2px solid var(--brand)' : 'none', touchAction: 'none',
                  transform: it.flipped ? 'scaleX(-1)' : undefined,
                }}
              />
            ))}
          </HouseSurface>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
          <button className="btn-secondary" disabled={!selected} onClick={() => bumpLayer(1)}>⬆️ Trazer p/ frente</button>
          <button className="btn-secondary" disabled={!selected} onClick={() => bumpLayer(-1)}>⬇️ Mandar p/ trás</button>
          <button className="btn-secondary" disabled={!selected} onClick={() => resizeSelected(1.15)}>➕ Aumentar</button>
          <button className="btn-secondary" disabled={!selected} onClick={() => resizeSelected(0.87)}>➖ Diminuir</button>
          <button className="btn-secondary" disabled={!selected} onClick={flipSelected}>↔️ Virar</button>
          <button className="btn-secondary" disabled={!selected} onClick={removeSelected}>🗑️ Remover</button>
          {houseId !== myHouses.find((h) => h.isActive)?.houseId && (
            <button className="btn-secondary" onClick={async () => { await setActiveHouse(houseId); onChanged(); pushNotice('Casa ativa alterada.'); }}>
              Tornar ativa
            </button>
          )}
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Salvando...' : '💾 Salvar casa'}</button>
        </div>
      </div>

      <div style={{ minWidth: 220, maxHeight: 500, overflowY: 'auto' }}>
        <h4 style={{ marginTop: 0 }}>Seus móveis</h4>
        {inventory?.filter((cat) => cat.items.some((it) => it.ownedQuantity > 0)).map((cat) => (
          <div key={cat.id} style={{ marginBottom: 10 }}>
            <div className="dim" style={{ fontSize: 12, fontWeight: 700 }}>{cat.name.toUpperCase()}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {cat.items.filter((it) => it.ownedQuantity > 0).map((it) => (
                <button key={it.id} className="icon-btn-small" title={`${it.name} (${it.ownedQuantity}x)`} style={{ padding: 4 }} onClick={() => addItem(it)}>
                  <img src={it.imageUrl} alt="" style={{ width: 36, height: 36, objectFit: 'contain' }} />
                </button>
              ))}
            </div>
          </div>
        ))}
        {inventory && inventory.every((cat) => cat.items.every((it) => it.ownedQuantity === 0)) && (
          <p className="dim" style={{ fontSize: 13 }}>Você ainda não tem móveis — compre na Imobiliária.</p>
        )}
      </div>
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
    <div>
      <div className="shop-section-tabs">
        <button className={`shop-section-tab ${section === 'HOUSES' ? 'active' : ''}`} onClick={() => setSection('HOUSES')}>🧊 Casas</button>
        <button className={`shop-section-tab ${section === 'FURNITURE' ? 'active' : ''}`} onClick={() => setSection('FURNITURE')}>🪑 Móveis</button>
        <button className={`shop-section-tab ${section === 'MAPS' ? 'active' : ''}`} onClick={() => setSection('MAPS')}>🖼️ Fundos</button>
      </div>

      {section === 'HOUSES' && (
        <div className="admin-badge-grid">
          {houses.map((h) => (
            <div key={h.id} className="card" style={{ padding: 14 }}>
              <div style={{ height: 90, borderRadius: 8, background: h.backgroundColor, marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                {h.imageUrl ? <img src={h.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <HouseIcon color="#FFFFFF" size={56} />}
              </div>
              <div style={{ fontWeight: 700 }}>{h.name}</div>
              <p>{h.price === 0 ? 'Grátis' : `🪙 ${fmt(h.price)}`}</p>
              <button className="btn-secondary" disabled={h.owned} onClick={() => doBuyHouse(h)}>{h.owned ? 'Você já tem' : 'Comprar'}</button>
            </div>
          ))}
        </div>
      )}

      {section === 'FURNITURE' && (
        <div>
          <div className="shop-category-chips">
            {furniture.map((cat) => (
              <button key={cat.id} className={`shop-category-chip ${furnitureCategory === cat.id ? 'active' : ''}`} onClick={() => setFurnitureCategory(cat.id)}>
                {cat.name}
              </button>
            ))}
          </div>
          <div className="admin-badge-grid">
            {activeCategory?.items.map((it) => (
              <div key={it.id} className="card" style={{ padding: 14 }}>
                <img src={it.imageUrl} alt="" style={{ width: '100%', height: 70, objectFit: 'contain' }} />
                <div style={{ fontWeight: 700 }}>{it.name}</div>
                <p>🪙 {fmt(it.price)} {it.ownedQuantity > 0 && <span className="dim">— você tem {it.ownedQuantity}</span>}</p>
                <button className="btn-secondary" onClick={() => doBuyFurniture(it)}>Comprar</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {section === 'MAPS' && (
        <div className="admin-badge-grid">
          {maps.map((m) => (
            <div key={m.id} className="card" style={{ padding: 14 }}>
              <img src={m.imageUrl} alt="" style={{ width: '100%', height: 90, objectFit: 'cover', borderRadius: 8 }} />
              <div style={{ fontWeight: 700, marginTop: 6 }}>{m.name}</div>
              <p>{m.price === 0 ? 'Grátis' : `🪙 ${fmt(m.price)}`}</p>
              <button className="btn-secondary" disabled={m.owned} onClick={() => doBuyMap(m)}>{m.owned ? 'Você já tem' : 'Comprar'}</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function GalleryTab() {
  const [houses, setHouses] = useState(null);
  const [filterMapId, setFilterMapId] = useState('');
  useEffect(() => { getHouseGallery().then((d) => setHouses(d.houses)); }, []);

  if (houses === null) return <p className="dim">Carregando...</p>;
  if (houses.length === 0) return <p className="dim">Ninguém decorou uma casa ainda.</p>;

  // Fundos usados por pelo menos uma casa aqui na Galeria — dá pra
  // filtrar só quem escolheu aquele mapa (casas com grupo, igual o bot
  // Robbie tinha, aparecem na posição fixa do grupo delas em cima dele).
  const usedMaps = [...new Map(houses.filter((h) => h.mapBackground).map((h) => [h.mapBackground.id, h.mapBackground])).values()];

  const visible = filterMapId ? houses.filter((h) => h.mapBackground?.id === filterMapId) : houses;

  return (
    <div>
      {usedMaps.length > 0 && (
        <div className="shop-category-chips" style={{ marginBottom: 14 }}>
          <button className={`shop-category-chip ${!filterMapId ? 'active' : ''}`} onClick={() => setFilterMapId('')}>Todas as casas</button>
          {usedMaps.map((m) => (
            <button key={m.id} className={`shop-category-chip ${filterMapId === m.id ? 'active' : ''}`} onClick={() => setFilterMapId(m.id)}>
              🖼️ {m.name}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        {visible.map((h) => (
          <div key={h.id} style={{ width: '100%', maxWidth: 320, flex: '1 1 260px' }}>
            <HouseSurface
              backgroundColor={h.house.backgroundColor}
              backgroundImageUrl={h.mapBackground?.imageUrl}
              items={h.items}
              width={h.mapBackground ? h.mapBackground.width || h.house.width : h.house.width}
              height={h.mapBackground ? h.mapBackground.height || h.house.height : h.house.height}
              houseSprite={h.house.groupId != null ? h.house.imageUrl : null}
              houseGroup={h.house.group}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
              <UserAvatar user={h.user} size={24} />
              <span>{h.user.displayName}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
