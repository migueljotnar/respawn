import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const MockRoomEvent = {
  Connected: "connected",
  Disconnected: "disconnected",
  ParticipantConnected: "participantConnected",
  ParticipantDisconnected: "participantDisconnected",
  TrackMuted: "trackMuted",
  TrackUnmuted: "trackUnmuted",
  LocalTrackPublished: "localTrackPublished",
  LocalTrackUnpublished: "localTrackUnpublished",
  TrackSubscribed: "trackSubscribed",
  TrackUnsubscribed: "trackUnsubscribed",
  ActiveSpeakersChanged: "activeSpeakersChanged",
  ConnectionQualityChanged: "connectionQualityChanged",
  AudioPlaybackStatusChanged: "audioPlaybackChanged",
} as const;

const MockConnectionQuality = {
  Excellent: "excellent",
  Good: "good",
  Poor: "poor",
  Unknown: "unknown",
} as const;

const MockTrack = {
  Kind: { Audio: "audio", Video: "video" },
  Source: { Camera: "camera", Microphone: "microphone", ScreenShare: "screen_share" },
} as const;

const MockVideoPresets = {
  h1080: { resolution: { width: 1920, height: 1080 } },
} as const;

type Handler = (...args: unknown[]) => void;

class FakeParticipant {
  isSpeaking = false;
  isMicrophoneEnabled = true;
  isCameraEnabled = false;
  isScreenShareEnabled = false;
  // No SDK real, getTrackPublication já existe na classe base Participant —
  // tanto participantes locais quanto remotos precisam dele (ex.: para achar
  // o videoTrack da câmera de um participante remoto ao montar o grid).
  getTrackPublication = vi.fn((_source: string): FakeTrackPublication | undefined => undefined);

  constructor(
    public identity: string,
    public name: string,
    public isLocal = false,
  ) {}
}

interface FakeAudioSenderStats {
  roundTripTime?: number;
}

class FakeTrackPublication {
  audioTrack: { getSenderStats: () => Promise<FakeAudioSenderStats | undefined> } | undefined;
  videoTrack: FakeRemoteTrack | undefined;

  constructor(public trackSid: string) {}
}

class FakeLocalParticipant extends FakeParticipant {
  setMicrophoneEnabled = vi.fn(async (enabled: boolean) => {
    this.isMicrophoneEnabled = enabled;
    return undefined;
  });
  setCameraEnabled = vi.fn(async (enabled: boolean) => {
    this.isCameraEnabled = enabled;
    return undefined;
  });
  setScreenShareEnabled = vi.fn(async (enabled: boolean) => {
    this.isScreenShareEnabled = enabled;
    return undefined;
  });

  constructor(identity: string, name: string) {
    super(identity, name, true);
  }
}

/** Dublê de RemoteTrack — o que track.attach()/track.detach() fazem de verdade
 * no SDK (criar/gerenciar um HTMLMediaElement), simplificado para o teste. */
class FakeRemoteTrack {
  constructor(public kind: string) {}

  attach = vi.fn((element?: HTMLMediaElement): HTMLMediaElement => {
    return element ?? document.createElement("audio");
  });

  detach = vi.fn((_element?: HTMLMediaElement): void => {});
}

class FakeRoom {
  localParticipant = new FakeLocalParticipant("local-user", "Local User");
  remoteParticipants = new Map<string, FakeParticipant>();
  connect = vi.fn(async () => undefined);
  disconnect = vi.fn(async () => undefined);
  canPlaybackAudio = true;
  startAudio = vi.fn(async () => {
    this.canPlaybackAudio = true;
  });
  private readonly listeners = new Map<string, Set<Handler>>();

  on(event: string, handler: Handler): this {
    const set = this.listeners.get(event) ?? new Set<Handler>();
    set.add(handler);
    this.listeners.set(event, set);
    return this;
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }

  /** Só para o teste: simula o servidor/SDK disparando um evento. */
  simulate(event: string, ...args: unknown[]): void {
    for (const handler of this.listeners.get(event) ?? []) {
      handler(...args);
    }
  }
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

const createRoomMock = vi.fn<() => FakeRoom>();
const fetchTokenMock = vi.fn();

vi.mock("../lib/voice-client.js", () => ({
  RoomEvent: MockRoomEvent,
  ConnectionQuality: MockConnectionQuality,
  Track: MockTrack,
  VideoPresets: MockVideoPresets,
  createRoom: createRoomMock,
}));

vi.mock("../lib/voice-api.js", () => ({
  voiceApi: { fetchToken: fetchTokenMock },
}));

const { useVoiceStore } = await import("./voice-store.js");

const INITIAL_STATE = {
  status: "disconnected" as const,
  channelSlug: null,
  roomName: null,
  error: null,
  connectionQuality: null,
  rttMs: null,
  audioPlaybackBlocked: false,
  participants: {},
  micMuted: false,
  deafened: false,
  cameraEnabled: false,
  screenShareEnabled: false,
  screenSharePreset: null,
};

beforeEach(async () => {
  await useVoiceStore.getState().leaveChannel();
  useVoiceStore.setState(INITIAL_STATE);
  createRoomMock.mockReset();
  fetchTokenMock.mockReset();
  document.querySelectorAll('[data-testid="voice-remote-audio-container"]').forEach((node) => {
    node.remove();
  });
});

describe("joinChannel", () => {
  it("conecta com sucesso: status fica 'connected', publica o mic e registra o participante local", async () => {
    const room = new FakeRoom();
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });

    await useVoiceStore.getState().joinChannel("lobby-neon");

    const state = useVoiceStore.getState();
    expect(state.status).toBe("connected");
    expect(state.roomName).toBe("voice:lobby-neon");
    expect(room.connect).toHaveBeenCalledWith("ws://127.0.0.1:7880", "fake-jwt");
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(state.participants["local-user"]).toMatchObject({
      id: "local-user",
      isLocal: true,
      micMuted: false,
    });
  });

  it("respeita micMuted já definido antes de entrar (não publica áudio se já estava mutado)", async () => {
    const room = new FakeRoom();
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    useVoiceStore.setState({ micMuted: true });

    await useVoiceStore.getState().joinChannel("lobby-neon");

    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
  });

  it("status vira 'error' quando a busca do token falha", async () => {
    fetchTokenMock.mockRejectedValue(new Error("403 simulado"));

    await useVoiceStore.getState().joinChannel("lobby-neon");

    const state = useVoiceStore.getState();
    expect(state.status).toBe("error");
    expect(state.error).toBe("403 simulado");
    expect(createRoomMock).not.toHaveBeenCalled();
  });

  it("status vira 'error' quando room.connect() falha", async () => {
    const room = new FakeRoom();
    room.connect.mockRejectedValueOnce(new Error("falha de conexão RTC"));
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });

    await useVoiceStore.getState().joinChannel("lobby-neon");

    expect(useVoiceStore.getState().status).toBe("error");
    expect(room.disconnect).toHaveBeenCalledTimes(1);
  });

  it("registra participantes que já estavam na sala quando a conexão terminou", async () => {
    const room = new FakeRoom();
    const remote = new FakeParticipant("remote-existing", "Já estava aqui");
    room.remoteParticipants.set(remote.identity, remote);
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });

    await useVoiceStore.getState().joinChannel("lobby-neon");

    expect(useVoiceStore.getState().participants[remote.identity]).toMatchObject({
      id: remote.identity,
      name: remote.name,
      isLocal: false,
    });
  });

  it("um join antigo aguardando o microfone não ressuscita sobre uma sala mais nova", async () => {
    const roomA = new FakeRoom();
    const roomB = new FakeRoom();
    const pendingMic = deferred<undefined>();
    roomA.localParticipant.setMicrophoneEnabled.mockImplementationOnce(() => pendingMic.promise);
    createRoomMock.mockReturnValueOnce(roomA).mockReturnValueOnce(roomB);
    fetchTokenMock
      .mockResolvedValueOnce({
        token: "token-a",
        url: "ws://127.0.0.1:7880",
        roomName: "voice:lobby-neon",
      })
      .mockResolvedValueOnce({
        token: "token-b",
        url: "ws://127.0.0.1:7880",
        roomName: "voice:squad-alpha",
      });

    const joinA = useVoiceStore.getState().joinChannel("lobby-neon");
    await vi.waitFor(() => {
      expect(roomA.localParticipant.setMicrophoneEnabled).toHaveBeenCalled();
    });

    await useVoiceStore.getState().joinChannel("squad-alpha");
    pendingMic.resolve(undefined);
    await joinA;

    expect(useVoiceStore.getState()).toMatchObject({
      status: "connected",
      channelSlug: "squad-alpha",
      roomName: "voice:squad-alpha",
    });
  });

  it("eventos de uma conexão obsoleta não contaminam a sala atual", async () => {
    const roomA = new FakeRoom();
    const roomB = new FakeRoom();
    const pendingConnect = deferred<undefined>();
    roomA.connect.mockImplementationOnce(() => pendingConnect.promise);
    createRoomMock.mockReturnValueOnce(roomA).mockReturnValueOnce(roomB);
    fetchTokenMock
      .mockResolvedValueOnce({
        token: "token-a",
        url: "ws://127.0.0.1:7880",
        roomName: "voice:lobby-neon",
      })
      .mockResolvedValueOnce({
        token: "token-b",
        url: "ws://127.0.0.1:7880",
        roomName: "voice:squad-alpha",
      });

    const joinA = useVoiceStore.getState().joinChannel("lobby-neon");
    await vi.waitFor(() => expect(roomA.connect).toHaveBeenCalled());
    await useVoiceStore.getState().joinChannel("squad-alpha");

    roomA.simulate(
      MockRoomEvent.ParticipantConnected,
      new FakeParticipant("stale-user", "Sala antiga"),
    );
    expect(useVoiceStore.getState().participants["stale-user"]).toBeUndefined();

    pendingConnect.resolve(undefined);
    await joinA;
  });

  it("mantém micMuted coerente quando o navegador nega o microfone inicial", async () => {
    const room = new FakeRoom();
    room.localParticipant.isMicrophoneEnabled = false;
    room.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
      new DOMException("permissão negada", "NotAllowedError"),
    );
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });

    await useVoiceStore.getState().joinChannel("lobby-neon");

    expect(useVoiceStore.getState()).toMatchObject({
      status: "connected",
      micMuted: true,
      error: "Não foi possível ativar o microfone.",
    });
    expect(useVoiceStore.getState().participants["local-user"]?.micMuted).toBe(true);
  });

  it("uma chamada mais nova invalida a anterior (troca rápida de canal não deixa estado obsoleto)", async () => {
    const createdRooms: FakeRoom[] = [];
    createRoomMock.mockImplementation(() => {
      const room = new FakeRoom();
      createdRooms.push(room);
      return room;
    });

    let resolveTokenA!: (value: { token: string; url: string; roomName: string }) => void;
    const tokenAPromise = new Promise<{ token: string; url: string; roomName: string }>((resolve) => {
      resolveTokenA = resolve;
    });

    fetchTokenMock.mockImplementationOnce(() => tokenAPromise);
    fetchTokenMock.mockImplementationOnce(async () => ({
      token: "token-b",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:squad-alpha",
    }));

    const joinA = useVoiceStore.getState().joinChannel("lobby-neon");
    const joinB = useVoiceStore.getState().joinChannel("squad-alpha");

    // B resolve primeiro (token síncrono); A só resolve DEPOIS, quando B já
    // concluiu — o resultado de A não pode sobrescrever o estado de B nem
    // vazar uma sala paralela para o store.
    await joinB;
    resolveTokenA({ token: "token-a", url: "ws://127.0.0.1:7880", roomName: "voice:lobby-neon" });
    await joinA;

    const state = useVoiceStore.getState();
    expect(state.roomName).toBe("voice:squad-alpha");
    expect(state.status).toBe("connected");
    // A geração de A fica obsoleta assim que B assume — a store detecta isso
    // logo após o fetch do token de A resolver, ANTES de sequer criar/
    // conectar um Room para ela. Por isso só um Room chega a ser criado
    // (o de B) em todo o cenário.
    expect(createdRooms).toHaveLength(1);
    expect(createdRooms[0]?.connect).toHaveBeenCalledWith("ws://127.0.0.1:7880", "token-b");
  });
});

describe("eventos do Room refletidos no estado", () => {
  async function connectRoom(): Promise<FakeRoom> {
    const room = new FakeRoom();
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");
    return room;
  }

  it("ParticipantConnected adiciona um participante remoto", async () => {
    const room = await connectRoom();
    const remote = new FakeParticipant("remote-user", "Fulano");

    room.simulate(MockRoomEvent.ParticipantConnected, remote);

    expect(useVoiceStore.getState().participants["remote-user"]).toMatchObject({
      id: "remote-user",
      name: "Fulano",
      isLocal: false,
    });
  });

  it("ParticipantDisconnected remove o participante", async () => {
    const room = await connectRoom();
    const remote = new FakeParticipant("remote-user", "Fulano");
    room.simulate(MockRoomEvent.ParticipantConnected, remote);

    room.simulate(MockRoomEvent.ParticipantDisconnected, remote);

    expect(useVoiceStore.getState().participants["remote-user"]).toBeUndefined();
  });

  it("ActiveSpeakersChanged marca isSpeaking só para quem está na lista de quem fala", async () => {
    const room = await connectRoom();
    const remoteA = new FakeParticipant("remote-a", "A");
    const remoteB = new FakeParticipant("remote-b", "B");
    room.simulate(MockRoomEvent.ParticipantConnected, remoteA);
    room.simulate(MockRoomEvent.ParticipantConnected, remoteB);

    room.simulate(MockRoomEvent.ActiveSpeakersChanged, [remoteA]);

    const state = useVoiceStore.getState();
    expect(state.participants["remote-a"]?.isSpeaking).toBe(true);
    expect(state.participants["remote-b"]?.isSpeaking).toBe(false);
  });

  it("Disconnected emitido pelo SDK (ex.: sala encerrada pelo servidor) volta o status para 'disconnected'", async () => {
    const room = await connectRoom();

    room.simulate(MockRoomEvent.Disconnected);

    const state = useVoiceStore.getState();
    expect(state.status).toBe("disconnected");
    expect(state.participants).toEqual({});
  });
});

describe("toggleMic", () => {
  it("alterna micMuted e chama setMicrophoneEnabled com o valor invertido quando conectado", async () => {
    const room = new FakeRoom();
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");
    room.localParticipant.setMicrophoneEnabled.mockClear();

    await useVoiceStore.getState().toggleMic();

    expect(useVoiceStore.getState().micMuted).toBe(true);
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(false);
  });

  it("alterna micMuted sem erro quando não há sala conectada", async () => {
    await expect(useVoiceStore.getState().toggleMic()).resolves.toBeUndefined();
    expect(useVoiceStore.getState().micMuted).toBe(true);
  });

  it("restaura o estado real e expõe erro quando o SDK rejeita a alteração", async () => {
    const room = new FakeRoom();
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");
    room.localParticipant.setMicrophoneEnabled.mockRejectedValueOnce(
      new DOMException("dispositivo ocupado", "NotReadableError"),
    );

    await expect(useVoiceStore.getState().toggleMic()).resolves.toBeUndefined();

    expect(useVoiceStore.getState()).toMatchObject({
      micMuted: false,
      error: "Não foi possível atualizar o microfone.",
    });
  });

  it("preserva a última intenção quando dois cliques rápidos resolvem em momentos diferentes", async () => {
    const room = new FakeRoom();
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");
    room.localParticipant.setMicrophoneEnabled.mockClear();

    const firstUpdate = deferred<void>();
    room.localParticipant.setMicrophoneEnabled
      .mockImplementationOnce(async (enabled: boolean) => {
        await firstUpdate.promise;
        room.localParticipant.isMicrophoneEnabled = enabled;
        return undefined;
      })
      .mockImplementationOnce(async (enabled: boolean) => {
        room.localParticipant.isMicrophoneEnabled = enabled;
        return undefined;
      });

    const mute = useVoiceStore.getState().toggleMic();
    const unmute = useVoiceStore.getState().toggleMic();

    await vi.waitFor(() => {
      expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenCalledTimes(1);
    });
    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenNthCalledWith(1, false);

    firstUpdate.resolve();
    await Promise.all([mute, unmute]);

    expect(room.localParticipant.setMicrophoneEnabled).toHaveBeenNthCalledWith(2, true);
    expect(room.localParticipant.isMicrophoneEnabled).toBe(true);
    expect(useVoiceStore.getState().micMuted).toBe(false);
  });
});

describe("toggleCamera", () => {
  it("alterna cameraEnabled e chama setCameraEnabled com o valor novo quando conectado", async () => {
    const room = new FakeRoom();
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");

    await useVoiceStore.getState().toggleCamera();

    expect(useVoiceStore.getState().cameraEnabled).toBe(true);
    // A resolução até 1080p precisa chegar de verdade na chamada real do SDK,
    // não só existir como intenção na UI.
    expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true, {
      resolution: { width: 1920, height: 1080 },
    });

    await useVoiceStore.getState().toggleCamera();

    expect(useVoiceStore.getState().cameraEnabled).toBe(false);
    expect(room.localParticipant.setCameraEnabled).toHaveBeenCalledWith(false, undefined);
  });

  it("alterna cameraEnabled sem erro quando não há sala conectada", async () => {
    await expect(useVoiceStore.getState().toggleCamera()).resolves.toBeUndefined();
    expect(useVoiceStore.getState().cameraEnabled).toBe(true);
  });

  it("restaura o estado real e expõe erro quando a permissão da câmera é negada", async () => {
    const room = new FakeRoom();
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");
    room.localParticipant.setCameraEnabled.mockRejectedValueOnce(
      new DOMException("Permission denied", "NotAllowedError"),
    );

    await expect(useVoiceStore.getState().toggleCamera()).resolves.toBeUndefined();

    expect(useVoiceStore.getState()).toMatchObject({
      cameraEnabled: false,
      error: "Não foi possível ativar a câmera.",
    });
  });

  it("preserva a intenção de câmera ligada ao trocar de canal de voz (reaplicada no próximo join)", async () => {
    const roomA = new FakeRoom();
    createRoomMock.mockReturnValue(roomA);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");
    await useVoiceStore.getState().toggleCamera();
    expect(useVoiceStore.getState().cameraEnabled).toBe(true);

    const roomB = new FakeRoom();
    createRoomMock.mockReturnValue(roomB);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:squad-alpha",
    });
    await useVoiceStore.getState().joinChannel("squad-alpha");

    expect(roomB.localParticipant.setCameraEnabled).toHaveBeenCalledWith(true, {
      resolution: { width: 1920, height: 1080 },
    });
    expect(useVoiceStore.getState().cameraEnabled).toBe(true);
  });
});

describe("startScreenShare / stopScreenShare — presets 720p30, 720p60, 1080p30, 1080p60", () => {
  async function connectRoom(): Promise<FakeRoom> {
    const room = new FakeRoom();
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");
    return room;
  }

  it("720p30: encaminha 1280x720 a 30fps de verdade para a chamada real do SDK", async () => {
    const room = await connectRoom();

    await useVoiceStore.getState().startScreenShare("720p30");

    expect(room.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(
      true,
      {
        resolution: { width: 1280, height: 720, frameRate: 30 },
      },
      {
        screenShareEncoding: { maxBitrate: 2_000_000, maxFramerate: 30 },
      },
    );
    expect(useVoiceStore.getState()).toMatchObject({
      screenShareEnabled: true,
      screenSharePreset: "720p30",
    });
  });

  it("720p60: encaminha 1280x720 a 60fps de verdade para a chamada real do SDK", async () => {
    const room = await connectRoom();

    await useVoiceStore.getState().startScreenShare("720p60");

    expect(room.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(
      true,
      {
        resolution: { width: 1280, height: 720, frameRate: 60 },
      },
      {
        screenShareEncoding: { maxBitrate: 4_000_000, maxFramerate: 60 },
      },
    );
    expect(useVoiceStore.getState().screenSharePreset).toBe("720p60");
  });

  it("1080p30: encaminha 1920x1080 a 30fps de verdade para a chamada real do SDK", async () => {
    const room = await connectRoom();

    await useVoiceStore.getState().startScreenShare("1080p30");

    expect(room.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(
      true,
      {
        resolution: { width: 1920, height: 1080, frameRate: 30 },
      },
      {
        screenShareEncoding: { maxBitrate: 5_000_000, maxFramerate: 30 },
      },
    );
    expect(useVoiceStore.getState().screenSharePreset).toBe("1080p30");
  });

  it("1080p60: encaminha 1920x1080 a 60fps de verdade para a chamada real do SDK", async () => {
    const room = await connectRoom();

    await useVoiceStore.getState().startScreenShare("1080p60");

    expect(room.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(
      true,
      {
        resolution: { width: 1920, height: 1080, frameRate: 60 },
      },
      {
        screenShareEncoding: { maxBitrate: 10_000_000, maxFramerate: 60 },
      },
    );
    expect(useVoiceStore.getState().screenSharePreset).toBe("1080p60");
  });

  it("preserva o preset escolhido durante toda a sessão de compartilhamento", async () => {
    const room = await connectRoom();
    await useVoiceStore.getState().startScreenShare("1080p60");

    room.simulate(MockRoomEvent.ActiveSpeakersChanged, []);
    room.simulate(MockRoomEvent.ConnectionQualityChanged, MockConnectionQuality.Good, room.localParticipant);

    expect(useVoiceStore.getState().screenSharePreset).toBe("1080p60");
  });

  it("cancelamento do seletor nativo não inicia o compartilhamento nem trava a UI em erro", async () => {
    const room = await connectRoom();
    room.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(
      new DOMException("The user did not select a screen to share.", "NotAllowedError"),
    );

    await expect(useVoiceStore.getState().startScreenShare("1080p30")).resolves.toBeUndefined();

    expect(useVoiceStore.getState()).toMatchObject({
      screenShareEnabled: false,
      screenSharePreset: null,
    });
  });

  it("permissão de captura de tela negada não inicia o compartilhamento nem trava a UI em erro", async () => {
    const room = await connectRoom();
    room.localParticipant.setScreenShareEnabled.mockRejectedValueOnce(
      new DOMException("Permission denied", "NotAllowedError"),
    );

    await expect(useVoiceStore.getState().startScreenShare("720p30")).resolves.toBeUndefined();

    expect(useVoiceStore.getState()).toMatchObject({
      screenShareEnabled: false,
      screenSharePreset: null,
    });
  });

  it("stopScreenShare finaliza a publicação e limpa o preset", async () => {
    const room = await connectRoom();
    await useVoiceStore.getState().startScreenShare("720p30");

    await useVoiceStore.getState().stopScreenShare();

    expect(room.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(false);
    expect(useVoiceStore.getState()).toMatchObject({
      screenShareEnabled: false,
      screenSharePreset: null,
    });
  });

  it("controle nativo 'Parar compartilhamento' do navegador sincroniza o estado via LocalTrackUnpublished", async () => {
    const room = await connectRoom();
    await useVoiceStore.getState().startScreenShare("720p30");
    expect(useVoiceStore.getState().screenShareEnabled).toBe(true);

    room.localParticipant.isScreenShareEnabled = false;
    room.simulate(MockRoomEvent.LocalTrackUnpublished, {
      source: MockTrack.Source.ScreenShare,
    });

    expect(useVoiceStore.getState()).toMatchObject({
      screenShareEnabled: false,
      screenSharePreset: null,
    });
  });

  it("não altera o mic ao finalizar via evento nativo (publication de outra fonte é ignorada)", async () => {
    const room = await connectRoom();
    await useVoiceStore.getState().startScreenShare("720p30");

    room.simulate(MockRoomEvent.LocalTrackUnpublished, {
      source: MockTrack.Source.Microphone,
    });

    expect(useVoiceStore.getState().screenSharePreset).toBe("720p30");
  });

  it("não faz nada quando não há sala conectada", async () => {
    await expect(useVoiceStore.getState().startScreenShare("720p30")).resolves.toBeUndefined();
    expect(useVoiceStore.getState().screenShareEnabled).toBe(false);
  });

  it("não reativa o compartilhamento de tela sozinho ao trocar de canal de voz", async () => {
    const roomA = new FakeRoom();
    createRoomMock.mockReturnValue(roomA);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");
    await useVoiceStore.getState().startScreenShare("720p30");

    const roomB = new FakeRoom();
    createRoomMock.mockReturnValue(roomB);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:squad-alpha",
    });
    await useVoiceStore.getState().joinChannel("squad-alpha");

    expect(roomB.localParticipant.setScreenShareEnabled).not.toHaveBeenCalled();
    expect(useVoiceStore.getState()).toMatchObject({
      screenShareEnabled: false,
      screenSharePreset: null,
    });
  });
});

describe("toggleDeafen", () => {
  it("alterna a flag deafened", () => {
    expect(useVoiceStore.getState().deafened).toBe(false);
    useVoiceStore.getState().toggleDeafen();
    expect(useVoiceStore.getState().deafened).toBe(true);
    useVoiceStore.getState().toggleDeafen();
    expect(useVoiceStore.getState().deafened).toBe(false);
  });
});

describe("leaveChannel", () => {
  it("desconecta a sala e reseta o estado para 'disconnected'", async () => {
    const room = new FakeRoom();
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");

    await useVoiceStore.getState().leaveChannel();

    expect(room.disconnect).toHaveBeenCalled();
    const state = useVoiceStore.getState();
    expect(state.status).toBe("disconnected");
    expect(state.channelSlug).toBeNull();
    expect(state.participants).toEqual({});
  });

  it("um leave antigo não apaga um join iniciado enquanto o disconnect aguardava", async () => {
    const roomA = new FakeRoom();
    const roomB = new FakeRoom();
    createRoomMock.mockReturnValueOnce(roomA).mockReturnValueOnce(roomB);
    fetchTokenMock
      .mockResolvedValueOnce({
        token: "token-a",
        url: "ws://127.0.0.1:7880",
        roomName: "voice:lobby-neon",
      })
      .mockResolvedValueOnce({
        token: "token-b",
        url: "ws://127.0.0.1:7880",
        roomName: "voice:squad-alpha",
      });
    await useVoiceStore.getState().joinChannel("lobby-neon");

    const pendingDisconnect = deferred<undefined>();
    roomA.disconnect.mockImplementationOnce(() => pendingDisconnect.promise);
    const leaving = useVoiceStore.getState().leaveChannel();
    await useVoiceStore.getState().joinChannel("squad-alpha");
    pendingDisconnect.resolve(undefined);
    await leaving;

    expect(useVoiceStore.getState()).toMatchObject({
      status: "connected",
      channelSlug: "squad-alpha",
      roomName: "voice:squad-alpha",
    });
  });
});

describe("resetSession", () => {
  it("limpa preferências sensíveis antes de uma nova conta entrar em voz", async () => {
    const roomA = new FakeRoom();
    createRoomMock.mockReturnValue(roomA);
    fetchTokenMock.mockResolvedValue({
      token: "token-a",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");
    await useVoiceStore.getState().toggleMic();
    useVoiceStore.getState().toggleDeafen();
    await useVoiceStore.getState().toggleCamera();

    expect(useVoiceStore.getState()).toMatchObject({
      micMuted: true,
      deafened: true,
      cameraEnabled: true,
    });

    await useVoiceStore.getState().resetSession();

    expect(useVoiceStore.getState()).toMatchObject({
      status: "disconnected",
      micMuted: false,
      deafened: false,
      cameraEnabled: false,
    });
    expect(roomA.disconnect).toHaveBeenCalledTimes(1);

    const roomB = new FakeRoom();
    createRoomMock.mockReturnValue(roomB);
    fetchTokenMock.mockResolvedValue({
      token: "token-b",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:squad-alpha",
    });
    await useVoiceStore.getState().joinChannel("squad-alpha");

    expect(roomB.localParticipant.setMicrophoneEnabled).toHaveBeenCalledWith(true);
    expect(roomB.localParticipant.setCameraEnabled).not.toHaveBeenCalled();
    expect(useVoiceStore.getState().deafened).toBe(false);
  });
});

describe("áudio remoto: subscribe/unsubscribe e attach/detach", () => {
  async function connectRoom(): Promise<FakeRoom> {
    const room = new FakeRoom();
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");
    return room;
  }

  it("TrackSubscribed de um track de áudio anexa um elemento ao DOM", async () => {
    const room = await connectRoom();
    const remote = new FakeParticipant("remote-user", "Fulano");
    const track = new FakeRemoteTrack(MockTrack.Kind.Audio);
    const publication = new FakeTrackPublication("track-sid-1");

    room.simulate(MockRoomEvent.TrackSubscribed, track, publication, remote);

    expect(track.attach).toHaveBeenCalledTimes(1);
    const container = document.querySelector('[data-testid="voice-remote-audio-container"]');
    expect(container?.childElementCount).toBe(1);
  });

  it("ignora tracks de vídeo neste fluxo de áudio (não anexa elemento)", async () => {
    const room = await connectRoom();
    const remote = new FakeParticipant("remote-user", "Fulano");
    const track = new FakeRemoteTrack(MockTrack.Kind.Video);
    const publication = new FakeTrackPublication("track-sid-video");

    room.simulate(MockRoomEvent.TrackSubscribed, track, publication, remote);

    expect(track.attach).not.toHaveBeenCalled();
  });

  it("TrackUnsubscribed desanexa e remove o elemento correspondente", async () => {
    const room = await connectRoom();
    const remote = new FakeParticipant("remote-user", "Fulano");
    const track = new FakeRemoteTrack(MockTrack.Kind.Audio);
    const publication = new FakeTrackPublication("track-sid-1");
    room.simulate(MockRoomEvent.TrackSubscribed, track, publication, remote);

    room.simulate(MockRoomEvent.TrackUnsubscribed, track, publication, remote);

    expect(track.detach).toHaveBeenCalledTimes(1);
    const container = document.querySelector('[data-testid="voice-remote-audio-container"]');
    expect(container?.childElementCount).toBe(0);
  });

  it("leaveChannel remove todos os elementos de áudio anexados (sem residual entre sessões)", async () => {
    const room = await connectRoom();
    const remote = new FakeParticipant("remote-user", "Fulano");
    room.simulate(
      MockRoomEvent.TrackSubscribed,
      new FakeRemoteTrack(MockTrack.Kind.Audio),
      new FakeTrackPublication("track-sid-1"),
      remote,
    );

    await useVoiceStore.getState().leaveChannel();

    const container = document.querySelector('[data-testid="voice-remote-audio-container"]');
    expect(container?.childElementCount ?? 0).toBe(0);
  });
});

describe("vídeo: cameraTrack exposto no participante para o grid renderizar", () => {
  async function connectRoom(): Promise<FakeRoom> {
    const room = new FakeRoom();
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");
    return room;
  }

  it("TrackSubscribed de câmera remota expõe cameraTrack no participante", async () => {
    const room = await connectRoom();
    const remote = new FakeParticipant("remote-user", "Fulano");
    const track = new FakeRemoteTrack(MockTrack.Kind.Video);
    const publication = new FakeTrackPublication("track-sid-cam");
    publication.videoTrack = track;
    remote.getTrackPublication.mockImplementation((source: string) =>
      source === MockTrack.Source.Camera ? publication : undefined,
    );

    room.simulate(MockRoomEvent.TrackSubscribed, track, publication, remote);

    expect(useVoiceStore.getState().participants["remote-user"]?.cameraTrack).toBe(track);
  });

  it("TrackUnsubscribed de câmera remota remove o cameraTrack do participante", async () => {
    const room = await connectRoom();
    const remote = new FakeParticipant("remote-user", "Fulano");
    const track = new FakeRemoteTrack(MockTrack.Kind.Video);
    const publication = new FakeTrackPublication("track-sid-cam");
    publication.videoTrack = track;
    remote.getTrackPublication.mockImplementation((source: string) =>
      source === MockTrack.Source.Camera ? publication : undefined,
    );
    room.simulate(MockRoomEvent.TrackSubscribed, track, publication, remote);

    publication.videoTrack = undefined;
    remote.getTrackPublication.mockReturnValue(undefined);
    room.simulate(MockRoomEvent.TrackUnsubscribed, track, publication, remote);

    expect(useVoiceStore.getState().participants["remote-user"]?.cameraTrack).toBeNull();
  });

  it("participante sem publicação de câmera tem cameraTrack nulo", async () => {
    const room = await connectRoom();
    const remote = new FakeParticipant("remote-user", "Fulano");

    room.simulate(MockRoomEvent.ParticipantConnected, remote);

    expect(useVoiceStore.getState().participants["remote-user"]?.cameraTrack).toBeNull();
  });
});

describe("vídeo: screenShareTrack exposto no participante para o grid renderizar", () => {
  async function connectRoom(): Promise<FakeRoom> {
    const room = new FakeRoom();
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");
    return room;
  }

  it("TrackSubscribed de tela remota expõe screenShareTrack no participante", async () => {
    const room = await connectRoom();
    const remote = new FakeParticipant("remote-user", "Fulano");
    const track = new FakeRemoteTrack(MockTrack.Kind.Video);
    const publication = new FakeTrackPublication("track-sid-screen");
    publication.videoTrack = track;
    remote.getTrackPublication.mockImplementation((source: string) =>
      source === MockTrack.Source.ScreenShare ? publication : undefined,
    );

    room.simulate(MockRoomEvent.TrackSubscribed, track, publication, remote);

    expect(useVoiceStore.getState().participants["remote-user"]?.screenShareTrack).toBe(track);
    expect(useVoiceStore.getState().participants["remote-user"]?.cameraTrack).toBeNull();
  });

  it("TrackUnsubscribed de tela remota remove o screenShareTrack do participante", async () => {
    const room = await connectRoom();
    const remote = new FakeParticipant("remote-user", "Fulano");
    const track = new FakeRemoteTrack(MockTrack.Kind.Video);
    const publication = new FakeTrackPublication("track-sid-screen");
    publication.videoTrack = track;
    remote.getTrackPublication.mockImplementation((source: string) =>
      source === MockTrack.Source.ScreenShare ? publication : undefined,
    );
    room.simulate(MockRoomEvent.TrackSubscribed, track, publication, remote);

    publication.videoTrack = undefined;
    remote.getTrackPublication.mockReturnValue(undefined);
    room.simulate(MockRoomEvent.TrackUnsubscribed, track, publication, remote);

    expect(useVoiceStore.getState().participants["remote-user"]?.screenShareTrack).toBeNull();
  });
});

describe("deafen aplicado a tracks de áudio anexados (atuais e futuros)", () => {
  async function connectRoom(): Promise<FakeRoom> {
    const room = new FakeRoom();
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");
    return room;
  }

  it("ensurdecer muta imediatamente os elementos de áudio já anexados", async () => {
    const room = await connectRoom();
    const remote = new FakeParticipant("remote-user", "Fulano");
    room.simulate(
      MockRoomEvent.TrackSubscribed,
      new FakeRemoteTrack(MockTrack.Kind.Audio),
      new FakeTrackPublication("track-sid-1"),
      remote,
    );
    const element = document.querySelector(
      '[data-testid="voice-remote-audio-container"] audio',
    ) as HTMLAudioElement;
    expect(element.muted).toBe(false);

    useVoiceStore.getState().toggleDeafen();

    expect(element.muted).toBe(true);
  });

  it("um track que chega DEPOIS de ensurdecer já nasce mutado", async () => {
    const room = await connectRoom();
    useVoiceStore.getState().toggleDeafen();
    const remote = new FakeParticipant("remote-user", "Fulano");

    room.simulate(
      MockRoomEvent.TrackSubscribed,
      new FakeRemoteTrack(MockTrack.Kind.Audio),
      new FakeTrackPublication("track-sid-late"),
      remote,
    );

    const element = document.querySelector(
      '[data-testid="voice-remote-audio-container"] audio',
    ) as HTMLAudioElement;
    expect(element.muted).toBe(true);
  });

  it("desligar o deafen desmuta os elementos já anexados", async () => {
    const room = await connectRoom();
    const remote = new FakeParticipant("remote-user", "Fulano");
    room.simulate(
      MockRoomEvent.TrackSubscribed,
      new FakeRemoteTrack(MockTrack.Kind.Audio),
      new FakeTrackPublication("track-sid-1"),
      remote,
    );
    useVoiceStore.getState().toggleDeafen();

    useVoiceStore.getState().toggleDeafen();

    const element = document.querySelector(
      '[data-testid="voice-remote-audio-container"] audio',
    ) as HTMLAudioElement;
    expect(element.muted).toBe(false);
  });
});

describe("RTT real (ping em milissegundos) e limpeza do timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("faz polling do RTT via getSenderStats() do microfone local e converte segundos para milissegundos", async () => {
    const room = new FakeRoom();
    const publication = new FakeTrackPublication("mic-track-sid");
    const getSenderStats = vi.fn(async () => ({ roundTripTime: 0.045 }));
    publication.audioTrack = { getSenderStats };
    room.localParticipant.getTrackPublication.mockImplementation((source: string) =>
      source === MockTrack.Source.Microphone ? publication : undefined,
    );
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });

    await useVoiceStore.getState().joinChannel("lobby-neon");
    expect(useVoiceStore.getState().rttMs).toBeNull();

    await vi.advanceTimersByTimeAsync(2_000);

    expect(getSenderStats).toHaveBeenCalled();
    expect(useVoiceStore.getState().rttMs).toBe(45);
  });

  it("para de fazer polling depois de leaveChannel (o timer não continua rodando)", async () => {
    const room = new FakeRoom();
    const publication = new FakeTrackPublication("mic-track-sid");
    const getSenderStats = vi.fn(async () => ({ roundTripTime: 0.05 }));
    publication.audioTrack = { getSenderStats };
    room.localParticipant.getTrackPublication.mockReturnValue(publication);
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(getSenderStats).toHaveBeenCalledTimes(1);

    await useVoiceStore.getState().leaveChannel();
    getSenderStats.mockClear();
    await vi.advanceTimersByTimeAsync(10_000);

    expect(getSenderStats).not.toHaveBeenCalled();
  });

  it("reseta rttMs para null ao entrar num canal novo", async () => {
    const room = new FakeRoom();
    const publication = new FakeTrackPublication("mic-track-sid");
    publication.audioTrack = { getSenderStats: vi.fn(async () => ({ roundTripTime: 0.03 })) };
    room.localParticipant.getTrackPublication.mockReturnValue(publication);
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");
    await vi.advanceTimersByTimeAsync(2_000);
    expect(useVoiceStore.getState().rttMs).toBe(30);

    await useVoiceStore.getState().leaveChannel();

    expect(useVoiceStore.getState().rttMs).toBeNull();
  });
});

describe("autoplay de áudio bloqueado pelo navegador", () => {
  async function connectRoom(canPlaybackAudio: boolean): Promise<FakeRoom> {
    const room = new FakeRoom();
    room.canPlaybackAudio = canPlaybackAudio;
    createRoomMock.mockReturnValue(room);
    fetchTokenMock.mockResolvedValue({
      token: "fake-jwt",
      url: "ws://127.0.0.1:7880",
      roomName: "voice:lobby-neon",
    });
    await useVoiceStore.getState().joinChannel("lobby-neon");
    return room;
  }

  it("audioPlaybackBlocked reflete room.canPlaybackAudio logo após conectar", async () => {
    await connectRoom(false);
    expect(useVoiceStore.getState().audioPlaybackBlocked).toBe(true);
  });

  it("AudioPlaybackStatusChanged atualiza a flag em tempo real", async () => {
    const room = await connectRoom(true);
    expect(useVoiceStore.getState().audioPlaybackBlocked).toBe(false);

    room.canPlaybackAudio = false;
    room.simulate(MockRoomEvent.AudioPlaybackStatusChanged, false);
    expect(useVoiceStore.getState().audioPlaybackBlocked).toBe(true);

    room.canPlaybackAudio = true;
    room.simulate(MockRoomEvent.AudioPlaybackStatusChanged, true);
    expect(useVoiceStore.getState().audioPlaybackBlocked).toBe(false);
  });

  it("resumeAudioPlayback chama room.startAudio() e limpa o bloqueio (ação explícita do usuário)", async () => {
    const room = await connectRoom(false);
    expect(useVoiceStore.getState().audioPlaybackBlocked).toBe(true);

    await useVoiceStore.getState().resumeAudioPlayback();

    expect(room.startAudio).toHaveBeenCalledTimes(1);
    expect(useVoiceStore.getState().audioPlaybackBlocked).toBe(false);
  });

  it("resumeAudioPlayback não lança quando não há sala conectada", async () => {
    await expect(useVoiceStore.getState().resumeAudioPlayback()).resolves.toBeUndefined();
  });
});
