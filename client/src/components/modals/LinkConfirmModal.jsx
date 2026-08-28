import { useStore } from '../../store/useStore';
import Modal from '../Modal.jsx';

// Rendered once at the app root (see MainApp.jsx) and driven entirely by
// `pendingLinkUrl` in the zustand store — same pattern as UserProfileModal.
// Every link inside a chat message or a bio (see richTextRender.jsx) goes
// through this instead of navigating straight away, so a malicious/misleading
// link pasted by someone else always shows you exactly where it actually
// points before your browser opens it.
export default function LinkConfirmModal() {
  const url = useStore((s) => s.pendingLinkUrl);
  const close = useStore((s) => s.closeLinkConfirm);

  if (!url) return null;

  const confirm = () => {
    window.open(url, '_blank', 'noopener,noreferrer');
    close();
  };

  return (
    <Modal title="Sair do Project Club" onClose={close} width="420px">
      <div className="settings-grid">
        <p>Tem certeza que deseja acessar este link?</p>
        <div className="link-confirm-url">{url}</div>
        <div className="modal-actions">
          <button className="btn-link" onClick={close}>Não</button>
          <button className="btn-primary" onClick={confirm}>Sim, acessar</button>
        </div>
      </div>
    </Modal>
  );
}
