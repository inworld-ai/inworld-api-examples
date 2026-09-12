#!/usr/bin/env node
/** Manage a named pronunciation dictionary through Inworld's public REST API. */

const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const path = require('node:path');

const DEFAULT_API_BASE_URL = 'https://api.inworld.ai';
const REQUEST_TIMEOUT_MILLISECONDS = 30_000;
const INITIAL_PRONUNCIATIONS = [
    { displayHeadword: 'Cat', languageCode: 'en-US', phoneSymbols: ['k', 'æ', 't'] },
    { displayHeadword: 'Ship', languageCode: 'en-US', phoneSymbols: ['ʃ', 'ɪ', 'p'] },
];
const REPLACEMENT_PRONUNCIATIONS = [
    { displayHeadword: 'Red', languageCode: 'en-US', phoneSymbols: ['ɹ', 'ɛ', 'd'] },
];

class ApiError extends Error {
    constructor(method, status) {
        super(`${method} request failed with HTTP ${status}.`);
        this.status = status;
    }
}

class PronunciationDictionariesClient {
    constructor(apiKey, workspaceId, apiBaseUrl, { fetchImpl = fetch } = {}) {
        const base = new URL(apiBaseUrl);
        if (base.username || base.password || base.search || base.hash ||
            base.pathname !== '/' || (base.protocol !== 'https:' &&
                !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)))) {
            throw new Error('Use an HTTPS regional API origin (HTTP is allowed only for localhost).');
        }
        this.apiKey = apiKey;
        this.workspaceId = workspaceId;
        this.apiBaseUrl = base.origin;
        this.fetchImpl = fetchImpl;
        this.collectionPath =
            `/pronunciations/v1/workspaces/${encodeURIComponent(workspaceId)}` +
            '/pronunciationDictionaries';
    }

    createDictionary(displayName, pronunciations) {
        return this.request(this.collectionPath, {
            method: 'POST', body: { displayName, pronunciations },
        });
    }

    listDictionaries(pageSize = 5) {
        return this.request(this.collectionPath, { query: { pageSize: String(pageSize) } });
    }

    getDictionary(name) {
        return this.request(this.resourcePath(name));
    }

    updateDictionary(dictionary, displayName, pronunciations) {
        requireEtag(dictionary);
        return this.request(this.resourcePath(dictionary.name), {
            method: 'PATCH',
            query: { updateMask: 'displayName,pronunciations' },
            body: { displayName, pronunciations, etag: dictionary.etag },
        });
    }

    deleteDictionary(dictionary) {
        requireEtag(dictionary);
        return this.request(this.resourcePath(dictionary.name), {
            method: 'DELETE', query: { etag: dictionary.etag },
        });
    }

    synthesize(body) {
        return this.request('/tts/v1/voice', { method: 'POST', body });
    }

    resourcePath(name) {
        const prefix = `workspaces/${this.workspaceId}/pronunciationDictionaries/`;
        const id = typeof name === 'string' && name.startsWith(prefix) ? name.slice(prefix.length) : '';
        if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
            throw new Error('Use the full dictionary name returned by create, in INWORLD_WORKSPACE_ID.');
        }
        return `/pronunciations/v1/${name.split('/').map(encodeURIComponent).join('/')}`;
    }

    async request(endpoint, { method = 'GET', query = {}, body } = {}) {
        const url = new URL(`${this.apiBaseUrl}${endpoint}`);
        for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
        let response;
        let responseText;
        try {
            response = await this.fetchImpl(url, {
                method,
                redirect: 'error',
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MILLISECONDS),
                headers: {
                    Authorization: `Basic ${this.apiKey}`,
                    ...(body ? { 'Content-Type': 'application/json' } : {}),
                },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
            if (!response.ok) throw new ApiError(method, response.status);
            responseText = await response.text();
        } catch (error) {
            if (error instanceof ApiError) throw error;
            throw new Error(`${method} request failed or timed out; its outcome may be unknown. Do not retry a mutation blindly.`);
        }
        try {
            return responseText ? JSON.parse(responseText) : {};
        } catch (_) {
            throw new Error(`${method} returned invalid JSON; its outcome may be unknown.`);
        }
    }
}

function requireEtag(dictionary) {
    if (typeof dictionary.etag !== 'string' || !dictionary.etag) {
        throw new Error('A current, non-empty dictionary ETag is required.');
    }
}

function dictionaryState(dictionary) {
    return {
        displayName: dictionary.displayName,
        pronunciations: dictionary.pronunciations?.map(({ displayHeadword, languageCode, phoneSymbols }) =>
            ({ displayHeadword, languageCode, phoneSymbols })),
    };
}

async function cleanupOwnedDictionary(client, name, expectedStates) {
    let current;
    try {
        current = await client.getDictionary(name);
    } catch (error) {
        if (error instanceof ApiError && error.status === 404) return;
        throw error;
    }
    // A lost PATCH response may leave either the preimage or intended postimage.
    // Refuse to delete content changed by another writer; the fresh ETag fences races.
    if (current.name !== name || !expectedStates.some((state) =>
        isDeepStrictEqual(dictionaryState(current), state))) {
        throw new Error('Cleanup refused: dictionary contents changed unexpectedly. Inspect it manually.');
    }
    await client.deleteDictionary(current);
}

function requireEnvironmentVariable(name) {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set. Copy .env.example to .env and provide a value.`);
    return value;
}

function clientFromEnvironment() {
    // Importing this module must not load credentials or execute requests.
    require('dotenv').config({ path: path.join(__dirname, '.env') });
    return new PronunciationDictionariesClient(
        requireEnvironmentVariable('INWORLD_API_KEY'),
        requireEnvironmentVariable('INWORLD_WORKSPACE_ID'),
        process.env.INWORLD_API_BASE_URL || DEFAULT_API_BASE_URL,
    );
}

async function runLifecycle(client, { log = console.log, error = console.error, id = randomUUID() } = {}) {
    const initial = { displayName: `API example ${id}`, pronunciations: INITIAL_PRONUNCIATIONS };
    const replacement = { displayName: `API example updated ${id}`, pronunciations: REPLACEMENT_PRONUNCIATIONS };
    let name;
    const expectedStates = [dictionaryState(initial)];
    log(`Creating disposable dictionary: ${initial.displayName}`);
    try {
        let dictionary = await client.createDictionary(initial.displayName, initial.pronunciations);
        client.resourcePath(dictionary.name);
        name = dictionary.name;
        log('1. Created dictionary', dictionary);
        log('2. Listed dictionaries (first page)', await client.listDictionaries(5));
        dictionary = await client.getDictionary(name);
        if (dictionary.name !== name || !isDeepStrictEqual(dictionaryState(dictionary), expectedStates[0])) {
            throw new Error('Dictionary changed unexpectedly; refusing to update it.');
        }
        log('3. Retrieved dictionary', dictionary);
        expectedStates.push(dictionaryState(replacement));
        dictionary = await client.updateDictionary(dictionary, replacement.displayName, replacement.pronunciations);
        if (dictionary.name !== name || !isDeepStrictEqual(dictionaryState(dictionary), expectedStates[1])) {
            throw new Error('Updated dictionary does not match the intended contents.');
        }
        log('4. Replaced dictionary contents', dictionary);
        await client.deleteDictionary(dictionary);
        name = null;
        log('5. Deleted dictionary');
    } catch (failure) {
        if (!name) error(`If create committed without a usable response, find displayName "${initial.displayName}" and reconcile manually.`);
        throw failure;
    } finally {
        if (name) {
            try {
                await cleanupOwnedDictionary(client, name, expectedStates);
                log('Cleaned up the dictionary after an incomplete run.');
            } catch (cleanupError) {
                error(`Cleanup failed for ${name}; inspect and delete it manually: ${cleanupError.message}`);
            }
        }
    }
}

if (require.main === module) {
    Promise.resolve().then(() => runLifecycle(clientFromEnvironment())).catch((error) => {
        console.error(`Pronunciation dictionary example failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = {
    ApiError, PronunciationDictionariesClient, clientFromEnvironment,
    requireEnvironmentVariable, cleanupOwnedDictionary, runLifecycle,
    INITIAL_PRONUNCIATIONS, REPLACEMENT_PRONUNCIATIONS,
};
