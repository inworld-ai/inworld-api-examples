const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const {
    PronunciationDictionariesClient, ApiError, runLifecycle,
    INITIAL_PRONUNCIATIONS, REPLACEMENT_PRONUNCIATIONS,
} = require('./example_pronunciation_dictionaries');
const { runCreate } = require('./example_create_dictionary');
const { runTts, decodeAudio } = require('./example_tts_with_dictionary');

const id = '6b1af7cc-b808-49dd-9d0c-181d988a21c2';
const name = `workspaces/test-workspace/pronunciationDictionaries/${id}`;
const quiet = () => {};
const audioContent = Buffer.from('example MP3 bytes').toString('base64');

function harness(handler) {
    const calls = [];
    const client = new PronunciationDictionariesClient('test-key', 'test-workspace', 'https://api.example.test', {
        fetchImpl: async (url, options) => {
            const call = { url, ...options, body: options.body ? JSON.parse(options.body) : undefined };
            calls.push(call);
            assert.equal(options.redirect, 'error');
            assert.ok(options.signal instanceof AbortSignal);
            assert.equal(options.headers.Authorization, 'Basic test-key');
            const result = await handler(call, calls.length);
            return result instanceof Response ? result : new Response(JSON.stringify(result), { status: 200 });
        },
    });
    return { client, calls };
}

function fakeIo() {
    const writes = [];
    const io = {
        readFile: fs.readFile,
        mkdtemp: async (prefix) => `${prefix}isolated`,
        writeFile: async (file, bytes) => writes.push({ file, bytes }),
    };
    return { io, writes };
}

test('create reads all five shared records in one POST and retains the returned dictionary', async () => {
    const fixture = JSON.parse(await fs.readFile(path.join(__dirname, '../sample-dictionary.json'), 'utf8'));
    const messages = [];
    const { client, calls } = harness((call) => ({ ...call.body, name, etag: 'created-etag' }));
    const dictionary = await runCreate(client, { id, log: (message) => messages.push(message) });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'POST');
    assert.equal(calls[0].body.pronunciations.length, 5);
    assert.deepEqual(calls[0].body.pronunciations, fixture.pronunciations);
    assert.ok(calls[0].body.displayName.length <= 64);
    assert.ok(calls[0].body.displayName.endsWith(id));
    assert.equal(dictionary.name, name);
    assert.equal(dictionary.etag, 'created-etag');
    assert.ok(messages[0].includes(calls[0].body.displayName));
    assert.ok(messages.includes(`PRONUNCIATION_DICTIONARY_NAME=${name}`));
});

test('TTS GETs the supplied resource and varies only the named selector without mutating it', async () => {
    const { client, calls } = harness((call) => call.method === 'GET' ? { name } : { audioContent });
    const { io, writes } = fakeIo();
    const result = await runTts(client, name, { io, tempRoot: '/tmp', log: quiet });
    assert.deepEqual(calls.map((call) => call.method), ['GET', 'POST', 'POST']);
    assert.equal(calls[1].url.pathname, '/tts/v1/voice');
    assert.equal(calls[2].url.pathname, '/tts/v1/voice');
    const baseline = calls[1].body;
    assert.equal(baseline.text, 'Cat, Ship, Red, Kit, and Dip.');
    assert.equal(baseline.voiceId, 'Ashley');
    assert.equal(baseline.modelId, 'inworld-tts-2');
    assert.equal(baseline.language, 'en-US');
    assert.deepEqual(baseline.audioConfig, { audioEncoding: 'MP3' });
    assert.equal(baseline.seed, 101);
    assert.equal('pronunciationDictionarySettings' in baseline, false);
    assert.deepEqual(calls[2].body, {
        ...baseline, pronunciationDictionarySettings: { dictionaries: [{ dictionary: name }] },
    });
    assert.equal(writes.length, 2);
    assert.equal(path.basename(result.baselinePath), 'baseline.mp3');
    assert.equal(path.basename(result.selectedPath), 'with-dictionary.mp3');
    assert.notEqual(result.baselinePath, result.selectedPath);
    assert.deepEqual(writes.map(({ bytes }) => bytes), [Buffer.from(audioContent, 'base64'), Buffer.from(audioContent, 'base64')]);
});

test('PATCH sends explicit lowerCamelCase mask and keeps ETag only in the body', async () => {
    const { client, calls } = harness(() => ({ name }));
    await client.updateDictionary({ name, etag: 'old' }, 'Updated', REPLACEMENT_PRONUNCIATIONS);
    assert.equal(calls[0].url.searchParams.get('updateMask'), 'displayName,pronunciations');
    assert.equal(calls[0].url.searchParams.has('etag'), false);
    assert.equal(calls[0].body.etag, 'old');
});

test('wrong-workspace and malformed names fail before any request', async () => {
    const { client, calls } = harness(() => assert.fail('Must not call the API'));
    for (const invalid of [name.replace('test-workspace', 'other-workspace'), `${name}/extra`, '', undefined]) {
        await assert.rejects(runTts(client, invalid, { log: quiet }), /full dictionary name/);
    }
    assert.equal(calls.length, 0);
});

test('missing selected dictionary prevents both TTS calls and output files', async () => {
    const { client, calls } = harness(() => new Response('private raw failure', { status: 404 }));
    const { io, writes } = fakeIo();
    await assert.rejects(runTts(client, name, { io, log: quiet }), (error) =>
        error instanceof ApiError && error.status === 404 && !error.message.includes('private'));
    assert.equal(calls.length, 1);
    assert.equal(writes.length, 0);
});

test('named TTS dependency failure is surfaced once with no retry or misleading audio artifacts', async () => {
    const { client, calls } = harness((call, index) => {
        if (index === 1) return { name };
        if (index === 2) return { audioContent };
        return new Response('sensitive upstream detail', { status: 504 });
    });
    const { io, writes } = fakeIo();
    await assert.rejects(runTts(client, name, { io, log: quiet }), (error) => error.status === 504);
    assert.equal(calls.length, 3);
    assert.equal(writes.length, 0);
});

test('empty, malformed and noncanonical base64 audio is rejected', () => {
    for (const value of ['', ' ', '!!!=', 'YQ', 'YR==', 'YQ===', '\nYQ==', null, 4]) {
        assert.throws(() => decodeAudio({ audioContent: value }), /audioContent/);
    }
    assert.throws(() => decodeAudio({}), /audioContent/);
    assert.deepEqual(decodeAudio({ audioContent: 'YQ==' }), Buffer.from('a'));
});

test('invalid baseline audio stops before named TTS and does not create output', async () => {
    const { client, calls } = harness((call, index) => index === 1 ? { name } : { audioContent: '' });
    const { io, writes } = fakeIo();
    await assert.rejects(runTts(client, name, { io, log: quiet }), /audioContent/);
    assert.equal(calls.length, 2);
    assert.equal(writes.length, 0);
});

test('GET returning a different dictionary prevents synthesis', async () => {
    const { client, calls } = harness(() => ({ name: `${name}-wrong` }));
    await assert.rejects(runTts(client, name, { log: quiet }), /different dictionary/);
    assert.equal(calls.length, 1);
});

function lifecycleHarness({ patchCommitted = true, concurrentChange = false, deleteLost = false } = {}) {
    let current;
    const { client, calls } = harness((call) => {
        if (call.method === 'POST') {
            current = { ...call.body, name, etag: 'etag-before' };
            return current;
        }
        if (call.method === 'PATCH') {
            if (patchCommitted) current = { ...call.body, name, etag: 'etag-after' };
            if (concurrentChange) current = { ...current, displayName: 'Other writer changed this' };
            if (!deleteLost) throw new Error('simulated lost PATCH response');
            return current;
        }
        if (call.method === 'DELETE') {
            assert.equal(call.url.searchParams.get('etag'), current.etag);
            current = null;
            if (deleteLost) throw new Error('simulated lost DELETE response');
            return {};
        }
        if (call.url.searchParams.has('pageSize')) return { pronunciationDictionaries: [current], nextPageToken: '' };
        return current || new Response('{}', { status: 404 });
    });
    return { client, calls };
}

test('lost PATCH response is cleaned up using the committed postimage and fresh ETag', async () => {
    const { client, calls } = lifecycleHarness();
    await assert.rejects(runLifecycle(client, { id, log: quiet, error: quiet }), /outcome may be unknown/);
    assert.deepEqual(calls.map(({ method }) => method), ['POST', 'GET', 'GET', 'PATCH', 'GET', 'DELETE']);
    assert.equal(calls.at(-1).url.searchParams.get('etag'), 'etag-after');
});

test('successful advanced CRUD lifecycle deletes only its created dictionary', async () => {
    let current;
    const { client, calls } = harness((call) => {
        if (call.method === 'POST' || call.method === 'PATCH') {
            current = { ...call.body, name, etag: call.method === 'POST' ? 'before' : 'after' };
            return current;
        }
        if (call.method === 'DELETE') {
            assert.equal(call.url.searchParams.get('etag'), 'after');
            return {};
        }
        return call.url.searchParams.has('pageSize') ? { pronunciationDictionaries: [current] } : current;
    });
    await runLifecycle(client, { id, log: quiet, error: quiet });
    assert.deepEqual(calls.map(({ method }) => method), ['POST', 'GET', 'GET', 'PATCH', 'DELETE']);
    assert.deepEqual(calls[3].body.pronunciations, REPLACEMENT_PRONUNCIATIONS);
});

test('uncommitted failed PATCH can clean up the verified preimage', async () => {
    const { client, calls } = lifecycleHarness({ patchCommitted: false });
    await assert.rejects(runLifecycle(client, { id, log: quiet, error: quiet }));
    assert.equal(calls.at(-1).method, 'DELETE');
    assert.equal(calls.at(-1).url.searchParams.get('etag'), 'etag-before');
});

test('cleanup refuses concurrent changes and reports manual reconciliation', async () => {
    const { client, calls } = lifecycleHarness({ concurrentChange: true });
    const errors = [];
    await assert.rejects(runLifecycle(client, { id, log: quiet, error: (message) => errors.push(message) }));
    assert.equal(calls.filter(({ method }) => method === 'DELETE').length, 0);
    assert.ok(errors.some((message) => message.includes('Cleanup refused') && message.includes(name)));
});

test('lost DELETE response is reconciled with one GET and no blind second DELETE', async () => {
    const { client, calls } = lifecycleHarness({ deleteLost: true });
    await assert.rejects(runLifecycle(client, { id, log: quiet, error: quiet }));
    assert.equal(calls.filter(({ method }) => method === 'DELETE').length, 1);
    assert.equal(calls.at(-1).method, 'GET');
});

test('lost create response has a printed unique display name and no mutation retries', async () => {
    const { client, calls } = harness(() => { throw new Error('sensitive raw transport detail'); });
    const messages = [];
    await assert.rejects(runLifecycle(client, { id, log: (message) => messages.push(message), error: (message) => messages.push(message) }),
        (error) => !error.message.includes('sensitive'));
    assert.equal(calls.length, 1);
    assert.ok(messages[0].includes(id));
    assert.ok(messages.at(-1).includes('reconcile manually'));
});

test('successful responses containing invalid JSON fail without exposing response content', async () => {
    const { client } = harness(() => new Response('private non-JSON content', { status: 200 }));
    await assert.rejects(client.getDictionary(name), /GET returned invalid JSON; its outcome may be unknown\./);
});

test('canonical API error statuses remain visible without raw bodies or automatic retries', async () => {
    for (const status of [400, 403, 404, 409, 503, 504]) {
        const { client, calls } = harness(() => new Response('sensitive detail', { status }));
        await assert.rejects(client.getDictionary(name), (error) =>
            error instanceof ApiError && error.status === status && error.message === `GET request failed with HTTP ${status}.`);
        assert.equal(calls.length, 1);
    }
});

test('mutations reject missing ETags and credentials cannot be redirected to a different origin', () => {
    const { client, calls } = harness(() => assert.fail('Must not call the API'));
    assert.throws(() => client.deleteDictionary({ name }), /ETag/);
    assert.throws(() => client.updateDictionary({ name }, 'x', INITIAL_PRONUNCIATIONS), /ETag/);
    assert.equal(calls.length, 0);
    for (const base of ['http://example.com', 'https://user:secret@example.com', 'https://example.com/path', 'https://example.com?x=y']) {
        assert.throws(() => new PronunciationDictionariesClient('key', 'ws', base), /HTTPS regional API origin/);
    }
});
