import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { VerifiedSession } from "../lib/auth-api.js";
import type { ChatMessageDto } from "../lib/chat-ws.js";

type Listener = (...args: unknown[]) => void;

class FakeSocket {
  connected = true;
  private readonly listeners = new Map<string, Set<Listener>>();

  on(event: string, handler: Listener): void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    set.add(handler);
    this.listeners.set(event, set);
  }

  off(event: string, handler: Listener): void {
    this.listeners.get(event)?.delete(handler);
  }

  close(): void {
    this.connected = false;
  }

  /** Só usado pelo teste, para simular o servidor emitindo um evento. */
  simulate(event: string, ...args: unknown[]): void {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(...args);
    }
  }
}

const connectChatSocketMock = vi.fn();
const joinChannelMock = vi.fn();
const sendChatMessageMock = vi.fn();
const startTypingMock = vi.fn();
const stopTypingMock = vi.fn();

vi.mock("../lib/chat-ws.js", () => ({
  connectChatSocket: connectChatSocketMock,
  joinChannel: joinChannelMock,
  sendChatMessage: sendChatMessageMock,
  startTyping: startTypingMock,
  stopTyping: stopTypingMock,
  ChatSendError: class ChatSendError extends Error {
    outcome: string;
    code: string;
    constructor(outcome: string, code: string) {
      super(code);
      this.outcome = outcome;
      this.code = code;
    }
  },
}));

vi.mock("../lib/session-storage.js", () => ({
  readSessionToken: () => "fake-token-for-test",
}));

const listMessagesMock = vi.fn(async () => []);
const listMembersMock = vi.fn(async () => []);

vi.mock("../lib/chat-api.js", () => ({
  chatApi: {
    listMessages: listMessagesMock,
    listMembers: listMembersMock,
  },
}));

const joinVoiceChannelMock = vi.fn(async () => {});
const leaveVoiceChannelMock = vi.fn(async () => {});
const resetVoiceSessionMock = vi.fn(async () => {});
const toggleVoiceMicMock = vi.fn(async () => {});
const toggleVoiceDeafenMock = vi.fn();
const toggleVoiceCameraMock = vi.fn(async () => {});
const startVoiceScreenShareMock = vi.fn(async () => {});
const stopVoiceScreenShareMock = vi.fn(async () => {});
const resumeVoiceAudioPlaybackMock = vi.fn(async () => {});

interface FakeVoiceState {
  status: "disconnected" | "connecting" | "connected" | "error";
  channelSlug: string | null;
  roomName: string | null;
  error: string | null;
  rttMs: number | null;
  audioPlaybackBlocked: boolean;
  participants: Record<string, unknown>;
  micMuted: boolean;
  deafened: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  screenSharePreset: string | null;
  joinChannel: typeof joinVoiceChannelMock;
  leaveChannel: typeof leaveVoiceChannelMock;
  resetSession: typeof resetVoiceSessionMock;
  toggleMic: typeof toggleVoiceMicMock;
  toggleDeafen: typeof toggleVoiceDeafenMock;
  toggleCamera: typeof toggleVoiceCameraMock;
  startScreenShare: typeof startVoiceScreenShareMock;
  stopScreenShare: typeof stopVoiceScreenShareMock;
  resumeAudioPlayback: typeof resumeVoiceAudioPlaybackMock;
}

const voiceState: FakeVoiceState = {
  status: "disconnected",
  channelSlug: null,
  roomName: null,
  error: null,
  rttMs: null,
  audioPlaybackBlocked: false,
  participants: {},
  micMuted: false,
  deafened: false,
  cameraEnabled: false,
  screenShareEnabled: false,
  screenSharePreset: null,
  joinChannel: joinVoiceChannelMock,
  leaveChannel: leaveVoiceChannelMock,
  resetSession: resetVoiceSessionMock,
  toggleMic: toggleVoiceMicMock,
  toggleDeafen: toggleVoiceDeafenMock,
  toggleCamera: toggleVoiceCameraMock,
  startScreenShare: startVoiceScreenShareMock,
  stopScreenShare: stopVoiceScreenShareMock,
  resumeAudioPlayback: resumeVoiceAudioPlaybackMock,
};

function resetVoiceState(): void {
  voiceState.status = "disconnected";
  voiceState.channelSlug = null;
  voiceState.roomName = null;
  voiceState.error = null;
  voiceState.rttMs = null;
  voiceState.audioPlaybackBlocked = false;
  voiceState.participants = {};
  voiceState.micMuted = false;
  voiceState.deafened = false;
  voiceState.cameraEnabled = false;
  voiceState.screenShareEnabled = false;
  voiceState.screenSharePreset = null;
}

function useVoiceStoreMock<T>(selector: (state: FakeVoiceState) => T): T {
  return selector(voiceState);
}
useVoiceStoreMock.getState = () => voiceState;

vi.mock("../stores/voice-store.js", () => ({
  useVoiceStore: useVoiceStoreMock,
}));

const { MainLayout } = await import("./MainLayout.js");
const { useChatStore } = await import("../stores/chat-store.js");
const originalStoreActions = {
  loadInitialMessages: useChatStore.getState().loadInitialMessages,
  loadOlderMessages: useChatStore.getState().loadOlderMessages,
  resyncChannel: useChatStore.getState().resyncChannel,
};

const session: VerifiedSession = {
  user: {
    id: "user-1",
    email: "test@example.com",
    username: "tester",
    displayName: null,
    avatarUrl: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  },
  session: { id: "session-1", expiresAt: "2027-01-01T00:00:00.000Z" },
};

function makeMessage(id: string, createdAt: string): ChatMessageDto {
  return {
    id,
    channelSlug: "chat-geral",
    content: id,
    createdAt,
    author: {
      id: "user-2",
      username: "other-user",
      displayName: null,
      avatarUrl: null,
      role: "PLAYER",
    },
  };
}

let fakeSocket: FakeSocket;

beforeEach(() => {
  fakeSocket = new FakeSocket();
  connectChatSocketMock.mockReset();
  connectChatSocketMock.mockReturnValue(fakeSocket);
  joinChannelMock.mockReset();
  joinChannelMock.mockResolvedValue(undefined);
  sendChatMessageMock.mockReset();
  sendChatMessageMock.mockResolvedValue(undefined);
  startTypingMock.mockReset();
  stopTypingMock.mockReset();
  listMessagesMock.mockClear();
  listMembersMock.mockClear();
  joinVoiceChannelMock.mockReset();
  joinVoiceChannelMock.mockResolvedValue(undefined);
  leaveVoiceChannelMock.mockReset();
  leaveVoiceChannelMock.mockResolvedValue(undefined);
  resetVoiceSessionMock.mockReset();
  resetVoiceSessionMock.mockResolvedValue(undefined);
  toggleVoiceMicMock.mockReset();
  toggleVoiceDeafenMock.mockReset();
  toggleVoiceCameraMock.mockReset();
  startVoiceScreenShareMock.mockReset();
  stopVoiceScreenShareMock.mockReset();
  resumeVoiceAudioPlaybackMock.mockReset();
  resetVoiceState();
  useChatStore.setState({
    messagesByChannel: {},
    hasMoreByChannel: {},
    loadingHistoryByChannel: {},
    loadGenerationByChannel: {},
    resyncGenerationByChannel: {},
    historyErrorByChannel: {},
    resyncStatusByChannel: {},
    typingByChannel: {},
    onlineUserIds: new Set(),
    members: [],
    membersError: null,
    ...originalStoreActions,
  });
});

afterEach(() => {
  cleanup();
});

describe("MainLayout — auto-rejoin ao (re)conectar", () => {
  it(
    "reentra no canal ativo quando o socket emite 'connect', sem que o teste chame join " +
      "manualmente (QA-F2-002)",
    async () => {
      render(
        <MainLayout
          session={session}
          serverId="respawn-hq"
          channelId="chat-geral"
          onNavigateChannel={() => {}}
          onLogout={() => {}}
        />,
      );

      expect(connectChatSocketMock).toHaveBeenCalledWith("fake-token-for-test");

      // O componente já dispara um join na montagem (efeito de troca de
      // canal). O que este teste prova é o caminho ADICIONAL: o próprio
      // socket mockado emitindo "connect" de novo — como uma reconexão real
      // faria — sem que este teste chame joinChannel diretamente.
      joinChannelMock.mockClear();

      fakeSocket.simulate("connect");

      await waitFor(() => {
        expect(joinChannelMock).toHaveBeenCalledWith(fakeSocket, "chat-geral");
      });
    },
  );

  it("reentra de novo em cada reconexão subsequente, sempre no canal atualmente ativo", async () => {
    render(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="party-up"
        onNavigateChannel={() => {}}
        onLogout={() => {}}
      />,
    );

    joinChannelMock.mockClear();

    fakeSocket.simulate("connect");
    await waitFor(() => {
      expect(joinChannelMock).toHaveBeenCalledWith(fakeSocket, "party-up");
    });

    joinChannelMock.mockClear();

    // Uma segunda queda + reconexão dispara "connect" outra vez — o handler
    // não é de uso único.
    fakeSocket.simulate("connect");
    await waitFor(() => {
      expect(joinChannelMock).toHaveBeenCalledWith(fakeSocket, "party-up");
    });
  });

  it("processa connection:ack atualizando a presença inicial no store", async () => {
    render(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="chat-geral"
        onNavigateChannel={() => {}}
        onLogout={() => {}}
      />,
    );

    fakeSocket.simulate("connection:ack", { userId: "user-1", onlineUserIds: ["user-1", "user-2"] });

    await waitFor(() => {
      expect(useChatStore.getState().onlineUserIds.has("user-2")).toBe(true);
    });
  });
});

describe("MainLayout — ordenação de join e resync", () => {
  it("não envia antes do ACK de join do canal ativo", async () => {
    let resolveJoin!: () => void;
    const pendingJoin = new Promise<void>((resolve) => {
      resolveJoin = resolve;
    });
    joinChannelMock.mockImplementation(() => pendingJoin);

    render(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="chat-geral"
        onNavigateChannel={() => {}}
        onLogout={() => {}}
      />,
    );

    const input = screen.getByRole("textbox", { name: /Mensagem para chat-geral/i });
    fireEvent.change(input, { target: { value: "aguarda o join" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));

    await act(async () => Promise.resolve());
    expect(sendChatMessageMock).not.toHaveBeenCalled();

    await act(async () => resolveJoin());

    await waitFor(() => {
      expect(sendChatMessageMock).toHaveBeenCalledWith(
        fakeSocket,
        "chat-geral",
        "aguarda o join",
        expect.any(String),
      );
    });
  });

  it("faz load inicial seguido de resync ao trocar e ao reabrir canal cacheado", async () => {
    const sequence: string[] = [];
    joinChannelMock.mockImplementation(async (_socket, channelSlug: string) => {
      sequence.push(`join:${channelSlug}`);
    });
    const loadInitialMessages = vi.fn(async (channelSlug: string) => {
      sequence.push(`load:${channelSlug}`);
    });
    const resyncChannel = vi.fn(async (channelSlug: string) => {
      sequence.push(`resync:${channelSlug}`);
    });
    useChatStore.setState({
      messagesByChannel: {
        "chat-geral": [],
        "party-up": [],
      },
      loadInitialMessages,
      resyncChannel,
    });

    const view = render(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="chat-geral"
        onNavigateChannel={() => {}}
        onLogout={() => {}}
      />,
    );

    await waitFor(() => expect(resyncChannel).toHaveBeenCalledWith("chat-geral"));
    sequence.length = 0;

    view.rerender(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="party-up"
        onNavigateChannel={() => {}}
        onLogout={() => {}}
      />,
    );

    await waitFor(() => expect(resyncChannel).toHaveBeenCalledWith("party-up"));
    expect(sequence).toEqual(["join:party-up", "load:party-up", "resync:party-up"]);
    sequence.length = 0;

    view.rerender(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="chat-geral"
        onNavigateChannel={() => {}}
        onLogout={() => {}}
      />,
    );

    await waitFor(() => expect(resyncChannel).toHaveBeenCalledTimes(3));
    expect(sequence).toEqual(["load:chat-geral", "resync:chat-geral"]);
  });

  it("nao deixa uma sincronizacao da conexao antiga iniciar resync apos reconnect", async () => {
    let resolveOldLoad!: () => void;
    const oldLoad = new Promise<void>((resolve) => {
      resolveOldLoad = resolve;
    });
    const loadInitialMessages = vi
      .fn<(channelSlug: string) => Promise<void>>()
      .mockImplementationOnce(() => oldLoad)
      .mockResolvedValueOnce(undefined);
    const resyncChannel = vi.fn(async () => undefined);
    useChatStore.setState({ loadInitialMessages, resyncChannel });

    render(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="chat-geral"
        onNavigateChannel={() => {}}
        onLogout={() => {}}
      />,
    );

    await waitFor(() => expect(loadInitialMessages).toHaveBeenCalledTimes(1));
    fakeSocket.simulate("connect");

    await waitFor(() => {
      expect(loadInitialMessages).toHaveBeenCalledTimes(2);
      expect(resyncChannel).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      resolveOldLoad();
      await Promise.resolve();
    });

    expect(resyncChannel).toHaveBeenCalledTimes(1);
  });

  it("preserva o cursor conhecido antes do join quando uma mensagem ao vivo chega durante a carga", async () => {
    const known = makeMessage("known", "2026-01-01T00:00:00.000Z");
    const live = makeMessage("live", "2026-01-01T00:02:00.000Z");
    const loadInitialMessages = vi.fn(async () => {
      useChatStore.getState().receiveMessage(live);
    });
    const resyncChannel = vi.fn(async () => undefined);
    useChatStore.setState({
      messagesByChannel: { "chat-geral": [known] },
      loadInitialMessages,
      resyncChannel,
    });

    render(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="chat-geral"
        onNavigateChannel={() => {}}
        onLogout={() => {}}
      />,
    );

    await waitFor(() => {
      expect(resyncChannel).toHaveBeenCalledWith("chat-geral", {
        createdAt: known.createdAt,
        id: known.id,
      });
    });
  });
});

describe("MainLayout — integração de voz", () => {
  it("entra no canal de voz selecionado ao montar em um canal de voz", async () => {
    render(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="lobby-neon"
        onNavigateChannel={() => {}}
        onLogout={() => {}}
      />,
    );

    await waitFor(() => {
      expect(joinVoiceChannelMock).toHaveBeenCalledWith("lobby-neon");
    });
    expect(leaveVoiceChannelMock).not.toHaveBeenCalled();
  });

  it("não entra em canal de voz ao montar em um canal de texto", async () => {
    render(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="chat-geral"
        onNavigateChannel={() => {}}
        onLogout={() => {}}
      />,
    );

    await act(async () => Promise.resolve());
    expect(joinVoiceChannelMock).not.toHaveBeenCalled();
  });

  it("sai do canal de voz ao trocar para um canal de texto", async () => {
    voiceState.channelSlug = "lobby-neon";
    voiceState.status = "connected";

    const view = render(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="lobby-neon"
        onNavigateChannel={() => {}}
        onLogout={() => {}}
      />,
    );

    view.rerender(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="chat-geral"
        onNavigateChannel={() => {}}
        onLogout={() => {}}
      />,
    );

    await waitFor(() => {
      expect(leaveVoiceChannelMock).toHaveBeenCalledTimes(1);
    });
    expect(joinVoiceChannelMock).not.toHaveBeenCalled();
  });

  it("troca diretamente de um canal de voz para outro sem chamar leaveChannel (join cuida da troca)", async () => {
    voiceState.channelSlug = "lobby-neon";
    voiceState.status = "connected";

    const view = render(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="lobby-neon"
        onNavigateChannel={() => {}}
        onLogout={() => {}}
      />,
    );

    view.rerender(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="squad-alpha"
        onNavigateChannel={() => {}}
        onLogout={() => {}}
      />,
    );

    await waitFor(() => {
      expect(joinVoiceChannelMock).toHaveBeenCalledWith("squad-alpha");
    });
    expect(leaveVoiceChannelMock).not.toHaveBeenCalled();
  });

  it("não reentra no mesmo canal de voz ao qual já está conectado", async () => {
    voiceState.channelSlug = "lobby-neon";
    voiceState.status = "connected";

    render(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="lobby-neon"
        onNavigateChannel={() => {}}
        onLogout={() => {}}
      />,
    );

    await act(async () => Promise.resolve());
    expect(joinVoiceChannelMock).not.toHaveBeenCalled();
  });

  it("permite reentrar no mesmo canal de voz depois de sair sem mudar a rota", () => {
    voiceState.channelSlug = "lobby-neon";
    voiceState.status = "connected";
    const props = {
      session,
      serverId: "respawn-hq",
      channelId: "lobby-neon" as const,
      onNavigateChannel: () => {},
      onLogout: () => {},
    };
    const view = render(<MainLayout {...props} />);

    voiceState.channelSlug = null;
    voiceState.status = "disconnected";
    view.rerender(<MainLayout {...props} />);
    joinVoiceChannelMock.mockClear();

    fireEvent.click(screen.getByRole("button", { name: "Entrar no canal de voz" }));

    expect(joinVoiceChannelMock).toHaveBeenCalledTimes(1);
    expect(joinVoiceChannelMock).toHaveBeenCalledWith("lobby-neon");
  });

  it("permite tentar novamente no mesmo canal de voz depois de um erro", () => {
    voiceState.channelSlug = "lobby-neon";
    voiceState.status = "error";
    voiceState.error = "Falha ao conectar.";

    render(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="lobby-neon"
        onNavigateChannel={() => {}}
        onLogout={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));

    expect(joinVoiceChannelMock).toHaveBeenCalledTimes(1);
    expect(joinVoiceChannelMock).toHaveBeenCalledWith("lobby-neon");
  });

  it("sai do canal de voz ao desmontar o layout", async () => {
    voiceState.channelSlug = "lobby-neon";
    voiceState.status = "connected";

    const view = render(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="lobby-neon"
        onNavigateChannel={() => {}}
        onLogout={() => {}}
      />,
    );

    view.unmount();

    await waitFor(() => {
      expect(leaveVoiceChannelMock).toHaveBeenCalledTimes(1);
    });
  });

  it("reseta a sessão de voz antes de concluir o logout", async () => {
    const sequence: string[] = [];
    resetVoiceSessionMock.mockImplementation(async () => {
      sequence.push("reset-voice");
    });
    const onLogout = vi.fn(() => {
      sequence.push("logout");
    });
    voiceState.channelSlug = "lobby-neon";
    voiceState.status = "connected";
    voiceState.micMuted = true;
    voiceState.deafened = true;
    voiceState.cameraEnabled = true;

    render(
      <MainLayout
        session={session}
        serverId="respawn-hq"
        channelId="lobby-neon"
        onNavigateChannel={() => {}}
        onLogout={onLogout}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Sair desta sessão" }));

    await waitFor(() => {
      expect(resetVoiceSessionMock).toHaveBeenCalledTimes(1);
    });
    expect(sequence).toEqual(["reset-voice", "logout"]);
    expect(leaveVoiceChannelMock).not.toHaveBeenCalled();
    expect(onLogout).toHaveBeenCalledTimes(1);
  });
});
