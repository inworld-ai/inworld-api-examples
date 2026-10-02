# Language Switching

Speak a turn that mixes languages, the way a language tutor talks: the learner's language, with words and phrases in the language being taught. Each part goes in a language tag, and the service speaks it in that language.

```text
<lang lang="en-US">Great job! "The dog runs" is</lang> <lang lang="es-MX">El perro corre.</lang> <lang lang="en-US">Listen for the rolled r in</lang> <lang lang="es-MX">perro</lang><lang lang="en-US">.</lang>
```

| File | What it shows |
|---|---|
| [`language_switching.py`](./language_switching.py) | Speaks a tagged turn through the other guides' speakers, and the same turn without tags for comparison |
| [`demo/`](./demo/) | A local web page that plays a turn with tags and without, side by side |

Tags pass through every mode unchanged, so this guide has no WebSocket client of its own: it reuses [`../barge_in/whole_turn.py`](../barge_in/whole_turn.py) and [`../sentence_boundary/sentence_boundary.py`](../sentence_boundary/sentence_boundary.py). Set up as in the [guides' README](../README.md#setup), and run the commands below from this folder.

## Language tags

`<lang lang="es-MX">…</lang>` speaks its span in Spanish. `xml:lang` is the same attribute, and the code is a BCP-47 tag such as `es-MX` or `ja-JP`.

- **The span is spoken on the voice's prompt for its language.** Pick a voice with a [localized prompt](https://docs.inworld.ai/tts/capabilities/multilingual#voice-localization) for each language; without one, the span is spoken on the voice's own prompt. The span's language also sets how its numbers are read, and its timestamps.
- **Tag every part of a turn that mixes languages,** the learner's language too. Text outside every tag is left to language detection, which reads it all at once.
- **Tags are flat.** A span lasts until its closing tag, and a tag inside a span starts a new span instead of nesting.
- **A span can open in one message and close in a later one.** On a context it lasts until its closing tag, across `sendText` messages and flushes.
- **Keep the switches few.** Each switch starts a new synthesis call inside the service, so teach a word or a phrase per sentence instead of alternating word by word, and keep neighbouring text of one language in one tag.

If language tags are not enabled for your workspace, the service strips them and speaks the turn as it would without them.

Ask your LLM for the tags in its system prompt, with an example in your two languages:

```text
Explain in English, and wrap everything you write in a language tag, leaving nothing outside one. Every Spanish word or phrase gets its own Spanish tag: <lang lang="en-US">You can say</lang> <lang lang="es-MX">Quisiera un café,</lang> <lang lang="en-US">which means "I would like a coffee."</lang> Keep the switches few, never tag punctuation on its own, and never put two tags of the same language next to each other.
```

If your content already marks the taught language its own way, such as `<l2>…</l2>`, turn those marks into language tags before sending, and wrap the rest in the learner's language.

## `language_switching.py`

```bash
python language_switching.py                      # the tagged turn as one flush
python language_switching.py --mode sentence      # token by token, with sentence-boundary auto mode
python language_switching.py --mode no-tags       # tags stripped: one detected language for the turn
python language_switching.py --mode per-language  # tags stripped, a flush at every switch
python language_switching.py --voice-id Sarah --text '<lang lang="en-US">In Japanese, "thank you" is</lang> <lang lang="ja-JP">ありがとうございます。</lang>'
```

Every mode writes `language_switching.wav`.

The first two modes send the tags. As one flush, the service speaks each span in turn. Token by token, the service holds back a tag split across tokens until it is whole, cuts a synthesis at each sentence end, and carries an open span across the cuts.

The last two are what a client could do before language tags, kept to hear the difference. Without tags the service detects one language for each synthesis, by its script first:

| Text in | Reads as |
|---|---|
| Kana | Japanese |
| Hangul | Korean |
| Chinese characters | Chinese or Japanese; a word or two alone reads by a character used in only one of them, and otherwise takes the language of the turn so far |
| Latin letters | what a model makes of it; a single word shared with English, such as *once*, reads as English |

So a whole turn without tags is spoken in one language, and a flush per language gets a short word wrong where its script does not settle it.

## Demo

```bash
python demo/server.py   # then open http://localhost:8765
```

Type a tagged turn, or pick a preset for English with Spanish or Japanese, Chinese with Japanese, Japanese with Chinese, or Korean with Japanese or Chinese. The page shows the turn's spans and what each mode sends, then plays all four modes on a voice with localized prompts. Each card shows the syntheses the service ran, and each preset says what to listen for. The no-tags flush uses a bilingual cloned voice instead when you set one, which the page remembers per language pair in your browser.
