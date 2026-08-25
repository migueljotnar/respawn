export type ChannelId =
  | "spawn-point"
  | "chat-geral"
  | "party-up"
  | "clips-e-highlights"
  | "lobby-neon"
  | "squad-alpha";

export type ChannelKind = "text" | "voice";
export type MemberRole =
  | "NOVATO"
  | "PLAYER"
  | "SQUADMATE"
  | "VETERAN"
  | "MVP"
  | "ELITE"
  | "MOD"
  | "ADMIN";

export interface CommunityServer {
  id: string;
  name: string;
  shortLabel: string;
  accent: "neon" | "purple" | "ice";
  unreadCount: number;
  available: boolean;
}

export interface CommunityChannel {
  id: ChannelId;
  name: string;
  kind: ChannelKind;
  section: "PONTO DE ENCONTRO" | "ARCADE" | "SALAS DE VOZ";
  topic: string;
  description: string;
  unreadCount: number;
}

export const DEFAULT_SERVER_ID = "respawn-hq";
export const DEFAULT_CHANNEL_ID: ChannelId = "spawn-point";

export const communityServers: CommunityServer[] = [
  {
    id: DEFAULT_SERVER_ID,
    name: "Respawn HQ",
    shortLabel: "R+",
    accent: "neon",
    unreadCount: 0,
    available: true,
  },
  {
    id: "pixel-forge",
    name: "Pixel Forge",
    shortLabel: "PF",
    accent: "purple",
    unreadCount: 3,
    available: false,
  },
  {
    id: "night-shift",
    name: "Night Shift",
    shortLabel: "NS",
    accent: "ice",
    unreadCount: 0,
    available: false,
  },
  {
    id: "cozy-lobby",
    name: "Cozy Lobby",
    shortLabel: "CL",
    accent: "purple",
    unreadCount: 1,
    available: false,
  },
];

export const communityChannels: CommunityChannel[] = [
  {
    id: "spawn-point",
    name: "spawn-point",
    kind: "text",
    section: "PONTO DE ENCONTRO",
    topic: "Comece por aqui",
    description: "Boas-vindas, avisos e tudo que você precisa para encontrar seu lugar.",
    unreadCount: 0,
  },
  {
    id: "chat-geral",
    name: "chat-geral",
    kind: "text",
    section: "PONTO DE ENCONTRO",
    topic: "A resenha nunca pausa",
    description: "Conversa livre sobre jogos, rotina e as histórias depois da partida.",
    unreadCount: 0,
  },
  {
    id: "party-up",
    name: "party-up",
    kind: "text",
    section: "PONTO DE ENCONTRO",
    topic: "Encontre seu próximo squad",
    description: "Diga o jogo, a plataforma e o horário. O resto é GG.",
    unreadCount: 0,
  },
  {
    id: "clips-e-highlights",
    name: "clips-e-highlights",
    kind: "text",
    section: "ARCADE",
    topic: "Jogadas que merecem replay",
    description: "Clutches, momentos engraçados e aquela play impossível.",
    unreadCount: 0,
  },
  {
    id: "lobby-neon",
    name: "Lobby Neon",
    kind: "voice",
    section: "SALAS DE VOZ",
    topic: "Sala social",
    description: "Um lobby leve para conversar enquanto escolhem o próximo jogo.",
    unreadCount: 0,
  },
  {
    id: "squad-alpha",
    name: "Squad Alpha",
    kind: "voice",
    section: "SALAS DE VOZ",
    topic: "Competitivo",
    description: "Comunicação focada para quem entrou na fila ranqueada.",
    unreadCount: 0,
  },
];

export function getChannel(channelId: string): CommunityChannel | undefined {
  return communityChannels.find((channel) => channel.id === channelId);
}

export function isChannelId(channelId: string): channelId is ChannelId {
  return getChannel(channelId) !== undefined;
}
