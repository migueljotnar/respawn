import { io as createSocket } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ChatSendError,
  sendChatMessage,
  startTyping,
  stopTyping,
  type ChatSocket,
} from "./chat-ws.js";

const sockets: ChatSocket[] = [];

function createDisconnectedSocket(): ChatSocket {
  const socket = createSocket("http://127.0.0.1:9", {
    autoConnect: false,
    reconnection: false,
  }) as unknown as ChatSocket;
  sockets.push(socket);
  return socket;
}

function bufferedPacketCount(socket: ChatSocket): number {
  return (socket as unknown as { sendBuffer: unknown[] }).sendBuffer.length;
}

afterEach(() => {
  for (const socket of sockets.splice(0)) {
    socket.close();
  }

  vi.useRealTimers();
});

describe("sendChatMessage — offline e timeout do Socket.IO", () => {
  it("rejeita antes do emit quando já está offline e não cria pacote bufferizado", async () => {
    const socket = createDisconnectedSocket();

    await expect(
      sendChatMessage(socket, "chat-geral", "não deve sair", "client-offline"),
    ).rejects.toMatchObject({
      outcome: "offline",
      code: "not_connected",
    });

    expect(bufferedPacketCount(socket)).toBe(0);
  });

  it("remove do sendBuffer o pacote cujo ACK expirou durante uma queda", async () => {
    vi.useFakeTimers();
    const socket = createDisconnectedSocket();
    let connectedReads = 0;

    // Simula a corrida exata: o precheck enxerga a conexão ativa, mas ela
    // cai antes de Socket.emit decidir entre transporte e sendBuffer.
    Object.defineProperty(socket, "connected", {
      configurable: true,
      get() {
        connectedReads += 1;
        return connectedReads === 1;
      },
    });

    const sendPromise = sendChatMessage(
      socket,
      "chat-geral",
      "pacote em corrida",
      "client-timeout",
    );
    const rejection = expect(sendPromise).rejects.toMatchObject({
      outcome: "timeout",
      code: "ack_timeout",
    });

    expect(bufferedPacketCount(socket)).toBe(1);

    await vi.advanceTimersByTimeAsync(8_000);
    await rejection;

    expect(bufferedPacketCount(socket)).toBe(0);
  });
});

describe("typing efemero", () => {
  function simulateDropBetweenPrecheckAndEmit(socket: ChatSocket): void {
    let connectedReads = 0;

    Object.defineProperty(socket, "connected", {
      configurable: true,
      get() {
        connectedReads += 1;
        return connectedReads === 1;
      },
    });
  }

  it("nao bufferiza typing:start para replay depois de uma queda", () => {
    const socket = createDisconnectedSocket();
    simulateDropBetweenPrecheckAndEmit(socket);

    startTyping(socket, "chat-geral");

    expect(bufferedPacketCount(socket)).toBe(0);
  });

  it("nao bufferiza typing:stop para replay depois de uma queda", () => {
    const socket = createDisconnectedSocket();
    simulateDropBetweenPrecheckAndEmit(socket);

    stopTyping(socket, "chat-geral");

    expect(bufferedPacketCount(socket)).toBe(0);
  });
});
