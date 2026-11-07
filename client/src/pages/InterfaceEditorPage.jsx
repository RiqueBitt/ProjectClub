import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { getUiLayout, updateUiLayout, resetUiLayout } from '../api/endpoints';
import { TOP_MENU_ITEMS } from '../components/TopMenu.jsx';
import { panelsForDevice, GRID_DIMENSIONS } from '../layoutPanels';
import logoIcon from '../assets/icons/logo-project-club.png';

const PANEL_COLORS = {
  navbar: '#5865F2', topMenu: '#9B59F6',
  main: '#FEE75C', membersList: '#ED4245', callbar: '#00C2FF',
};
function spanOf(value) {
  if (!value || !value.includes('/')) return 1;
  const [start, end] = value.split('/').map((v) => parseInt(v.trim(), 10));
  return Math.max(1, end - start);
}
function startOf(value) {
  if (!value) return 1;
  return parseInt(value.split('/')[0].trim(), 10) || 1;
}

// Editor visual dos menus principais do site — pensado pra staff ajustar
// como o app aparece pra todo mundo, sem precisar mexer em código. Não é
// um "arraste qualquer coisa pra qualquer lugar" (isso exigiria trocar
// toda a base do layout, que hoje é organizada por grid, não por posição
// livre — mudar isso seria um risco grande pro que já funciona) — em vez
// disso, cada parte editável do site (ordem/visibilidade dos menus da
// barra de seções, largura da barra de canais, largura da lista de
// membros) tem seu próprio controle de verdade, e o resultado final é
// exatamente o que aparece no site pra todo mundo depois de salvar.
export default function InterfaceEditorPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [device, setDevice] = useState(null); // null = ainda escolhendo PC/Mobile
  const [config, setConfig] = useState(null);
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState(null); // panelId sendo arrastado, na seção "Posição dos painéis"
  const canvasRef = useRef(null);

  const isStaff = ['ADMIN', 'MODERATOR'].includes(user.platformRole);

  useEffect(() => {
    if (!device) return;
    getUiLayout().then((d) => setConfig(d[device])).catch(() => {
      setConfig({ railOrder: [], railHidden: [], sidebarWidth: 280, membersWidth: 240, membersDefaultOpen: true, panelPositions: {} });
    });
  }, [device]);

  // F12 salva e sai — em alguns navegadores essa tecla é reservada pro
  // DevTools e o preventDefault pode não bloquear isso sempre (limitação
  // do próprio navegador); por isso também tem o botão "Salvar" normal.
  // Precisa ficar ANTES dos `if (...) return` abaixo — todo Hook (useState/
  // useEffect) tem que rodar em TODA renderização, na mesma ordem, senão
  // o React quebra com "Rendered more hooks than during the previous
  // render" bem na hora de escolher PC/Mobile (o bug que gerava a tela de
  // "Algo deu errado" reportada).
  const saveRef = useRef(null);
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'F12' && device && config) { e.preventDefault(); saveRef.current?.(); }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [device, config]);

  if (!isStaff) {
    return (
      <div className="editor-gate">
        <p>Acesso restrito à equipe.</p>
        <button className="btn-secondary" onClick={() => navigate('/')}>Voltar</button>
      </div>
    );
  }

  if (!device) {
    return (
      <div className="editor-gate">
        <img className="editor-gate-logo" src={logoIcon} alt="" />
        <h1>Editor de Interface</h1>
        <p className="dim">Escolha qual versão do site você quer editar. Cada uma tem sua própria configuração.</p>
        <div className="editor-device-pick">
          <button className="editor-device-btn" onClick={() => setDevice('PC')}>
            <span style={{ fontSize: 40 }}>🖥️</span>
            <span>PC</span>
          </button>
          <button className="editor-device-btn" onClick={() => setDevice('MOBILE')}>
            <span style={{ fontSize: 40 }}>📱</span>
            <span>Celular</span>
          </button>
        </div>
        <button className="btn-link" onClick={() => navigate('/admin')}>Cancelar</button>
      </div>
    );
  }

  if (!config) return <div className="editor-gate"><p className="dim">Carregando...</p></div>;

  const items = (config.railOrder?.length ? config.railOrder.map((to) => TOP_MENU_ITEMS.find((i) => i.to === to)).filter(Boolean) : TOP_MENU_ITEMS);
  const hidden = new Set(config.railHidden || []);

  const move = (index, dir) => {
    const next = [...items];
    const swap = index + dir;
    if (swap < 0 || swap >= next.length) return;
    [next[index], next[swap]] = [next[swap], next[index]];
    setConfig({ ...config, railOrder: next.map((i) => i.to) });
  };

  const toggleHidden = (to) => {
    const next = new Set(hidden);
    if (next.has(to)) next.delete(to); else next.add(to);
    setConfig({ ...config, railHidden: [...next] });
  };

  const save = async () => {
    setSaving(true);
    try {
      await updateUiLayout(device, config);
      navigate('/');
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = save;

  const reset = async () => {
    if (!confirm('Restaurar o layout padrão? Isso apaga as mudanças salvas pra este dispositivo.')) return;
    const { config: def } = await resetUiLayout(device);
    setConfig(def);
  };

  // --- Posição dos painéis (arrastar barra lateral, lista de membros,
  // chat, etc pra outro lugar da grade) ---
  const dims = device ? GRID_DIMENSIONS[device] : null;
  const panelDefs = device ? panelsForDevice(device) : null;
  const panelPositions = config?.panelPositions || {};

  const cellFromPointer = (clientX, clientY) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const col = Math.min(dims.columns, Math.max(1, Math.ceil(((clientX - rect.left) / rect.width) * dims.columns)));
    const row = Math.min(dims.rows, Math.max(1, Math.ceil(((clientY - rect.top) / rect.height) * dims.rows)));
    return { col, row };
  };

  const currentPos = (panelId) => panelPositions[panelId] || { gridColumn: panelDefs[panelId].gridColumn, gridRow: panelDefs[panelId].gridRow };

  const onPanelPointerMove = (e) => {
    if (!dragging) return;
    const { col, row } = cellFromPointer(e.clientX, e.clientY);
    const current = currentPos(dragging);
    const colSpan = spanOf(current.gridColumn);
    const rowSpan = spanOf(current.gridRow);
    setConfig((c) => ({
      ...c,
      panelPositions: {
        ...c.panelPositions,
        [dragging]: {
          gridColumn: colSpan > 1 ? `${col} / ${Math.min(dims.columns + 1, col + colSpan)}` : String(col),
          gridRow: rowSpan > 1 ? `${row} / ${Math.min(dims.rows + 1, row + rowSpan)}` : String(row),
        },
      },
    }));
  };

  const changePanelSpan = (panelId, axis, delta) => {
    const current = currentPos(panelId);
    const key = axis === 'col' ? 'gridColumn' : 'gridRow';
    const max = axis === 'col' ? dims.columns : dims.rows;
    const start = startOf(current[key]);
    const newSpan = Math.max(1, Math.min(max - start + 1, spanOf(current[key]) + delta));
    setConfig((c) => ({
      ...c,
      panelPositions: { ...c.panelPositions, [panelId]: { ...current, [key]: newSpan > 1 ? `${start} / ${start + newSpan}` : String(start) } },
    }));
  };

  return (
    <div className="editor-shell">
      <div className="editor-toolbar">
        <div>
          <b>Editor de Interface</b>
          <span className="dim" style={{ marginLeft: 8 }}>{device === 'PC' ? '🖥️ PC' : '📱 Celular'}</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn-link" onClick={() => setDevice(null)}>Trocar dispositivo</button>
          <button className="btn-link" onClick={reset}>Restaurar padrão</button>
          <button className="btn-secondary" onClick={() => navigate('/')} disabled={saving}>Sair sem salvar</button>
          <button className="btn-primary" onClick={save} disabled={saving}>{saving ? 'Salvando...' : '💾 Salvar e sair (F12)'}</button>
        </div>
      </div>

      <div className={`editor-canvas ${device === 'MOBILE' ? 'mobile-frame' : ''}`}>
        <div className="editor-preview">
          <div className="editor-panel">
            <div className="editor-panel-title">Menu superior — ordem e visibilidade</div>
            <p className="dim" style={{ fontSize: 12 }}>Use as setas pra reordenar, o olho pra esconder um menu de todo mundo.</p>
            {items.map((item, i) => (
              <div key={item.to} className={`editor-rail-item-row ${hidden.has(item.to) ? 'hidden-item' : ''}`}>
                <span className="top-menu-item-icon">{item.icon}</span>
                <span style={{ flex: 1 }}>{item.label}</span>
                <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} title="Mover pra cima">▲</button>
                <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === items.length - 1} title="Mover pra baixo">▼</button>
                <button className="icon-btn" onClick={() => toggleHidden(item.to)} title={hidden.has(item.to) ? 'Mostrar' : 'Esconder'}>
                  {hidden.has(item.to) ? '🚫' : '👁️'}
                </button>
              </div>
            ))}
          </div>

          {device === 'PC' && (
            <div className="editor-panel">
              <div className="editor-panel-title">Largura do dropdown de canais</div>
              <input
                type="range" min="220" max="400" value={config.sidebarWidth}
                onChange={(e) => setConfig({ ...config, sidebarWidth: parseInt(e.target.value, 10) })}
              />
              <span className="dim"> {config.sidebarWidth}px</span>

              <div className="editor-panel-title" style={{ marginTop: 16 }}>Largura da lista de membros</div>
              <input
                type="range" min="180" max="360" value={config.membersWidth}
                onChange={(e) => setConfig({ ...config, membersWidth: parseInt(e.target.value, 10) })}
              />
              <span className="dim"> {config.membersWidth}px</span>
            </div>
          )}

          <div className="editor-panel">
            <label className="checkbox-row">
              <input
                type="checkbox" checked={config.membersDefaultOpen}
                onChange={(e) => setConfig({ ...config, membersDefaultOpen: e.target.checked })}
              />
              Lista de membros aberta por padrão
            </label>
          </div>

          <div className="editor-panel">
            <div className="editor-panel-title">Posição dos painéis</div>
            <p className="dim" style={{ fontSize: 12 }}>Arraste um painel pelo ⣿ pra outra célula da grade. Use os botões ± pra deixar ele maior ou menor.</p>
            <div
              ref={canvasRef}
              className="panel-position-canvas"
              style={{ gridTemplateColumns: `repeat(${dims.columns}, 1fr)`, gridTemplateRows: `repeat(${dims.rows}, 1fr)` }}
              onPointerMove={onPanelPointerMove}
              onPointerUp={() => setDragging(null)}
              onPointerLeave={() => setDragging(null)}
            >
              {Object.entries(panelDefs).map(([id, def]) => {
                const pos = currentPos(id);
                return (
                  <div
                    key={id}
                    className="panel-position-box"
                    style={{ gridColumn: pos.gridColumn, gridRow: pos.gridRow, background: `${PANEL_COLORS[id]}33`, borderColor: PANEL_COLORS[id] }}
                  >
                    <div
                      className="panel-position-handle"
                      style={{ background: PANEL_COLORS[id] }}
                      onPointerDown={(e) => { e.target.setPointerCapture(e.pointerId); setDragging(id); }}
                    >
                      ⣿ {def.label}
                    </div>
                    <div className="panel-position-resize">
                      <span>Largura</span>
                      <button type="button" onClick={() => changePanelSpan(id, 'col', -1)}>−</button>
                      <button type="button" onClick={() => changePanelSpan(id, 'col', 1)}>+</button>
                      <span>Altura</span>
                      <button type="button" onClick={() => changePanelSpan(id, 'row', -1)}>−</button>
                      <button type="button" onClick={() => changePanelSpan(id, 'row', 1)}>+</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
