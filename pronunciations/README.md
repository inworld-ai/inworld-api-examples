# Inworld Pronunciation Dictionaries API Examples

These examples manage named pronunciation dictionaries through the public REST API.

| Directory | Description |
|---|---|
| [`python/`](python/) | Complete dictionary lifecycle using Python and `requests` |
| [`js/`](js/) | Complete dictionary lifecycle using Node.js and native `fetch` |

Each example creates a dictionary, lists dictionaries in the workspace, gets the created resource, atomically replaces its display name and entries, and deletes it. If the example fails after creating the resource, it attempts to delete the resource before exiting.

Named dictionaries are separate from the workspace saved pronunciations managed in Inworld Portal. The public API manages named dictionaries, but production public TTS requests cannot yet select or apply one.

See [Saved custom pronunciations](https://docs.inworld.ai/tts/capabilities/saved-pronunciations) for behavior, limits, and the distinction between inline, workspace, and named pronunciations.
