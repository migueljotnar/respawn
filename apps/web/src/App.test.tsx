import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "./App.js";
import {
  clearSessionToken,
  readSessionToken,
  storeSessionToken,
} from "./lib/session-storage.js";

vi.mock("./layouts/MainLayout.js", () => ({
  MainLayout: ({ onLogout }: { onLogout: () => void }) => (
    <button type="button" onClick={onLogout}>
      Encerrar sessao de teste
    </button>
  ),
}));

const TOKEN = "header.payload.signature";
const verifiedSession = {
  user: {
    id: "11111111-1111-4111-8111-111111111111",
    email: "logout@example.com",
    username: "logout-test",
    displayName: null,
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  session: {
    id: "22222222-2222-4222-8222-222222222222",
    expiresAt: "2027-01-01T00:00:00.000Z",
  },
};

function sessionResponse(): Response {
  return new Response(JSON.stringify({ data: verifiedSession }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input.toString();
}

beforeEach(() => {
  clearSessionToken();
  storeSessionToken(TOKEN);
  window.history.replaceState({}, "", "/channels/respawn-hq/spawn-point");
});

afterEach(() => {
  cleanup();
  clearSessionToken();
  vi.unstubAllGlobals();
});

describe("App logout", () => {
  it("revoga com o Bearer token antes do cleanup e ignora cliques repetidos", async () => {
    let resolveLogout!: (response: Response) => void;
    const pendingLogout = new Promise<Response>((resolve) => {
      resolveLogout = resolve;
    });
    const fetchMock = vi.fn<typeof fetch>((input, init) => {
      const url = requestUrl(input);

      if (url.endsWith("/api/auth/session")) {
        return Promise.resolve(sessionResponse());
      }

      if (url.endsWith("/api/auth/logout")) {
        return pendingLogout;
      }

      return Promise.reject(new Error(`URL inesperada: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    const logoutButton = await screen.findByRole("button", {
      name: "Encerrar sessao de teste",
    });

    fireEvent.click(logoutButton);
    fireEvent.click(logoutButton);

    await waitFor(() => {
      const logoutCalls = fetchMock.mock.calls.filter(([input]) =>
        requestUrl(input).endsWith("/api/auth/logout"),
      );
      expect(logoutCalls).toHaveLength(1);
      expect(logoutCalls[0]?.[1]).toMatchObject({
        method: "POST",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${TOKEN}`,
        },
      });
    });
    expect(readSessionToken()).toBe(TOKEN);
    expect(window.location.pathname).toBe("/channels/respawn-hq/spawn-point");
    expect(
      screen.getByText("Encerrando sua sessão com segurança..."),
    ).toBeTruthy();

    resolveLogout(new Response(null, { status: 204 }));

    await waitFor(() => {
      expect(readSessionToken()).toBeNull();
      expect(window.location.pathname).toBe("/login");
    });
  });

  it("sempre limpa a sessao local e navega para login quando o logout remoto falha", async () => {
    const fetchMock = vi.fn<typeof fetch>((input) => {
      const url = requestUrl(input);

      if (url.endsWith("/api/auth/session")) {
        return Promise.resolve(sessionResponse());
      }

      if (url.endsWith("/api/auth/logout")) {
        return Promise.reject(new Error("rede indisponivel"));
      }

      return Promise.reject(new Error(`URL inesperada: ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);
    fireEvent.click(
      await screen.findByRole("button", { name: "Encerrar sessao de teste" }),
    );

    await waitFor(() => {
      expect(readSessionToken()).toBeNull();
      expect(window.location.pathname).toBe("/login");
    });
    const logoutCalls = fetchMock.mock.calls.filter(([input]) =>
      requestUrl(input).endsWith("/api/auth/logout"),
    );
    expect(logoutCalls).toHaveLength(1);
    expect(logoutCalls[0]?.[1]).toMatchObject({
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${TOKEN}`,
      },
    });
  });
});
