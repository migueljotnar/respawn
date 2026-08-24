import {
  DEFAULT_CHANNEL_ID,
  DEFAULT_SERVER_ID,
  communityServers,
  isChannelId,
  type ChannelId,
} from "../data/community-mocks.js";

export type AuthPage = "login" | "register";

export type AppRoute =
  | { kind: "auth"; page: AuthPage }
  | { kind: "community"; serverId: string; channelId: ChannelId }
  | { kind: "unknown" };

export function communityPath(
  channelId: ChannelId,
  serverId = DEFAULT_SERVER_ID,
): string {
  return `/channels/${serverId}/${channelId}`;
}

export const DEFAULT_COMMUNITY_PATH = communityPath(DEFAULT_CHANNEL_ID);

export function parseAppRoute(pathname: string): AppRoute {
  if (pathname === "/login") {
    return { kind: "auth", page: "login" };
  }

  if (pathname === "/register") {
    return { kind: "auth", page: "register" };
  }

  const match = pathname.match(/^\/channels\/([a-z0-9-]+)\/([a-z0-9-]+)$/);

  if (!match) {
    return { kind: "unknown" };
  }

  const serverId = match[1];
  const channelId = match[2];
  const serverExists = communityServers.some(
    (server) => server.id === serverId && server.available,
  );

  if (!serverId || !channelId || !serverExists || !isChannelId(channelId)) {
    return { kind: "unknown" };
  }

  return { kind: "community", serverId, channelId };
}
