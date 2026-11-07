import { useAuth } from '../context/AuthContext.jsx';

// Shown instead of the whole app whenever the platform is "Em reforma"
// (see adminController.setMaintenanceMode / middleware/auth.js's
// requireAuth, which is what actually enforces this server-side on every
// request — this screen is just the client reflecting that state, not
// what's actually blocking anyone). Platform staff (ADMIN/MODERATOR) get an
// extra button to go in anyway — their account already bypasses the
// server-side block, so this just needs to get out of their own way too.
export default function MaintenanceScreen({ message, onStaffBypass }) {
  const { user } = useAuth();
  const isStaff = user && ['ADMIN', 'MODERATOR'].includes(user.platformRole);

  return (
    <div className="maintenance-screen">
      <div className="maintenance-card">
        <div className="maintenance-icon">🛠️</div>
        <h1>O Project Club está em manutenção</h1>
        <p>{message || 'Já estamos arrumando algumas coisas por aqui. Volte daqui a pouco!'}</p>
        {isStaff && (
          <button className="btn-primary" onClick={onStaffBypass}>Entrar como staff</button>
        )}
      </div>
    </div>
  );
}
