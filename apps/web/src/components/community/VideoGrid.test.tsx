import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { VoiceParticipant } from "../../stores/voice-store.js";
import { VideoGrid } from "./VideoGrid.js";

afterEach(() => {
  cleanup();
});

class FakeVideoTrack {
  attach = vi.fn((element: HTMLMediaElement) => element);
  detach = vi.fn((_element?: HTMLMediaElement) => []);
}

function makeParticipant(overrides: Partial<VoiceParticipant> = {}): VoiceParticipant {
  return {
    id: "user-1",
    name: "Ana",
    isLocal: false,
    isSpeaking: false,
    micMuted: false,
    cameraEnabled: true,
    screenShareEnabled: false,
    cameraTrack: null,
    screenShareTrack: null,
    ...overrides,
  };
}

describe("VideoGrid — renderização e attach/detach de tracks", () => {
  it("não renderiza nada quando ninguém está com a câmera ligada", () => {
    const { container } = render(
      <VideoGrid participants={[makeParticipant({ cameraTrack: null })]} />,
    );

    expect(container.firstChild).toBeNull();
  });

  it("anexa o track real ao elemento de vídeo ao montar o tile", () => {
    const track = new FakeVideoTrack();
    render(
      <VideoGrid
        participants={[
          makeParticipant({ id: "user-1", cameraTrack: track as never }),
        ]}
      />,
    );

    expect(track.attach).toHaveBeenCalledTimes(1);
    const videoElement = track.attach.mock.calls[0]![0] as HTMLVideoElement;
    expect(videoElement.tagName).toBe("VIDEO");
  });

  it("desanexa o track ao desmontar o grid", () => {
    const track = new FakeVideoTrack();
    const view = render(
      <VideoGrid
        participants={[makeParticipant({ id: "user-1", cameraTrack: track as never })]}
      />,
    );

    view.unmount();

    expect(track.detach).toHaveBeenCalledTimes(1);
  });

  it("desanexa o track antigo e anexa o novo quando o track do participante muda", () => {
    const trackA = new FakeVideoTrack();
    const trackB = new FakeVideoTrack();
    const view = render(
      <VideoGrid
        participants={[makeParticipant({ id: "user-1", cameraTrack: trackA as never })]}
      />,
    );

    view.rerender(
      <VideoGrid
        participants={[makeParticipant({ id: "user-1", cameraTrack: trackB as never })]}
      />,
    );

    expect(trackA.detach).toHaveBeenCalledTimes(1);
    expect(trackB.attach).toHaveBeenCalledTimes(1);
  });

  it("remove o tile (e desanexa) quando o participante desliga a câmera", () => {
    const track = new FakeVideoTrack();
    const view = render(
      <VideoGrid
        participants={[makeParticipant({ id: "user-1", cameraTrack: track as never })]}
      />,
    );

    view.rerender(<VideoGrid participants={[makeParticipant({ id: "user-1", cameraTrack: null })]} />);

    expect(track.detach).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("video-tile-user-1:camera")).toBeNull();
  });

  it("mostra o participante local primeiro, independente da ordem recebida", () => {
    render(
      <VideoGrid
        participants={[
          makeParticipant({ id: "remote-1", name: "Beto", cameraTrack: new FakeVideoTrack() as never }),
          makeParticipant({
            id: "local-1",
            name: "Ana",
            isLocal: true,
            cameraTrack: new FakeVideoTrack() as never,
          }),
        ]}
      />,
    );

    const region = screen.getByRole("region", { name: "Vídeos da chamada de voz" });
    const tiles = region.querySelectorAll("[data-testid^='video-tile-']");
    expect(tiles[0]?.getAttribute("data-testid")).toBe("video-tile-local-1:camera");
    expect(tiles[1]?.getAttribute("data-testid")).toBe("video-tile-remote-1:camera");
  });
});

describe("VideoGrid — limite de 6 vídeos simultâneos", () => {
  function makeParticipantsWithCamera(count: number): VoiceParticipant[] {
    return Array.from({ length: count }, (_, index) =>
      makeParticipant({
        id: `user-${index}`,
        name: `User ${index}`,
        cameraTrack: new FakeVideoTrack() as never,
      }),
    );
  }

  it("renderiza todos os tiles quando há 6 ou menos participantes com câmera", () => {
    render(<VideoGrid participants={makeParticipantsWithCamera(6)} />);

    const region = screen.getByRole("region", { name: "Vídeos da chamada de voz" });
    expect(region.querySelectorAll("[data-testid^='video-tile-']").length).toBe(6);
    expect(screen.queryByTestId("video-grid-overflow")).toBeNull();
  });

  it("mostra no máximo 6 tiles de vídeo e um indicador de excedente quando há mais de 6", () => {
    render(<VideoGrid participants={makeParticipantsWithCamera(9)} />);

    const region = screen.getByRole("region", { name: "Vídeos da chamada de voz" });
    expect(region.querySelectorAll("[data-testid^='video-tile-']").length).toBe(6);
    expect(screen.getByTestId("video-grid-overflow").textContent).toBe("+3");
  });
});

describe("VideoGrid — indicador de fala", () => {
  it("marca com destaque visual só quem está falando", () => {
    render(
      <VideoGrid
        participants={[
          makeParticipant({ id: "user-1", isSpeaking: true, cameraTrack: new FakeVideoTrack() as never }),
          makeParticipant({ id: "user-2", isSpeaking: false, cameraTrack: new FakeVideoTrack() as never }),
        ]}
      />,
    );

    expect(screen.getByTestId("video-tile-user-1:camera").className).toContain("ring-respawn-neon");
    expect(screen.getByTestId("video-tile-user-2:camera").className).toContain("ring-transparent");
  });
});

describe("VideoGrid — compartilhamento de tela no grid", () => {
  it("renderiza a tela compartilhada como um tile próprio, anexando o track real", () => {
    const track = new FakeVideoTrack();
    render(
      <VideoGrid
        participants={[makeParticipant({ id: "user-1", screenShareTrack: track as never })]}
      />,
    );

    expect(screen.getByTestId("video-tile-user-1:screen")).toBeTruthy();
    expect(track.attach).toHaveBeenCalledTimes(1);
  });

  it("renderiza câmera e tela do mesmo participante como dois tiles distintos, sem duplicar nenhum dos dois", () => {
    const cameraTrack = new FakeVideoTrack();
    const screenTrack = new FakeVideoTrack();
    render(
      <VideoGrid
        participants={[
          makeParticipant({ id: "user-1", cameraTrack: cameraTrack as never, screenShareTrack: screenTrack as never }),
        ]}
      />,
    );

    const region = screen.getByRole("region", { name: "Vídeos da chamada de voz" });
    const tiles = region.querySelectorAll("[data-testid^='video-tile-']");
    expect(tiles.length).toBe(2);
    expect(screen.getByTestId("video-tile-user-1:camera")).toBeTruthy();
    expect(screen.getByTestId("video-tile-user-1:screen")).toBeTruthy();
    expect(cameraTrack.attach).toHaveBeenCalledTimes(1);
    expect(screenTrack.attach).toHaveBeenCalledTimes(1);
  });

  it("desanexa o track de tela ao parar o compartilhamento, sem afetar o tile da câmera", () => {
    const cameraTrack = new FakeVideoTrack();
    const screenTrack = new FakeVideoTrack();
    const view = render(
      <VideoGrid
        participants={[
          makeParticipant({ id: "user-1", cameraTrack: cameraTrack as never, screenShareTrack: screenTrack as never }),
        ]}
      />,
    );

    view.rerender(
      <VideoGrid
        participants={[makeParticipant({ id: "user-1", cameraTrack: cameraTrack as never, screenShareTrack: null })]}
      />,
    );

    expect(screenTrack.detach).toHaveBeenCalledTimes(1);
    expect(cameraTrack.detach).not.toHaveBeenCalled();
    expect(screen.queryByTestId("video-tile-user-1:screen")).toBeNull();
    expect(screen.queryByTestId("video-tile-user-1:camera")).toBeTruthy();
  });

  it("conta câmera e tela juntas no limite de 6 e no excedente", () => {
    render(
      <VideoGrid
        participants={[
          makeParticipant({
            id: "user-1",
            cameraTrack: new FakeVideoTrack() as never,
            screenShareTrack: new FakeVideoTrack() as never,
          }),
          makeParticipant({ id: "user-2", cameraTrack: new FakeVideoTrack() as never }),
          makeParticipant({ id: "user-3", cameraTrack: new FakeVideoTrack() as never }),
          makeParticipant({ id: "user-4", cameraTrack: new FakeVideoTrack() as never }),
          makeParticipant({ id: "user-5", cameraTrack: new FakeVideoTrack() as never }),
          makeParticipant({ id: "user-6", cameraTrack: new FakeVideoTrack() as never }),
        ]}
      />,
    );

    const region = screen.getByRole("region", { name: "Vídeos da chamada de voz" });
    expect(region.querySelectorAll("[data-testid^='video-tile-']").length).toBe(6);
    expect(screen.getByTestId("video-grid-overflow").textContent).toBe("+1");
  });
});
