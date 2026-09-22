#!/usr/bin/env node
/** Compare speech with the workspace's existing Portal pronunciation entries. */

const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { clientFromEnvironment } = require('./example_pronunciation_dictionaries');
const { decodeAudio } = require('./example_tts_with_dictionary');

async function runWorkspaceTts(client, {
    text = 'The Cat is on the mat.', io = fs, tempRoot = os.tmpdir(), log = console.log,
} = {}) {
    if (!text.trim()) throw new Error('Synthesis text must not be empty.');
    const request = {
        text, voiceId: 'Ashley', modelId: 'inworld-tts-2', language: 'en-US',
        audioConfig: { audioEncoding: 'MP3' }, seed: 101,
    };
    log('Two billable TTS requests; uses existing Portal entries without changing them.');
    const baseline = decodeAudio(await client.synthesize(request));
    const selected = decodeAudio(await client.synthesize({
        ...request, enable_custom_pronunciation: true,
    }));
    const directory = await io.mkdtemp(path.join(tempRoot, 'workspace-pronunciation-'));
    const baselinePath = path.join(directory, 'baseline.mp3');
    const selectedPath = path.join(directory, 'with-workspace-dictionary.mp3');
    await io.writeFile(baselinePath, baseline);
    await io.writeFile(selectedPath, selected);
    log(`Baseline audio: ${baselinePath}`);
    log(`Workspace-dictionary audio: ${selectedPath}`);
    log('If Portal has Cat → /ɹɛd/ for en-US, listen for cat → red in the second file.');
    log('HTTP success is not proof of rewriting: unavailable defaults leave speech unchanged.');
    return { baselinePath, selectedPath };
}

if (require.main === module) {
    Promise.resolve().then(() => runWorkspaceTts(clientFromEnvironment())).catch((error) => {
        console.error(`Workspace pronunciation example failed: ${error.message}`);
        process.exitCode = 1;
    });
}

module.exports = { runWorkspaceTts };
