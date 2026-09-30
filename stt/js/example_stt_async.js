#!/usr/bin/env node
/**
 * Example script for Inworld STT asynchronous transcription using HTTP.
 *
 * Asynchronous transcription is for recordings that are too long to wait on.
 * Submitting returns a job; the transcript is collected once the job finishes:
 *
 *   1. POST /stt/v1/transcribe:async      -> an operation naming the job
 *   2. GET  /lro/v1alpha/{operation name} -> poll until done
 *   3. GET  {resultUri}                   -> the transcript document
 *
 * This script sends the audio inline, base64-encoded, which is the simplest way
 * and suits small files. For large recordings use example_stt_async_multipart.js,
 * which streams the file instead of holding it in memory.
 */

const fs = require('fs');
const path = require('path');
try { require('dotenv').config(); } catch (_) {}

const API_BASE = 'https://api.inworld.ai';

// How long to keep polling, and how long to wait between polls. A job takes
// roughly as long as a fraction of the recording, so a two-hour file needs a
// larger budget than this default.
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 600000;

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
 * Submit an asynchronous transcription job with the audio sent inline.
 *
 * @param {string} audioPath - Path to audio file (WAV, MP3, FLAC, OGG, etc.)
 * @param {Object} options - Optional transcribeConfig overrides
 * @param {string} apiKey - API key for authentication
 * @returns {Promise<Object>} The operation, whose "name" identifies the job
 */
async function submit(audioPath, options, apiKey) {
    const contentB64 = fs.readFileSync(audioPath).toString('base64');

    const transcribeConfig = {
        modelId: 'inworld/inworld-stt-1',
        // Asynchronous transcription accepts every encoding, including the
        // compressed ones streaming rejects, because the audio is a stored file.
        audioEncoding: 'AUTO_DETECT',
        language: 'en-US',
        ...options
    };

    const response = await fetch(`${API_BASE}/stt/v1/transcribe:async`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${apiKey}`
        },
        body: JSON.stringify({ transcribeConfig, audioData: { content: contentB64 } })
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
    console.log('Inworld STT Asynchronous Transcription Example');
    console.log('='.repeat(50));

    const apiKey = checkApiKey();
    if (!apiKey) return 1;

    const DEFAULT_AUDIO_PATH = path.join(__dirname, '..', 'tests-data', 'audio', 'test-audio.wav');
    const audioPath = process.argv[2] || DEFAULT_AUDIO_PATH;
    if (!fs.existsSync(audioPath)) {
        console.log(`Error: Audio file not found: ${audioPath}`);
        console.log('Usage: node example_stt_async.js [path/to/audio.wav]');
        console.log('Default: ../tests-data/audio/test-audio.wav');
        return 1;
    }

    try {
        console.log(`Audio file: ${audioPath}`);
        console.log('Submitting...');
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

module.exports = { API_BASE, checkApiKey, toError, waitForOperation, downloadTranscript, printResult };

if (require.main === module) {
    main().then(process.exit);
}
