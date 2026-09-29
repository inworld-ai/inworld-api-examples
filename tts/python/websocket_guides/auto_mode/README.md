# Auto Mode

How we recommend speaking an agent's replies over the TTS WebSocket: send the LLM's tokens as they arrive with sentence-boundary auto mode, let the service find the sentences, and handle barge-in so the conversation stays grounded in what the user actually heard. For the full reference, see [Synthesize Speech (WebSocket)](https://docs.inworld.ai/tts/synthesize-speech-websocket).

| File | What it shows |
|---|---|
| [`sentence_boundary.py`](./sentence_boundary.py) | The recommended client: sentence-boundary auto mode, one context per agent turn, barge-in, and word timestamps for the LLM history |
| [`../playground/`](../playground/) | A local web page to talk to the agent, hear it, and interrupt it |

## Try it

```bash
cd ../playground
python server.py   # then open http://localhost:8766
```

Pick a scripted reply, or a live LLM through the Inworld Router (same API key), and send. Press Esc, or send another message, to interrupt. The right-hand panel shows the LLM history as the next request would send it.

To speak one reply into a WAV file without the page: `python sentence_boundary.py`.

## The pattern

1. Open one WebSocket connection for the conversation.
2. For each agent turn, create a context with `autoMode: true`, `autoModeStrategy: "SENTENCE_BOUNDARY"` and word timestamps. You don't need to wait for `contextCreated`: messages on a connection are processed in order.
3. Send each LLM token in a `sendText` as it arrives.
4. When the LLM finishes, send `closeContext`. That releases the last sentence. Keep receiving until `contextClosed`, which arrives after the turn's last audio.
5. On barge-in, stop playback, close the context, drop the rest of its audio, and keep only the words the user heard in the LLM history.

```json
{"contextId": "turn-1", "create": {"voiceId": "Dennis", "modelId": "inworld-tts-2",
  "audioConfig": {"audioEncoding": "PCM", "sampleRateHertz": 24000},
  "timestampType": "WORD", "autoMode": true, "autoModeStrategy": "SENTENCE_BOUNDARY"}}
{"contextId": "turn-1", "sendText": {"text": "Your"}}
{"contextId": "turn-1", "sendText": {"text": " flight"}}
...
{"contextId": "turn-1", "closeContext": {}}
```

`SENTENCE_BOUNDARY` is a **Preview** feature. It supports `inworld-tts-2` and `inworld-tts-2-flash`; on other models, creating the context returns `INVALID_ARGUMENT`.

## How the service turns tokens into speech

- A sentence end is confirmed by the text that follows it, so the last sentence of a turn waits for `closeContext`.
- `flushCompleted` marks each synthesis the service completed, not each message you sent, so it doesn't mark the end of a turn. `contextClosed` does.

What ends a sentence:

- `.`, `!`, `?` and `…` followed by a space and more text. Full-width `。！？`, Arabic `؟` and the Devanagari `।` `॥` end a sentence without a following space.
- A complete break tag such as `<break time="300ms"/>` also ends one, and produces the pause.
- Commas, colons, semicolons and line breaks never do. For unusually long text without a sentence end, a buffering safeguard forces a cut at a word boundary; leave `bufferCharThreshold` at its default.
- Decimals (*2.5*), the dots inside a URL, dotted abbreviations and initials (*Dr. Smith*, *U.S.A.*) are not sentence ends. Neither is a period after any short capitalized word, such as *Tom.* or *Rome.*: that sentence runs on to the next end. A lowercase abbreviation such as *a.m.* followed by a space can end a sentence early.

Markup can be split across messages, the way an LLM streams it: `[whis` followed by `per] Hello.` reads as `[whisper] Hello.`. An incomplete tag stays buffered and is never synthesized as a partial tag, and an instruction such as `[whisper]` stays with the words that follow it. See [Voice steering](https://docs.inworld.ai/tts/capabilities/steering) for the instructions each model supports.

**No timer.** Auto mode doesn't use `maxBufferDelayMs`, so an unfinished sentence waits for more text, however long that takes. The playground's *LLM pauses mid-sentence* reply shows the gap. If you know the LLM is about to pause, for example for a tool call, `flushContext` (`Speaker.flush`) speaks what it has written so far.

**Finish every tag before closing.** Incomplete markup at the end of a turn returns `INVALID_ARGUMENT`.

## Barge-in

Synthesis runs faster than playback. By the time the user cuts in, most of the reply has usually been synthesized and is sitting in your player's queue, so stopping the player is what makes the agent go quiet. Do that first, then:

- Stop reading the LLM's stream.
- Send `closeContext`. The service can't take back text it has accepted: whatever it still synthesizes arrives on the old `contextId`, and you drop it. The next turn starts on a new context right away.

In the playground, the page stops playback the moment you press Esc or send a message, and tells the server how many seconds of the turn it played.

## Keep the history to what the user heard

If the agent was interrupted, the user heard only part of its reply, and the LLM should know that. With `"timestampType": "WORD"`, audio chunks carry the words they contain, with start and end times that reset at each synthesis. Add the audio the turn had received before that synthesis started, which `flushCompleted` marks, and every word has a time in the turn's audio. `Turn.heard(seconds)` returns the words that finished playing in the first `seconds`. The assistant message you keep ends there:

```python
heard = turn.heard(seconds_played)   # "Sure, here's an easy one. Start by warming two tablespoons of olive oil in"
history.append({"role": "assistant", "content": heard})
```

## Other ways to use the WebSocket

The same interface will host the alternatives, each selectable as a guide in the playground:

| | Auto mode off | `CLIENT_SEGMENTED` | `SENTENCE_BOUNDARY` (Preview) |
|---|---|---|---|
| Create with | nothing extra | `"autoMode": true` | `"autoMode": true, "autoModeStrategy": "SENTENCE_BOUNDARY"` |
| Send | text you flush yourself | complete sentences or phrases | anything, down to single tokens |
| A synthesis starts | at each `flushContext`, when buffered text reaches `bufferCharThreshold`, or after `maxBufferDelayMs` | on each `sendText`, as soon as the previous synthesis finishes | at each complete sentence, as soon as the previous synthesis finishes |
| Text sent while a synthesis runs | waits its turn as its own synthesis, one per flush | combined into the next synthesis | combined into the next synthesis |
| `flushCompleted` | one per flush with words to speak | one per synthesis the service ran | one per synthesis the service ran |
| Models | all | all | `inworld-tts-2`, `inworld-tts-2-flash` |

With `autoMode: true`, omitting `autoModeStrategy` selects `CLIENT_SEGMENTED`. Sending it LLM tokens starts a synthesis on the first token, so a turn begins with a fragment such as *Grea*. With auto mode off, nothing is spoken until you flush, unless you split sentences yourself.

One context can also carry several turns. Syntheses on one context share its conversation history, so the voice's delivery carries from one turn to the next, but only `closeContext` marks the end of a turn's audio, and an interrupted turn has to close its context anyway.
