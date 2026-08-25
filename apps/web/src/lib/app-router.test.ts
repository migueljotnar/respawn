import { describe, expect, it } from "vitest";

import { DEFAULT_COMMUNITY_PATH, communityPath, parseAppRoute } from "./app-router.js";

describe("parseAppRoute", () => {
  it("reconhece as rotas de autenticação", () => {
    expect(parseAppRoute("/login")).toEqual({ kind: "auth", page: "login" });
    expect(parseAppRoute("/register")).toEqual({ kind: "auth", page: "register" });
  });

  it("reconhece uma rota de comunidade válida (servidor disponível + canal existente)", () => {
    expect(parseAppRoute("/channels/respawn-hq/spawn-point")).toEqual({
      kind: "community",
      serverId: "respawn-hq",
      channelId: "spawn-point",
    });
  });

  it("rejeita um servidor que existe mas está marcado como indisponível", () => {
    // pixel-forge existe em communityServers mas com available: false — é um
    // placeholder de servidor travado, não deve resolver como rota válida.
    expect(parseAppRoute("/channels/pixel-forge/spawn-point")).toEqual({ kind: "unknown" });
  });

  it("rejeita um servidor que não existe", () => {
    expect(parseAppRoute("/channels/servidor-inexistente/spawn-point")).toEqual({
      kind: "unknown",
    });
  });

  it("rejeita um canal que não existe dentro de um servidor válido", () => {
    expect(parseAppRoute("/channels/respawn-hq/canal-inexistente")).toEqual({ kind: "unknown" });
  });

  it("rejeita caminhos que não batem com nenhum formato conhecido", () => {
    expect(parseAppRoute("/")).toEqual({ kind: "unknown" });
    expect(parseAppRoute("/qualquer-outra-coisa")).toEqual({ kind: "unknown" });
    expect(parseAppRoute("/channels/so-um-segmento")).toEqual({ kind: "unknown" });
  });
});

describe("communityPath", () => {
  it("monta o caminho usando o servidor padrão quando nenhum é informado", () => {
    expect(communityPath("chat-geral")).toBe("/channels/respawn-hq/chat-geral");
  });

  it("monta o caminho usando o servidor informado explicitamente", () => {
    expect(communityPath("chat-geral", "outro-servidor")).toBe(
      "/channels/outro-servidor/chat-geral",
    );
  });
});

describe("DEFAULT_COMMUNITY_PATH", () => {
  it("aponta para o canal e servidor padrão", () => {
    expect(DEFAULT_COMMUNITY_PATH).toBe("/channels/respawn-hq/spawn-point");
  });
});
