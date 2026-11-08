import { useCallback, useRef, useState } from 'react';

// BUG CORRIGIDO ("renomear e criar categoria não funciona no PC, no
// celular sim"): window.prompt() e window.confirm() são funções
// NATIVAS do navegador — funcionam bem no WebView do Android (app
// mobile), mas o Electron (app desktop) DESABILITA window.prompt()
// por completo, por decisão oficial do próprio projeto (nunca vai
// ser suportado — não é um bug deles, é escolha de design). Chamar
// prompt() ali sempre devolve null, então qualquer "if (!name) return"
// simplesmente desiste sem nenhum aviso. window.confirm() geralmente
// ainda funciona no Electron, mas por consistência (e pra não
// depender de um comportamento que pode mudar) os dois são
// substituídos por um modal de verdade, próprio do app.
//
// Uso: const { promptAsync, confirmAsync, DialogElement } =
// usePromptDialog(); dentro do componente, chame await
// promptAsync('Nome:', valorAtual) / await confirmAsync('Tem certeza?')
// em vez de prompt()/confirm() — ambos devolvem uma Promise (string OU
// null pra prompt cancelado; true OU false pra confirm), e renderize
// {DialogElement} uma vez em algum lugar do JSX do componente.
export function usePromptDialog() {
  const [state, setState] = useState(null); // { type, message, value } | null
  const resolveRef = useRef(null);

  const promptAsync = useCallback((message, defaultValue = '') => {
    setState({ type: 'prompt', message, value: defaultValue });
    return new Promise((resolve) => { resolveRef.current = resolve; });
  }, []);

  const confirmAsync = useCallback((message) => {
    setState({ type: 'confirm', message, value: '' });
    return new Promise((resolve) => { resolveRef.current = resolve; });
  }, []);

  const close = (result) => {
    resolveRef.current?.(result);
    resolveRef.current = null;
    setState(null);
  };

  const onSubmit = (e) => {
    e.preventDefault();
    close(state.type === 'prompt' ? state.value : true);
  };

  const DialogElement = state ? (
    <div className="modal-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) close(state.type === 'prompt' ? null : false); }}>
      <form className="modal-box prompt-dialog-box" onSubmit={onSubmit}>
        <p className="prompt-dialog-message">{state.message}</p>
        {state.type === 'prompt' && (
          <input
            autoFocus
            value={state.value}
            onChange={(e) => setState((s) => ({ ...s, value: e.target.value }))}
            onFocus={(e) => e.target.select()}
          />
        )}
        <div className="modal-actions">
          <button type="button" className="btn-secondary" onClick={() => close(state.type === 'prompt' ? null : false)}>Cancelar</button>
          <button type="submit" className="btn-primary" autoFocus={state.type === 'confirm'}>OK</button>
        </div>
      </form>
    </div>
  ) : null;

  return { promptAsync, confirmAsync, DialogElement };
}
