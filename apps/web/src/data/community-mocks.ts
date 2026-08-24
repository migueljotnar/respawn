export type ChannelId =
  | "spawn-point"
  | "chat-geral"
  | "party-up"
  | "clips-e-highlights"
  | "lobby-neon"
  | "squad-alpha";

export type ChannelKind = "text" | "voice";
export type MemberRole = "MOD" | "VETERAN" | "PLAYER";
export type MemberStatus = "online" | "idle" | "offline";

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

export interface CommunityMember {
  id: string;
  name: string;
  username: string;
  initials: string;
  role: MemberRole;
  status: MemberStatus;
  activity: string;
}

export interface MockReaction {
  emoji: string;
  count: number;
}

export interface MockMessage {
  id: string;
  author: string;
  initials: string;
  role: MemberRole;
  content: string;
  timestamp: string;
  reactions: MockReaction[];
  isLocal?: boolean;
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
    unreadCount: 7,
  },
  {
    id: "party-up",
    name: "party-up",
    kind: "text",
    section: "PONTO DE ENCONTRO",
    topic: "Encontre seu próximo squad",
    description: "Diga o jogo, a plataforma e o horário. O resto é GG.",
    unreadCount: 2,
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
    topic: "Sala social — 3 conectados",
    description: "Um lobby leve para conversar enquanto escolhem o próximo jogo.",
    unreadCount: 0,
  },
  {
    id: "squad-alpha",
    name: "Squad Alpha",
    kind: "voice",
    section: "SALAS DE VOZ",
    topic: "Competitivo — 2 conectados",
    description: "Comunicação focada para quem entrou na fila ranqueada.",
    unreadCount: 0,
  },
];

export const communityMembers: CommunityMember[] = [
  {
    id: "luna-byte",
    name: "Luna Byte",
    username: "lunabyte",
    initials: "LB",
    role: "MOD",
    status: "online",
    activity: "Cuidando do spawn",
  },
  {
    id: "rafa-gg",
    name: "Rafa GG",
    username: "rafagg",
    initials: "RG",
    role: "MOD",
    status: "online",
    activity: "Organizando a game night",
  },
  {
    id: "atlas-xp",
    name: "Atlas XP",
    username: "atlasxp",
    initials: "AX",
    role: "VETERAN",
    status: "online",
    activity: "No #party-up",
  },
  {
    id: "maya-pixel",
    name: "Maya Pixel",
    username: "mayapixel",
    initials: "MP",
    role: "VETERAN",
    status: "idle",
    activity: "Editando um highlight",
  },
  {
    id: "nando-crit",
    name: "Nando Crit",
    username: "nandocrit",
    initials: "NC",
    role: "VETERAN",
    status: "offline",
    activity: "Volta mais tarde",
  },
  {
    id: "nox",
    name: "Nox",
    username: "noxplays",
    initials: "NX",
    role: "PLAYER",
    status: "online",
    activity: "Buscando trio",
  },
  {
    id: "pixel-nina",
    name: "Pixel Nina",
    username: "pixelnina",
    initials: "PN",
    role: "PLAYER",
    status: "online",
    activity: "No Lobby Neon",
  },
  {
    id: "jota-rush",
    name: "Jota Rush",
    username: "jotarush",
    initials: "JR",
    role: "PLAYER",
    status: "idle",
    activity: "Pausa pro café",
  },
  {
    id: "caique-zero",
    name: "Caique Zero",
    username: "caiquezero",
    initials: "CZ",
    role: "PLAYER",
    status: "offline",
    activity: "Offline",
  },
];

export const mockMessagesByChannel: Record<ChannelId, MockMessage[]> = {
  "spawn-point": [
    {
      id: "spawn-1",
      author: "Luna Byte",
      initials: "LB",
      role: "MOD",
      content:
        "Boas-vindas ao seu ponto de respawn. Aqui ninguém precisa jogar sozinho — escolha um canal, puxe conversa e fique à vontade.",
      timestamp: "Hoje, 18:04",
      reactions: [{ emoji: "💚", count: 12 }],
    },
    {
      id: "spawn-2",
      author: "Atlas XP",
      initials: "AX",
      role: "VETERAN",
      content:
        "Dica rápida: conta pra gente o que você joga no #chat-geral. Se estiver montando time, o #party-up é o atalho.",
      timestamp: "Hoje, 18:08",
      reactions: [{ emoji: "🎮", count: 6 }],
    },
    {
      id: "spawn-3",
      author: "Nox",
      initials: "NX",
      role: "PLAYER",
      content: "Cheguei agora e já curti a energia daqui. Bora de game night?",
      timestamp: "Hoje, 18:11",
      reactions: [{ emoji: "⚡", count: 4 }],
    },
  ],
  "chat-geral": [
    {
      id: "geral-1",
      author: "Maya Pixel",
      initials: "MP",
      role: "VETERAN",
      content: "Qual foi o jogo que fez vocês virarem a noite pela primeira vez?",
      timestamp: "Hoje, 19:20",
      reactions: [{ emoji: "👀", count: 8 }],
    },
    {
      id: "geral-2",
      author: "Pixel Nina",
      initials: "PN",
      role: "PLAYER",
      content: "Pra mim foi Minecraft. Comecei uma casa e quando vi já era uma cidade inteira.",
      timestamp: "Hoje, 19:22",
      reactions: [{ emoji: "⛏️", count: 5 }],
    },
    {
      id: "geral-3",
      author: "Rafa GG",
      initials: "RG",
      role: "MOD",
      content: "A resposta certa é sempre: “só mais uma partida”.",
      timestamp: "Hoje, 19:24",
      reactions: [
        { emoji: "😂", count: 14 },
        { emoji: "GG", count: 3 },
      ],
    },
  ],
  "party-up": [
    {
      id: "party-1",
      author: "Nox",
      initials: "NX",
      role: "PLAYER",
      content: "Alguém fecha trio hoje às 21h? PC, competitivo leve e zero tilt.",
      timestamp: "Hoje, 20:02",
      reactions: [{ emoji: "🙋", count: 3 }],
    },
    {
      id: "party-2",
      author: "Atlas XP",
      initials: "AX",
      role: "VETERAN",
      content: "Eu topo. Posso fazer suporte e já chamo a Nina quando ela voltar.",
      timestamp: "Hoje, 20:04",
      reactions: [{ emoji: "✅", count: 2 }],
    },
    {
      id: "party-3",
      author: "Jota Rush",
      initials: "JR",
      role: "PLAYER",
      content: "Se ainda tiver vaga, fecho a terceira. Meu nick é o mesmo daqui.",
      timestamp: "Hoje, 20:06",
      reactions: [{ emoji: "🔥", count: 4 }],
    },
  ],
  "clips-e-highlights": [
    {
      id: "clips-1",
      author: "Maya Pixel",
      initials: "MP",
      role: "VETERAN",
      content: "Separei o clutch da game night. O upload de mídia chega numa próxima fase, então imaginem a play perfeita aqui 😄",
      timestamp: "Hoje, 17:46",
      reactions: [{ emoji: "🏆", count: 9 }],
    },
  ],
  "lobby-neon": [
    {
      id: "lobby-1",
      author: "Pixel Nina",
      initials: "PN",
      role: "PLAYER",
      content: "Luna e Rafa estão neste lobby mock. A conexão de voz real chega na Fase 3.",
      timestamp: "Agora",
      reactions: [{ emoji: "🎧", count: 3 }],
    },
  ],
  "squad-alpha": [
    {
      id: "alpha-1",
      author: "Rafa GG",
      initials: "RG",
      role: "MOD",
      content: "Sala reservada para o squad competitivo. Hoje os dados são simulados e não existe conexão de voz ativa.",
      timestamp: "Agora",
      reactions: [{ emoji: "🎯", count: 2 }],
    },
  ],
};

export const memberRoleOrder: MemberRole[] = ["MOD", "VETERAN", "PLAYER"];

export function getChannel(channelId: string): CommunityChannel | undefined {
  return communityChannels.find((channel) => channel.id === channelId);
}

export function isChannelId(channelId: string): channelId is ChannelId {
  return getChannel(channelId) !== undefined;
}
