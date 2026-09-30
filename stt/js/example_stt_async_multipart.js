#!/usr/bin/env node
/**
 * Example script for Inworld STT asynchronous transcription with a streamed upload.
 *
 * Same three steps as example_stt_async.js, but the audio is sent as a
 * multipart/form-data upload instead of inline base64. Use this for large
 * recordings: the file is streamed from disk a block at a time, so a two-hour
 * recording costs one block of memory rather than its own size, and it avoids
 * the third that base64 encoding adds to the request.
 *
 * The config part must be sent before the file part. The server reads the form
 * as a stream, so a config that arrives after the audio is found too late.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
try { require('dotenv').config(); } catch (_) {}

const {
    API_BASE,
    checkApiKey,
    toError,
    waitForOperation,
    downloadTranscript,
    printResult
} = require('./example_stt_async');

// How much of the file to read at a time while uploading.
const UPLOAD_BLOCK_BYTES = 1024 * 1024;

/**
 * Yield the multipart body a block at a time, config part first.
 *
 * Written by hand rather than with FormData because that one needs the whole
 * body in memory, which is exactly what a large upload needs to avoid.
 *
 * @param {string} boundary
 * @param {Object} transcribeConfig
 * @param {string} audioPath
 */
async function* multipartBody(boundary, transcribeConfig, audioPath) {
    yield Buffer.from(
        `--${boundary}\r\n` +
        'Content-Disposition: form-data; name="transcribeConfig"\r\n' +
        'Content-Type: application/json\r\n\r\n' +
        `${JSON.stringify(transcribeConfig)}\r\n`
    );

    yield Buffer.from(
        `--${boundary}\r\n` +
        `Content-Disposition: form-data; name="file"; filename="${path.basename(audioPath)}"\r\n` +
        'Content-Type: application/octet-stream\r\n\r\n'
    );

    for await (const block of fs.createReadStream(audioPath, { highWaterMark: UPLOAD_BLOCK_BYTES })) {
        yield block;
    }

    yield Buffer.from(`\r\n--${boundary}--\r\n`);
}

/**
 * Submit an asynchronous transcription job, streaming the audio file.
 *
 * @param {string} audioPath - Path to audio file (WAV, MP3, FLAC, OGG, etc.)
 * @param {Object} options - Optional transcribeConfig overrides
 * @param {string} apiKey - API key for authentication
 * @returns {Promise<Object>} The operation, whose "name" identifies the job
 */
async function submitMultipart(audioPath, options, apiKey) {
    const transcribeConfig = {
        modelId: 'inworld/inworld-stt-1',
        audioEncoding: 'AUTO_DETECT',
        language: 'en-US',
        ...options
    };

    const boundary = crypto.randomUUID().replace(/-/g, '');
    const response = await fetch(`${API_BASE}/stt/v1/transcribe:async`, {
        method: 'POST',
        headers: {
            'Content-Type': `multipart/form-data; boundary=${boundary}`,
            'Authorization': `Basic ${apiKey}`
        },
        body: Readable.toWeb(Readable.from(multipartBody(boundary, transcribeConfig, audioPath))),
        // Required by fetch whenever the body is a stream: it says the request
        // body is sent before the response is read.
        duplex: 'half'
    });

    if (!response.ok) throw await toError(response);
    return response.json();
}

/**
 * Main.
 */
async function main() {
    console.log('Inworld STT Asynchronous Transcription Example (streamed upload)');
    console.log('='.repeat(64));

    const apiKey = checkApiKey();
    if (!apiKey) return 1;

    const DEFAULT_AUDIO_PATH = path.join(__dirname, '..', 'tests-data', 'audio', 'test-audio.wav');
    const audioPath = process.argv[2] || DEFAULT_AUDIO_PATH;
    if (!fs.existsSync(audioPath)) {
        console.log(`Error: Audio file not found: ${audioPath}`);
        console.log('Usage: node example_stt_async_multipart.js [path/to/audio.wav]');
        console.log('Default: ../tests-data/audio/test-audio.wav');
        return 1;
    }

    try {
        const sizeMb = (fs.statSync(audioPath).size / (1024 * 1024)).toFixed(1);
        console.log(`Audio file: ${audioPath} (${sizeMb} MB)`);
        console.log('Uploading...');
        const start = Date.now();

        let operation = await submitMultipart(audioPath, {}, apiKey);
        console.log(`Job submitted: ${operation.name}`);

        console.log('Waiting for the job to finish...\n');
        operation = await waitForOperation(operation.name, apiKey);
        const elapsed = ((Date.now() - start) / 1000).toFixed(2);

        if (operation.error) {
            console.log(`Job failed: ${operation.error.message} (code ${operation.error.code})`);
            return 1;
        }

        const transcriptDoc = await downloadTranscript(operation.response.resultUri);
        printResult(operation, transcriptDoc);
        console.log(`\nDone in ${elapsed} s.`);
    } catch (err) {
        console.log(`Transcription failed: ${err.message}`);
        return 1;
    }
    return 0;
}

if (require.main === module) {
    main().then(process.exit);
}
