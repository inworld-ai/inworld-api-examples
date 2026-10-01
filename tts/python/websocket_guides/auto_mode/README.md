# Auto Mode

Start speaking before the LLM has finished: cut its tokens into sentences on the client, and send each one to a context in auto mode as soon as it is complete. Barge-in and the LLM history work as in [`../barge_in/`](../barge_in/).

| File | What it shows |
|---|---|
| [`client_segmented.py`](./client_segmented.py) | The base guide's client with auto mode and a small sentence splitter |
| [Playground](../README.md#playground) | A local web page to talk to the agent, hear it, and interrupt it |

## Try it

Run the [playground](../README.md#playground), choose the mode *Client-side sentence segmentation*, and compare its first-audio time with *One flush per turn*.

To speak one reply into a WAV file without the page, after the [setup](../README.md#setup): `python client_segmented.py`.

## What changes

- Create the context with `"autoMode": true`. Its default strategy, `CLIENT_SEGMENTED`, expects complete sentences or phrases: the service decides when to synthesize, and can combine text that arrives while an earlier response is streaming.
- Send each sentence as soon as it is complete. When the reply ends, send whatever is left, then `closeContext`.
- `flushCompleted` now marks each synthesis the service ran, not each `sendText`. `contextClosed` still marks the end of the turn's audio.

```json
{"contextId": "turn-1", "create": {"voiceId": "Sarah", "modelId": "inworld-tts-2",
  "audioConfig": {"audioEncoding": "PCM", "sampleRateHertz": 24000},
  "timestampType": "WORD", "timestampTransportStrategy": "ASYNC",
  "autoMode": true}}
{"contextId": "turn-1", "sendText": {"text": "Your flight to Chicago leaves at 7:45 from gate B12. "}}
{"contextId": "turn-1", "sendText": {"text": "Boarding starts 30 minutes earlier."}}
{"contextId": "turn-1", "closeContext": {}}
```

Send sentences, not tokens: auto mode starts a synthesis on the first `sendText` it gets, so tokens would be spoken as fragments such as *Grea*.

## The splitter

`split_sentences` in [`client_segmented.py`](./client_segmented.py) is the simplest splitter that works across widely used languages. A sentence ends at `.`, `!` or `?` followed by whitespace, as in languages written in Latin or Cyrillic script, or right after Chinese and Japanese `。！？`, Arabic `؟` or Devanagari `।` `॥`, which need no space after them. It doesn't end at an ellipsis, after a common English abbreviation (*Dr.*, *e.g.*) or an initial (*J. R.*), or inside markup: `[say warmly]`, `<break time="500ms"/>` and `<verbatim>AB. 12</verbatim>` stay whole, and an unfinished tag holds back the text after it. Closing quotes, brackets and tags stay with the sentence they close. A sentence that ends in `.`, `!` or `?` waits for the whitespace after it, so the reply's last one goes out when the reply ends.

It has no abbreviations for other languages, and it ends a sentence after a quoted one, as in `「はい。」と言った` or `"Really?" she asked`. For a splitter that handles those, leave the splitting to the service: see [`../sentence_boundary/`](../sentence_boundary/).
