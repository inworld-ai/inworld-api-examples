# Barge-In

The base guide: speak an agent's replies over the TTS WebSocket, and let the user interrupt. Each reply goes out whole, with auto mode off, so this guide is only about the conversation: one context per turn, barge-in, and keeping the LLM history to what the user heard. The next guides change only how a reply is sent.

| File | What it shows |
|---|---|
| [`whole_turn.py`](./whole_turn.py) | The client: one context per turn, the whole reply in one message, barge-in, and word timestamps for the LLM history |
| [Playground](../README.md#playground) | A local web page to talk to the agent, hear it, and interrupt it |

## Try it

Run the [playground](../README.md#playground) and choose the mode *One flush per turn*. Send a message to a live LLM or pick a scripted reply, then press Esc, or send another message, to interrupt. The reply shows what you heard, which is what the LLM history keeps.

To speak one reply into a WAV file without the page, after the [setup](../README.md#setup): `python whole_turn.py`.

## The pattern

1. Open one WebSocket connection for the conversation.
2. For each agent turn, create a context with word timestamps, delivered with `"timestampTransportStrategy": "ASYNC"` so they never hold up the audio. You don't need to wait for `contextCreated`: messages on a connection are processed in order.
3. When the LLM finishes, send the reply in one `sendText` (up to 2,000 characters) with `flushContext`, then `closeContext`. Keep receiving until `contextClosed`, which arrives after the turn's last audio.
4. On barge-in, stop playback, close the context, drop the rest of its audio, and keep only the words the user heard in the LLM history.

```json
{"contextId": "turn-1", "create": {"voiceId": "Dennis", "modelId": "inworld-tts-2",
  "audioConfig": {"audioEncoding": "PCM", "sampleRateHertz": 24000},
  "timestampType": "WORD", "timestampTransportStrategy": "ASYNC"}}
{"contextId": "turn-1", "sendText": {"text": "Your flight to Chicago leaves at 7:45 from gate B12. Boarding starts 30 minutes earlier.",
  "flushContext": {}}}
{"contextId": "turn-1", "closeContext": {}}
```

Waiting for the whole reply means nothing is spoken until the LLM has finished; the playground's log shows the gap. [`../auto_mode/`](../auto_mode/) starts speaking while the LLM is still writing.

## Barge-in

Synthesis runs faster than playback. By the time the user cuts in, most of the reply has usually been synthesized and is sitting in your player's queue, so stopping the player is what makes the agent go quiet. Do that first, then:

- Stop reading the LLM's stream.
- Send `closeContext`. The service can't take back text it has accepted: whatever it still synthesizes arrives on the old `contextId`, and you drop it. The next turn starts on a new context right away.

In the playground, the page stops playback the moment you press Esc or send a message, and tells the server how many seconds of the turn it played.

## Keep the history to what the user heard

If the agent was interrupted, the user heard only part of its reply, and the LLM should know that. With `"timestampType": "WORD"` and the `ASYNC` transport, the audio comes first and the words follow in trailing messages, before that synthesis's `flushCompleted`. Their start and end times reset at each synthesis: add the audio the turn had received before that synthesis started, which the previous `flushCompleted` marks, and every word has a time in the turn's audio. `Turn.heard(seconds)` returns the words that finished playing in the first `seconds`. The assistant message you keep ends there:

```python
heard = await turn.heard_after_timestamps(seconds_played)   # "Sure, here's an easy one. Start by warming two tablespoons of olive oil in"
history.append({"role": "assistant", "content": heard})
```

With the `ASYNC` transport, timestamps trail their audio, so the words the user just heard may not have their timestamps yet when they cut in. `Turn.heard_after_timestamps(seconds)` waits up to two seconds for timestamps to cover the played audio, then returns `heard(seconds)`. Closing the context doesn't stop them: the timestamps for audio already synthesized still arrive. If they don't arrive in time, the history comes out a few words short, never long.
