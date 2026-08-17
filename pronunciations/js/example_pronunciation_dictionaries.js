#!/usr/bin/env node
/** Manage a named pronunciation dictionary through Inworld's public REST API. */

try {
    require('dotenv').config();
} catch (_) {}

const DEFAULT_API_BASE_URL = 'https://api.inworld.ai';

const INITIAL_PRONUNCIATIONS = [
    {
        displayHeadword: 'Cat',
        languageCode: 'en-US',
        phoneSymbols: ['k', 'æ', 't'],
    },
    {
        displayHeadword: 'Ship',
        languageCode: 'en-US',
        phoneSymbols: ['ʃ', 'ɪ', 'p'],
    },
];

const REPLACEMENT_PRONUNCIATIONS = [
    {
        displayHeadword: 'Red',
        languageCode: 'en-US',
        phoneSymbols: ['ɹ', 'ɛ', 'd'],
    },
];

class PronunciationDictionariesClient {
    constructor(apiKey, workspaceId, apiBaseUrl) {
        this.apiKey = apiKey;
        this.workspaceId = workspaceId;
        this.apiBaseUrl = apiBaseUrl.replace(/\/$/, '');
        this.collectionPath =
            `/pronunciations/v1/workspaces/${encodeURIComponent(workspaceId)}` +
            '/pronunciationDictionaries';
    }

    createDictionary(displayName, pronunciations) {
        return this.request(this.collectionPath, {
            method: 'POST',
            body: { displayName, pronunciations },
        });
    }

    listDictionaries(pageSize = 5) {
        return this.request(this.collectionPath, {
            query: { pageSize: String(pageSize) },
        });
    }

    getDictionary(name) {
        return this.request(this.resourcePath(name));
    }

    updateDictionary(dictionary, displayName, pronunciations) {
        return this.request(this.resourcePath(dictionary.name), {
            method: 'PATCH',
            query: { updateMask: 'displayName,pronunciations' },
            body: {
                name: dictionary.name,
                displayName,
                pronunciations,
                etag: dictionary.etag,
            },
        });
    }

    deleteDictionary(dictionary) {
        return this.request(this.resourcePath(dictionary.name), {
            method: 'DELETE',
            query: { etag: dictionary.etag },
        });
    }

    resourcePath(name) {
        const expectedPrefix =
            `workspaces/${this.workspaceId}/pronunciationDictionaries/`;
        if (!name.startsWith(expectedPrefix)) {
            throw new Error(`Unexpected pronunciation dictionary name: ${name}`);
        }
        const encodedName = name.split('/').map(encodeURIComponent).join('/');
        return `/pronunciations/v1/${encodedName}`;
    }

    async request(path, { method = 'GET', query = {}, body } = {}) {
        const url = new URL(`${this.apiBaseUrl}${path}`);
        for (const [name, value] of Object.entries(query)) {
            url.searchParams.set(name, value);
        }

        const response = await fetch(url, {
            method,
            headers: {
                Authorization: `Basic ${this.apiKey}`,
                ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
        });
        const responseText = await response.text();
        if (!response.ok) {
            throw new Error(
                `${method} ${url} failed with HTTP ${response.status}: ${responseText}`,
            );
        }
        return responseText ? JSON.parse(responseText) : {};
    }
}

function printResult(label, value) {
    console.log(`\n${label}`);
    console.log(JSON.stringify(value, null, 2));
}

function requireEnvironmentVariable(name) {
    const value = process.env[name];
    if (!value) {
        throw new Error(
            `${name} is not set. Copy .env.example to .env and provide a value.`,
        );
    }
    return value;
}

async function runLifecycle(client) {
    let dictionary = null;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    try {
        dictionary = await client.createDictionary(
            `API example ${timestamp}`,
            INITIAL_PRONUNCIATIONS,
        );
        printResult('1. Created dictionary', dictionary);

        const page = await client.listDictionaries(5);
        printResult('2. Listed dictionaries (first page)', page);

        dictionary = await client.getDictionary(dictionary.name);
        printResult('3. Retrieved dictionary', dictionary);

        dictionary = await client.updateDictionary(
            dictionary,
            `API example updated ${timestamp}`,
            REPLACEMENT_PRONUNCIATIONS,
        );
        printResult('4. Replaced dictionary contents', dictionary);

        const deleteResponse = await client.deleteDictionary(dictionary);
        printResult('5. Deleted dictionary', deleteResponse);
        dictionary = null;
    } finally {
        if (dictionary) {
            try {
                await client.deleteDictionary(dictionary);
                console.log('\nCleaned up the dictionary after an incomplete run.');
            } catch (cleanupError) {
                console.error(
                    `\nCleanup failed; delete ${dictionary.name} manually: ` +
                    cleanupError.message,
                );
            }
        }
    }
}

async function main() {
    const client = new PronunciationDictionariesClient(
        requireEnvironmentVariable('INWORLD_API_KEY'),
        requireEnvironmentVariable('INWORLD_WORKSPACE_ID'),
        process.env.INWORLD_API_BASE_URL || DEFAULT_API_BASE_URL,
    );
    await runLifecycle(client);
}

main().catch((error) => {
    console.error(`Pronunciation dictionary example failed: ${error.message}`);
    process.exitCode = 1;
});
