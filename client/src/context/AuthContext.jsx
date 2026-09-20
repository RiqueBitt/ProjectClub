import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api } from '../api/client';
import { setAccessToken, setUnauthorizedHandler } from '../api/client';
import { loginUser, logoutUser, registerUser, fetchMe } from '../api/endpoints';
import { useStore } from '../store/useStore';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);
  // Bug corrigido: em desenvolvimento (React.StrictMode), o efeito de
  // montagem dispara duas vezes de propósito — e como o refresh token é de
  // uso único (é trocado por um novo a cada renovação, por segurança), a
  // segunda chamada via /auth/refresh chegava com o token que a primeira
  // já tinha "gasto", o servidor entendia isso como um token roubado sendo
  // reutilizado e DERRUBAVA A SESSÃO INTEIRA por segurança — forçando
  // login de novo. Esse ref sobrevive ao efeito duplo do StrictMode (é a
  // mesma instância do componente) e garante que só a primeira chamada
  // realmente saia.
  const restoreStartedRef = useRef(false);

  // BUG CORRIGIDO ("tema escolhido não fica salvo"): sincroniza o tema
  // salvo na CONTA (User.preferredTheme, ver schema.prisma) pro estado
  // local sempre que uma sessão é aplicada — login, registro ou restauro
  // automático ao abrir o site de novo. Isso é o que faz o tema
  // sobreviver a trocar de navegador/dispositivo, ou a qualquer situação
  // onde o localStorage local tenha sido limpo/bloqueado: a conta
  // continua lembrando, mesmo que o navegador não lembre mais.
  const applySession = useCallback((data) => {
    setUser(data.user);
    setToken(data.accessToken);
    setAccessToken(data.accessToken);
    if (data.user?.preferredTheme) {
      useStore.getState().setTheme(data.user.preferredTheme);
    }
    // Item pedido: "em aparência adicione uma nova opção de layout" —
    // mesmo padrão de sincronização do tema acima.
    if (data.user?.layoutStyle) {
      useStore.getState().setLayoutStyle(data.user.layoutStyle);
    }
    if (data.user?.emojiStyle) {
      useStore.getState().setEmojiStyle(data.user.emojiStyle);
    }
    // Item pedido: "sistema podendo mudar o zoom... pra melhor
    // personalização" — mesmo padrão de tema/emoji acima: o valor
    // salvo na CONTA sincroniza pro estado local sempre que a sessão
    // é aplicada, então o zoom escolhido também sobrevive a trocar de
    // navegador/dispositivo. Só sincroniza se vier um valor de
    // verdade (nunca sobrescreve com 0/undefined por engano).
    if (data.user?.chatZoom) {
      useStore.getState().setChatZoom(data.user.chatZoom);
    }
    // Item pedido: "adicione nas configurações do usuário ele poder
    // aumentar ou diminuir o zoom quanto quiser" — mesmo padrão do
    // chat-zoom acima: o valor salvo na CONTA sincroniza pro estado
    // local sempre que a sessão é aplicada.
    if (data.user?.interfaceZoom) {
      useStore.getState().setInterfaceZoom(data.user.interfaceZoom);
    }
  }, []);

  const clearSession = useCallback(() => {
    setUser(null);
    setToken(null);
    setAccessToken(null);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(clearSession);
    if (restoreStartedRef.current) return;
    restoreStartedRef.current = true;
    // BUG CORRIGIDO ("cookies sendo apagados após a atualização da
    // plataforma"): a causa real não era o cookie em si (ele continua
    // intacto no navegador) — era esse catch aqui tratando QUALQUER
    // falha da mesma forma, inclusive um ERRO DE REDE (servidor
    // temporariamente fora do ar, exatamente o que acontece durante os
    // ~15-20s de um deploy — `npm install && vite build && prisma db
    // push` antes do servidor novo voltar a responder). Se a página
    // carregasse justo nessa janela, a chamada de /auth/refresh nem
    // chegava a ser respondida (erro de conexão, sem "response"
    // nenhum) — e o app deslogava a pessoa mesmo com a sessão dela
    // continuando perfeitamente válida no banco.
    //
    // A diferença certa: só um erro com `response` (o servidor
    // respondeu de verdade, ex: 401 porque o cookie realmente não é
    // mais válido) significa sessão inválida de verdade. Um erro SEM
    // response (servidor inacessível) tenta de novo algumas vezes com
    // espera crescente antes de desistir — dá tempo do deploy
    // terminar sem derrubar ninguém por causa da janela de deploy.
    const tryRestore = (attempt = 1) => {
      api.post('/auth/refresh')
        .then((res) => { applySession(res.data); setLoading(false); })
        .catch((err) => {
          if (err.response) {
            // Servidor respondeu de propósito (401/403/etc) — sessão
            // realmente inválida, não tem o que tentar de novo.
            clearSession();
            setLoading(false);
            return;
          }
          if (attempt >= 5) {
            // Já tentamos por um tempo razoável (até uns 30s de
            // espera acumulada) — aí sim assume que não é só o deploy
            // e desiste, pra não deixar a pessoa presa carregando pra
            // sempre se estiver genuinamente sem internet.
            clearSession();
            setLoading(false);
            return;
          }
          setTimeout(() => tryRestore(attempt + 1), attempt * 1500);
        });
    };
    tryRestore();
  }, [applySession, clearSession]);

  const login = useCallback(async (payload) => {
    const data = await loginUser(payload);
    if (data.requiresTwoFactor) return { requiresTwoFactor: true };
    applySession(data);
    return { ok: true };
  }, [applySession]);

  const register = useCallback(async (payload) => {
    const data = await registerUser(payload);
    applySession(data);
    return data;
  }, [applySession]);

  const logout = useCallback(async () => {
    await logoutUser().catch(() => {});
    clearSession();
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    const data = await fetchMe();
    setUser(data.user);
    return data.user;
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, refreshUser, setUser, applySession }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de <AuthProvider>');
  return ctx;
}
