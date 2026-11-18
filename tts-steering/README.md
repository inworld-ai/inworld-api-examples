# Steering: direct how the voice speaks

[Steering](https://docs.inworld.ai/tts/capabilities/steering) directs a voice with a natural-language instruction in square brackets, placed before the words it applies to: `[speak as if barely holding back rage] I told you.` A tag lasts until the next tag or `[reset]`. Instructions are written in English, whatever the language of the text, and work on `inworld-tts-2` only; `inworld-tts-2-flash` ignores them, though sounds such as `[laugh]` still play.

Something has to write those tags. These examples show the two ways.

## Which to use

| | Built-in Reasoning | Tags from your own LLM |
|---|---|---|
| **How** | Set `synthesisContext.reasoning: REASONING_ON`; Inworld's model writes the instruction | Add [`steering_system_prompt.md`](steering_system_prompt.md) to the system prompt of the LLM that already writes your reply |
| **Latency** | Adds an LLM step before the first audio | None: the tags arrive inside the reply text |
| **Endpoints** | HTTP unary and HTTP streaming; not the WebSocket | Any, including the WebSocket |
| **Control** | Optional `reasoningContext` notes (up to 600 characters) | You own and edit the prompt |
| **Good for** | Getting started, non-realtime and long-form audio: narration, audiobooks, voice-overs | Realtime voice agents and anything latency-sensitive |
| **Example** | `example_reasoning` | `example_llm_steering_stream` |

Both can be mixed: an inline tag in the text takes over from the instruction Reasoning wrote, from where it appears.

## The prompt

[`steering_system_prompt.md`](steering_system_prompt.md) is a system-prompt addendum. Paste it after your agent's own instructions, and the LLM writes its replies with tags where the delivery calls for one, and none in most replies:

```text
User: Did I win the raffle?
You: [barely containing excitement like announcing a surprise] You did! First prize is yours. [reset] I'll email you the pickup details tonight.
```

It asks for short, specific instructions in English, no tag when a plain read is right, one instruction per tag, and no contradictory or stacked tags. Edit it to fit your agent.

## Examples

| Example | Python | JavaScript | What it shows |
|---|---|---|---|
| Tags from your own LLM, streamed | [example_llm_steering_stream.py](python/example_llm_steering_stream.py) | [example_llm_steering_stream.js](js/example_llm_steering_stream.js) | Streams a reply from an LLM given the prompt above, and forwards it, tags included, to the TTS WebSocket sentence by sentence. Prints the time to the first token, first sentence and first audio, and saves `llm_steering_stream.wav` |
| Built-in Reasoning | [example_reasoning.py](python/example_reasoning.py) | [example_reasoning.js](js/example_reasoning.js) | Sends `reasoning` and `reasoningContext` on a unary and a streaming request, prints the `reasoningInstruction` that came back, and saves `reasoning.mp3` and `reasoning_stream.mp3` |

Start with the [Python setup](python/README.md) or [JavaScript setup](js/README.md).

### Streaming an LLM reply with its tags

The streaming example is the pattern for a realtime agent:

1. Open the TTS WebSocket and create a context with `autoMode: true` before the LLM's first token arrives.
2. Stream the LLM reply. Cut its tokens into sentences and send each one in a `sendText` as soon as it is complete, so the first sentence is spoken while the LLM is still writing.
3. Never cut inside a tag. An LLM can stream `[barely con` and `taining excitement]` as separate tokens; the example's `SentenceBuffer` holds back everything from an unclosed `[` until its `]` arrives, so every tag reaches TTS whole.
4. Close the context when the LLM finishes.

A tag persists across the `sendText` messages of one context, just as it does across sentences of one request. Keep the tags in the LLM's conversation history too, so the next reply stays consistent.

The LLM is the [Inworld Router](https://docs.inworld.ai/router/introduction)'s OpenAI-compatible chat completions API, which takes the same `INWORLD_API_KEY`. Any OpenAI-compatible LLM works: set `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`. For barge-in, conversation context and the other ways to send an LLM's text over the WebSocket, see the [WebSocket guides for conversational agents](../tts/python/websocket_guides/).

### Keeping a delivery Reasoning wrote

Each Reasoning request is directed on its own, so the same text can come out differently next time. To keep a delivery you like, put the returned `reasoningInstruction` in brackets at the start of the text and leave `reasoning` unset. `example_reasoning` prints that text for you.
