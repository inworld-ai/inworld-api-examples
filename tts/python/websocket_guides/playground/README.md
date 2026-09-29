# Playground

A local web page shared by the WebSocket guides: type to the agent, hear its reply, and interrupt it.

```bash
pip install -r ../../requirements.txt   # from this folder
python server.py                        # then open http://localhost:8766
```

Set your API key in `tts/python/.env` or with `export INWORLD_API_KEY=...`. The server holds the key and talks to the TTS WebSocket; the page only talks to the server and plays the audio.

## On the page

- **Guide**: which client speaks the replies. Each guide is a module with the same `Speaker` interface; see [`../auto_mode/`](../auto_mode/).
- **Voice**: any voice ID.
- **Reply**: a scripted reply, or a live LLM.
  - Scripted replies stream the same tokens every run, with an LLM's timing: a first token after about a third of a second, then 60 tokens a second. One pauses mid-sentence, the way an LLM does for a tool call.
  - *Live LLM* streams from the Inworld Router's chat completions API with the same API key. Choose the model with `--llm-model`.
- **Interrupt**: press Esc, click Interrupt, or send another message. The page stops playback at once and reports how many seconds of the turn it played. The server closes the turn's context and keeps only the words you heard in the LLM history, shown on the right.

Under each reply, a log shows when the first LLM token and the first audio arrived, each synthesis the service completed, and `contextClosed`.

## Options

```bash
python server.py --port 8766 --model-id inworld-tts-2 --llm-model openai/gpt-4.1-mini
```

## Adding a guide

Write a module with a `Speaker` class: `start_turn()` returns a `Turn`, then `send_text(turn, token)`, `flush(turn)`, `end_turn(turn)`, `interrupt(turn)` and `close()`. A `Turn` has an `events` queue and `heard(seconds)`, as in [`sentence_boundary.py`](../auto_mode/sentence_boundary.py). Add it to `GUIDES` in `server.py`.
