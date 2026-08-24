import { useCallback, useEffect, useMemo, useState } from "react";

import { ChannelSidebar } from "../components/community/ChannelSidebar.js";
import { ChatPanel } from "../components/community/ChatPanel.js";
import { MemberSidebar } from "../components/community/MemberSidebar.js";
import { MobileDrawer } from "../components/community/MobileDrawer.js";
import { ServerRail } from "../components/community/ServerRail.js";
import {
  DEFAULT_CHANNEL_ID,
  communityServers,
  getChannel,
  mockMessagesByChannel,
  type ChannelId,
  type MockMessage,
} from "../data/community-mocks.js";
import type { VerifiedSession } from "../lib/auth-api.js";

type MobilePanel = "navigation" | "members" | null;
type LocalMessages = Partial<Record<ChannelId, MockMessage[]>>;

interface MainLayoutProps {
  session: VerifiedSession;
  serverId: string;
  channelId: ChannelId;
  onNavigateChannel: (channelId: ChannelId) => void;
  onLogout: () => void;
}

function getInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function MainLayout({
  session,
  serverId,
  channelId,
  onNavigateChannel,
  onLogout,
}: MainLayoutProps) {
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>(null);
  const [localMessages, setLocalMessages] = useState<LocalMessages>({});
  const activeChannel = getChannel(channelId) ?? getChannel(DEFAULT_CHANNEL_ID);
  const activeServer =
    communityServers.find((server) => server.id === serverId) ?? communityServers[0];
  const closeMobilePanel = useCallback(() => setMobilePanel(null), []);

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

  const messages = useMemo(() => {
    if (!activeChannel) return [];
    return [
      ...mockMessagesByChannel[activeChannel.id],
      ...(localMessages[activeChannel.id] ?? []),
    ];
  }, [activeChannel, localMessages]);

  if (!activeChannel || !activeServer) {
    return null;
  }

  function handleNavigateChannel(nextChannelId: ChannelId) {
    setMobilePanel(null);
    onNavigateChannel(nextChannelId);
  }

  function handleSendLocalMessage(content: string) {
    const author = session.user.displayName ?? session.user.username;
    const message: MockMessage = {
      id: `local-${channelId}-${Date.now()}`,
      author,
      initials: getInitials(author),
      role: "PLAYER",
      content,
      timestamp: "Agora",
      reactions: [],
      isLocal: true,
    };

    setLocalMessages((current) => ({
      ...current,
      [channelId]: [...(current[channelId] ?? []), message],
    }));
  }

  const channelSidebarProps = {
    activeChannelId: activeChannel.id,
    serverId: activeServer.id,
    user: session.user,
    onNavigate: handleNavigateChannel,
    onLogout,
  };

  return (
    <div className="grid h-[100dvh] min-h-0 grid-cols-1 overflow-hidden bg-respawn-base text-respawn-ice md:grid-cols-[72px_248px_minmax(0,1fr)] xl:grid-cols-[72px_264px_minmax(0,1fr)_248px]">
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
        onOpenNavigation={() => setMobilePanel("navigation")}
        onOpenMembers={() => setMobilePanel("members")}
        onSendLocalMessage={handleSendLocalMessage}
      />

      <MemberSidebar className="hidden xl:flex" />

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
          <MemberSidebar className="flex h-full w-[min(300px,calc(100vw-16px))] [&>div:first-child]:pl-16" />
        </MobileDrawer>
      ) : null}
    </div>
  );
}
