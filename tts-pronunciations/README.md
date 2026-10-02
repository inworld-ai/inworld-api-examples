# Pronunciation dictionaries: create, then synthesize

Create a dictionary containing several pronunciations in one public API request, then select it in a separate TTS example. Both languages use the same data and request shapes.

| Example | Python | JavaScript | Resource behavior |
|---|---|---|---|
| Create five entries | [example_create_dictionary.py](python/example_create_dictionary.py) | [example_create_dictionary.js](js/example_create_dictionary.js) | Creates and retains a new dictionary |
| Compare TTS audio | [example_tts_with_dictionary.py](python/example_tts_with_dictionary.py) | [example_tts_with_dictionary.js](js/example_tts_with_dictionary.js) | Reads an existing dictionary; never changes or deletes it |
| Use Portal's workspace dictionary | [example_tts_with_workspace_dictionary.py](python/example_tts_with_workspace_dictionary.py) | [example_tts_with_workspace_dictionary.js](js/example_tts_with_workspace_dictionary.js) | Synthesizes with existing Portal entries; no dictionary ID or management calls |
| Optional CRUD lifecycle | [example_pronunciation_dictionaries.py](python/example_pronunciation_dictionaries.py) | [example_pronunciation_dictionaries.js](js/example_pronunciation_dictionaries.js) | Creates, lists, gets, updates, and deletes its own temporary dictionary |

Start with the [Python setup](python/README.md) or [JavaScript setup](js/README.md).

## What to expect

1. Create loads [sample-dictionary.json](sample-dictionary.json) and sends all five entries atomically. It prints the returned dictionary, including its full `name` and `etag`. Keep the `name` for synthesis; the script deliberately leaves this dictionary available.
2. TTS gets that dictionary, then synthesizes [sample-text.txt](sample-text.txt) twice using `inworld-tts-2`, `Ashley`, and `en-US`: once without dictionary selection, then once with it. It saves `baseline.mp3` and `with-dictionary.mp3` in a newly created temporary directory and prints their paths. These are two billable synthesis requests.
3. Listen to both files. The sample deliberately maps **Cat → red**, so the first spoken word should change from “cat” to “red.” Ship, Red, Kit, and Dip use their ordinary pronunciations. This artificial override makes the difference easy to hear; edit the JSON and matching text for your own vocabulary.

The local JSON file is read by the example, not uploaded through a separate file API. Each `phoneSymbols` element is an individual supported phone symbol; an arbitrary IPA string is not interchangeable with this array. See the [pronunciation guide](https://docs.inworld.ai/tts/capabilities/pronunciation-dictionaries) for supported languages, phones, and limits.

## Configuration and selection

Use one **Standard API key with Voices Write access** for the complete workflow, and the workspace ID it belongs to. There is no separate Custom Pronunciations permission. List/get need Voices Read; create/update/delete need Voices Write. Keep the key server-side and never commit `.env` or expose it in browser code.

Use the same workspace and regional API base URL for creation, synthesis, and cleanup. The scripts default to `https://api.inworld.ai`; the target deployment and workspace must have the pronunciation API and named-dictionary synthesis available.

Pass the **full server-returned resource name**, not just its UUID, as `PRONUNCIATION_DICTIONARY_NAME`. The selected TTS request adds:

```json
{
  "pronunciationDictionarySettings": {
    "dictionaries": [
      { "dictionary": "workspaces/my-workspace/pronunciationDictionaries/{dictionary_id}" }
    ]
  }
}
```

Replace the illustrative name with the exact `name` returned by create. Named dictionaries are separate from workspace saved pronunciations in Inworld Portal. Do not send `enable_custom_pronunciation` alongside named settings, even as `false`.

## Use the workspace dictionary saved in Portal

Choose this example when you already saved entries on the workspace's **Pronunciations** page, rather than creating a named dictionary through the API. It adds only:

```json
{ "enable_custom_pronunciation": true }
```

1. In a test workspace in Portal, save **Cat** with English (US) phones **ɹ**, **ɛ**, **d** (`/ɹɛd/`). This intentionally makes “cat” sound like “red.” The request uses the same spelling, **Cat**. Do not replace somebody else's entry; use a test workspace you control.
2. Configure the same workspace's Standard `INWORLD_API_KEY`, `INWORLD_WORKSPACE_ID`, and matching regional `INWORLD_API_BASE_URL` using the language-specific setup. The API key determines the workspace; the workspace ID setting does not override its scope. `PRONUNCIATION_DICTIONARY_NAME` is not used.
3. Run `npm run tts:workspace` from `tts-pronunciations/js`, or `python example_tts_with_workspace_dictionary.py` from `tts-pronunciations/python`.
4. Listen to the printed files: `baseline.mp3` should say “The cat is on the mat”; `with-workspace-dictionary.mp3` should say “The red is on the mat.” Both requests use TTS-2, Ashley, and `en-US` and are billable. The example never reads, creates, updates, or deletes dictionary resources. Remove only your own test entry in Portal afterward if no longer needed.

This public selector must be deployed and workspace-default synthesis enabled in the region you call. False or omission disables the default dictionary on a new request. An empty, unavailable, or nonmatching default can leave audio unchanged even with HTTP 200; listen to the result rather than treating request success as proof. Named selection instead surfaces dictionary-loading failures. Neither selector makes Portal's default dictionary editable through public dictionary CRUD, and no workspace UUID should be sent by the client.

## Update and cleanup safety

The optional CRUD demo sends an explicit `updateMask=displayName,pronunciations`. `pronunciations` is a complete replacement: omitted entries are removed. A display-name-only update uses `updateMask=displayName`. Use REST lowerCamelCase mask paths and keep `etag` out of the mask.

Updates and deletes use the current ETag. On HTTP 409 / gRPC `ABORTED`, get the dictionary again and reconcile concurrent changes before submitting another mutation. The CRUD demo performs a bounded cleanup read and only deletes a resource whose name and contents still match that run's expected state; it reports a cleanup failure rather than deleting someone else's edits.

The scripts do not retry HTTP requests. A failed create response can still mean the server created the resource. Create prints its unique display name before sending the request: inspect the workspace's paginated dictionary listing for that name before trying again. Likewise, inspect the current dictionary after an ambiguous update response.

### Delete the retained sample when finished

Creation is intentionally persistent. To remove **only the sample you created**, export the same API variables in your shell (the scripts' `.env` file is not automatically exported), and set `PRONUNCIATION_DICTIONARY_NAME` to that exact resource name. Get and inspect its current contents first:

```bash
curl --fail-with-body \
  "${INWORLD_API_BASE_URL:-https://api.inworld.ai}/pronunciations/v1/${PRONUNCIATION_DICTIONARY_NAME}" \
  --header "Authorization: Basic ${INWORLD_API_KEY}"
```

Copy its current `etag` into the variable below. Confirm you no longer need the dictionary, then delete it:

```bash
DICTIONARY_ETAG='paste-current-etag-here'
curl --fail-with-body --get --request DELETE \
  "${INWORLD_API_BASE_URL:-https://api.inworld.ai}/pronunciations/v1/${PRONUNCIATION_DICTIONARY_NAME}" \
  --header "Authorization: Basic ${INWORLD_API_KEY}" \
  --data-urlencode "etag=${DICTIONARY_ETAG}"
```

Do not blindly retry a conflict with a new ETag. A subsequent GET should return HTTP 404 after successful deletion. The local audio files remain until you remove their printed temporary directory.
