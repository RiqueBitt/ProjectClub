import { useState } from 'react';
import Modal from './Modal.jsx';
import Recaptcha from './Recaptcha.jsx';

// Shown AFTER submitting email/password (or the register form) instead of
// having the checkbox sit inline on the form from the start — the person
// fills in their credentials first, then this pops up centered on screen
// just for the "prove you're not a robot" step, with its own "Prosseguir"
// button that only actually logs in/registers once checked.
export default function RecaptchaModal({ onClose, onConfirm, busy }) {
  const [token, setToken] = useState(null);

  return (
    <Modal title="Confirme que você não é um robô" onClose={onClose} width="380px" overlayClassName="recaptcha-modal-overlay">
      <div className="recaptcha-modal-body">
        <Recaptcha onChange={setToken} />
        <button className="btn-primary" disabled={!token || busy} onClick={() => onConfirm(token)}>
          {busy ? 'Entrando...' : 'Prosseguir'}
        </button>
      </div>
    </Modal>
  );
}
