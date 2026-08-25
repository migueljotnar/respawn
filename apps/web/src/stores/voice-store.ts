import { create } from "zustand";

import {
  ConnectionQuality,
  RoomEvent,
  Track,
  VideoPresets,
  createRoom,
  type Participant,
  type Room,
} from "../lib/voice-client.js";
import { voiceApi } from "../lib/voice-api.js";

export type VoiceConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

export type ScreenSharePresetId = "720p30" | "720p60" | "1080p30" | "1080p60";

export interface ScreenSharePreset {
  id: ScreenSharePresetId;
  label: string;
  width: number;
  height: number;
  frameRate: number;
  maxBitrate: number;
}

export const SCREEN_SHARE_PRESETS: readonly ScreenSharePreset[] = [
  {
    id: "720p30",
    label: "720p · 30 FPS",
    width: 1280,
    height: 720,
    frameRate: 30,
    maxBitrate: 2_000_000,
  },
  {
    id: "720p60",
    label: "720p · 60 FPS",
    width: 1280,
    height: 720,
    frameRate: 60,
    maxBitrate: 4_000_000,
  },
  {
    id: "1080p30",
    label: "1080p · 30 FPS",
    width: 1920,
    height: 1080,
    frameRate: 30,
    maxBitrate: 5_000_000,
  },
  {
    id: "1080p60",
    label: "1080p · 60 FPS",
    width: 1920,
    height: 1080,
    frameRate: 60,
    maxBitrate: 10_000_000,
  },
];

const SCREEN_SHARE_PRESETS_BY_ID: Record<ScreenSharePresetId, ScreenSharePreset> =
  Object.fromEntries(SCREEN_SHARE_PRESETS.map((preset) => [preset.id, preset])) as Record<
    ScreenSharePresetId,
    ScreenSharePreset
  >;

export interface VoiceParticipant {
  id: string;
  name: string;
  isLocal: boolean;
  isSpeaking: boolean;
  micMuted: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  /** Track de vídeo da câmera pronto para track.attach() num <video> real —
   * null quando o participante não está publicando câmera no momento. */
  cameraTrack: Track | null;
  /** Track de vídeo do compartilhamento de tela pronto para track.attach() —
   * null quando o participante não está compartilhando tela no momento. */
  screenShareTrack: Track | null;
}

interface VoiceState {
  status: VoiceConnectionStatus;
  channelSlug: string | null;
  roomName: string | null;
  error: string | null;
  connectionQuality: ConnectionQuality | null;
  /** RTT real do microfone local até o servidor LiveKit, em milissegundos —
   * medido via WebRTC getStats(), não uma leitura de ConnectionQuality. */
  rttMs: number | null;
  /** true quando o navegador bloqueou a reprodução de áudio por política de
   * autoplay — só um gesto explícito do usuário (resumeAudioPlayback) resolve. */
  audioPlaybackBlocked: boolean;
  participants: Record<string, VoiceParticipant>;
  micMuted: boolean;
  deafened: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  /** Preset em uso durante a sessão de compartilhamento atual — null quando
   * não há compartilhamento ativo. Fica travado até stopScreenShare(). */
  screenSharePreset: ScreenSharePresetId | null;

  joinChannel: (channelSlug: string) => Promise<void>;
  leaveChannel: () => Promise<void>;
  resetSession: () => Promise<void>;
  toggleMic: () => Promise<void>;
  toggleDeafen: () => void;
  toggleCamera: () => Promise<void>;
  startScreenShare: (preset: ScreenSharePresetId) => Promise<void>;
  stopScreenShare: () => Promise<void>;
  resumeAudioPlayback: () => Promise<void>;
}

const DEFAULT_JOIN_ERROR = "Não foi possível entrar no canal de voz.";
const MICROPHONE_JOIN_ERROR = "Não foi possível ativar o microfone.";
const MICROPHONE_UPDATE_ERROR = "Não foi possível atualizar o microfone.";
const CAMERA_JOIN_ERROR = "Não foi possível ativar a câmera.";
const CAMERA_UPDATE_ERROR = "Não foi possível ativar a câmera.";
const RTT_POLL_INTERVAL_MS = 2_000;
// Garante suporte a até 1080p na captura da webcam (o padrão do SDK não é
// necessariamente essa resolução).
const CAMERA_CAPTURE_OPTIONS = { resolution: VideoPresets.h1080.resolution };

function describeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : DEFAULT_JOIN_ERROR;
}

// O Room do LiveKit é uma instância mutável com sockets/tracks reais — não
// cabe no estado reativo do Zustand (mesmo raciocínio dos timeouts de typing
// em chat-store.ts: efeitos colaterais vivem à parte do estado observável).
let currentRoom: Room | null = null;
// Protege contra corrida quando joinChannel/leaveChannel são chamados em
// sequência rápida (ex.: trocar de canal de voz duas vezes seguidas) — uma
// chamada mais nova sempre invalida a anterior, que descarta seu resultado
// ao perceber que não é mais a "geração" atual.
let joinGeneration = 0;
// Serializa alterações do microfone. Assim, dois cliques rápidos são
// aplicados ao SDK na ordem em que ocorreram e a última intenção permanece
// vencedora, mesmo quando a primeira chamada demora para resolver.
let microphoneUpdateTail: Promise<void> = Promise.resolve();
let rttIntervalId: ReturnType<typeof setInterval> | null = null;
// Elementos <audio> criados por track.attach() para os tracks remotos —
// vivem escondidos no DOM (só precisam existir para o áudio tocar, não
// aparecer). Chave: publication.trackSid, único por publicação.
const attachedAudioElements = new Map<string, HTMLMediaElement>();
let audioContainer: HTMLElement | null = null;

function getAudioContainer(): HTMLElement {
  if (!audioContainer || !document.body.contains(audioContainer)) {
    audioContainer = document.createElement("div");
    audioContainer.setAttribute("data-testid", "voice-remote-audio-container");
    audioContainer.style.position = "fixed";
    audioContainer.style.width = "0";
    audioContainer.style.height = "0";
    audioContainer.style.overflow = "hidden";
    document.body.appendChild(audioContainer);
  }

  return audioContainer;
}

function stopRttPolling(): void {
  if (rttIntervalId !== null) {
    clearInterval(rttIntervalId);
    rttIntervalId = null;
  }
}

function cleanupAudioElements(): void {
  for (const element of attachedAudioElements.values()) {
    element.remove();
  }
  attachedAudioElements.clear();
}

function applyDeafenToAttachedAudio(deafened: boolean): void {
  for (const element of attachedAudioElements.values()) {
    element.muted = deafened;
  }
}

function startRttPolling(room: Room, set: (partial: Partial<VoiceState>) => void): void {
  stopRttPolling();

  rttIntervalId = setInterval(() => {
    void (async () => {
      if (currentRoom !== room) {
        stopRttPolling();
        return;
      }

      const publication = room.localParticipant.getTrackPublication(Track.Source.Microphone);
      let stats;

      try {
        stats = await publication?.audioTrack?.getSenderStats();
      } catch {
        return;
      }

      if (currentRoom !== room) {
        // A sala pode ter mudado durante o await de getSenderStats().
        return;
      }

      if (stats?.roundTripTime !== undefined) {
        // WebRTC reporta roundTripTime em segundos; a UI quer milissegundos.
        set({ rttMs: Math.round(stats.roundTripTime * 1_000) });
      }
    })();
  }, RTT_POLL_INTERVAL_MS);
}

async function disconnectRoom(room: Room): Promise<void> {
  room.removeAllListeners();
  stopRttPolling();
  cleanupAudioElements();

  try {
    await room.disconnect();
  } catch {
    // Já pode estar desconectado (ex.: o servidor derrubou a conexão) — não
    // há nada a fazer além de garantir que o estado local reflita isso.
  }
}

function toVoiceParticipant(participant: Participant, isLocal: boolean): VoiceParticipant {
  return {
    id: participant.identity,
    name: participant.name && participant.name.length > 0 ? participant.name : participant.identity,
    isLocal,
    isSpeaking: participant.isSpeaking,
    micMuted: !participant.isMicrophoneEnabled,
    cameraEnabled: participant.isCameraEnabled,
    screenShareEnabled: participant.isScreenShareEnabled,
    cameraTrack: participant.getTrackPublication(Track.Source.Camera)?.videoTrack ?? null,
    screenShareTrack: participant.getTrackPublication(Track.Source.ScreenShare)?.videoTrack ?? null,
  };
}

export const useVoiceStore = create<VoiceState>((set, get) => ({
  status: "disconnected",
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

  async joinChannel(channelSlug) {
    const generation = ++joinGeneration;
    const previousRoom = currentRoom;
    currentRoom = null;

    if (previousRoom) {
      await disconnectRoom(previousRoom);
    }

    if (generation !== joinGeneration) {
      return;
    }

    set({
      status: "connecting",
      channelSlug,
      roomName: null,
      error: null,
      participants: {},
      connectionQuality: null,
      rttMs: null,
      audioPlaybackBlocked: false,
      // Ao contrário de mic/câmera, o compartilhamento de tela nunca retoma
      // sozinho ao entrar numa sala: getDisplayMedia() exige um gesto novo
      // do usuário a cada vez, então a intenção não é preservada entre joins.
      screenShareEnabled: false,
      screenSharePreset: null,
    });

    let tokenResult;

    try {
      tokenResult = await voiceApi.fetchToken(channelSlug);
    } catch (error) {
      if (generation === joinGeneration) {
        set({ status: "error", error: describeError(error) });
      }
      return;
    }

    if (generation !== joinGeneration) {
      return;
    }

    const room = createRoom();

    function isCurrentJoin(): boolean {
      return generation === joinGeneration;
    }

    function upsertParticipant(participant: Participant, isLocal: boolean): void {
      if (!isCurrentJoin()) {
        return;
      }

      set((state) => ({
        participants: {
          ...state.participants,
          [participant.identity]: toVoiceParticipant(participant, isLocal),
        },
      }));
    }

    function removeParticipant(participant: Participant): void {
      if (!isCurrentJoin()) {
        return;
      }

      set((state) => {
        if (!(participant.identity in state.participants)) {
          return state;
        }

        const next = { ...state.participants };
        delete next[participant.identity];
        return { participants: next };
      });
    }

    room.on(RoomEvent.ParticipantConnected, (participant) => upsertParticipant(participant, false));
    room.on(RoomEvent.ParticipantDisconnected, (participant) => removeParticipant(participant));
    room.on(RoomEvent.TrackMuted, (_publication, participant) =>
      upsertParticipant(participant, participant.isLocal),
    );
    room.on(RoomEvent.TrackUnmuted, (_publication, participant) =>
      upsertParticipant(participant, participant.isLocal),
    );
    room.on(RoomEvent.LocalTrackPublished, () => upsertParticipant(room.localParticipant, true));
    room.on(RoomEvent.LocalTrackUnpublished, (publication) => {
      upsertParticipant(room.localParticipant, true);

      // Cobre o controle nativo "Parar compartilhamento" do navegador: o
      // MediaStreamTrack termina por fora da nossa ação, o SDK despublica
      // sozinho, e é só este evento que nos avisa disso.
      if (isCurrentJoin() && publication.source === Track.Source.ScreenShare) {
        set({ screenShareEnabled: false, screenSharePreset: null });
      }
    });
    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      upsertParticipant(participant, false);

      if (!isCurrentJoin() || track.kind !== Track.Kind.Audio) {
        return;
      }

      // Anexa mesmo áudio que chega DEPOIS de ensurdecer — a intenção atual
      // de `deafened` é aplicada a cada novo elemento no momento do attach.
      const element = track.attach();
      element.muted = get().deafened;
      attachedAudioElements.set(publication.trackSid, element);
      getAudioContainer().appendChild(element);
    });
    room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
      upsertParticipant(participant, false);

      const element = attachedAudioElements.get(publication.trackSid);

      if (element) {
        track.detach(element);
        element.remove();
        attachedAudioElements.delete(publication.trackSid);
      }
    });
    room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
      if (!isCurrentJoin()) {
        return;
      }

      const speakingIds = new Set(speakers.map((speaker) => speaker.identity));

      set((state) => {
        const next: Record<string, VoiceParticipant> = {};

        for (const [id, participant] of Object.entries(state.participants)) {
          next[id] = { ...participant, isSpeaking: speakingIds.has(id) };
        }

        return { participants: next };
      });
    });
    room.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
      if (isCurrentJoin() && participant.isLocal) {
        set({ connectionQuality: quality });
      }
    });
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      if (isCurrentJoin()) {
        set({ audioPlaybackBlocked: !room.canPlaybackAudio });
      }
    });
    room.on(RoomEvent.Disconnected, () => {
      if (isCurrentJoin() && currentRoom === room) {
        joinGeneration += 1;
        currentRoom = null;
        room.removeAllListeners();
        stopRttPolling();
        cleanupAudioElements();
        set({
          status: "disconnected",
          channelSlug: null,
          roomName: null,
          participants: {},
          connectionQuality: null,
          rttMs: null,
          audioPlaybackBlocked: false,
          screenShareEnabled: false,
          screenSharePreset: null,
        });
      }
    });

    try {
      await room.connect(tokenResult.url, tokenResult.token);
    } catch (error) {
      await disconnectRoom(room);

      if (generation === joinGeneration) {
        set({ status: "error", error: describeError(error) });
      }

      return;
    }

    if (generation !== joinGeneration) {
      // Uma chamada mais nova a joinChannel/leaveChannel já assumiu enquanto
      // esta conexão estava em voo — descarta sem tocar no estado global.
      await disconnectRoom(room);
      return;
    }

    currentRoom = room;

    const { micMuted, cameraEnabled } = get();
    let microphoneError: string | null = null;

    try {
      await room.localParticipant.setMicrophoneEnabled(!micMuted);
    } catch {
      // Permissão negada ou dispositivo ocupado: a conexão de voz continua,
      // mas o estado precisa refletir o track real em vez da intenção anterior.
      microphoneError = MICROPHONE_JOIN_ERROR;
    }

    if (!isCurrentJoin() || currentRoom !== room) {
      await disconnectRoom(room);
      return;
    }

    let cameraError: string | null = null;

    // A câmera só é (re)ativada aqui se o usuário já a tinha ligado — o
    // padrão é começar desligada, ao contrário do microfone.
    if (cameraEnabled) {
      try {
        await room.localParticipant.setCameraEnabled(true, CAMERA_CAPTURE_OPTIONS);
      } catch {
        cameraError = CAMERA_JOIN_ERROR;
      }

      if (!isCurrentJoin() || currentRoom !== room) {
        await disconnectRoom(room);
        return;
      }
    }

    for (const participant of room.remoteParticipants.values()) {
      upsertParticipant(participant, false);
    }
    upsertParticipant(room.localParticipant, true);
    startRttPolling(room, set);
    set({
      status: "connected",
      roomName: tokenResult.roomName,
      micMuted: !room.localParticipant.isMicrophoneEnabled,
      cameraEnabled: room.localParticipant.isCameraEnabled,
      error: microphoneError ?? cameraError,
      audioPlaybackBlocked: !room.canPlaybackAudio,
    });
  },

  async leaveChannel() {
    const generation = ++joinGeneration;
    const room = currentRoom;
    currentRoom = null;

    if (room) {
      await disconnectRoom(room);
    }

    if (generation !== joinGeneration) {
      return;
    }

    set({
      status: "disconnected",
      channelSlug: null,
      roomName: null,
      participants: {},
      connectionQuality: null,
      rttMs: null,
      audioPlaybackBlocked: false,
      error: null,
      screenShareEnabled: false,
      screenSharePreset: null,
    });
  },

  async resetSession() {
    // Preferências de mídia podem ser preservadas durante trocas de canal da
    // mesma pessoa, mas nunca podem atravessar a fronteira de autenticação.
    // O set ocorre antes do primeiro await para que uma nova sessão não veja
    // câmera, microfone ou áudio herdados enquanto o disconnect está em voo.
    set({ micMuted: false, deafened: false, cameraEnabled: false });
    await get().leaveChannel();
  },

  async toggleMic() {
    const nextMuted = !get().micMuted;
    const room = currentRoom;
    set({ micMuted: nextMuted, error: null });

    if (!room) {
      return;
    }

    const update = microphoneUpdateTail
      .catch(() => undefined)
      .then(async () => {
        if (currentRoom !== room) {
          return;
        }

        try {
          await room.localParticipant.setMicrophoneEnabled(!nextMuted);
        } catch {
          // Se já existe uma intenção mais nova na store, ela será aplicada
          // pela próxima operação da fila; não reverta esse clique posterior.
          if (currentRoom === room && get().micMuted === nextMuted) {
            set((state) => ({
              micMuted: !room.localParticipant.isMicrophoneEnabled,
              error: MICROPHONE_UPDATE_ERROR,
              participants: {
                ...state.participants,
                [room.localParticipant.identity]: toVoiceParticipant(room.localParticipant, true),
              },
            }));
          }
          return;
        }

        if (currentRoom === room && get().micMuted === nextMuted) {
          set((state) => ({
            micMuted: !room.localParticipant.isMicrophoneEnabled,
            participants: {
              ...state.participants,
              [room.localParticipant.identity]: toVoiceParticipant(room.localParticipant, true),
            },
          }));
        }
      });

    microphoneUpdateTail = update;
    await update;
  },

  async toggleCamera() {
    const nextEnabled = !get().cameraEnabled;
    const room = currentRoom;
    set({ cameraEnabled: nextEnabled, error: null });

    if (!room) {
      return;
    }

    try {
      await room.localParticipant.setCameraEnabled(
        nextEnabled,
        nextEnabled ? CAMERA_CAPTURE_OPTIONS : undefined,
      );
    } catch {
      if (currentRoom === room) {
        set((state) => ({
          cameraEnabled: room.localParticipant.isCameraEnabled,
          error: CAMERA_UPDATE_ERROR,
          participants: {
            ...state.participants,
            [room.localParticipant.identity]: toVoiceParticipant(room.localParticipant, true),
          },
        }));
      }
      return;
    }

    if (currentRoom === room) {
      set((state) => ({
        cameraEnabled: room.localParticipant.isCameraEnabled,
        participants: {
          ...state.participants,
          [room.localParticipant.identity]: toVoiceParticipant(room.localParticipant, true),
        },
      }));
    }
  },

  async startScreenShare(preset) {
    const room = currentRoom;

    if (!room) {
      return;
    }

    const config = SCREEN_SHARE_PRESETS_BY_ID[preset];
    set({ error: null });

    try {
      await room.localParticipant.setScreenShareEnabled(
        true,
        {
          resolution: { width: config.width, height: config.height, frameRate: config.frameRate },
        },
        {
          screenShareEncoding: {
            maxBitrate: config.maxBitrate,
            maxFramerate: config.frameRate,
          },
        },
      );
    } catch {
      // Cobre tanto o cancelamento do seletor nativo de tela quanto uma
      // permissão de fato negada — o navegador reporta os dois com o mesmo
      // NotAllowedError, então não há como distinguir de forma confiável.
      // Em ambos os casos o compartilhamento simplesmente não inicia.
      if (currentRoom === room) {
        set({ screenShareEnabled: false, screenSharePreset: null });
      }
      return;
    }

    if (currentRoom !== room) {
      // Uma troca de sala aconteceu enquanto o picker nativo estava aberto —
      // desfaz a publicação, que teria ido parar na sala errada.
      try {
        await room.localParticipant.setScreenShareEnabled(false);
      } catch {
        // A sala já pode ter sido desconectada.
      }
      return;
    }

    set((state) => ({
      screenShareEnabled: room.localParticipant.isScreenShareEnabled,
      screenSharePreset: preset,
      participants: {
        ...state.participants,
        [room.localParticipant.identity]: toVoiceParticipant(room.localParticipant, true),
      },
    }));
  },

  async stopScreenShare() {
    const room = currentRoom;
    set({ screenSharePreset: null });

    if (!room) {
      set({ screenShareEnabled: false });
      return;
    }

    try {
      await room.localParticipant.setScreenShareEnabled(false);
    } catch {
      // Já pode ter sido parado pelo controle nativo do navegador.
    }

    if (currentRoom === room) {
      set((state) => ({
        screenShareEnabled: room.localParticipant.isScreenShareEnabled,
        participants: {
          ...state.participants,
          [room.localParticipant.identity]: toVoiceParticipant(room.localParticipant, true),
        },
      }));
    }
  },

  toggleDeafen() {
    // Aplica a novos elementos (attach futuro) via `get().deafened` lido no
    // handler de TrackSubscribed, e aos já anexados agora mesmo.
    set((state) => {
      const next = !state.deafened;
      applyDeafenToAttachedAudio(next);
      return { deafened: next };
    });
  },

  async resumeAudioPlayback() {
    const room = currentRoom;

    if (!room) {
      return;
    }

    try {
      await room.startAudio();
    } catch {
      // Ainda bloqueado — normalmente porque a chamada não veio de um gesto
      // do usuário; a UI pode deixar a pessoa tentar de novo.
    } finally {
      if (currentRoom === room) {
        set({ audioPlaybackBlocked: !room.canPlaybackAudio });
      }
    }
  },
}));
