import { useEffect, useRef, useState } from 'react';
import { getPinguAdmin, updatePinguAdmin, uploadPinguImage } from '../../api/endpoints';
import UserAvatar from '../UserAvatar.jsx';
import '../../styles/pingu-admin.css';

// Painel da Equipe → Comunidade → Pingu (assistente de IA).
// Edita o perfil do Pingu (nome, foto, capa, bio, cores) e o que ele
// sabe sobre o Project Club — o texto entra nas instruções da IA na hora.
const EMPTY = { displayName: '', bio: '', profileNameColor: '#38BDF8', profileColor: '#38BDF8', instructions: '' };

const fromState = (s) => ({
  displayName: s.user?.displayName || '',
  bio: s.user?.bio || '',
  profileNameColor: s.user?.profileNameColor || '#38BDF8',
  profileColor: s.user?.profileColor || '#38BDF8',
  instructions: s.instructions || '',
});

export default function PinguAdmin() {
  const [state, setState] = useState(null);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState({ text: '', ok: true });
  const avatarRef = useRef(null);
  const bannerRef = useRef(null);

  const apply = (s) => { setState(s); setForm(fromState(s)); };
  const flash = (text, ok = true) => { setMsg({ text, ok }); setTimeout(() => setMsg({ text: '', ok: true }), 3000); };
  useEffect(() => { getPinguAdmin().then(apply).catch((e) => flash(e?.response?.data?.error || 'Não deu pra carregar o Pingu.', false)); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const dirty = state && JSON.stringify(fromState(state)) !== JSON.stringify(form);

  const save = async (e) => {
    e.preventDefault();
    if (!dirty) return;
    setBusy(true);
    try { apply(await updatePinguAdmin(form)); flash('Salvo. O Pingu já está usando as mudanças.'); } catch (err) { flash(err?.response?.data?.error || 'Não deu pra salvar.', false); } finally { setBusy(false); }
  };
  const upload = async (kind, file) => {
    if (!file) return;
    setBusy(true);
    try { apply(await uploadPinguImage(kind, file)); flash(kind === 'avatar' ? 'Foto atualizada.' : 'Capa atualizada.'); } catch (err) { flash(err?.response?.data?.error || 'Não deu pra enviar a imagem.', false); } finally { setBusy(false); }
  };

  if (!state) return <p className="dim">{msg.text || 'Carregando…'}</p>;
  const u = state.user;
  const preview = u ? { ...u, displayName: form.displayName || u.displayName } : null;
  const left = (state.maxInstructions || 2000) - form.instructions.length;

  return (
    <div className="pga">
      <section className="settings-block pga-head">
        <div className="pga-card">
          <div className="pga-banner" style={u?.bannerUrl ? { backgroundImage: `url(${u.bannerUrl})` } : { background: form.profileColor }} />
          <div className="pga-id">
            {preview && <UserAvatar user={preview} size={64} noDecoration />}
            <div className="pga-names">
              <strong style={{ color: form.profileNameColor }}>{form.displayName || 'Pingu'}</strong>
              <span className="dim">@{u?.username || 'pingu'} · Assistente de IA</span>
            </div>
            <span className={`pga-status ${state.online ? 'on' : ''}`}>{state.enabled ? (state.online ? 'Online' : 'Offline (IA fora do ar)') : 'Desligado'}</span>
          </div>
        </div>
        <p className="dim pga-sub">
          Modelo <b>{state.model}</b>{state.queue ? ` · ${state.queue} pergunta(s) na fila` : ''}. Chamado com <b>@{u?.username || 'pingu'}</b> ou respondendo uma mensagem dele.
        </p>
        <div className="pga-actions">
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => avatarRef.current?.click()}>Trocar foto</button>
          <button type="button" className="btn-secondary" disabled={busy} onClick={() => bannerRef.current?.click()}>Trocar capa</button>
          <input ref={avatarRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { upload('avatar', e.target.files?.[0]); e.target.value = ''; }} />
          <input ref={bannerRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { upload('banner', e.target.files?.[0]); e.target.value = ''; }} />
        </div>
      </section>

      <form className="settings-block pga-form" onSubmit={save}>
        <h3>Perfil</h3>
        <label>Nome<input value={form.displayName} maxLength={32} onChange={set('displayName')} /></label>
        <label>Bio<textarea rows={2} maxLength={300} value={form.bio} onChange={set('bio')} /></label>
        <div className="pga-row">
          <label>Cor do nome<input type="color" value={form.profileNameColor} onChange={set('profileNameColor')} /></label>
          <label>Cor do perfil<input type="color" value={form.profileColor} onChange={set('profileColor')} /></label>
        </div>

        <h3>O que o Pingu sabe</h3>
        <p className="dim pga-hint">
          Escreva fatos curtos e verdadeiros sobre o Project Club (regras, como ganhar moedas, o que tem em cada aba).
          O Pingu usa isso nas respostas. Quanto mais curto, mais rápido ele responde.
        </p>
        <label>
          <span className="pga-count">{left} caracteres sobrando</span>
          <textarea rows={8} maxLength={state.maxInstructions || 2000} value={form.instructions} onChange={set('instructions')}
            placeholder={'Ex.:\nO baú diário dá moedas uma vez por dia na aba Economia.\nGemas vêm de missões e da Loja.\nPara falar com a equipe, abra um ticket em Suporte.'} />
        </label>

        <div className="pga-actions">
          <button type="submit" className="btn-primary" disabled={busy || !dirty}>{busy ? 'Salvando…' : 'Salvar'}</button>
          <button type="button" className="btn-secondary" disabled={busy || !dirty} onClick={() => setForm(fromState(state))}>Desfazer</button>
          {msg.text && <span className={`pga-msg ${msg.ok ? '' : 'err'}`} role="status">{msg.text}</span>}
        </div>
      </form>
    </div>
  );
}
