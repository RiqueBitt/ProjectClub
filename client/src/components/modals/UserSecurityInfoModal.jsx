import { useEffect, useState } from 'react';
import Modal from '../Modal.jsx';
import { adminGetUserSecurityInfo } from '../../api/endpoints';

// Opened from the admin panel's Users tab — deliberately its own separate
// modal (not just another column in the table) since this is genuinely
// sensitive data (IP addresses, device list) that shouldn't be visible
// just by glancing at the list; you have to specifically ask to see it.
export default function UserSecurityInfoModal({ userId, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    adminGetUserSecurityInfo(userId).then(setData).catch((err) => setError(err.response?.data?.error || 'Não foi possível carregar.'));
  }, [userId]);

  return (
    <Modal title="Informações confidenciais" onClose={onClose} width="560px">
      <div className="settings-grid">
        <p className="text-danger">
          ⚠️ Dados sensíveis — visíveis só pra staff, nunca pro próprio usuário. Use com responsabilidade (investigação de abuso/contas duplicadas), não por curiosidade.
        </p>
        {error && <div className="auth-error">{error}</div>}
        {!data && !error && <p className="dim">Carregando...</p>}
        {data && (
          <>
            <div className="settings-block">
              <h4>Conta</h4>
              <p className="dim">
                {data.user.displayName} (@{data.user.username}) · ID {data.user.publicId}<br />
                E-mail: {data.user.email} {data.user.emailVerified ? '✅' : '❌ não verificado'}<br />
                Criada em: {new Date(data.user.createdAt).toLocaleString('pt-BR')}<br />
                2FA: {data.user.twoFactorEnabled ? 'Ativado' : 'Desativado'}
                {data.user.failedLoginAttempts > 0 && <><br />Tentativas de login falhas: {data.user.failedLoginAttempts}</>}
                {data.user.loginLockedUntil && new Date(data.user.loginLockedUntil) > new Date() && (
                  <><br /><span className="text-danger">Bloqueada por tentativas até {new Date(data.user.loginLockedUntil).toLocaleString('pt-BR')}</span></>
                )}
              </p>
            </div>

            <div className="settings-block">
              <h4>IPs usados ({data.distinctIps.length})</h4>
              {data.distinctIps.length === 0 && <p className="dim">Nenhum registrado.</p>}
              <div className="security-ip-list">
                {data.distinctIps.map((ip) => <code key={ip} className="security-ip-chip">{ip}</code>)}
              </div>
            </div>

            {data.sharedIpAccounts.length > 0 && (
              <div className="settings-block">
                <h4 className="text-danger">⚠️ Outras contas com o mesmo IP ({data.sharedIpAccounts.length})</h4>
                <p className="dim">Pode indicar contas alternativas da mesma pessoa (útil pra checar evasão de banimento).</p>
                <table className="admin-table">
                  <tbody>
                    {data.sharedIpAccounts.map((u) => (
                      <tr key={u.id}>
                        <td>{u.displayName} <span className="dim">@{u.username}</span></td>
                        <td className="dim">ID {u.publicId}</td>
                        <td>{u.isPlatformBanned && <span className="text-danger">Banido</span>}</td>
                        <td className="dim">IP: {u.sharedIp}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="settings-block">
              <h4>Sessões ({data.sessions.length})</h4>
              <table className="admin-table">
                <thead><tr><th>IP</th><th>Dispositivo</th><th>Criada em</th><th>Status</th></tr></thead>
                <tbody>
                  {data.sessions.map((s) => (
                    <tr key={s.id}>
                      <td>{s.ipAddress || <span className="dim">—</span>}</td>
                      <td className="dim truncate" style={{ maxWidth: 200 }}>{s.userAgent || '—'}</td>
                      <td className="dim">{new Date(s.createdAt).toLocaleString('pt-BR')}</td>
                      <td className="dim">{s.revoked ? 'Encerrada' : new Date(s.expiresAt) > new Date() ? 'Ativa' : 'Expirada'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
