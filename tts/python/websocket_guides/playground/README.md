# Playground

A local web page shared by the WebSocket guides: type to the agent, hear its reply, and interrupt it.

```bash
pip install -r ../../requirements.txt   # from this folder
python server.py                        # then open http://localhost:8766
```

Set your API key in `tts/python/.env` or with `export INWORLD_API_KEY=...`. The server holds the key and talks to the TTS WebSocket; the page only talks to the server and plays the audio.

## On the page

- **Guide**: which client speaks the replies: [`1. Whole turn`](../barge_in/), [`2. Auto mode`](../auto_mode/), or [`3. Sentence boundary`](../sentence_boundary/).
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

Subclass `Speaker` from [`whole_turn.py`](../barge_in/whole_turn.py), as the other guides do: set `CREATE` for the context settings, and override `send_text(turn, token)` and, if needed, `end_turn(turn)`. Add the module to `GUIDES` in `server.py`.
