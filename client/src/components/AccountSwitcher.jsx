import { useState } from 'react';
import UserAvatar from './UserAvatar.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useStore } from '../store/useStore';
import { savedAccounts, switchTo, forgetAccount, startAddAccount, rememberAccount, markAccountGone, MAX_ACCOUNTS } from '../utils/accountSwitch';

// Menu "Mudar de conta" (dentro do menu de status do painel do usuário).
export default function AccountSwitcher({ user, onDone }) {
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState('');
  const [list, setList] = useState(savedAccounts);
  const others = list.filter((a) => a.id !== user.id);

  const go = async (a) => {
    setBusy(a.id);
    try {
      await rememberAccount(user).catch(() => {});
      await switchTo(a);
    } catch (e) {
      if (e?.response?.data?.code === 'SWITCH_EXPIRED') { markAccountGone(a.id); setList(savedAccounts()); }
      useStore.getState().pushNotice(e?.response?.data?.error || 'Não deu pra trocar de conta.');
      setBusy('');
    }
  };
  const add = async () => {
    if (list.length >= MAX_ACCOUNTS && !list.some((a) => a.id === user.id)) { useStore.getState().pushNotice(`Dá pra salvar até ${MAX_ACCOUNTS} contas.`); return; }
    setBusy('add'); onDone?.();
    await startAddAccount(user, logout).catch(() => setBusy(''));
  };
  const remove = async (a) => { await forgetAccount(a); setList(savedAccounts()); };

  if (!open) {
    return (
      <button type="button" role="menuitem" className="usb-menu-item" onClick={() => setOpen(true)}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M16 3l4 4-4 4M20 7H9M8 21l-4-4 4-4M4 17h11" /></svg>
        <span>Mudar de conta</span>
      </button>
    );
  }
  return (
    <div className="acs" role="group" aria-label="Mudar de conta">
      <div className="acs-row on"><UserAvatar user={user} size={28} /><span><b>{user.displayName}</b><small>Conta atual</small></span></div>
      {others.map((a) => (
        <div key={a.id} className="acs-row">
          <button type="button" className="acs-pick" disabled={!!busy} onClick={() => go(a)}>
            <UserAvatar user={a} size={28} /><span><b>{a.displayName}</b><small>@{a.username}</small></span>
            {busy === a.id && <em>Entrando…</em>}
          </button>
          <button type="button" className="acs-x" title="Tirar deste aparelho" aria-label={`Tirar ${a.displayName} deste aparelho`} onClick={() => remove(a)}>✕</button>
        </div>
      ))}
      <button type="button" className="usb-menu-item" disabled={!!busy} onClick={add}>+ Adicionar conta</button>
      <small className="acs-hint">Até {MAX_ACCOUNTS} contas ficam salvas neste aparelho.</small>
    </div>
  );
}
