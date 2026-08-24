import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AuthShell } from "./components/AuthShell.js";
import {
  SessionLoading,
  SessionUnavailable,
} from "./components/SessionPanels.js";
import {
  DEFAULT_CHANNEL_ID,
  DEFAULT_SERVER_ID,
  getChannel,
  type ChannelId,
} from "./data/community-mocks.js";
import { MainLayout } from "./layouts/MainLayout.js";
import {
  DEFAULT_COMMUNITY_PATH,
  communityPath,
  parseAppRoute,
} from "./lib/app-router.js";
import {
  ApiClientError,
  authApi,
  type AuthResult,
  type VerifiedSession,
} from "./lib/auth-api.js";
import {
  clearSessionToken,
  clearSessionTokenIfMatches,
  readSessionToken,
  storeSessionToken,
} from "./lib/session-storage.js";
import { LoginPage } from "./pages/LoginPage.js";
import { RegisterPage } from "./pages/RegisterPage.js";

type AuthState =
  | { status: "checking"; message: string }
  | { status: "anonymous"; notice: string | null }
  | { status: "authenticated"; data: VerifiedSession }
  | { status: "unavailable"; message: string };

export function App() {
  const verificationSequence = useRef(0);
  const pendingCommunityPath = useRef<string | null>(null);
  const inFlightVerification = useRef<{
    token: string;
    request: Promise<VerifiedSession>;
  } | null>(null);
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [authState, setAuthState] = useState<AuthState>({
    status: "checking",
    message: "Procurando uma sessão ativa neste dispositivo...",
  });
  const route = useMemo(() => parseAppRoute(pathname), [pathname]);

  const navigate = useCallback((nextPath: string, replace = false) => {
    if (window.location.pathname !== nextPath) {
      window.history[replace ? "replaceState" : "pushState"]({}, "", nextPath);
    }
    setPathname(nextPath);
  }, []);

  const rememberCommunityPath = useCallback((candidatePath: string) => {
    const candidateRoute = parseAppRoute(candidatePath);

    if (candidateRoute.kind === "community") {
      pendingCommunityPath.current = communityPath(
        candidateRoute.channelId,
        candidateRoute.serverId,
      );
    }
  }, []);

  const verifyToken = useCallback(
    async (token: string, showLoading: boolean) => {
      const verificationId = ++verificationSequence.current;

      if (showLoading) {
        setAuthState({
          status: "checking",
          message: "Confirmando seu acesso com o servidor...",
        });
      }

      const activeRequest = inFlightVerification.current;
      const request =
        activeRequest?.token === token
          ? activeRequest.request
          : authApi.getSession(token);

      if (request !== activeRequest?.request) {
        inFlightVerification.current = { token, request };
      }

      try {
        const data = await request;

        if (
          verificationSequence.current === verificationId &&
          readSessionToken() === token
        ) {
          setAuthState({ status: "authenticated", data });
        }
      } catch (error) {
        if (
          verificationSequence.current !== verificationId ||
          readSessionToken() !== token
        ) {
          return;
        }

        if (error instanceof ApiClientError && error.status === 401) {
          rememberCommunityPath(window.location.pathname);
          clearSessionTokenIfMatches(token);
          setAuthState({
            status: "anonymous",
            notice: "Sua sessão expirou. Entre novamente para continuar.",
          });
          navigate("/login", true);
          return;
        }

        const message =
          error instanceof ApiClientError
            ? error.message
            : "Não foi possível verificar sua sessão agora.";
        setAuthState({ status: "unavailable", message });
      } finally {
        if (inFlightVerification.current?.request === request) {
          inFlightVerification.current = null;
        }
      }
    },
    [navigate, rememberCommunityPath],
  );

  useEffect(() => {
    function handlePopState() {
      setPathname(window.location.pathname);
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    const token = readSessionToken();

    if (!token) {
      setAuthState({ status: "anonymous", notice: null });
      return;
    }

    void verifyToken(token, false);
  }, [verifyToken]);

  useEffect(() => {
    if (authState.status === "authenticated" && route.kind !== "community") {
      const destination = pendingCommunityPath.current ?? DEFAULT_COMMUNITY_PATH;
      pendingCommunityPath.current = null;
      navigate(destination, true);
    } else if (authState.status === "anonymous" && route.kind !== "auth") {
      if (route.kind === "community") {
        pendingCommunityPath.current = communityPath(
          route.channelId,
          route.serverId,
        );
      }
      navigate("/login", true);
    }
  }, [authState.status, navigate, route]);

  useEffect(() => {
    if (authState.status !== "authenticated") {
      return;
    }

    const token = readSessionToken();

    if (!token) {
      return;
    }

    const activeToken = token;
    const expiresAt = new Date(authState.data.session.expiresAt).getTime();
    const expiryDelay = Math.max(
      1_000,
      Math.min(expiresAt - Date.now() + 250, 2_147_000_000),
    );
    const expiryTimer = window.setTimeout(() => {
      void verifyToken(activeToken, false);
    }, expiryDelay);

    function handleReturnToApp() {
      if (
        document.visibilityState === "visible" &&
        readSessionToken() === activeToken
      ) {
        void verifyToken(activeToken, false);
      }
    }

    window.addEventListener("focus", handleReturnToApp);
    document.addEventListener("visibilitychange", handleReturnToApp);

    return () => {
      window.clearTimeout(expiryTimer);
      window.removeEventListener("focus", handleReturnToApp);
      document.removeEventListener("visibilitychange", handleReturnToApp);
    };
  }, [authState, verifyToken]);

  useEffect(() => {
    if (route.kind === "community") {
      const channel = getChannel(route.channelId);
      document.title = `${channel?.name ?? "Comunidade"} | Respawn`;
    } else if (route.kind === "auth") {
      document.title = `${route.page === "register" ? "Criar conta" : "Entrar"} | Respawn`;
    } else {
      document.title = "Respawn";
    }
  }, [route]);

  async function handleAuthenticated(result: AuthResult): Promise<void> {
    storeSessionToken(result.token);
    setAuthState({
      status: "checking",
      message: "Conta confirmada. Abrindo seu ponto de respawn...",
    });
    await verifyToken(result.token, false);
  }

  function handleLogout() {
    verificationSequence.current += 1;
    pendingCommunityPath.current = null;
    clearSessionToken();
    setAuthState({ status: "anonymous", notice: null });
    navigate("/login", true);
  }

  function handleRetry() {
    const token = readSessionToken();

    if (!token) {
      handleLogout();
      return;
    }

    void verifyToken(token, true);
  }

  function handleNavigateChannel(channelId: ChannelId) {
    const serverId =
      route.kind === "community" ? route.serverId : DEFAULT_SERVER_ID;
    navigate(communityPath(channelId, serverId));
  }

  if (authState.status === "checking") {
    return (
      <AuthShell>
        <SessionLoading message={authState.message} />
      </AuthShell>
    );
  }

  if (authState.status === "unavailable") {
    return (
      <AuthShell>
        <SessionUnavailable
          message={authState.message}
          onRetry={handleRetry}
          onLogout={handleLogout}
        />
      </AuthShell>
    );
  }

  if (authState.status === "authenticated") {
    const communityRoute =
      route.kind === "community"
        ? route
        : {
            kind: "community" as const,
            serverId: DEFAULT_SERVER_ID,
            channelId: DEFAULT_CHANNEL_ID,
          };

    return (
      <MainLayout
        session={authState.data}
        serverId={communityRoute.serverId}
        channelId={communityRoute.channelId}
        onNavigateChannel={handleNavigateChannel}
        onLogout={handleLogout}
      />
    );
  }

  if (route.kind === "auth" && route.page === "register") {
    return (
      <AuthShell>
        <RegisterPage
          onAuthenticated={handleAuthenticated}
          onNavigate={(path) => navigate(path)}
        />
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <LoginPage
        onAuthenticated={handleAuthenticated}
        onNavigate={(path) => navigate(path)}
        notice={authState.notice}
      />
    </AuthShell>
  );
}
