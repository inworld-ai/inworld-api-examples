# Inworld Realtime — Flutter (WebRTC)

A cross-platform (iOS + Android) voice-agent app for the Inworld Realtime API over
WebRTC: it streams mic audio to the API, plays the agent's audio reply, and shows a
live chat transcript of both sides. It mirrors the [JS WebRTC example](../../js/webrtc)
and the native [iOS](../../ios/webrtc) and [Android](../../android/webrtc) examples, and
supports both auth variants (`basic` and `jwt`) via an in-app picker.

- Flutter 3.24+, Dart 3.5+
- WebRTC via [`flutter_webrtc`](https://pub.dev/packages/flutter_webrtc)
- One Dart codebase for both platforms

## Scope

This is a **cross-platform quickstart**. It ports the full realtime protocol, the
streaming transcript, barge-in, settings, and back-channel playback. It intentionally
does **not** port the native examples' audio-engineering debug section (audio-session
mode toggles, hardware-AEC switch), which lives below Flutter and requires per-platform
native code — use the [iOS](../../ios/webrtc) / [Android](../../android/webrtc) examples
as the reference for echo/AEC tuning. A couple of other simplifications versus the
native apps:

- Model/voice are free-text fields here; the native apps fetch live pickers from the
  catalog APIs.
- Back-channel PCM chunks are buffered per interjection and played as a WAV clip (Flutter
  has no stock streaming-PCM sink); the native apps stream each chunk into a live node.

## Setup

```sh
cp lib/secrets.dart.example lib/secrets.dart
# Generate the platform runner projects (android/, ios/, …) into this directory:
flutter create .
flutter pub get
```

`flutter create .` scaffolds the native runner projects that Flutter needs to build but
that aren't checked in (they're gitignored). After running it once, apply the two
permission edits below, then `flutter run`.

`lib/secrets.dart` is gitignored. Either paste your base64 `INWORLD_API_KEY` into it
(used as the default), or leave it empty and enter the key at runtime in the app's
Settings (gear icon) — it's stored in SharedPreferences. Never commit a real key.

### Required permission edits (after `flutter create .`)

**iOS** — add to `ios/Runner/Info.plist`:

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Voice conversations with the Inworld agent.</string>
```

**Android** — add to `android/app/src/main/AndroidManifest.xml` (inside `<manifest>`,
above `<application>`):

```xml
<uses-permission android:name="android.permission.INTERNET"/>
<uses-permission android:name="android.permission.RECORD_AUDIO"/>
<uses-permission android:name="android.permission.MODIFY_AUDIO_SETTINGS"/>
```

`flutter_webrtc` needs Android `minSdkVersion 23` — set it in
`android/app/build.gradle` if `flutter create` used a lower default.

### Auth modes

- **API Key (Basic)** — the key is sent as `Authorization: Basic <key>` directly to
  `api.inworld.ai`. Simplest; fine for development. Mirrors `js/webrtc/basic`.
- **Backend JWT** — the app fetches `{ jwt, ice_servers, url }` from `<backend>/api/config`,
  i.e. the [`js/webrtc/jwt`](../../js/webrtc/jwt) Node server. No Inworld secrets ship
  in the app.

## How it works

1. `GET /v1/realtime/ice-servers` → ICE config.
2. `RTCPeerConnection` (unified plan) + data channel `oai-events` + mic audio track.
3. Offer SDP → `POST /v1/realtime/calls` (`Content-Type: application/sdp`) → answer SDP.
4. On data-channel open: `session.update` (model, instructions, semantic VAD,
   `inworld-tts-2` voice, optional web search / back-channel / responsiveness), greeting
   `conversation.item.create`, `response.create`.
5. Agent audio arrives as a remote WebRTC track (auto-plays); transcripts stream over
   the data channel. On `input_audio_buffer.speech_started` the app mutes the agent
   track, sends `response.cancel`, and drops the in-flight bubble (barge-in).

### The JSON casing contract

The realtime session schema is snake_case everywhere **except** the single key
`providerData`, which the Go server unmarshals as camelCase. A blanket snake_case
strategy would emit `provider_data`, which the server silently ignores — so back-channel,
responsiveness, and web search would never turn on. `lib/realtime/events/client_events.dart`
builds the JSON by hand so that one key stays camelCase while its inner keys are
snake_case; `test/client_event_encoding_test.dart` asserts this byte-for-byte.

## Test from CLI

```sh
flutter test
flutter analyze
```

The unit tests (event encoding/decoding, transcript reconciliation) are pure Dart and
need no device. An end-to-end voice test needs a real device or simulator with a mic and
your `INWORLD_API_KEY`.
