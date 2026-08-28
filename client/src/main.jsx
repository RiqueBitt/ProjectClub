import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import { AuthProvider } from './context/AuthContext.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import './styles/global.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </React.StrictMode>
);

// One-time cleanup: an earlier build of this app registered a service
// worker (/sw.js) that no longer exists. Anyone who visited before may
// still have it installed, silently serving whatever it cached at install
// time forever — including old, buggy layouts — regardless of how many
// times the site is redeployed. This unregisters any such leftover worker
// so the browser goes back to loading the real, current files.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.getRegistrations().then((regs) => {
    regs.forEach((reg) => reg.unregister());
  }).catch(() => {});
}
