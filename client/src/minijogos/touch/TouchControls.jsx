import { Arrow, DPad, Joystick, KeyButton } from './controls.jsx';
import './touch.css';

// Controles na tela de um mini-jogo, montados a partir do esquema do jogo
// (schemes.js). Ficam em dois cantos (esquerdo: movimento; direito: ações):
//  - fit 'side'    → nas faixas pretas dos lados do jogo (celular deitado)
//  - fit 'below'   → na faixa abaixo do jogo (celular em pé)
//  - fit 'overlay' → por cima dos cantos de baixo, translúcidos e menores
// O resto da tela continua indo direto pro jogo (tocar = clicar).

const ICONS = {
  jump: <path d="M12 19V7M6.5 11.5 12 6l5.5 5.5" />,
  fire: <><circle cx="12" cy="12" r="6.5" /><circle cx="12" cy="12" r="2" /><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3" /></>,
  grab: <path d="M12 3v7M7 10h10M7 10l-2.5 5L7 19M17 10l2.5 5L17 19" />,
  drop: <><path d="M12 4v10M7.5 9.5 12 14l4.5-4.5" /><path d="M5 19h14" /></>,
  ok: <path d="m5 12.5 4.5 4.5L19 7.5" />,
};

function ActionIcon({ name }) {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name] || ICONS.ok}
    </svg>
  );
}

const DIR_LABEL = { up: 'Cima', down: 'Baixo', left: 'Esquerda', right: 'Direita' };

function ArrowKey({ input, dir, repeat, className = '' }) {
  return (
    <KeyButton input={input} keyName={dir} className={`mjt-arrowkey ${className}`} label={DIR_LABEL[dir]} repeat={repeat} testId={`mjt-key-${dir}`}>
      <Arrow dir={dir} size={34} />
    </KeyButton>
  );
}

export default function TouchControls({ scheme, input, fit = 'overlay', size = 'md' }) {
  const { left, actions = [], repeat } = scheme;
  let leftEl = null;
  let rightExtra = null;
  if (left === 'dpad4' || left === 'dpad8') leftEl = <DPad input={input} mode={left === 'dpad8' ? 8 : 4} />;
  else if (left === 'joystick') leftEl = <Joystick input={input} />;
  else if (left === 'lr') leftEl = <div className="mjt-pair"><ArrowKey input={input} dir="left" repeat={repeat} /><ArrowKey input={input} dir="right" repeat={repeat} /></div>;
  else if (left === 'lr-split') {
    leftEl = <ArrowKey input={input} dir="left" repeat={repeat} className="is-xl" />;
    rightExtra = <ArrowKey input={input} dir="right" repeat={repeat} className="is-xl" />;
  } else if (left === 'dance') {
    leftEl = <div className="mjt-pair"><ArrowKey input={input} dir="left" /><ArrowKey input={input} dir="down" /></div>;
    rightExtra = <div className="mjt-pair"><ArrowKey input={input} dir="up" /><ArrowKey input={input} dir="right" /></div>;
  }

  return (
    <div className={`mjt-controls fit-${fit} size-${size}${left === 'joystick' ? ' has-joystick' : ''}`} aria-label="Controles na tela" data-testid="mjt-controls">
      {leftEl && <div className="mjt-zone is-left">{leftEl}</div>}
      {(rightExtra || actions.length > 0) && (
        <div className="mjt-zone is-right">
          {rightExtra}
          {actions.length > 0 && (
            <div className={`mjt-actions n-${actions.length}`}>
              {actions.map((a, i) => (
                <KeyButton key={a.key} input={input} keyName={a.key} label={a.label} className={`mjt-action${i === 0 ? ' is-main' : ''}`} testId={`mjt-action-${a.key}`}>
                  <ActionIcon name={a.icon} />
                  <span className="mjt-action-label">{a.label}</span>
                </KeyButton>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
