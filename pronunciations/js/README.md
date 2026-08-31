# Inworld Pronunciation Dictionaries JavaScript Example

This example demonstrates five operations in the public Pronunciation Dictionaries API:

1. Create a complete dictionary.
2. List dictionaries in the workspace.
3. Get the created dictionary.
4. Update its display name and atomically replace all pronunciation entries.
5. Delete it using its current `etag`.

## Prerequisites

- Node.js 20 or higher
- A Standard Inworld API key with **Voices Write** access
- The ID of a workspace the API key can access

The example creates, updates, and deletes a dictionary, so Voices Write access is required. Voices Read access is sufficient only for list and get; there is no separate Custom Pronunciations permission.

## Run the example

```bash
npm install
cp .env.example .env
# Edit .env and set INWORLD_API_KEY and INWORLD_WORKSPACE_ID.
npm start
```

You can also export the variables in your shell instead of creating `.env`:

```bash
export INWORLD_API_KEY=your_api_key_here
export INWORLD_WORKSPACE_ID=your_workspace_id_here
npm start
```

`INWORLD_API_BASE_URL` is optional and defaults to `https://api.inworld.ai`.

## Important update behavior

The example omits the optional `updateMask`, so both mutable fields—`displayName` and `pronunciations`—are updated. The `pronunciations` field is the complete desired dictionary contents: entries omitted from the request are deleted.

For a partial update, add an `updateMask` query parameter using lowerCamelCase field names. For example, `query: { updateMask: 'displayName' }` updates the name without changing the entries. Supported fields are `displayName` and `pronunciations`.

Updates and deletes require the current `etag`; retrieve the dictionary again before retrying after an `etag` conflict.

The script deletes the dictionary at the end and attempts the same cleanup if a later lifecycle step fails.
