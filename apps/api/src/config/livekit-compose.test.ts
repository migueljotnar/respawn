import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const composePath = new URL("../../../../compose.yaml", import.meta.url);

test("LiveKit local fixa a imagem e anuncia as portas RTC pelo IP LAN do host", async () => {
  const compose = await readFile(composePath, "utf8");

  assert.match(
    compose,
    /image:\s+livekit\/livekit-server@sha256:[a-f0-9]{64}/,
    "a imagem não pode usar a tag mutável latest",
  );
  assert.match(
    compose,
    /NODE_IP:\s+"\$\{LIVEKIT_NODE_IP:\?[^}]+\}"/,
    "o IP LAN deve ser obrigatorio; loopback nao e alcancavel pelo WebRTC via Docker Desktop",
  );
  assert.doesNotMatch(compose, /NODE_IP:[^\r\n]*127\.0\.0\.1/);
  assert.match(compose, /LIVEKIT_RTC_ENABLE_LOOPBACK_CANDIDATE:\s+"false"/);
  assert.match(compose, /LIVEKIT_RTC_USE_EXTERNAL_IP:\s+"false"/);
  assert.match(compose, /LIVEKIT_RTC_TCP_PORT:\s+"7881"/);
  assert.match(compose, /LIVEKIT_RTC_UDP_PORT:\s+"7882"/);
  assert.match(compose, /"0\.0\.0\.0:7881:7881"/);
  assert.match(compose, /"0\.0\.0\.0:7882:7882\/udp"/);
});
