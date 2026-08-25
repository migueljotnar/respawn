import {
  ChevronDown,
  Hash,
  Headphones,
  LogOut,
  Mic,
  MicOff,
  MonitorUp,
  ShieldCheck,
  Video,
  VideoOff,
  Volume2,
} from "lucide-react";
import { useState, type MouseEvent } from "react";

import {
  communityChannels,
  type ChannelId,
} from "../../data/community-mocks.js";
import { communityPath } from "../../lib/app-router.js";
import type { PublicUser } from "../../lib/auth-api.js";
import {
  SCREEN_SHARE_PRESETS,
  type ScreenSharePresetId,
  type VoiceConnectionStatus,
  type VoiceParticipant,
} from "../../stores/voice-store.js";

export interface ChannelSidebarVoiceState {
  status: VoiceConnectionStatus;
  channelSlug: string | null;
  roomName: string | null;
  rttMs: number | null;
  error: string | null;
  audioPlaybackBlocked: boolean;
  micMuted: boolean;
  deafened: boolean;
  cameraEnabled: boolean;
  screenShareEnabled: boolean;
  screenSharePreset: ScreenSharePresetId | null;
  participants: VoiceParticipant[];
}

interface ChannelSidebarProps {
  activeChannelId: ChannelId;
  serverId: string;
  user: PublicUser;
  onNavigate: (channelId: ChannelId) => void;
  onLogout: () => void;
  onlineCount: number;
  isSelfOnline: boolean;
  className: string;
  voice: ChannelSidebarVoiceState;
  onToggleVoiceMic: () => void;
  onToggleVoiceDeafen: () => void;
  onToggleVoiceCamera: () => void;
  onStartVoiceScreenShare: (preset: ScreenSharePresetId) => void;
  onStopVoiceScreenShare: () => void;
  onResumeVoiceAudioPlayback: () => void;
  onLeaveVoice: () => void;
}

const sections = ["PONTO DE ENCONTRO", "ARCADE", "SALAS DE VOZ"] as const;

function getInitials(user: PublicUser): string {
  const source = user.displayName ?? user.username;
  return source
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function initialsFromName(name: string): string {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function describeVoiceStatusLabel(status: VoiceConnectionStatus): string {
  if (status === "connected") return "Voice Connected";
  if (status === "connecting") return "Conectando...";
  if (status === "error") return "Erro na conexão de voz";
  return "";
}

export function ChannelSidebar({
  activeChannelId,
  serverId,
  user,
  onNavigate,
  onLogout,
  onlineCount,
  isSelfOnline,
  className,
  voice,
  onToggleVoiceMic,
  onToggleVoiceDeafen,
  onToggleVoiceCamera,
  onStartVoiceScreenShare,
  onStopVoiceScreenShare,
  onResumeVoiceAudioPlayback,
  onLeaveVoice,
}: ChannelSidebarProps) {
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);

  function handleChannelClick(
    event: MouseEvent<HTMLAnchorElement>,
    channelId: ChannelId,
  ) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }

    event.preventDefault();
    onNavigate(channelId);
  }

  return (
    <aside
      aria-label="Navegação de canais"
      className={`${className} min-h-0 w-full min-w-0 flex-col border-r border-white/[0.07] bg-respawn-panel`}
    >
      <div className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.07] px-4">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h2 className="truncate font-bold text-respawn-ice">Respawn HQ</h2>
            <ShieldCheck className="h-4 w-4 shrink-0 text-respawn-neon" aria-label="Comunidade verificada" />
          </div>
          <p className="mt-0.5 text-[11px] uppercase tracking-digital text-slate-400">
            comunidade oficial
          </p>
        </div>
        <ChevronDown className="h-4 w-4 text-slate-400" aria-hidden="true" />
      </div>

      <div className="mx-3 mt-3 flex shrink-0 items-center justify-between rounded-xl border border-respawn-neon/15 bg-respawn-neon/[0.05] px-3 py-2.5">
        <div>
          <p className="text-xs font-bold text-respawn-ice">Comunidade em movimento</p>
          <p className="mt-0.5 text-[11px] text-slate-400">Presença em tempo real</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-respawn-neon px-2 py-1 text-[10px] font-black uppercase tracking-wider text-respawn-base">
          <span className="h-1.5 w-1.5 rounded-full bg-respawn-base" aria-hidden="true" />
          {onlineCount} online
        </span>
      </div>

      <nav aria-label="Canais da Respawn HQ" className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-3">
        {sections.map((section) => {
          const channels = communityChannels.filter(
            (channel) => channel.section === section,
          );

          return (
            <section key={section} aria-labelledby={`section-${section.replaceAll(" ", "-").toLowerCase()}`} className="mb-4">
              <h3
                id={`section-${section.replaceAll(" ", "-").toLowerCase()}`}
                className="mb-1 flex items-center gap-1 px-2 text-[10px] font-extrabold uppercase tracking-digital text-slate-400"
              >
                <ChevronDown className="h-3 w-3" aria-hidden="true" />
                {section}
              </h3>
              <ul className="space-y-0.5" role="list">
                {channels.map((channel) => {
                  const isActive = channel.id === activeChannelId;
                  const ChannelIcon = channel.kind === "voice" ? Volume2 : Hash;

                  return (
                    <li key={channel.id}>
                      <a
                        href={communityPath(channel.id, serverId)}
                        onClick={(event) => handleChannelClick(event, channel.id)}
                        aria-current={isActive ? "page" : undefined}
                        className={`group relative flex min-h-11 items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-respawn-neon ${
                          isActive
                            ? "bg-white/[0.07] font-semibold text-respawn-ice"
                            : "text-slate-300 hover:bg-white/[0.04] hover:text-respawn-ice"
                        }`}
                      >
                        {isActive ? (
                          <span
                            className="absolute inset-y-2 left-0 w-0.5 rounded-r-full bg-respawn-neon"
                            aria-hidden="true"
                          />
                        ) : null}
                        <ChannelIcon
                          className={`h-[18px] w-[18px] shrink-0 ${
                            isActive ? "text-respawn-neon" : "text-slate-400 group-hover:text-slate-300"
                          }`}
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1 truncate">{channel.name}</span>
                        {!isActive && channel.unreadCount > 0 ? (
                          <span className="grid min-h-5 min-w-5 place-items-center rounded-full bg-respawn-neon px-1 text-[10px] font-black text-respawn-base">
                            {channel.unreadCount}
                            <span className="sr-only"> mensagens não lidas</span>
                          </span>
                        ) : null}
                      </a>
                      {channel.kind === "voice" && channel.id === voice.channelSlug ? (
                        <ul
                          className="ml-6 mt-0.5 space-y-0.5 border-l border-white/10 py-1 pl-2"
                          role="list"
                          aria-label={`Conectados em ${channel.name}`}
                        >
                          {voice.participants.length === 0 ? (
                            <li className="px-2 py-1 text-[11px] text-slate-500">Conectando...</li>
                          ) : (
                            voice.participants.map((participant) => (
                              <li key={participant.id} className="flex items-center gap-2 px-2 py-1">
                                <span
                                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gradient-to-br from-respawn-neon/20 to-respawn-purple/25 text-[10px] font-black text-respawn-ice ring-2 transition-all ${
                                    participant.isSpeaking
                                      ? "animate-pulse ring-respawn-neon shadow-neon-soft"
                                      : "ring-transparent"
                                  }`}
                                  aria-hidden="true"
                                >
                                  {initialsFromName(participant.name)}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-xs text-slate-300">
                                  {participant.name}
                                  {participant.isLocal ? " (você)" : ""}
                                </span>
                                {participant.micMuted ? (
                                  <MicOff
                                    className="h-3 w-3 shrink-0 text-slate-500"
                                    aria-label={`${participant.name} está com o microfone mutado`}
                                  />
                                ) : null}
                              </li>
                            ))
                          )}
                        </ul>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </nav>

      {voice.status !== "disconnected" ? (
        <div
          role="status"
          aria-live="polite"
          className="mx-3 mb-2 shrink-0 rounded-xl border border-respawn-neon/20 bg-respawn-neon/[0.06] px-3 py-2"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-xs font-bold text-respawn-ice">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    voice.status === "connected"
                      ? "bg-respawn-neon"
                      : voice.status === "error"
                        ? "bg-red-400"
                        : "bg-amber-400"
                  }`}
                  aria-hidden="true"
                />
                {describeVoiceStatusLabel(voice.status)}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-slate-400">
                {voice.roomName ?? voice.channelSlug}
                {voice.status === "connected" && voice.rttMs !== null ? ` · ${voice.rttMs} ms` : ""}
                {voice.screenShareEnabled && voice.screenSharePreset
                  ? ` · Compartilhando (${
                      SCREEN_SHARE_PRESETS.find((preset) => preset.id === voice.screenSharePreset)
                        ?.label ?? voice.screenSharePreset
                    })`
                  : ""}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={onToggleVoiceCamera}
                aria-pressed={voice.cameraEnabled}
                aria-label={voice.cameraEnabled ? "Desligar câmera" : "Ligar câmera"}
                className={`grid h-7 w-7 place-items-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-respawn-neon ${
                  voice.cameraEnabled
                    ? "bg-respawn-neon/15 text-respawn-neon hover:bg-respawn-neon/25"
                    : "text-slate-400 hover:bg-white/[0.06] hover:text-respawn-ice"
                }`}
              >
                {voice.cameraEnabled ? <Video className="h-4 w-4" /> : <VideoOff className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (voice.screenShareEnabled) {
                    onStopVoiceScreenShare();
                    return;
                  }

                  setPresetPickerOpen((open) => !open);
                }}
                aria-pressed={voice.screenShareEnabled}
                aria-expanded={presetPickerOpen}
                aria-label={voice.screenShareEnabled ? "Parar compartilhamento de tela" : "Compartilhar tela"}
                className={`grid h-7 w-7 place-items-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-respawn-neon ${
                  voice.screenShareEnabled
                    ? "bg-respawn-neon/15 text-respawn-neon hover:bg-respawn-neon/25"
                    : "text-slate-400 hover:bg-white/[0.06] hover:text-respawn-ice"
                }`}
              >
                <MonitorUp className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onLeaveVoice}
                aria-label="Sair da chamada de voz"
                className="rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400 outline-none transition-colors hover:bg-white/[0.06] hover:text-red-300 focus-visible:ring-2 focus-visible:ring-respawn-neon"
              >
                Sair
              </button>
            </div>
          </div>
          {presetPickerOpen && !voice.screenShareEnabled ? (
            <div
              role="menu"
              aria-label="Escolher qualidade do compartilhamento de tela"
              className="mt-2 grid grid-cols-2 gap-1"
            >
              {SCREEN_SHARE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setPresetPickerOpen(false);
                    onStartVoiceScreenShare(preset.id);
                  }}
                  className="rounded-lg border border-white/10 px-2 py-1 text-[10px] font-bold text-slate-300 outline-none transition-colors hover:border-respawn-neon/40 hover:text-respawn-ice focus-visible:ring-2 focus-visible:ring-respawn-neon"
                >
                  {preset.label}
                </button>
              ))}
            </div>
          ) : null}
          {voice.error ? <p className="mt-1 text-[11px] text-red-300">{voice.error}</p> : null}
          {voice.audioPlaybackBlocked ? (
            <button
              type="button"
              onClick={onResumeVoiceAudioPlayback}
              className="mt-1.5 w-full rounded-lg bg-respawn-neon px-2 py-1 text-[10px] font-black text-respawn-base outline-none focus-visible:ring-2 focus-visible:ring-respawn-ice"
            >
              Ativar áudio
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="flex min-h-[68px] shrink-0 items-center gap-2 border-t border-white/[0.07] bg-respawn-base/35 px-3 py-2">
        <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-respawn-neon/25 to-respawn-purple/30 text-xs font-black text-respawn-ice">
          {getInitials(user)}
          <span
            role="img"
            className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-respawn-panel ${isSelfOnline ? "bg-respawn-neon" : "bg-slate-500"}`}
            aria-label={isSelfOnline ? "online" : "offline"}
          />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-respawn-ice">
            {user.displayName ?? user.username}
          </p>
          <p className="truncate text-[10px] text-slate-400">@{user.username}</p>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={onToggleVoiceMic}
            disabled={voice.status !== "connected"}
            aria-pressed={voice.micMuted}
            aria-label={
              voice.status === "connected"
                ? voice.micMuted
                  ? "Ativar microfone"
                  : "Mutar microfone"
                : "Microfone — conecte-se a uma sala de voz"
            }
            className={`grid h-9 w-9 place-items-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-respawn-neon ${
              voice.status !== "connected"
                ? "cursor-not-allowed text-slate-500 opacity-70"
                : voice.micMuted
                  ? "bg-red-400/10 text-red-300 hover:bg-red-400/20"
                  : "text-slate-300 hover:bg-white/[0.06] hover:text-respawn-ice"
            }`}
          >
            {voice.micMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onToggleVoiceDeafen}
            disabled={voice.status !== "connected"}
            aria-pressed={voice.deafened}
            aria-label={
              voice.status === "connected"
                ? voice.deafened
                  ? "Reativar áudio"
                  : "Ensurdecer áudio"
                : "Áudio — conecte-se a uma sala de voz"
            }
            className={`grid h-9 w-9 place-items-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-respawn-neon ${
              voice.status !== "connected"
                ? "cursor-not-allowed text-slate-500 opacity-70"
                : voice.deafened
                  ? "bg-red-400/10 text-red-300 hover:bg-red-400/20"
                  : "text-slate-300 hover:bg-white/[0.06] hover:text-respawn-ice"
            }`}
          >
            <Headphones className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={onLogout}
            aria-label="Sair desta sessão"
            title="Sair desta sessão"
            className="grid h-9 w-9 place-items-center rounded-lg text-slate-400 outline-none transition-colors hover:bg-white/[0.06] hover:text-red-300 focus-visible:ring-2 focus-visible:ring-respawn-neon"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}
