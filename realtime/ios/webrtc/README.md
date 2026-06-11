# Inworld Realtime — iOS (WebRTC)

A native iOS voice-agent app for the Inworld Realtime API over WebRTC: it streams
mic audio to the API, plays the agent's audio reply, and shows a live chat
transcript of both sides. It mirrors the [JS WebRTC example](../../js/webrtc) and
supports both of its auth variants (`basic` and `jwt`) via an in-app picker.

- SwiftUI, iOS 17+
- WebRTC via [stasel/WebRTC](https://github.com/stasel/WebRTC) (SPM binary xcframework)
- Project generated with [XcodeGen](https://github.com/yonaskolb/XcodeGen)

## Features

- Full-duplex voice over a single WebRTC peer connection (Opus mic + agent audio track)
- Streaming chat transcript — agent text and partial user transcripts update live
- Barge-in: speaking interrupts the agent (mutes its track + `response.cancel`)
- Back-channel audio ("uh-huh") played out-of-band so it stays audible while you talk
- Settings for model, voice, instructions, turn detection, back-channel, and
  responsiveness, plus live model/voice pickers fetched from the Inworld APIs

## Setup

```sh
brew install xcodegen
cp Sources/App/Secrets.swift.example Sources/App/Secrets.swift
xcodegen generate
open InworldVoiceAgent.xcodeproj
```

`Secrets.swift` is gitignored. Either paste your base64 `INWORLD_API_KEY` into it
(used as the default), or leave it empty and enter the key at runtime in the app's
Settings (gear icon) — it's stored in the Keychain. Then tap **Connect** and talk.
Never commit a real key.

### Auth modes

- **API Key (Basic)** — the key is sent as `Authorization: Basic <key>` directly to
  `api.inworld.ai`. Simplest; fine for development. Mirrors `js/webrtc/basic`.
- **Backend JWT** — the app fetches `{ jwt, ice_servers, url }` from `<backend>/api/config`,
  i.e. the [`js/webrtc/jwt`](../../js/webrtc/jwt) Node server. No Inworld secrets ship
  in the app.

## How it works

1. `GET /v1/realtime/ice-servers` → ICE config.
2. `RTCPeerConnection` + data channel `oai-events` + mic audio track.
3. Offer SDP → `POST /v1/realtime/calls` (`Content-Type: application/sdp`) → answer SDP.
4. On data-channel open: `session.update` (model, instructions, semantic VAD,
   `inworld-tts-2` voice), greeting `conversation.item.create`, `response.create`.
5. Agent audio arrives as a remote WebRTC track (auto-plays); transcripts stream over
   the data channel. On `input_audio_buffer.speech_started` the app mutes the agent
   track, sends `response.cancel`, and drops the in-flight bubble (barge-in).

## Build & test from CLI

```sh
xcodegen generate
xcodebuild build -project InworldVoiceAgent.xcodeproj -scheme InworldVoiceAgent \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO
xcodebuild test -project InworldVoiceAgent.xcodeproj -scheme InworldVoiceAgent \
  -destination 'platform=iOS Simulator,name=iPhone 16'
```

Note: the simulator passes through the Mac mic/speakers, so an end-to-end smoke test
works there, but echo cancellation, speaker routing, Bluetooth, and background audio
need a physical device.
