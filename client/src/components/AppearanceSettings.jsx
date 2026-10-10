// Configurações → Aparência ("Personalizar layout") e os extras de
// Acessibilidade. Tudo aplica na hora (o app atrás do modal muda junto)
// e salva sozinho na conta — ver utils/appearance.js.
import { useStore } from '../store/useStore';
import {
  DEFAULT_LAYOUT_PREFS, isDefaultLayoutPrefs, SEASONS, seasonForDate,
  SIDEBAR_WIDTH_MIN, SIDEBAR_WIDTH_MAX, FONT_SIZE_MIN, FONT_SIZE_MAX,
} from '../utils/appearance';
import '../styles/appearance.css';

function Seg({ value, options, onChange, label }) {
  return (
    <div className="pc-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value} type="button" role="radio" aria-checked={value === o.value}
          className={value === o.value ? 'active' : ''} onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ on, onChange, label }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`pc-switch ${on ? 'on' : ''}`} onClick={() => onChange(!on)} />
  );
}

function SwitchRow({ title, hint, on, onChange }) {
  return (
    <div className="pc-switch-row">
      <div>
        <strong>{title}</strong>
        {hint && <span>{hint}</span>}
      </div>
      <Switch on={on} onChange={onChange} label={title} />
    </div>
  );
}

function LivePreview({ prefs }) {
  const sidePct = Math.round(18 + ((prefs.sidebarWidth - SIDEBAR_WIDTH_MIN) / (SIDEBAR_WIDTH_MAX - SIDEBAR_WIDTH_MIN)) * 22);
  const cls = [
    'pc-preview',
    prefs.corners === 'square' ? 'is-square' : '',
    prefs.density !== 'normal' ? `d-${prefs.density}` : '',
    prefs.showMembers ? '' : 'no-members',
  ].join(' ');
  const font = (prefs.fontSize / 16) * 11 * ({ compact: 0.93, normal: 1, spacious: 1.06 }[prefs.density]);
  return (
    <div className="pc-preview-wrap">
      <span className="pc-preview-label">Prévia</span>
      <div className={cls} style={{ '--pv-side': `${sidePct}%`, '--pv-font': `${font.toFixed(2)}px` }} aria-hidden="true">
        <div className="pc-preview-side">
          <div className="pc-preview-chan active"># geral</div>
          <div className="pc-preview-chan"># jogos</div>
          <div className="pc-preview-chan"># memes</div>
          <div className="pc-preview-chan"># mods</div>
        </div>
        <div className="pc-preview-chat">
          <div className="pc-preview-msg">
            <span className="pc-preview-avatar" />
            <div className="pc-preview-lines">
              <span className="pc-preview-name">Rique</span>
              <span className="pc-preview-text">Bora jogar hoje?</span>
            </div>
          </div>
          <div className="pc-preview-msg">
            <span className="pc-preview-avatar" />
            <div className="pc-preview-lines">
              <span className="pc-preview-name">Ana</span>
              <span className="pc-preview-text">Bora! Já baixei o modpack</span>
            </div>
          </div>
          <div className="pc-preview-input" />
        </div>
        <div className="pc-preview-members">
          {prefs.showMembers && ['Ana', 'Rique', 'Leo'].map((n) => <div key={n} className="pc-preview-member">{n}</div>)}
        </div>
      </div>
      <p className="pc-preview-note">As mudanças já aparecem no app atrás desta janela.</p>
    </div>
  );
}

// Bloco de Aparência: densidade, cantos, coluna, fonte, membros, fundo, temas sazonais.
export function LayoutCustomizer() {
  const prefs = useStore((s) => s.layoutPrefs);
  const setPrefs = useStore((s) => s.setLayoutPrefs);
  const nowSeason = seasonForDate();
  const isDefault = isDefaultLayoutPrefs(prefs);

  return (
    <section className="pc-layout-panel" aria-labelledby="pc-layout-title">
      <div className="pc-layout-head">
        <div>
          <h4 id="pc-layout-title">Personalizar layout</h4>
          <p>Deixe o Project Club do seu jeito. Salvo na sua conta.</p>
        </div>
        <button type="button" className="pc-btn-ghost" disabled={isDefault} onClick={() => setPrefs({ ...DEFAULT_LAYOUT_PREFS })}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5" /></svg>
          Restaurar padrão
        </button>
      </div>

      <div className="pc-layout-body">
        <div className="pc-controls">
          <div className="pc-field">
            <span className="pc-field-label">Densidade</span>
            <Seg
              label="Densidade" value={prefs.density} onChange={(v) => setPrefs({ density: v })}
              options={[{ value: 'compact', label: 'Compacta' }, { value: 'normal', label: 'Normal' }, { value: 'spacious', label: 'Espaçosa' }]}
            />
            <p className="pc-field-hint">Espaço e tamanho do texto no chat, na lista de canais e na de membros.</p>
          </div>

          <div className="pc-field">
            <span className="pc-field-label">Cantos</span>
            <Seg
              label="Cantos" value={prefs.corners} onChange={(v) => setPrefs({ corners: v })}
              options={[{ value: 'round', label: 'Arredondados' }, { value: 'square', label: 'Retos' }]}
            />
          </div>

          <div className="pc-field">
            <label className="pc-field-label" htmlFor="pc-font-size">
              Tamanho da fonte <span className="pc-field-value">{prefs.fontSize}px</span>
            </label>
            <input
              id="pc-font-size" className="pc-range" type="range" min={FONT_SIZE_MIN} max={FONT_SIZE_MAX} step="1"
              value={prefs.fontSize} onChange={(e) => setPrefs({ fontSize: Number(e.target.value) })}
            />
          </div>

          <div className="pc-field">
            <label className="pc-field-label" htmlFor="pc-sidebar-width">
              Largura da coluna lateral <span className="pc-field-value">{prefs.sidebarWidth}px</span>
            </label>
            <input
              id="pc-sidebar-width" className="pc-range" type="range" min={SIDEBAR_WIDTH_MIN} max={SIDEBAR_WIDTH_MAX} step="4"
              value={prefs.sidebarWidth} onChange={(e) => setPrefs({ sidebarWidth: Number(e.target.value) })}
            />
            <p className="pc-field-hint">Só no PC, no layout Normal 2.0. Você também pode arrastar a borda da coluna.</p>
          </div>

          <SwitchRow
            title="Mostrar lista de membros" hint="Aberta por padrão ao entrar num canal."
            on={prefs.showMembers} onChange={(v) => setPrefs({ showMembers: v })}
          />

          <div className="pc-field">
            <span className="pc-field-label">Fundo animado</span>
            <Seg
              label="Fundo animado" value={prefs.animatedBg} onChange={(v) => setPrefs({ animatedBg: v })}
              options={[{ value: 'off', label: 'Desligado' }, { value: 'gradient', label: 'Degradê' }, { value: 'particles', label: 'Partículas' }]}
            />
            <p className="pc-field-hint">Movimento suave atrás do app. Fica desligado se o movimento reduzido estiver ativo.</p>
          </div>

          <SwitchRow
            title="Temas sazonais" hint="Pequenos enfeites em datas especiais."
            on={prefs.seasonal} onChange={(v) => setPrefs({ seasonal: v })}
          />
          {prefs.seasonal && (
            <div className="pc-season-list" aria-label="Datas com tema">
              {Object.entries(SEASONS).map(([key, s]) => (
                <span key={key} className={`pc-season-chip ${nowSeason === key ? 'is-now' : ''}`} title={s.when}>
                  <i style={{ background: { natal: '#e23d3d', anonovo: '#f5c542', carnaval: '#ff4fa3', halloween: '#ff8a1f', aniversario: 'var(--brand)' }[key] }} />
                  {s.label}{nowSeason === key ? ' · agora' : ''}
                </span>
              ))}
            </div>
          )}

          <SwitchRow
            title="Reabrir onde parei" hint="Ao abrir o app, volta pra última página em vez do Início."
            on={prefs.resumeLastPage} onChange={(v) => setPrefs({ resumeLastPage: v })}
          />
        </div>

        <LivePreview prefs={prefs} />
      </div>
    </section>
  );
}

// Extras de Acessibilidade: fonte legível, modo foco e atalhos.
export function AccessibilityExtras() {
  const legibleFont = useStore((s) => s.layoutPrefs.legibleFont);
  const setPrefs = useStore((s) => s.setLayoutPrefs);
  const focusMode = useStore((s) => s.focusMode);
  const setFocusMode = useStore((s) => s.setFocusMode);
  const isDesktopApp = typeof window !== 'undefined' && !!window.electronAPI;

  return (
    <section className="pc-layout-panel" aria-labelledby="pc-a11y-title">
      <div className="pc-layout-head">
        <div>
          <h4 id="pc-a11y-title">Leitura e navegação</h4>
          <p>Opções extras pra ler e navegar com mais conforto.</p>
        </div>
      </div>
      <SwitchRow
        title="Fonte mais legível" hint="Usa a Atkinson Hyperlegible, feita pra facilitar a leitura (ajuda com dislexia)."
        on={legibleFont} onChange={(v) => setPrefs({ legibleFont: v })}
      />
      <SwitchRow
        title="Modo foco" hint="Esconde as colunas laterais e deixa só o conteúdo."
        on={focusMode} onChange={setFocusMode}
      />
      <div className="pc-field">
        <span className="pc-field-label">Atalhos</span>
        <div className="pc-kbd-list">
          <kbd>Ctrl+Shift+F</kbd><span>Liga/desliga o modo foco</span>
          <kbd>Esc</kbd><span>Sai do modo foco</span>
          <kbd>Tab</kbd><span>No início da página, mostra &quot;Pular para o conteúdo&quot;</span>
          {isDesktopApp && <><kbd>Alt+← / Alt+→</kbd><span>Voltar / avançar (também nos botões laterais do mouse)</span></>}
        </div>
      </div>
    </section>
  );
}
