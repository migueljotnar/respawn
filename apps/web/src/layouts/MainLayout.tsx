import { useCallback, useEffect, useRef, useState } from "react";

import { ChannelSidebar } from "../components/community/ChannelSidebar.js";
import { ChatPanel } from "../components/community/ChatPanel.js";
import { MemberSidebar } from "../components/community/MemberSidebar.js";
import { MobileDrawer } from "../components/community/MobileDrawer.js";
import { ServerRail } from "../components/community/ServerRail.js";
import {
  DEFAULT_CHANNEL_ID,
  communityServers,
  getChannel,
  type ChannelId,
} from "../data/community-mocks.js";
import type { VerifiedSession } from "../lib/auth-api.js";
import {
  ChatSendError,
  connectChatSocket,
  joinChannel,
  sendChatMessage,
  startTyping,
  stopTyping,
  type ChatSocket,
} from "../lib/chat-ws.js";
import { readSessionToken } from "../lib/session-storage.js";
import { useChatStore } from "../stores/chat-store.js";
import { useVoiceStore, type ScreenSharePresetId } from "../stores/voice-store.js";

type MobilePanel = "navigation" | "members" | null;

interface MainLayoutProps {
  session: VerifiedSession;
  serverId: string;
  channelId: ChannelId;
  onNavigateChannel: (channelId: ChannelId) => void;
  onLogout: () => void;
}

export function MainLayout({
  session,
  serverId,
  channelId,
  onNavigateChannel,
  onLogout,
}: MainLayoutProps) {
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const socketRef = useRef<ChatSocket | null>(null);
  const activeChannelRef = useRef<ChannelId>(channelId);
  const connectionGenerationRef = useRef(0);
  const joinedChannelsRef = useRef(new Set<ChannelId>());
  const joinPromisesRef = useRef(new Map<ChannelId, Promise<void>>());
  const synchronizationPromisesRef = useRef(new Map<ChannelId, Promise<void>>());
  const typingGenerationRef = useRef(0);
  activeChannelRef.current = channelId;
  const activeChannel = getChannel(channelId) ?? getChannel(DEFAULT_CHANNEL_ID);
  const activeServer =
    communityServers.find((server) => server.id === serverId) ?? communityServers[0];
  const closeMobilePanel = useCallback(() => setMobilePanel(null), []);

  const messagesByChannel = useChatStore((state) => state.messagesByChannel);
  const loadingHistoryByChannel = useChatStore((state) => state.loadingHistoryByChannel);
  const hasMoreByChannel = useChatStore((state) => state.hasMoreByChannel);
  const historyErrorByChannel = useChatStore((state) => state.historyErrorByChannel);
  const resyncStatusByChannel = useChatStore((state) => state.resyncStatusByChannel);
  const typingByChannel = useChatStore((state) => state.typingByChannel);
  const onlineUserIds = useChatStore((state) => state.onlineUserIds);
  const members = useChatStore((state) => state.members);
  const membersError = useChatStore((state) => state.membersError);

  const voiceStatus = useVoiceStore((state) => state.status);
  const voiceChannelSlug = useVoiceStore((state) => state.channelSlug);
  const voiceRoomName = useVoiceStore((state) => state.roomName);
  const voiceRttMs = useVoiceStore((state) => state.rttMs);
  const voiceError = useVoiceStore((state) => state.error);
  const voiceAudioPlaybackBlocked = useVoiceStore((state) => state.audioPlaybackBlocked);
  const voiceMicMuted = useVoiceStore((state) => state.micMuted);
  const voiceDeafened = useVoiceStore((state) => state.deafened);
  const voiceCameraEnabled = useVoiceStore((state) => state.cameraEnabled);
  const voiceScreenShareEnabled = useVoiceStore((state) => state.screenShareEnabled);
  const voiceScreenSharePreset = useVoiceStore((state) => state.screenSharePreset);
  const voiceParticipantsMap = useVoiceStore((state) => state.participants);
  const voiceParticipants = Object.values(voiceParticipantsMap);

  function ensureChannelJoined(socket: ChatSocket, channelSlug: ChannelId): Promise<void> {
    if (getChannel(channelSlug)?.kind !== "text") {
      return Promise.reject(new ChatSendError("rejected", "channel_not_text"));
    }

    if (!socket.connected) {
      return Promise.reject(new ChatSendError("offline", "not_connected"));
    }

    if (joinedChannelsRef.current.has(channelSlug)) {
      return Promise.resolve();
    }

    const pending = joinPromisesRef.current.get(channelSlug);
    if (pending) {
      return pending;
    }

    const generation = connectionGenerationRef.current;
    const joinAttempt = joinChannel(socket, channelSlug).then(() => {
      if (!socket.connected || generation !== connectionGenerationRef.current) {
        throw new ChatSendError("offline", "stale_connection");
      }

      joinedChannelsRef.current.add(channelSlug);
    });

    joinPromisesRef.current.set(channelSlug, joinAttempt);

    const clearPending = () => {
      if (joinPromisesRef.current.get(channelSlug) === joinAttempt) {
        joinPromisesRef.current.delete(channelSlug);
      }
    };
    void joinAttempt.then(clearPending, clearPending);

    return joinAttempt;
  }

  function synchronizeChannel(socket: ChatSocket, channelSlug: ChannelId): Promise<void> {
    if (getChannel(channelSlug)?.kind !== "text") {
      return Promise.resolve();
    }

    const pending = synchronizationPromisesRef.current.get(channelSlug);
    if (pending) {
      return pending;
    }

    const generation = connectionGenerationRef.current;
    const knownMessages = useChatStore.getState().messagesByChannel[channelSlug] ?? [];
    const startingCursor = knownMessages[knownMessages.length - 1];
    useChatStore.getState().invalidateChannelOperations(channelSlug);

    function assertCurrentConnection(): void {
      if (!socket.connected || generation !== connectionGenerationRef.current) {
        throw new ChatSendError("offline", "stale_connection");
      }
    }

    const synchronization = (async () => {
      await ensureChannelJoined(socket, channelSlug);
      assertCurrentConnection();
      await useChatStore.getState().loadInitialMessages(channelSlug);
      assertCurrentConnection();
      const resyncChannel = useChatStore.getState().resyncChannel;

      if (startingCursor) {
        await resyncChannel(channelSlug, {
          createdAt: startingCursor.createdAt,
          id: startingCursor.id,
        });
      } else {
        await resyncChannel(channelSlug);
      }
      assertCurrentConnection();
    })();

    synchronizationPromisesRef.current.set(channelSlug, synchronization);

    const clearPending = () => {
      if (synchronizationPromisesRef.current.get(channelSlug) === synchronization) {
        synchronizationPromisesRef.current.delete(channelSlug);
      }
    };
    void synchronization.then(clearPending, clearPending);

    return synchronization;
  }

  function requestChannelSynchronization(socket: ChatSocket, channelSlug: ChannelId): void {
    void synchronizeChannel(socket, channelSlug).catch(() => {
      // Queda/offline durante join é recuperada pelo próximo evento connect.
    });
  }

  useEffect(() => {
    setMobilePanel(null);
  }, [channelId]);

  useEffect(() => {
    if (!mobilePanel) return;

    const breakpoint = window.matchMedia(
      mobilePanel === "navigation"
        ? "(min-width: 768px)"
        : "(min-width: 1280px)",
    );

    function handleBreakpoint(event: MediaQueryListEvent) {
      if (event.matches) {
        setMobilePanel(null);
      }
    }

    if (breakpoint.matches) {
      setMobilePanel(null);
      return;
    }

    breakpoint.addEventListener("change", handleBreakpoint);
    return () => breakpoint.removeEventListener("change", handleBreakpoint);
  }, [mobilePanel]);

  useEffect(() => {
    const token = readSessionToken();

    if (!token) {
      return;
    }

    const socket = connectChatSocket(token);
    socketRef.current = socket;

    // Salas do Socket.IO não sobrevivem a uma reconexão — o servidor vê uma
    // conexão nova e "connect" dispara de novo a cada reconexão automática,
    // não só na primeira vez. Reentrar na sala ativa aqui (em vez de só no
    // efeito abaixo, que só reage a troca de canal) garante que o cliente
    // volta a receber mensagens depois de uma queda de rede/reinício da API
    // sem precisar trocar de canal ou recarregar a página. resyncChannel
    // busca o que foi perdido durante a queda a partir da última mensagem
    // conhecida.
    function joinAndResync() {
      connectionGenerationRef.current += 1;
      joinedChannelsRef.current.clear();
      joinPromisesRef.current.clear();
      synchronizationPromisesRef.current.clear();
      const activeChannelSlug = activeChannelRef.current;
      requestChannelSynchronization(socket, activeChannelSlug);
    }

    socket.on("connect", joinAndResync);
    socket.on("connection:ack", (ack) => {
      useChatStore.getState().setInitialPresence(ack.onlineUserIds);
    });
    socket.on("message:new", (message) => {
      useChatStore.getState().receiveMessage(message);
    });
    socket.on("typing:update", (update) => {
      useChatStore.getState().applyTypingUpdate(update);
    });
    socket.on("presence:update", (update) => {
      useChatStore.getState().applyPresenceUpdate(update);

      if (!useChatStore.getState().members.some((member) => member.id === update.userId)) {
        void useChatStore.getState().loadMembers();
      }
    });

    if (socket.connected) {
      joinAndResync();
    }

    void useChatStore.getState().loadMembers();

    return () => {
      connectionGenerationRef.current += 1;
      joinedChannelsRef.current.clear();
      joinPromisesRef.current.clear();
      synchronizationPromisesRef.current.clear();
      socket.off("connect", joinAndResync);
      socket.close();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    const socket = socketRef.current;

    if (!socket) {
      return;
    }

    requestChannelSynchronization(socket, channelId);
  }, [channelId]);

  // Entra/sai da sala de voz de acordo com o tipo do canal ativo. Trocar
  // entre dois canais de voz não passa por leaveChannel: joinChannel já
  // desconecta a sala anterior antes de conectar a nova (voice-store.ts).
  useEffect(() => {
    const channel = getChannel(channelId);

    if (channel?.kind === "voice") {
      if (useVoiceStore.getState().channelSlug !== channelId) {
        void useVoiceStore.getState().joinChannel(channelId);
      }
    } else if (useVoiceStore.getState().channelSlug !== null) {
      void useVoiceStore.getState().leaveChannel();
    }
  }, [channelId]);

  // Desmontagem do layout (ex.: navegação para fora da comunidade) também
  // precisa liberar a sala de voz — cobre qualquer saída que não passe pela
  // troca de channelId acima.
  useEffect(() => {
    return () => {
      void useVoiceStore.getState().leaveChannel();
    };
  }, []);

  if (!activeChannel || !activeServer) {
    return null;
  }

  function handleNavigateChannel(nextChannelId: ChannelId) {
    setMobilePanel(null);
    onNavigateChannel(nextChannelId);
  }

  function handleLogout() {
    // Chamada explícita (em vez de depender só do cleanup de desmontagem)
    // para liberar a sala e limpar preferências sensíveis antes que outra
    // conta possa reutilizar esta mesma instância da aplicação.
    void useVoiceStore.getState().resetSession();
    onLogout();
  }

  async function handleSendMessage(content: string, clientMessageId: string): Promise<void> {
    const socket = socketRef.current;

    if (!socket) {
      throw new ChatSendError("offline", "not_connected");
    }

    await ensureChannelJoined(socket, channelId);
    await sendChatMessage(socket, channelId, content, clientMessageId);
  }

  function handleTypingStart() {
    const socket = socketRef.current;
    const typingChannel = channelId;

    if (!socket || getChannel(typingChannel)?.kind !== "text") {
      return;
    }

    const generation = ++typingGenerationRef.current;
    void ensureChannelJoined(socket, typingChannel)
      .then(() => {
        if (
          generation === typingGenerationRef.current &&
          activeChannelRef.current === typingChannel
        ) {
          startTyping(socket, typingChannel);
        }
      })
      .catch(() => {
        // O próximo input/reconnect pode iniciar novamente quando houver join.
      });
  }

  function handleTypingStop() {
    const socket = socketRef.current;
    typingGenerationRef.current += 1;

    if (!socket || !joinedChannelsRef.current.has(channelId)) {
      return;
    }

    stopTyping(socket, channelId);
  }

  function handleToggleVoiceMic() {
    void useVoiceStore.getState().toggleMic();
  }

  function handleToggleVoiceDeafen() {
    useVoiceStore.getState().toggleDeafen();
  }

  function handleToggleVoiceCamera() {
    void useVoiceStore.getState().toggleCamera();
  }

  function handleStartVoiceScreenShare(preset: ScreenSharePresetId) {
    void useVoiceStore.getState().startScreenShare(preset);
  }

  function handleStopVoiceScreenShare() {
    void useVoiceStore.getState().stopScreenShare();
  }

  function handleResumeVoiceAudioPlayback() {
    void useVoiceStore.getState().resumeAudioPlayback();
  }

  function handleLeaveVoice() {
    void useVoiceStore.getState().leaveChannel();
  }

  function handleJoinVoice() {
    if (getChannel(channelId)?.kind !== "voice") {
      return;
    }

    void useVoiceStore.getState().joinChannel(channelId);
  }

  function handleRetryHistory() {
    const socket = socketRef.current;

    if (!socket) {
      return;
    }

    requestChannelSynchronization(socket, channelId);
  }

  const messages = messagesByChannel[channelId] ?? [];
  const isLoadingHistory = loadingHistoryByChannel[channelId] ?? false;
  const hasMoreHistory = hasMoreByChannel[channelId] ?? false;
  const historyError = historyErrorByChannel[channelId] ?? null;
  const resyncStatus = resyncStatusByChannel[channelId] ?? "idle";
  const typingUsers = Object.entries(typingByChannel[channelId] ?? {})
    .filter(([userId]) => userId !== session.user.id)
    .map(([, username]) => username);

  const channelSidebarProps = {
    activeChannelId: activeChannel.id,
    serverId: activeServer.id,
    user: session.user,
    onNavigate: handleNavigateChannel,
    onLogout: handleLogout,
    onlineCount: onlineUserIds.size,
    isSelfOnline: onlineUserIds.has(session.user.id),
    voice: {
      status: voiceStatus,
      channelSlug: voiceChannelSlug,
      roomName: voiceRoomName,
      rttMs: voiceRttMs,
      error: voiceError,
      audioPlaybackBlocked: voiceAudioPlaybackBlocked,
      micMuted: voiceMicMuted,
      deafened: voiceDeafened,
      cameraEnabled: voiceCameraEnabled,
      screenShareEnabled: voiceScreenShareEnabled,
      screenSharePreset: voiceScreenSharePreset,
      participants: voiceParticipants,
    },
    onToggleVoiceMic: handleToggleVoiceMic,
    onToggleVoiceDeafen: handleToggleVoiceDeafen,
    onToggleVoiceCamera: handleToggleVoiceCamera,
    onStartVoiceScreenShare: handleStartVoiceScreenShare,
    onStopVoiceScreenShare: handleStopVoiceScreenShare,
    onResumeVoiceAudioPlayback: handleResumeVoiceAudioPlayback,
    onLeaveVoice: handleLeaveVoice,
  };

  return (
    <div className="grid h-full min-h-0 grid-cols-1 overflow-hidden bg-respawn-base text-respawn-ice md:grid-cols-[72px_248px_minmax(0,1fr)] xl:grid-cols-[72px_264px_minmax(0,1fr)_248px]">
      <ServerRail
        activeServerId={activeServer.id}
        onSelectServer={() => handleNavigateChannel(DEFAULT_CHANNEL_ID)}
        className="hidden md:flex"
      />
      <ChannelSidebar {...channelSidebarProps} className="hidden md:flex" />

      <ChatPanel
        key={activeChannel.id}
        channel={activeChannel}
        messages={messages}
        isLoadingHistory={isLoadingHistory}
        hasMoreHistory={hasMoreHistory}
        historyError={historyError}
        resyncStatus={resyncStatus}
        onlineCount={onlineUserIds.size}
        typingUsers={typingUsers}
        currentUserId={session.user.id}
        onOpenNavigation={() => setMobilePanel("navigation")}
        onOpenMembers={() => setMobilePanel("members")}
        onSendMessage={handleSendMessage}
        onLoadOlderMessages={() => void useChatStore.getState().loadOlderMessages(channelId)}
        onRetryHistory={handleRetryHistory}
        onTypingStart={handleTypingStart}
        onTypingStop={handleTypingStop}
        onJoinVoice={handleJoinVoice}
        voiceStatus={activeChannel.id === voiceChannelSlug ? voiceStatus : "disconnected"}
        voiceError={voiceError}
        voiceParticipants={activeChannel.id === voiceChannelSlug ? voiceParticipants : []}
      />

      <MemberSidebar
        className="hidden xl:flex"
        members={members}
        onlineUserIds={onlineUserIds}
        membersError={membersError}
      />

      {mobilePanel === "navigation" ? (
        <MobileDrawer
          title="servidores e canais"
          side="left"
          onClose={closeMobilePanel}
        >
          <div className="grid h-full w-[min(340px,calc(100vw-16px))] grid-cols-[72px_minmax(0,1fr)] overflow-hidden bg-respawn-panel">
            <ServerRail
              activeServerId={activeServer.id}
              onSelectServer={() => handleNavigateChannel(DEFAULT_CHANNEL_ID)}
              className="flex"
            />
            <ChannelSidebar
              {...channelSidebarProps}
              className="flex [&>div:first-child]:pr-16"
            />
          </div>
        </MobileDrawer>
      ) : null}

      {mobilePanel === "members" ? (
        <MobileDrawer
          title="lista de membros"
          side="right"
          onClose={closeMobilePanel}
        >
          <MemberSidebar
            className="flex h-full w-[min(300px,calc(100vw-16px))] [&>div:first-child]:pl-16"
            members={members}
            onlineUserIds={onlineUserIds}
            membersError={membersError}
          />
        </MobileDrawer>
      ) : null}
    </div>
  );
}
