#!/usr/bin/env node
/** Compare baseline speech with a caller-supplied named dictionary. */

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {
    clientFromEnvironment, requireEnvironmentVariable,
} = require('./example_pronunciation_dictionaries');

function decodeAudio(response) {
    const encoded = response?.audioContent;
    if (typeof encoded !== 'string' || !encoded || encoded.length % 4 !== 0 ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) {
        throw new Error('TTS response must contain non-empty, valid base64 audioContent.');
    }
    const audio = Buffer.from(encoded, 'base64');
    if (!audio.length || audio.toString('base64') !== encoded) {
        throw new Error('TTS returned invalid audioContent.');
    }
    return audio;
}

async function runTts(client, name, {
    textPath = path.join(__dirname, '../sample-text.txt'),
    io = fs, tempRoot = os.tmpdir(), log = console.log,
} = {}) {
    const dictionary = await client.getDictionary(name);
    if (dictionary.name !== name) throw new Error('GET returned a different dictionary.');
    const text = (await io.readFile(textPath, 'utf8')).trim();
    if (!text) throw new Error('The shared sample text must not be empty.');
    const request = {
        text, voiceId: 'Ashley', modelId: 'inworld-tts-2', language: 'en-US',
        audioConfig: { audioEncoding: 'MP3' }, seed: 101,
    };
    // Baseline omits dictionary selection; named synthesis changes only this setting.
    const baseline = decodeAudio(await client.synthesize(request));
    const selected = decodeAudio(await client.synthesize({
        ...request,
        pronunciationDictionarySettings: { dictionaries: [{ dictionary: name }] },
    }));
    const directory = await io.mkdtemp(path.join(tempRoot, 'pronunciation-example-'));
    const baselinePath = path.join(directory, 'baseline.mp3');
    const selectedPath = path.join(directory, 'with-dictionary.mp3');
    await io.writeFile(baselinePath, baseline);
    await io.writeFile(selectedPath, selected);
    log(`Baseline audio: ${baselinePath}`);
    log(`Named-dictionary audio: ${selectedPath}`);
    log('Compare the first word: the sample dictionary intentionally makes Cat sound like red.');
    log('The supplied dictionary was not modified or deleted.');
    return { baselinePath, selectedPath };
}

if (require.main === module) {
    Promise.resolve().then(() => {
        const client = clientFromEnvironment();
        return runTts(client, requireEnvironmentVariable('PRONUNCIATION_DICTIONARY_NAME'));
    }).catch((error) => {
        console.error(`TTS dictionary example failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { decodeAudio, runTts };
