# Client-Side Sentence Segmentation

Start speaking before the LLM has finished: cut its tokens into sentences on the client, and send each one as soon as it is complete. Barge-in and the LLM history work as in [`../base/`](../base/).

| File | What it shows |
|---|---|
| [`client_segmentation.py`](./client_segmentation.py) | The base guide's client with a small sentence splitter, a flush per sentence and auto mode |
| [Playground](../README.md#playground) | A local web page to talk to the agent, hear it, and interrupt it |

## Try it

Run the [playground](../README.md#playground), choose the mode *Client-side sentence segmentation*, and compare its first-audio time with *Base*.

To speak one reply into a WAV file without the page, after the [setup](../README.md#setup): `python client_segmentation.py`.

## What changes

- Send each sentence with `flushContext` as soon as it is complete. When the reply ends, send whatever is left, then `closeContext`.
- Create the context with `"autoMode": true` (see [Choose how text is buffered](https://docs.inworld.ai/tts/synthesize-speech-websocket#choose-how-text-is-buffered)). With its default strategy, `CLIENT_SEGMENTED`, every `sendText` is taken as a complete sentence or phrase and synthesized at once: the flush is implied, and the service batches sentences that arrive while it is busy, for smoother delivery.
- With auto mode off, the flush is needed: it is what starts each sentence's synthesis. With auto mode on, it changes nothing, so the same client works either way.
- `flushCompleted` marks each synthesis the service ran, which can cover more than one sentence. `contextClosed` still marks the end of the turn's audio.

```json
{"contextId": "turn-1", "create": {"voiceId": "Sarah", "modelId": "inworld-tts-2",
  "audioConfig": {"audioEncoding": "PCM", "sampleRateHertz": 24000},
  "timestampType": "WORD", "timestampTransportStrategy": "ASYNC",
  "autoMode": true}}
{"contextId": "turn-1", "sendText": {"text": "Your flight to Chicago leaves at 7:45 from gate B12. ", "flushContext": {}}}
{"contextId": "turn-1", "sendText": {"text": "Boarding starts 30 minutes earlier.", "flushContext": {}}}
{"contextId": "turn-1", "closeContext": {}}
```

Send sentences, not tokens: each `sendText` starts a synthesis, so tokens would be spoken as fragments such as *Grea*.

## The splitter

`split_sentences` in [`client_segmentation.py`](./client_segmentation.py) is the simplest splitter that works across widely used languages. A sentence ends at `.`, `!` or `?` followed by whitespace, as in languages written in Latin or Cyrillic script, or right after Chinese and Japanese `。！？`, Arabic `؟` or Devanagari `।` `॥`, which need no space after them. It doesn't end at an ellipsis, after a common English abbreviation (*Dr.*, *e.g.*) or an initial (*J. R.*), or inside markup: `[say warmly]`, `<break time="500ms"/>` and `<verbatim>AB. 12</verbatim>` stay whole, and an unfinished tag holds back the text after it. A sentence can end at a closing tag, as in `El perro corre.</lang> `, or inside a language span, which then carries on into the next message (see [markup in replies](../README.md#markup-in-replies)). A sentence that ends in `.`, `!` or `?` waits for the whitespace after it, so the reply's last one goes out when the reply ends.

It has no abbreviations for other languages, and it ends a sentence after a quoted one, as in `「はい。」と言った` or `"Really?" she asked`. For a splitter that handles those, leave the splitting to the service: see [`../streaming_tokens/`](../streaming_tokens/).
