import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PublicUser } from "../../lib/auth-api.js";
import type { VoiceParticipant } from "../../stores/voice-store.js";
import { ChannelSidebar, type ChannelSidebarVoiceState } from "./ChannelSidebar.js";

afterEach(() => {
  cleanup();
});

const user: PublicUser = {
  id: "user-1",
  email: "tester@example.com",
  username: "tester",
  displayName: null,
  avatarUrl: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const disconnectedVoice: ChannelSidebarVoiceState = {
  status: "disconnected",
  channelSlug: null,
  roomName: null,
  rttMs: null,
  error: null,
  audioPlaybackBlocked: false,
  micMuted: false,
  deafened: false,
  cameraEnabled: false,
  screenShareEnabled: false,
  screenSharePreset: null,
  participants: [],
};

function makeParticipant(overrides: Partial<VoiceParticipant> = {}): VoiceParticipant {
  return {
    id: "user-1",
    name: "Ana",
    isLocal: false,
    isSpeaking: false,
    micMuted: false,
    cameraEnabled: false,
    screenShareEnabled: false,
    cameraTrack: null,
    screenShareTrack: null,
    ...overrides,
  };
}

function renderSidebar(overrides: Partial<Parameters<typeof ChannelSidebar>[0]> = {}) {
  return render(
    <ChannelSidebar
      activeChannelId="chat-geral"
      serverId="respawn-hq"
      user={user}
      onNavigate={() => {}}
      onLogout={() => {}}
      onlineCount={1}
      isSelfOnline
      className=""
      voice={disconnectedVoice}
      onToggleVoiceMic={() => {}}
      onToggleVoiceDeafen={() => {}}
      onToggleVoiceCamera={() => {}}
      onStartVoiceScreenShare={() => {}}
      onStopVoiceScreenShare={() => {}}
      onResumeVoiceAudioPlayback={() => {}}
      onLeaveVoice={() => {}}
      {...overrides}
    />,
  );
}

describe("ChannelSidebar — controles de microfone e áudio", () => {
  it("mantém mic e áudio desabilitados quando não está conectado a uma sala de voz", () => {
    renderSidebar();

    const micButton = screen.getByRole("button", {
      name: "Microfone — conecte-se a uma sala de voz",
    }) as HTMLButtonElement;
    const deafenButton = screen.getByRole("button", {
      name: "Áudio — conecte-se a uma sala de voz",
    }) as HTMLButtonElement;

    expect(micButton.disabled).toBe(true);
    expect(deafenButton.disabled).toBe(true);
  });

  it("habilita mic e áudio quando conectado, e chama os handlers reais ao clicar", () => {
    const onToggleVoiceMic = vi.fn();
    const onToggleVoiceDeafen = vi.fn();

    renderSidebar({
      voice: { ...disconnectedVoice, status: "connected", channelSlug: "lobby-neon" },
      onToggleVoiceMic,
      onToggleVoiceDeafen,
    });

    const micButton = screen.getByRole("button", { name: "Mutar microfone" }) as HTMLButtonElement;
    const deafenButton = screen.getByRole("button", {
      name: "Ensurdecer áudio",
    }) as HTMLButtonElement;
    expect(micButton.disabled).toBe(false);
    expect(deafenButton.disabled).toBe(false);
    expect(deafenButton.className.split(/\s+/)).toContain("grid");
    expect(deafenButton.className.split(/\s+/)).not.toContain("hidden");

    fireEvent.click(micButton);
    expect(onToggleVoiceMic).toHaveBeenCalledTimes(1);

    fireEvent.click(deafenButton);
    expect(onToggleVoiceDeafen).toHaveBeenCalledTimes(1);
  });

  it("troca o rótulo/ícone quando o microfone e o áudio já estão desativados", () => {
    renderSidebar({
      voice: {
        ...disconnectedVoice,
        status: "connected",
        channelSlug: "lobby-neon",
        micMuted: true,
        deafened: true,
      },
    });

    expect(screen.queryByRole("button", { name: "Ativar microfone" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Reativar áudio" })).not.toBeNull();
  });
});

describe("ChannelSidebar — painel 'Voice Connected'", () => {
  it("não mostra o painel quando desconectado", () => {
    renderSidebar();

    expect(screen.queryByText("Voice Connected")).toBeNull();
  });

  it("mostra status, nome da sala e RTT real em milissegundos quando conectado", () => {
    renderSidebar({
      voice: {
        ...disconnectedVoice,
        status: "connected",
        channelSlug: "lobby-neon",
        roomName: "voice:lobby-neon",
        rttMs: 42,
      },
    });

    expect(screen.queryByText("Voice Connected")).not.toBeNull();
    expect(screen.getByText(/voice:lobby-neon/).textContent).toContain("42 ms");
  });

  it("mostra 'Conectando...' enquanto a conexão está em andamento", () => {
    renderSidebar({
      voice: { ...disconnectedVoice, status: "connecting", channelSlug: "lobby-neon" },
    });

    expect(screen.getByRole("status").textContent).toContain("Conectando...");
  });

  it("chama onLeaveVoice ao clicar em Sair no painel", () => {
    const onLeaveVoice = vi.fn();
    renderSidebar({
      voice: { ...disconnectedVoice, status: "connected", channelSlug: "lobby-neon" },
      onLeaveVoice,
    });

    fireEvent.click(screen.getByRole("button", { name: "Sair da chamada de voz" }));
    expect(onLeaveVoice).toHaveBeenCalledTimes(1);
  });

  it("chama onToggleVoiceCamera ao clicar no botão de câmera do painel", () => {
    const onToggleVoiceCamera = vi.fn();
    renderSidebar({
      voice: { ...disconnectedVoice, status: "connected", channelSlug: "lobby-neon" },
      onToggleVoiceCamera,
    });

    fireEvent.click(screen.getByRole("button", { name: "Ligar câmera" }));
    expect(onToggleVoiceCamera).toHaveBeenCalledTimes(1);
  });

  it("mostra 'Desligar câmera' quando a câmera já está ligada", () => {
    renderSidebar({
      voice: {
        ...disconnectedVoice,
        status: "connected",
        channelSlug: "lobby-neon",
        cameraEnabled: true,
      },
    });

    expect(screen.queryByRole("button", { name: "Desligar câmera" })).not.toBeNull();
  });

  it("abre o seletor de presets ao clicar em 'Compartilhar tela' e chama onStartVoiceScreenShare com o preset escolhido", () => {
    const onStartVoiceScreenShare = vi.fn();
    renderSidebar({
      voice: { ...disconnectedVoice, status: "connected", channelSlug: "lobby-neon" },
      onStartVoiceScreenShare,
    });

    fireEvent.click(screen.getByRole("button", { name: "Compartilhar tela" }));

    const menu = screen.getByRole("menu", { name: "Escolher qualidade do compartilhamento de tela" });
    expect(menu.textContent).toContain("720p · 30 FPS");
    expect(menu.textContent).toContain("720p · 60 FPS");
    expect(menu.textContent).toContain("1080p · 30 FPS");
    expect(menu.textContent).toContain("1080p · 60 FPS");

    fireEvent.click(screen.getByRole("menuitem", { name: "1080p · 60 FPS" }));
    expect(onStartVoiceScreenShare).toHaveBeenCalledWith("1080p60");
  });

  it("fecha o seletor de presets após escolher um preset", () => {
    renderSidebar({
      voice: { ...disconnectedVoice, status: "connected", channelSlug: "lobby-neon" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Compartilhar tela" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "720p · 30 FPS" }));

    expect(
      screen.queryByRole("menu", { name: "Escolher qualidade do compartilhamento de tela" }),
    ).toBeNull();
  });

  it("mostra 'Parar compartilhamento' e chama onStopVoiceScreenShare quando já está compartilhando", () => {
    const onStopVoiceScreenShare = vi.fn();
    renderSidebar({
      voice: {
        ...disconnectedVoice,
        status: "connected",
        channelSlug: "lobby-neon",
        screenShareEnabled: true,
        screenSharePreset: "1080p60",
      },
      onStopVoiceScreenShare,
    });

    fireEvent.click(screen.getByRole("button", { name: "Parar compartilhamento de tela" }));
    expect(onStopVoiceScreenShare).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("menu", { name: "Escolher qualidade do compartilhamento de tela" }),
    ).toBeNull();
  });

  it("mostra o preset ativo no status do painel enquanto compartilha a tela", () => {
    renderSidebar({
      voice: {
        ...disconnectedVoice,
        status: "connected",
        channelSlug: "lobby-neon",
        screenShareEnabled: true,
        screenSharePreset: "1080p60",
      },
    });

    expect(screen.getByRole("status").textContent).toContain("Compartilhando (1080p · 60 FPS)");
  });

  it("mostra ação para reativar áudio quando o navegador bloqueou o autoplay", () => {
    const onResumeVoiceAudioPlayback = vi.fn();
    renderSidebar({
      voice: {
        ...disconnectedVoice,
        status: "connected",
        channelSlug: "lobby-neon",
        audioPlaybackBlocked: true,
      },
      onResumeVoiceAudioPlayback,
    });

    const resumeButton = screen.getByRole("button", { name: "Ativar áudio" });
    fireEvent.click(resumeButton);
    expect(onResumeVoiceAudioPlayback).toHaveBeenCalledTimes(1);
  });
});

describe("ChannelSidebar — lista de participantes conectados", () => {
  it("expande a lista de participantes sob o canal de voz ativo", () => {
    renderSidebar({
      voice: {
        ...disconnectedVoice,
        status: "connected",
        channelSlug: "lobby-neon",
        participants: [
          makeParticipant({ id: "user-1", name: "Ana", isLocal: true }),
          makeParticipant({ id: "user-2", name: "Beto", micMuted: true }),
        ],
      },
    });

    expect(screen.queryByText("Ana (você)")).not.toBeNull();
    expect(screen.queryByText("Beto")).not.toBeNull();
    expect(screen.queryByLabelText("Beto está com o microfone mutado")).not.toBeNull();
  });

  it("mostra indicador visual de fala (borda) só para quem está falando", () => {
    renderSidebar({
      voice: {
        ...disconnectedVoice,
        status: "connected",
        channelSlug: "lobby-neon",
        participants: [
          makeParticipant({ id: "user-1", name: "Ana", isSpeaking: true }),
          makeParticipant({ id: "user-2", name: "Beto", isSpeaking: false }),
        ],
      },
    });

    const anaAvatar = screen.getByText("Ana").closest("li")?.querySelector("span[aria-hidden='true']");
    const betoAvatar = screen.getByText("Beto").closest("li")?.querySelector("span[aria-hidden='true']");

    expect(anaAvatar?.className).toContain("ring-respawn-neon");
    expect(betoAvatar?.className).toContain("ring-transparent");
  });

  it("mostra 'Conectando...' na lista quando ainda não há participantes carregados", () => {
    renderSidebar({
      voice: { ...disconnectedVoice, status: "connecting", channelSlug: "lobby-neon", participants: [] },
    });

    expect(
      screen.getByRole("list", { name: "Conectados em Lobby Neon" }).textContent,
    ).toContain("Conectando...");
  });

  it("não expande participantes sob um canal de voz ao qual não está conectado", () => {
    renderSidebar({
      voice: {
        ...disconnectedVoice,
        status: "connected",
        channelSlug: "squad-alpha",
        participants: [makeParticipant({ id: "user-1", name: "Ana" })],
      },
    });

    expect(screen.queryByRole("list", { name: "Conectados em Lobby Neon" })).toBeNull();
  });
});
