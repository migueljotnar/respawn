import { beforeEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "respawn.auth.token.v1";

// session-storage.ts guarda um cache em memória no escopo do módulo
// (inMemoryToken/isMemoryInitialized) que só lê o sessionStorage real na
// PRIMEIRA chamada de readSessionToken(). Para testar esse comportamento de
// "primeira leitura" de forma confiável, cada teste precisa de uma instância
// nova do módulo — daí o vi.resetModules() + import dinâmico em vez de um
// import estático no topo do arquivo.
async function freshModule() {
  vi.resetModules();
  return import("./session-storage.js");
}

beforeEach(() => {
  window.sessionStorage.clear();
});

describe("session-storage", () => {
  it("retorna null quando não há token nem em memória nem no sessionStorage", async () => {
    const { readSessionToken } = await freshModule();
    expect(readSessionToken()).toBeNull();
  });

  it("lê, na primeira chamada, um token já persistido de uma sessão anterior", async () => {
    window.sessionStorage.setItem(STORAGE_KEY, "pre-existing-token");
    const { readSessionToken } = await freshModule();
    expect(readSessionToken()).toBe("pre-existing-token");
  });

  it("storeSessionToken grava em memória e no sessionStorage", async () => {
    const { readSessionToken, storeSessionToken } = await freshModule();
    storeSessionToken("novo-token");
    expect(readSessionToken()).toBe("novo-token");
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBe("novo-token");
  });

  it("clearSessionToken remove tanto da memória quanto do sessionStorage", async () => {
    const { readSessionToken, storeSessionToken, clearSessionToken } = await freshModule();
    storeSessionToken("token-a-remover");
    clearSessionToken();
    expect(readSessionToken()).toBeNull();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("clearSessionTokenIfMatches só limpa quando o token informado é o token atual", async () => {
    const { readSessionToken, storeSessionToken, clearSessionTokenIfMatches } =
      await freshModule();
    storeSessionToken("token-atual");

    clearSessionTokenIfMatches("token-diferente");
    expect(readSessionToken()).toBe("token-atual");

    clearSessionTokenIfMatches("token-atual");
    expect(readSessionToken()).toBeNull();
  });

  it("não lança quando o sessionStorage está indisponível e mantém o token em memória", async () => {
    const { readSessionToken, storeSessionToken } = await freshModule();
    const originalSetItem = window.sessionStorage.setItem.bind(window.sessionStorage);
    window.sessionStorage.setItem = () => {
      throw new DOMException("blocked by browser settings");
    };

    try {
      expect(() => storeSessionToken("token-x")).not.toThrow();
      expect(readSessionToken()).toBe("token-x");
    } finally {
      window.sessionStorage.setItem = originalSetItem;
    }
  });
});
