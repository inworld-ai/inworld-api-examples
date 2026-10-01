#!/usr/bin/env node
/**
 * Example script for Inworld STT asynchronous transcription, sending a URL.
 *
 * Asynchronous transcription is for recordings too long to wait on. You hand
 * over a recording, receive a job, and collect the transcript when it finishes:
 *
 *   1. POST /stt/v1/transcribe:async      -> an operation naming the job
 *   2. GET  /lro/v1alpha/{operation name} -> poll until done
 *   3. GET  {resultUri}                   -> the transcript document
 *
 * This script sends no audio at all. It gives the service a URL and the service
 * fetches the recording itself, which is the cheapest handover when the audio
 * already lives somewhere reachable such as cloud storage: the bytes never pass
 * through your process. To send the bytes instead, see
 * example_stt_async_file.js (whole file in the request) or
 * example_stt_async_stream.js (streamed upload).
 *
 * The URL must be https, must serve the audio directly, and must be reachable
 * without your Inworld credentials — either public, or carrying its own
 * authorization such as a signed cloud-storage URL. Redirects are refused, so
 * give the URL that serves the bytes rather than one that points at it. Most
 * convenient sharing links redirect: file-sharing services, shortened URLs, and
 * console URLs such as storage.cloud.google.com. The service fetches the audio
 * while your submit request is still in flight, so a URL it cannot reach is
 * reported as a failed submit rather than a failed job — and submitting a large
 * recording this way takes as long as the fetch does.
 *
 * Usage:
 *   node example_stt_async_uri.js [https://host/path/audio.wav]
 */

try { require('dotenv').config(); } catch (_) {}

const API_BASE = 'https://api.inworld.ai';

// How long to keep polling, and how long to wait between polls. A job takes
// roughly as long as a fraction of the recording, so a long file needs a larger
// budget than this default.
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 600000;

// A public sample, served directly by Google Cloud Storage with no redirect.
// Replace it with your own URL — a signed cloud-storage link, for instance.
const DEFAULT_AUDIO_URI = 'https://storage.googleapis.com/cloud-samples-data/speech/brooklyn_bridge.wav';

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
 * Submit an asynchronous transcription job that names the audio by URL.
 *
 * @param {string} audioUri - https URL serving the audio directly (WAV, MP3, FLAC, OGG, etc.)
 * @param {Object} options - Optional transcribeConfig overrides
 * @param {string} apiKey - API key for authentication
 * @returns {Promise<Object>} The operation, whose "name" identifies the job
 */
async function submit(audioUri, options, apiKey) {
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
        body: JSON.stringify({ transcribeConfig, audioUri })
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
    console.log('Inworld STT Async Transcription - audio named by URL');
    console.log('='.repeat(60));

    const apiKey = checkApiKey();
    if (!apiKey) return 1;

    const audioUri = process.argv[2] || DEFAULT_AUDIO_URI;
    if (!audioUri.startsWith('https://')) {
        console.log(`Error: the audio URL must be https: ${audioUri}`);
        console.log('Usage: node example_stt_async_uri.js [https://host/path/audio.wav]');
        console.log(`Default: ${DEFAULT_AUDIO_URI}`);
        return 1;
    }

    try {
        console.log(`Audio URL: ${audioUri}`);
        console.log('Submitting...');
        const start = Date.now();

        let operation = await submit(audioUri, {}, apiKey);
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
