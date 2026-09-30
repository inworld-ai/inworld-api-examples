# Inworld STT API Examples

| Directory | Description |
|---|---|
| [`js/`](js/) | Speech-to-text examples in JavaScript/Node.js (sync HTTP, async jobs, WebSocket from file or mic) |
| [`python/`](python/) | Speech-to-text examples in Python (sync HTTP, async jobs, WebSocket from file or mic) |
| [`tests-data/`](tests-data/) | Test audio for file-based examples (e.g. `audio/test-audio.wav`, `audio/test-pcm-audio.pcm`) |


## Asynchronous transcription

For a recording too long to wait on, submit it as a job and collect the
transcript when the job finishes. Three steps:

1. `POST https://api.inworld.ai/stt/v1/transcribe:async` returns an
   **operation** — a handle naming the job, not the transcript.
2. `GET https://api.inworld.ai/lro/v1alpha/{operation name}` reports whether
   the job has finished. Poll every few seconds.
3. The finished operation carries `response.resultUri`, a signed link to the
   transcript. It needs no credentials and expires 24 hours after completion,
   so download the transcript if you need to keep it.

Send the audio inline as base64 (`audioData.content`), as a streamed
`multipart/form-data` upload, or as a URL for the service to fetch
(`audioUri`). Multipart is the one to use for large files: nothing holds the
recording whole, and base64 is avoided. When sending multipart, put the
`transcribeConfig` part **before** the `file` part — the upload is read as a
stream, so a config that arrives after the audio is found too late.

Every audio encoding is accepted here, including the compressed formats the
streaming endpoint rejects. Full reference:
[Async transcription](https://docs.inworld.ai/stt/async-transcription).

## Streaming integration

Connect to `wss://api.inworld.ai/stt/v1/transcribe:streamBidirectional` with
`Authorization: Basic <INWORLD_API_KEY>`. Use the Portal's Base64 credentials
verbatim, without encoding them again. Keep the key on your backend. Browser
clients can relay audio through an authenticated backend connection or connect
directly with a [one-time token](https://docs.inworld.ai/portal/ephemeral-tokens)
minted by the backend. Pass that token as the `bearer_<accessToken>` WebSocket
subprotocol and mint a fresh token for every connection attempt.

Send `transcribeConfig` first, then JSON `audioChunk` messages containing
Base64-encoded PCM16 (signed 16-bit little-endian) audio. These examples use
16 kHz mono and 100 ms chunks (3,200 bytes before Base64 encoding). The file
examples use the included `tests-data/audio/test-pcm-audio.pcm`, so no microphone
is needed for a first run. Follow the setup commands in [`js/`](js/) or
[`python/`](python/).

Each interim transcript replaces the previous interim for the current turn;
it is not a delta. Append a final once and clear the interim. Speech activity
events are separate from transcript finalization.

When audio ends, flush the last partial chunk and send `closeStream` once.
It finalizes pending audio: do not send `endTurn` immediately before it. Keep
reading final transcripts and usage until the server closes. Use `endTurn`
only to finalize a turn while continuing the session with more audio.

Browser `MediaRecorder` WebM/Opus and Ogg/Opus chunks are not PCM and cannot be
sent directly to this streaming endpoint. See the
[WebSocket integration guide](https://docs.inworld.ai/api-reference/sttAPI/speechtotext/transcribe-stream-websocket)
for capture, authentication, response handling, and shutdown details.

Run the protocol regression tests without credentials:

```sh
node --test stt/js/stream_shutdown.test.js
python3 -m unittest discover -s stt/python -p 'test_*.py'
```
