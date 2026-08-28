import { Component } from 'react';

// Bug fix: "the page goes totally black after some hours, have to refresh"
// — this app had no error boundary anywhere, so ANY uncaught error during
// a render (e.g. a stale-session edge case a few hours in, where a
// component briefly reads a null `user` right before the redirect to
// /login kicks in) unmounted the entire React tree with nothing left in
// its place — since the page background itself is dark, an empty DOM
// looks exactly like a solid black screen. This catches that instead and
// offers a one-click recovery, rather than leaving the person stuck until
// they think to hard-refresh.
//
// `compact` renders a small inline fallback instead of a full-screen one,
// and "try again" just resets this boundary's own state (remounting only
// the subtree underneath it) instead of reloading the whole page — meant
// for wrapping one specific risky panel (e.g. the voice-call view) so a
// crash there doesn't take out chat/sidebar/everything else too, and
// doesn't force leaving a call just to recover from it.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
    this.reset = () => this.setState({ hasError: false });
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('Unhandled render error, caught by ErrorBoundary:', error, info);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.compact) {
        return (
          <div className="error-boundary-inline">
            <span>⚠️ Essa parte travou de um jeito inesperado.</span>
            <button className="btn-link" onClick={this.reset}>Tentar de novo</button>
          </div>
        );
      }
      return (
        <div className="error-boundary-screen">
          <div className="error-boundary-card">
            <div className="error-boundary-icon">⚠️</div>
            <h1>Algo deu errado</h1>
            <p>Essa tela travou de um jeito inesperado. Recarregar a página deve resolver.</p>
            <button className="btn-primary" onClick={() => window.location.reload()}>Recarregar</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
