# Language Switching

Speak a turn that mixes two languages on one WebSocket context, the way a language tutor talks: the learner's language, with words and phrases in the language being taught.

| File | What it shows |
|---|---|
| [`language_switching.py`](./language_switching.py) | The WebSocket client: sends a turn in any of four modes |
| [`demo/`](./demo/) | A local web page that plays a turn in all four modes and explains what you hear |

Run the commands below from this folder. Set your API key in `tts/python/.env` or with `export INWORLD_API_KEY=...`.

## Mark the switches

Ask your LLM to wrap the language being taught in `<l2>…</l2>`. The rest of the turn is the learner's language; you may mark it with `<l1>…</l1>` too. The client strips the tags, so the service never sees them.

```text
Great job! In Spanish, "the dog runs" is <l2>El perro corre.</l2> Listen for the rolled r in <l2>perro</l2>, "dog", and the single tap in <l2>pero</l2>, "but".
```

Ask it, too, to write Japanese in kana, never kanji: `せんせい`, not `先生`. Most kanji have several readings, and the same characters read as Chinese, while kana has one reading and always reads as Japanese. Have your LLM write kana from the start rather than converting afterwards: the LLM knows which word it means, and a converter has to guess a reading from the characters. Check your LLM with words that have more than one reading (人気のない is *hitoke*, not *ninki*): smaller models get some of them wrong.

## Four ways to send a turn

Every mode opens one context with no `language`, so the service detects the language of each synthesis. The detected language picks the voice's prompt, and so its accent, when the voice has a localized prompt for it and per-language prompt switching is enabled for your workspace. It also sets how numbers are read, and timestamps. All syntheses on a context share its history, so the delivery carries from one to the next.

| Mode | What the client sends | Languages detected |
|---|---|---|
| `one` | the whole turn as one flush | one, for the whole turn |
| `per-language` | a flush at every switch | one per flush |
| `instructions` | a flush at every switch, each opening with an instruction such as `[in pure Spanish]` | one per flush; the instruction steers each |
| `sentence` | the turn in small pieces, the way an LLM's tokens arrive, with sentence-boundary auto mode | one per synthesis the service starts |

**`one`: on a bilingual voice, the most robust choice today.** On a voice cloned from a clip in both languages, its one prompt has both accents, so what detection decides leaves the accent as it is, and the delivery runs straight through every switch. On a voice with localized prompts, the whole turn is spoken on the prompt of whichever language it reads as.

```bash
python ../../example_voice_clone.py --name "Tutor EN-ES" --audio tutor_en_es.wav   # about 30 s, half in each language
python language_switching.py --voice-id <your bilingual voice ID>
```

**`per-language`: on a voice with localized prompts.** Each flush can be spoken on the prompt of its language, as long as detection can place it:

| A flush in | Reads as |
|---|---|
| Kana | Japanese |
| Hangul | Korean |
| Chinese characters | Chinese or Japanese; a word or two alone takes the language of the turn so far |
| Latin letters | what a model makes of it; a single word can read as English |

So per-language flushes give Japanese in kana, Korean, and phrases in their own spelling their own prompt. A single Spanish word, or a Chinese word of a character or two, lands on the learner's prompt: phrase it longer, steer it with `instructions`, or send the turn as one flush on a bilingual voice.

```bash
python language_switching.py --mode per-language --voice-id Jason
```

**`instructions`: per-language flushes, each steered.** As in `per-language`, the client flushes at every switch and each flush gets its own detected language and prompt. Each flush also opens with an inline instruction that steers its delivery. Detection ignores the instruction, so it helps most where detection places a flush on the other language's prompt, as it does a single word. Set the instruction with `--instruction`, using `{language}` for the segment's language name; `--languages` names the two languages. Instructions need `inworld-tts-2`.

```bash
python language_switching.py --mode instructions --voice-id Jason --languages English,Spanish
python language_switching.py --mode instructions --voice-id Jason --instruction "without accent"
```

**`sentence`: streamed, cut by the service.** The client sends the turn in small pieces with no flushes, and the service starts a synthesis at every sentence end, detecting the language of each. While one synthesis runs, the sentences that arrive are batched into the next, and a batch is spoken in one language, so a turn that switches within or between quick sentences gets one language for several of them.

```bash
python language_switching.py --mode sentence --voice-id Jason
```

Every mode writes `language_switching.wav`.

## Demo

```bash
python demo/server.py   # then open http://localhost:8765
```

Type a turn or pick a preset for English with Spanish or Japanese, Chinese with Japanese, Japanese with Chinese, or Korean with Japanese or Chinese. The page shows what each mode sends, then plays all four. `one` uses your bilingual voice when you set one, which the page remembers per language pair in your browser, and the voice with localized prompts (`Jason` or `Sarah`) otherwise; the other modes switch prompts by language, so they use the voice with localized prompts. Each preset says what to listen for.

## How syntheses map to audio

Each synthesis ends with a `flushCompleted`, and syntheses on a context run in order, so the client credits each audio chunk to the first synthesis whose `flushCompleted` has not arrived.

- In the flush modes, each flush is one synthesis. A flush with nothing to speak, only punctuation or spaces, gets no `flushCompleted`, so the client never sends one: such a piece joins the segment before it. A flush longer than `buffer_char_threshold` (1000 characters unless you set it) is synthesized in parts, each with its own `flushCompleted`.
- In sentence mode, the service decides where each synthesis starts, so the client knows each one's audio but not its text. Request word timestamps to learn what each one spoke.

## Streaming an LLM's output

For `per-language` and `instructions`, keep auto mode off and send each segment once the next tag arrives, and each sentence of the learner's language as it ends. `CLIENT_SEGMENTED` auto mode would batch the segments that arrive while a synthesis runs into one flush, with one language. For `one`, send each sentence once it ends. Sentence mode takes the tokens as they arrive; strip the `<l1>`/`<l2>` tags from the stream before sending it, since in that mode a `<` that never closes holds back everything after it.
