# Sentence Boundary

Let the service split the sentences: send the LLM's tokens as they arrive to a context with `autoModeStrategy: "SENTENCE_BOUNDARY"`. Everything else works as in [`../auto_mode/`](../auto_mode/) and [`../barge_in/`](../barge_in/).

| File | What it shows |
|---|---|
| [`sentence_boundary.py`](./sentence_boundary.py) | The base guide's client with sentence-boundary auto mode: every token sent as it arrives |
| [Playground](../README.md#playground) | A local web page to talk to the agent, hear it, and interrupt it |

`SENTENCE_BOUNDARY` is a **Preview** feature. It supports `inworld-tts-2` and `inworld-tts-2-flash`; on other models, creating the context returns `INVALID_ARGUMENT`. For the full reference, see [Synthesize Speech (WebSocket)](https://docs.inworld.ai/tts/synthesize-speech-websocket).

## Try it

Run the [playground](../README.md#playground) and choose the mode *One token at a time*.

To speak one reply into a WAV file without the page, after the [setup](../README.md#setup): `python sentence_boundary.py`.

## What changes

- Create the context with `"autoMode": true, "autoModeStrategy": "SENTENCE_BOUNDARY"`.
- Drop the client-side splitter: send each LLM token in a `sendText` as it arrives.
- A sentence end is confirmed by the text that follows it, so the last sentence of the reply waits for `closeContext`.

```json
{"contextId": "turn-1", "create": {"voiceId": "Dennis", "modelId": "inworld-tts-2",
  "audioConfig": {"audioEncoding": "PCM", "sampleRateHertz": 24000},
  "timestampType": "WORD", "timestampTransportStrategy": "ASYNC",
  "autoMode": true, "autoModeStrategy": "SENTENCE_BOUNDARY"}}
{"contextId": "turn-1", "sendText": {"text": "Your"}}
{"contextId": "turn-1", "sendText": {"text": " flight"}}
...
{"contextId": "turn-1", "closeContext": {}}
```

## What ends a sentence

- `.`, `!`, `?` and `…` followed by a space and more text. Full-width `。！？`, Arabic `؟` and the Devanagari `।` `॥` end a sentence without a following space.
- A complete break tag such as `<break time="300ms"/>` also ends one, and produces the pause.
- Commas, colons, semicolons and line breaks never do. For unusually long text without a sentence end, a buffering safeguard forces a cut at a word boundary; leave `bufferCharThreshold` at its default.
- Decimals (*2.5*), the dots inside a URL, dotted abbreviations and initials (*Dr. Smith*, *U.S.A.*) are not sentence ends. Neither is a period after any short capitalized word, such as *Tom.* or *Rome.*: that sentence runs on to the next end. A lowercase abbreviation such as *a.m.* followed by a space can end a sentence early.

Markup can be split across messages, the way an LLM streams it: `[whis` followed by `per] Hello.` reads as `[whisper] Hello.`, and a `<lang xml:lang="es-ES">` tag split across tokens is held until it closes (see [markup in replies](../README.md#markup-in-replies)). An incomplete tag stays buffered and is never synthesized as a partial tag, and an instruction such as `[whisper]` stays with the words that follow it. See [Voice steering](https://docs.inworld.ai/tts/capabilities/steering) for the instructions each model supports. Finish every tag before closing: incomplete markup at the end of a turn returns `INVALID_ARGUMENT`.

**No timer.** Auto mode doesn't use `maxBufferDelayMs`, so an unfinished sentence waits for more text, however long that takes. The playground's *LLM pauses mid-sentence* reply shows the gap. If you know the LLM is about to pause, for example for a tool call, `flushContext` (`Speaker.flush`) speaks what it has written so far.
