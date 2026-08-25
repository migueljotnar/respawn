import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { getChannel } from "../../data/community-mocks.js";
import { ChatSendError, type ChatMessageDto } from "../../lib/chat-ws.js";
import type { VoiceParticipant } from "../../stores/voice-store.js";
import {
  ChatPanel,
  countNewlyAppendedMessages,
  renderInlineMarkdown,
  shouldGroupWithPrevious,
} from "./ChatPanel.js";

function makeVoiceParticipant(overrides: Partial<VoiceParticipant> = {}): VoiceParticipant {
  return {
    id: "user-2",
    name: "Fulano",
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderPanel(overrides: Partial<Parameters<typeof ChatPanel>[0]> = {}) {
  return render(
    <ChatPanel
      channel={getChannel("chat-geral")!}
      messages={[]}
      isLoadingHistory={false}
      hasMoreHistory={false}
      historyError={null}
      resyncStatus="idle"
      onlineCount={1}
      typingUsers={[]}
      currentUserId="user-1"
      onOpenNavigation={() => {}}
      onOpenMembers={() => {}}
      onSendMessage={async () => {}}
      onLoadOlderMessages={() => {}}
      onRetryHistory={() => {}}
      onTypingStart={() => {}}
      onTypingStop={() => {}}
      onJoinVoice={() => {}}
      {...overrides}
    />,
  );
}

function makeMessage(id: string, createdAt: string, authorId = "author-1"): ChatMessageDto {
  return {
    id,
    channelSlug: "chat-geral",
    content: id,
    createdAt,
    author: {
      id: authorId,
      username: "someone",
      displayName: null,
      avatarUrl: null,
      role: "NOVATO",
    },
  };
}

// countNewlyAppendedMessages é o que corrige o QA-F2 P3: o contador de "N
// novas mensagens" incrementava sempre em 1 por atualização, subcontando
// quando várias mensagens chegavam de uma vez (ex.: uma página inteira do
// resync). Testamos lotes de 1, 2 e 50 diretamente, sem depender de
// scroll/layout real (jsdom não simula scrollHeight/clientHeight de verdade).
describe("countNewlyAppendedMessages", () => {
  it("conta 1 quando só uma mensagem nova chega", () => {
    const previousIds = new Set(["m1"]);
    const messages = [makeMessage("m1", "2026-01-01T00:00:00.000Z"), makeMessage("m2", "2026-01-01T00:00:01.000Z")];

    const count = countNewlyAppendedMessages(messages, previousIds, {
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "m1",
    });

    expect(count).toBe(1);
  });

  it("conta 2 quando duas mensagens chegam juntas na mesma atualização", () => {
    const previousIds = new Set(["m1"]);
    const messages = [
      makeMessage("m1", "2026-01-01T00:00:00.000Z"),
      makeMessage("m2", "2026-01-01T00:00:01.000Z"),
      makeMessage("m3", "2026-01-01T00:00:02.000Z"),
    ];

    const count = countNewlyAppendedMessages(messages, previousIds, {
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "m1",
    });

    expect(count).toBe(2);
  });

  it("conta 50 quando uma página inteira do resync chega de uma vez", () => {
    const previousIds = new Set(["m0"]);
    const batch = Array.from({ length: 50 }, (_unused, index) =>
      makeMessage(`new-${index}`, `2026-01-01T00:01:${String(index).padStart(2, "0")}.000Z`),
    );
    const messages = [makeMessage("m0", "2026-01-01T00:00:00.000Z"), ...batch];

    const count = countNewlyAppendedMessages(messages, previousIds, {
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "m0",
    });

    expect(count).toBe(50);
  });

  it("não conta mensagens antigas trazidas por prepend (scroll infinito)", () => {
    const previousIds = new Set(["m5"]);
    const olderMessages = [
      makeMessage("m1", "2025-12-31T23:00:00.000Z"),
      makeMessage("m2", "2025-12-31T23:01:00.000Z"),
    ];
    const messages = [...olderMessages, makeMessage("m5", "2026-01-01T00:00:00.000Z")];

    const count = countNewlyAppendedMessages(messages, previousIds, {
      createdAt: "2026-01-01T00:00:00.000Z",
      id: "m5",
    });

    expect(count).toBe(0);
  });

  it("usa createdAt + id para contar mensagens novas com o mesmo timestamp", () => {
    const timestamp = "2026-01-01T00:00:00.000Z";
    const previousIds = new Set(["m-middle"]);
    const messages = [
      makeMessage("m-before", timestamp),
      makeMessage("m-middle", timestamp),
      makeMessage("m-next", timestamp),
    ];

    const count = countNewlyAppendedMessages(messages, previousIds, {
      createdAt: timestamp,
      id: "m-middle",
    });

    expect(count).toBe(1);
  });

  it("ignora ids já vistos mesmo que createdAt seja mais recente que o cursor antigo", () => {
    const previousIds = new Set(["m1"]);
    const messages = [makeMessage("m1", "2026-01-01T00:00:00.000Z")];

    const count = countNewlyAppendedMessages(messages, previousIds, undefined);

    expect(count).toBe(0);
  });
});

describe("shouldGroupWithPrevious", () => {
  it("agrupa mensagens do mesmo autor dentro da janela de 5 minutos", () => {
    const previous = makeMessage("a", "2026-01-01T00:00:00.000Z", "author-1");
    const current = makeMessage("b", "2026-01-01T00:02:00.000Z", "author-1");

    expect(shouldGroupWithPrevious(current, previous)).toBe(true);
  });

  it("não agrupa mensagens de autores diferentes", () => {
    const previous = makeMessage("a", "2026-01-01T00:00:00.000Z", "author-1");
    const current = makeMessage("b", "2026-01-01T00:00:01.000Z", "author-2");

    expect(shouldGroupWithPrevious(current, previous)).toBe(false);
  });

  it("não agrupa quando passou mais de 5 minutos", () => {
    const previous = makeMessage("a", "2026-01-01T00:00:00.000Z", "author-1");
    const current = makeMessage("b", "2026-01-01T00:06:00.000Z", "author-1");

    expect(shouldGroupWithPrevious(current, previous)).toBe(false);
  });
});

describe("renderInlineMarkdown", () => {
  it("renderiza negrito, itálico e código inline como elementos separados", () => {
    const nodes = renderInlineMarkdown("**bold** e *italico* e `codigo`");

    expect(nodes).toHaveLength(5);
  });

  it("mantém texto puro quando não há marcação", () => {
    const nodes = renderInlineMarkdown("apenas texto simples");

    expect(nodes).toEqual(["apenas texto simples"]);
  });
});

describe("ChatPanel — envio idempotente e rascunho", () => {
  it("reutiliza o clientMessageId no retry manual e limpa o valor bruto submetido", async () => {
    const onSendMessage = vi
      .fn<(content: string, clientMessageId: string) => Promise<void>>()
      .mockRejectedValueOnce(new ChatSendError("timeout", "ack_timeout"))
      .mockResolvedValueOnce(undefined);

    renderPanel({ onSendMessage });

    const input = screen.getByRole("textbox", {
      name: /Mensagem para chat-geral/i,
    }) as HTMLInputElement;
    const sendButton = screen.getByRole("button", { name: "Enviar mensagem" });

    fireEvent.change(input, { target: { value: "  mensagem com espaços  " } });
    fireEvent.click(sendButton);

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(1));
    await screen.findByText(/confirmar o envio/i);
    expect(input.value).toBe("  mensagem com espaços  ");

    const firstClientMessageId = onSendMessage.mock.calls[0]![1];
    await waitFor(() => expect((sendButton as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(sendButton);

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2));
    expect(onSendMessage.mock.calls[0]).toEqual([
      "mensagem com espaços",
      firstClientMessageId,
    ]);
    expect(onSendMessage.mock.calls[1]).toEqual([
      "mensagem com espaços",
      firstClientMessageId,
    ]);
    await waitFor(() => expect(input.value).toBe(""));
  });

  it("não apaga texto editado enquanto o ACK está pendente", async () => {
    let resolveSend!: () => void;
    const pendingSend = new Promise<void>((resolve) => {
      resolveSend = resolve;
    });
    const onSendMessage = vi.fn(() => pendingSend);

    renderPanel({ onSendMessage });

    const input = screen.getByRole("textbox", {
      name: /Mensagem para chat-geral/i,
    }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "texto original" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    fireEvent.change(input, { target: { value: "novo rascunho" } });

    await act(async () => resolveSend());

    await waitFor(() => expect(input.value).toBe("novo rascunho"));
  });

  it("nao reaplica erro de uma tentativa abandonada enquanto o ACK estava pendente", async () => {
    let rejectSend!: (reason: Error) => void;
    const pendingSend = new Promise<void>((_resolve, reject) => {
      rejectSend = reject;
    });
    const onSendMessage = vi.fn(() => pendingSend);

    renderPanel({ onSendMessage });

    const input = screen.getByRole("textbox", {
      name: /Mensagem para chat-geral/i,
    }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "tentativa antiga" } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar mensagem" }));
    fireEvent.change(input, { target: { value: "rascunho atual" } });

    await act(async () => rejectSend(new ChatSendError("timeout", "ack_timeout")));

    expect(input.value).toBe("rascunho atual");
    expect(screen.queryByText(/confirmar o envio/i)).toBeNull();
  });

  it("descarta o id do retry quando o rascunho e editado e depois restaurado", async () => {
    const onSendMessage = vi
      .fn<(content: string, clientMessageId: string) => Promise<void>>()
      .mockRejectedValueOnce(new ChatSendError("timeout", "ack_timeout"))
      .mockResolvedValueOnce(undefined);

    renderPanel({ onSendMessage });

    const input = screen.getByRole("textbox", {
      name: /Mensagem para chat-geral/i,
    }) as HTMLInputElement;
    const sendButton = screen.getByRole("button", { name: "Enviar mensagem" });

    fireEvent.change(input, { target: { value: "mensagem repetivel" } });
    fireEvent.click(sendButton);
    await screen.findByText(/confirmar o envio/i);

    const abandonedClientMessageId = onSendMessage.mock.calls[0]![1];
    fireEvent.change(input, { target: { value: "outro rascunho" } });
    fireEvent.change(input, { target: { value: "mensagem repetivel" } });
    fireEvent.click(sendButton);

    await waitFor(() => expect(onSendMessage).toHaveBeenCalledTimes(2));
    expect(onSendMessage.mock.calls[1]![1]).not.toBe(abandonedClientMessageId);
    await waitFor(() => expect(input.value).toBe(""));
  });
});

describe("ChatPanel — typing, voz e recuperação", () => {
  it("emite typing:start uma vez por atividade e stop somente após o TTL", () => {
    vi.useFakeTimers();
    const onTypingStart = vi.fn();
    const onTypingStop = vi.fn();

    renderPanel({ onTypingStart, onTypingStop });

    const input = screen.getByRole("textbox", {
      name: /Mensagem para chat-geral/i,
    });
    fireEvent.change(input, { target: { value: "a" } });
    fireEvent.change(input, { target: { value: "ab" } });
    fireEvent.change(input, { target: { value: "abc" } });

    expect(onTypingStart).toHaveBeenCalledTimes(1);
    expect(onTypingStop).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1_999));
    expect(onTypingStop).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onTypingStop).toHaveBeenCalledTimes(1);

    fireEvent.change(input, { target: { value: "abcd" } });
    expect(onTypingStart).toHaveBeenCalledTimes(2);
  });

  it("não mostra composer em canal de voz", () => {
    renderPanel({ channel: getChannel("lobby-neon")! });

    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Enviar mensagem" })).toBeNull();
  });

  it("mostra falha de histórico com ação de retry", () => {
    const onRetryHistory = vi.fn();
    renderPanel({ historyError: "Histórico indisponível", onRetryHistory });

    expect(screen.getByRole("alert").textContent).toContain("Histórico indisponível");
    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onRetryHistory).toHaveBeenCalledTimes(1);
  });
});

describe("ChatPanel — status real de voz em canal de voz", () => {
  it("mostra que não está conectado por padrão", () => {
    renderPanel({ channel: getChannel("lobby-neon")! });

    expect(screen.getByRole("status").textContent).toContain(
      "Você não está conectado a esta sala de voz.",
    );
  });

  it("mostra 'Conectando...' enquanto a sala de voz está conectando", () => {
    renderPanel({ channel: getChannel("lobby-neon")!, voiceStatus: "connecting" });

    expect(screen.getByRole("status").textContent).toContain("Conectando à sala de voz...");
  });

  it("mostra conectado sem contagem quando só o usuário local está na sala", () => {
    renderPanel({
      channel: getChannel("lobby-neon")!,
      voiceStatus: "connected",
      voiceParticipants: [makeVoiceParticipant({ id: "user-1", isLocal: true })],
    });

    expect(screen.getByRole("status").textContent).toContain("Conectado à sala de voz.");
  });

  it("mostra a contagem de participantes quando conectado com outras pessoas", () => {
    renderPanel({
      channel: getChannel("lobby-neon")!,
      voiceStatus: "connected",
      voiceParticipants: [
        makeVoiceParticipant({ id: "user-1", isLocal: true }),
        makeVoiceParticipant({ id: "user-2", name: "Fulano" }),
        makeVoiceParticipant({ id: "user-3", name: "Beltrano" }),
      ],
    });

    expect(screen.getByRole("status").textContent).toContain("Conectado à sala de voz · 2 pessoas.");
  });

  it("mostra a mensagem de erro real quando a conexão de voz falha", () => {
    renderPanel({
      channel: getChannel("lobby-neon")!,
      voiceStatus: "error",
      voiceError: "Não foi possível ativar o microfone.",
    });

    expect(screen.getByRole("status").textContent).toContain(
      "Não foi possível ativar o microfone.",
    );
  });

  it("oferece uma ação acessível para entrar quando está desconectado", () => {
    const onJoinVoice = vi.fn();
    renderPanel({
      channel: getChannel("lobby-neon")!,
      voiceStatus: "disconnected",
      onJoinVoice,
    });

    fireEvent.click(screen.getByRole("button", { name: "Entrar no canal de voz" }));
    expect(onJoinVoice).toHaveBeenCalledTimes(1);
  });

  it("oferece tentar novamente quando a conexão falha", () => {
    const onJoinVoice = vi.fn();
    renderPanel({
      channel: getChannel("lobby-neon")!,
      voiceStatus: "error",
      voiceError: "Falha ao conectar.",
      onJoinVoice,
    });

    fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
    expect(onJoinVoice).toHaveBeenCalledTimes(1);
  });
});

describe("ChatPanel — grid de vídeo em canal de voz", () => {
  it("mostra o grid de vídeo quando algum participante está com a câmera ligada", () => {
    renderPanel({
      channel: getChannel("lobby-neon")!,
      voiceStatus: "connected",
      voiceParticipants: [
        makeVoiceParticipant({
          id: "user-1",
          isLocal: true,
          cameraTrack: { attach: () => {}, detach: () => {} } as never,
        }),
      ],
    });

    expect(screen.queryByRole("region", { name: "Vídeos da chamada de voz" })).not.toBeNull();
  });

  it("não mostra o grid de vídeo em canal de texto", () => {
    renderPanel({
      channel: getChannel("chat-geral")!,
      voiceParticipants: [
        makeVoiceParticipant({
          id: "user-1",
          isLocal: true,
          cameraTrack: { attach: () => {}, detach: () => {} } as never,
        }),
      ],
    });

    expect(screen.queryByRole("region", { name: "Vídeos da chamada de voz" })).toBeNull();
  });

  it("não mostra o grid quando ninguém está com a câmera ligada", () => {
    renderPanel({
      channel: getChannel("lobby-neon")!,
      voiceStatus: "connected",
      voiceParticipants: [makeVoiceParticipant({ id: "user-1", isLocal: true })],
    });

    expect(screen.queryByRole("region", { name: "Vídeos da chamada de voz" })).toBeNull();
  });
});
