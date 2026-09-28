# Language Switching

Speak a turn that mixes two languages on one WebSocket context, the way a language tutor talks: the learner's language, with words and phrases in the language being taught.

| File | What it shows |
|---|---|
| [`language_switching.py`](./language_switching.py) | The WebSocket client: sends a turn as one flush, or as one flush per language |
| [`demo/`](./demo/) | A local web page that plays a turn both ways, on a voice with localized prompts and on a bilingual voice, and explains what you hear |

Run the commands below from this folder. Set your API key in `tts/python/.env` or with `export INWORLD_API_KEY=...`.

## Mark the switches, and spell what you teach

Ask your LLM to wrap the language being taught in `<l2>…</l2>`. The rest of the turn is the learner's language; you may mark it with `<l1>…</l1>` too. The client strips the tags, so the service never sees them.

Ask it, too, to spell the taught language so that its pronunciation is certain:

| Language | Spell it in | Because |
|---|---|---|
| Japanese | kana, never kanji: `せんせい` | Most kanji have several readings, and the same characters read differently in Chinese |
| Chinese | pinyin with tone marks: `hǎochī` | Many characters have several readings (好, 还, 行, 长) |
| Spanish and other Latin-script languages | IPA between slashes, one word per pair: `/ˈpe.ro/` | A single word can be read as English: *once*, *pero* |

```text
Great job! In Spanish, "the dog runs" is <l2>El perro corre.</l2> Listen for the rolled r in <l2>/ˈpe.ro/</l2>, "dog", and the single tap in <l2>/ˈpe.ɾo/</l2>, "but".
```

The voice speaks the sounds such a spelling gives it, whichever language the service detects. A sentence long enough to read as its language can keep its own spelling. Have your LLM write the taught language this way from the start rather than converting it afterwards: the LLM knows which word it means, and a converter has to guess a reading from the characters. Check your LLM with words that have more than one reading (人気のない is *hitoke*, not *ninki*; 还没 is *hái*, 还书 *huán*) and with IPA that tells *r* from *ɾ*: smaller models get some of them wrong.

## Two ways to send a turn

`language_switching.py` does both the same way: one context with no `language`, so the service detects the language of every flush, and auto mode off, so each flush is synthesized as sent. The detected language picks the voice's prompt, and so its accent, when the voice has a localized prompt for it and per-language prompt switching is enabled for your workspace. It also sets how numbers are read, and timestamps.

**One flush, on a bilingual voice.** The tags are stripped and the whole turn is one flush. On a voice cloned from a clip in both languages, its one prompt has both accents, so what detection decides does not change the accent, and the delivery runs straight through every switch. This is the most robust choice today.

```bash
python ../../example_voice_clone.py --name "Tutor EN-ES" --audio tutor_en_es.wav   # about 30 s, half in each language
python language_switching.py --voice-id <your bilingual voice ID>
```

**Per-language flushes, on a voice with localized prompts.** The turn is flushed at every switch, and each flush's language is detected on its own, so each can be spoken on the prompt of its language. The flushes share the context's history, so the delivery carries across the switches. This works only for a flush that detection can place:

| A flush in | Reads as |
|---|---|
| Kana | Japanese |
| Hangul | Korean |
| Chinese characters | Chinese or Japanese; a word or two can go either way, or neither |
| Latin letters | what a model makes of it; a single word can read as English |
| Pinyin | never Chinese: *hǎochī* reads as German |
| IPA | no language: the flush takes the language of the turn so far |

So per-language flushes give Japanese in kana and Korean their own prompt, but not IPA or pinyin: send those as one flush on a bilingual voice.

```bash
python language_switching.py --per-language --voice-id Jason
python language_switching.py --per-language --voice-id Jason \
    --text 'In Japanese, "thank you" is <l2>ありがとうございます。</l2> Say it back to me.'
```

Both write `language_switching.wav`.

## Demo

```bash
python demo/server.py   # then open http://localhost:8765
```

Type a turn or pick a preset for English with Spanish or Japanese, Chinese with Japanese, Japanese with Chinese, or Korean with Japanese or Chinese. The page shows what each way sends, then plays one flush and per-language flushes on a voice with localized prompts (`Jason` or `Sarah`), and one flush on your bilingual voice, which it remembers per language pair in your browser. Each preset says what to listen for.

## How flushes map to audio

With auto mode off, each flush is one synthesis, and each synthesis ends with a `flushCompleted`. The client credits audio to the first flush whose `flushCompleted` has not arrived. Two exceptions:

- A flush with nothing to speak, only punctuation or spaces, gets no `flushCompleted`. The client never sends one: such a piece joins the segment before it.
- A flush longer than `buffer_char_threshold` (1000 characters unless you set it) is synthesized in parts, each with its own `flushCompleted`.

Keep auto mode off for per-language flushes. In either auto strategy, text that arrives while a synthesis is running is merged into the next one, across your flushes, and each synthesis is spoken in one language.

## Streaming an LLM's output

For per-language flushes, keep auto mode off and send each segment once the next tag arrives, and each sentence of the learner's language as it ends.

On a bilingual voice, a synthesis may span both languages, so sentence-boundary auto mode can take the text as it streams. Strip the tags from the stream before sending it: in that mode, a `<` that never closes holds back everything after it.
