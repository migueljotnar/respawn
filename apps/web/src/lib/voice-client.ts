import {
  ConnectionQuality,
  Room,
  RoomEvent,
  Track,
  VideoPresets,
  type LocalParticipant,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";

// Reexportado a partir de um único módulo — a store de voz importa daqui em
// vez de "livekit-client" diretamente, então os testes só precisam mockar
// este arquivo, sem depender da API real do SDK.
export { ConnectionQuality, Room, RoomEvent, Track, VideoPresets };
export type {
  LocalParticipant,
  LocalTrackPublication,
  Participant,
  RemoteParticipant,
  RemoteTrack,
  RemoteTrackPublication,
};

export function createRoom(): Room {
  return new Room({ adaptiveStream: true, dynacast: true });
}
