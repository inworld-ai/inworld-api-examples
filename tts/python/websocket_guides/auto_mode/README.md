# Auto Mode

Start speaking before the LLM has finished: cut its tokens into sentences on the client, and send each one to a context in auto mode as soon as it is complete. Barge-in and the LLM history work as in [`../barge_in/`](../barge_in/).

| File | What it shows |
|---|---|
| [`client_segmented.py`](./client_segmented.py) | The base guide's client with auto mode and a small English sentence splitter |
| [Playground](../README.md#playground) | A local web page to talk to the agent, hear it, and interrupt it |

## Try it

Run the [playground](../README.md#playground), choose the mode *Client-side sentence segmentation*, and compare its first-audio time with *One flush per turn*.

To speak one reply into a WAV file without the page, after the [setup](../README.md#setup): `python client_segmented.py`.

## What changes

- Create the context with `"autoMode": true`. Its default strategy, `CLIENT_SEGMENTED`, expects complete sentences or phrases: the service decides when to synthesize, and can combine text that arrives while an earlier response is streaming.
- Send each sentence as soon as it is complete. When the reply ends, send whatever is left, then `closeContext`.
- `flushCompleted` now marks each synthesis the service ran, not each `sendText`. `contextClosed` still marks the end of the turn's audio.

```json
{"contextId": "turn-1", "create": {"voiceId": "Dennis", "modelId": "inworld-tts-2",
  "audioConfig": {"audioEncoding": "PCM", "sampleRateHertz": 24000},
  "timestampType": "WORD", "timestampTransportStrategy": "ASYNC",
  "autoMode": true}}
{"contextId": "turn-1", "sendText": {"text": "Your flight to Chicago leaves at 7:45 from gate B12. "}}
{"contextId": "turn-1", "sendText": {"text": "Boarding starts 30 minutes earlier."}}
{"contextId": "turn-1", "closeContext": {}}
```

Send sentences, not tokens: auto mode starts a synthesis on the first `sendText` it gets, so tokens would be spoken as fragments such as *Grea*.

## The splitter

`split_sentences` in [`client_segmented.py`](./client_segmented.py) is short and handles English only. A sentence ends at `.`, `!` or `?` followed by whitespace, unless the period follows a common abbreviation (*Dr.*, *e.g.*) or an initial (*J. R.*), or sits inside markup: `[say warmly]`, `<break time="500ms"/>` and `<verbatim>AB. 12</verbatim>` stay whole, and an unfinished tag holds back the text after it. The last sentence has no whitespace after it yet, so it goes out when the reply ends.

It doesn't know other languages' punctuation (`。` needs no space after it), and it splits a quotation after its `?`. For other languages, or to leave the splitting to the service, see [`../sentence_boundary/`](../sentence_boundary/).
