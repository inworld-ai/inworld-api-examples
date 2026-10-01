#!/usr/bin/env node
/**
 * Example script for Inworld STT asynchronous transcription, streaming the upload.
 *
 * Asynchronous transcription is for recordings too long to wait on. You hand
 * over a recording, receive a job, and collect the transcript when it finishes:
 *
 *   1. POST /stt/v1/transcribe:async      -> an operation naming the job
 *   2. GET  /lro/v1alpha/{operation name} -> poll until done
 *   3. GET  {resultUri}                   -> the transcript document
 *
 * This script streams the recording as a multipart/form-data upload, reading it
 * from disk a block at a time. It is the right way to hand over a large file:
 * memory stays flat however long the recording is, and it avoids the third that
 * base64 encoding adds to a request. For a small file example_stt_async_file.js
 * is simpler; when the audio already lives somewhere reachable,
 * example_stt_async_uri.js sends a URL instead of the bytes.
 *
 * The config part must be sent before the file part. The server reads the form
 * as a stream, so a config arriving after the audio is found too late.
 *
 * Usage:
 *   node example_stt_async_stream.js [path/to/audio.wav]
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
try { require('dotenv').config(); } catch (_) {}

const API_BASE = 'https://api.inworld.ai';

// How long to keep polling, and how long to wait between polls. A job takes
// roughly as long as a fraction of the recording, so a long file needs a larger
// budget than this default.
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 600000;

// How much of the file to read at a time while uploading.
const UPLOAD_BLOCK_BYTES = 1024 * 1024;

/**
 * Check if INWORLD_API_KEY environment variable is set.
 * @returns {string|null} API key or null if not set
 */
function checkApiKey() {
    const apiKey = process.env.INWORLD_API_KEY;
    if (!apiKey) {
        console.log('Error: INWORLD_API_KEY environment variable is not set.');
        console.log('Please set it with: export INWORLD_API_KEY=your_api_key_here');
        return null;
    }
    return apiKey;
}

/**
 * Turn a failed response into an error carrying whatever the server said.
 *
 * The body is read once, as text. Consuming it as JSON and falling back to
 * text() on a non-JSON body fails with "Body is unusable" and loses the
 * server's actual message — which is the one thing this function is for.
 *
 * @param {Response} response
 */
async function toError(response) {
    const details = await response.text();
    return new Error(`HTTP ${response.status}: ${details}`);
}

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
async function submit(audioPath, options, apiKey) {
    const transcribeConfig = {
        modelId: 'inworld/inworld-stt-1',
        // Asynchronous transcription accepts every encoding, including the
        // compressed ones streaming rejects, because the audio is a stored file.
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
 * Poll an operation until it finishes.
 *
 * @param {string} name - Operation name returned by submit()
 * @param {string} apiKey - API key for authentication
 * @param {number} timeoutMs - Give up after this long
 * @returns {Promise<Object>} The finished operation, carrying either "response" or "error"
 */
async function waitForOperation(name, apiKey, timeoutMs = POLL_TIMEOUT_MS) {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
        // Checked before each request, and used to bound it: a deadline
        // consulted only between requests cannot stop a poll that stalls
        // inside one.
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) {
            throw new Error(`job did not finish within ${timeoutMs / 1000} s`);
        }

        const response = await fetch(`${API_BASE}/lro/v1alpha/${name}`, {
            headers: { 'Authorization': `Basic ${apiKey}` },
            signal: AbortSignal.timeout(remainingMs)
        });
        if (!response.ok) throw await toError(response);

        const operation = await response.json();
        if (operation.done) return operation;

        await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
    }
}

/**
 * Download the transcript document. The link is signed, so it carries its own
 * authorization and must not be sent with the API key.
 *
 * @param {string} resultUri
 * @returns {Promise<Object>}
 */
async function downloadTranscript(resultUri) {
    const response = await fetch(resultUri);
    if (!response.ok) throw await toError(response);
    return response.json();
}

/**
 * Print the transcript, its segments and what the job billed.
 *
 * @param {Object} operation
 * @param {Object} transcriptDoc
 */
function printResult(operation, transcriptDoc) {
    console.log('Transcript:');
    console.log(transcriptDoc.transcript || '(empty)');

    const segments = transcriptDoc.segments || [];
    if (segments.length > 0) {
        console.log(`\nSegments (${segments.length}):`);
        segments.forEach(segment => {
            // Durations are int64, which JSON carries as strings.
            const startMs = Number(segment.startTimeMs || 0);
            const endMs = Number(segment.endTimeMs || 0);
            console.log(`  ${startMs}-${endMs} ms: ${segment.transcript || ''}`);
        });
    }

    if (transcriptDoc.language) {
        console.log(`\nLanguage: ${transcriptDoc.language}`);
    }

    const usage = transcriptDoc.usage || {};
    if (usage.transcribedAudioMs != null) {
        console.log(`Transcribed audio: ${usage.transcribedAudioMs} ms`);
    }
    if (usage.modelId) {
        console.log(`Model: ${usage.modelId}`);
    }

    const expireTime = (operation.response || {}).expireTime;
    if (expireTime) {
        console.log(`\nResult link expires at ${expireTime}. Keep your own copy to read it later.`);
    }
}

/**
 * Main.
 */
async function main() {
    console.log('Inworld STT Async Transcription - streamed upload');
    console.log('='.repeat(60));

    const apiKey = checkApiKey();
    if (!apiKey) return 1;

    const DEFAULT_AUDIO_PATH = path.join(__dirname, '..', 'tests-data', 'audio', 'test-audio.wav');
    const audioPath = process.argv[2] || DEFAULT_AUDIO_PATH;
    if (!fs.existsSync(audioPath)) {
        console.log(`Error: Audio file not found: ${audioPath}`);
        console.log('Usage: node example_stt_async_stream.js [path/to/audio.wav]');
        console.log('Default: ../tests-data/audio/test-audio.wav');
        return 1;
    }

    try {
        const sizeMb = (fs.statSync(audioPath).size / (1024 * 1024)).toFixed(1);
        console.log(`Audio file: ${audioPath} (${sizeMb} MB)`);
        console.log('Uploading...');
        const start = Date.now();

        let operation = await submit(audioPath, {}, apiKey);
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
