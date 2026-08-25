import { useEffect, useRef } from "react";

import type { Track } from "../../lib/voice-client.js";
import type { VoiceParticipant } from "../../stores/voice-store.js";

const MAX_VISIBLE_TILES = 6;

interface VideoGridProps {
  participants: VoiceParticipant[];
}

interface VideoTileDescriptor {
  key: string;
  track: Track;
  label: string;
  isLocal: boolean;
  isSpeaking: boolean;
}

/**
 * Achata cada participante em até 2 tiles independentes (câmera e tela) —
 * cada track aparece uma única vez, então uma pessoa com câmera E tela ocupa
 * 2 vagas do grid, nunca a mesma track publicada em dois tiles.
 */
function buildTiles(participants: VoiceParticipant[]): VideoTileDescriptor[] {
  const ordered = [...participants].sort((a, b) => Number(b.isLocal) - Number(a.isLocal));
  const tiles: VideoTileDescriptor[] = [];

  for (const participant of ordered) {
    if (participant.cameraTrack) {
      tiles.push({
        key: `${participant.id}:camera`,
        track: participant.cameraTrack,
        label: participant.isLocal ? `${participant.name} (você)` : participant.name,
        isLocal: participant.isLocal,
        isSpeaking: participant.isSpeaking,
      });
    }

    if (participant.screenShareTrack) {
      tiles.push({
        key: `${participant.id}:screen`,
        track: participant.screenShareTrack,
        label: participant.isLocal ? "Sua tela" : `Tela de ${participant.name}`,
        isLocal: participant.isLocal,
        isSpeaking: false,
      });
    }
  }

  return tiles;
}

function VideoTile({ tile }: { tile: VideoTileDescriptor }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const track = tile.track;
    const element = videoRef.current;

    if (!element) {
      return;
    }

    track.attach(element);

    return () => {
      track.detach(element);
    };
  }, [tile.track]);

  return (
    <div
      data-testid={`video-tile-${tile.key}`}
      className={`relative aspect-video overflow-hidden rounded-xl bg-black/40 ring-2 transition-all ${
        tile.isSpeaking ? "ring-respawn-neon shadow-neon-soft" : "ring-transparent"
      }`}
    >
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={tile.isLocal}
        className="h-full w-full object-cover"
      />
      <span className="absolute bottom-1.5 left-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white">
        {tile.label}
      </span>
    </div>
  );
}

export function VideoGrid({ participants }: VideoGridProps) {
  const tiles = buildTiles(participants);

  if (tiles.length === 0) {
    return null;
  }

  const visible = tiles.slice(0, MAX_VISIBLE_TILES);
  const overflowCount = tiles.length - visible.length;

  return (
    <div
      role="region"
      aria-label="Vídeos da chamada de voz"
      className="grid grid-cols-2 gap-2 px-4 pb-4 sm:grid-cols-3 sm:px-6"
    >
      {visible.map((tile) => (
        <VideoTile key={tile.key} tile={tile} />
      ))}
      {overflowCount > 0 ? (
        <div
          data-testid="video-grid-overflow"
          className="grid aspect-video place-items-center rounded-xl bg-white/[0.04] text-sm font-bold text-slate-300"
        >
          +{overflowCount}
        </div>
      ) : null}
    </div>
  );
}
