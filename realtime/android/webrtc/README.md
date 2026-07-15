# Inworld Realtime — Android (WebRTC)

A native Android voice-agent app for the Inworld Realtime API over WebRTC: it streams
mic audio to the API, plays the agent's audio reply, and shows a live chat transcript
of both sides. Feature-parity port of the iOS example, sharing its protocol and
settings surface.

- Kotlin 2.4, Jetpack Compose + Material 3, minSdk 26
- WebRTC via [stream-webrtc-android](https://github.com/GetStream/webrtc-android) (maintained libwebrtc prebuilt, stock `org.webrtc` API)
- StateFlow + `collectAsStateWithLifecycle`, Preferences DataStore, kotlinx-serialization, type-safe Navigation Compose

## Features

- Full-duplex voice over a single `PeerConnection` (Opus mic + agent audio track), data channel `oai-events`
- Streaming chat transcript — agent text and partial user transcripts update live
  (tolerates both incremental and cumulative STT partials)
- Barge-in: speaking interrupts the agent (mutes its track + `response.cancel`)
- Back-channel audio ("uh-huh") played out-of-band via a dedicated `AudioTrack` so it stays audible while you talk
- Both auth variants: API key (Basic) and Backend JWT (the JS example's `webrtc/jwt` Node server)
- Settings for model, voice, instructions, turn detection, back-channel, responsiveness,
  plus live model/voice pickers fetched from the Inworld APIs
- **Audio (debug)** section for echo/AEC experiments (see below)

## Setup

```sh
cp app/src/main/java/ai/inworld/voiceagent/Secrets.kt.example \
   app/src/main/java/ai/inworld/voiceagent/Secrets.kt
./gradlew assembleDebug
```

`Secrets.kt` is gitignored. Either paste your base64 `INWORLD_API_KEY` into it (used as
the default), or leave it empty and enter the key at runtime in the app's Settings —
it's persisted in DataStore. Never commit a real key.

Install & run on a connected device:

```sh
./gradlew installDebug
adb shell am start -n ai.inworld.voiceagent/.MainActivity
```

Unit tests (pure JVM, no emulator needed):

```sh
./gradlew test
```

### Auth modes

- **API Key (Basic)** — `Authorization: Basic <key>` directly to `api.inworld.ai`.
- **Backend JWT** — the app fetches `{ jwt, ice_servers, url }` from `<backend>/api/config`.
  To use the local JS `webrtc/jwt` server from a physical device:
  `adb reverse tcp:3000 tcp:3000`, then keep the default `http://localhost:3000`.

## How it works

1. `GET /v1/realtime/ice-servers` → ICE config.
2. `PeerConnection` (unified plan) + ordered data channel `oai-events` + mic audio track.
3. Offer SDP → wait for ICE gathering (complete / 500 ms quiet / 3 s cap) →
   `POST /v1/realtime/calls` (`Content-Type: application/sdp`) → answer SDP.
4. On data-channel open: `session.update` (snake_case everywhere except the literal
   `providerData` key), greeting `conversation.item.create`, `response.create`.
5. Agent audio arrives as a remote WebRTC track (plays through the audio device module);
   transcripts stream over the data channel. On `input_audio_buffer.speech_started` the
   app mutes the agent track and sends `response.cancel` (barge-in).

## Audio / AEC notes

Echo cancellation on Android comes from two levers, both surfaced in **Settings → Audio (debug)**:

| Lever | Where | Default |
|---|---|---|
| `AudioManager` mode | `MODE_IN_COMMUNICATION` (voice-call path) vs `MODE_NORMAL` | IN_COMMUNICATION |
| Hardware AEC/NS | `JavaAudioDeviceModule.setUseHardwareAcousticEchoCanceler` | on |

The HW AEC flag is frozen at peer-connection-factory creation, so the app builds a
factory per session and toggles apply on the next Connect. `goog*` audio constraints are
inert in modern libwebrtc — when HW AEC is off, libwebrtc's software AEC3 takes over.
A live readout (mode · route · HW AEC) is shown while connected.

**Echo experiment recipe:** on speakerphone, set mode `NORMAL` + HW AEC off → the agent
should hear itself (echo repro); defaults should be echo-free.
