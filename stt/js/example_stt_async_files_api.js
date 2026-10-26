#!/usr/bin/env node
/**
 * Example script for Inworld STT asynchronous transcription of a stored file.
 *
 * Asynchronous transcription is for recordings too long to wait on. You hand
 * over a recording, receive a job, and collect the transcript when it finishes:
 *
 *   1. POST /v1/files                     -> upload the recording once
 *   2. POST /stt/v1/transcribe:async      -> an operation naming the job
 *   3. GET  /lro/v1alpha/{operation name} -> poll until done
 *   4. GET  {resultUri}                   -> the transcript document
 *
 * This script uploads the audio to the Files API first and then names it by id.
 * It is the handover to use when the same recording is transcribed more than
 * once — a second language, a different model, a re-run after a failure — since
 * the bytes are sent once and every later job is a small JSON request. For a
 * recording you transcribe once and discard, example_stt_async_file.js (whole
 * file in the request) is simpler; example_stt_async_uri.js sends no bytes at
 * all when the audio already lives somewhere reachable.
 *
 * What a stored file is:
 *
 *   - It belongs to the workspace your API key belongs to, and only that
 *     workspace can transcribe it.
 *   - It is write-only. You can list it and read its metadata, but the bytes
 *     cannot be downloaded again — the Files API is not general storage.
 *   - It expires. Seven days by default for audio; pass expires_after to ask
 *     for something else, from one hour to thirty days. A job started before it
 *     expires still finishes.
 *   - It counts against your workspace's file storage, so delete what you no
 *     longer need: DELETE /v1/files/{id}.
 *
 * Note the two JSON styles. The Files API is OpenAI-shaped and answers
 * snake_case (mime_type, created_at), naming the file itself "id"; the
 * transcription API is camelCase and takes that value as "fileId". That is not
 * a mistake in this script.
 *
 * Usage:
 *   node example_stt_async_files_api.js [path/to/audio.wav]
 */

try { require('dotenv').config(); } catch (_) {}

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://api.inworld.ai';

// How long to keep polling, and how long to wait between polls. A job takes
// roughly as long as a fraction of the recording, so a long file needs a larger
// budget than this default.
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
 * Upload a recording to the Files API and return the stored file.
 *
 * The type is read from the first bytes of the file, never from its name, so an
 * extension that lies about the contents changes nothing. Audio, video and
 * image types are accepted under this purpose; a video is stored whole and
 * transcription takes its audio track.
 *
 * The whole file is read into memory here, which keeps the example short. For
 * a recording large enough to mind that, upload it in parts instead:
 * POST /v1/uploads, then POST /v1/uploads/{id}/parts, then
 * POST /v1/uploads/{id}/complete, which answers the same file object.
 *
 * @param {string} audioPath - Path to the recording
 * @param {string} apiKey - API key for authentication
 * @param {number} [expiresAfterS] - Optional lifetime in seconds, 3600 to 2592000
 * @returns {Promise<Object>} The file object, whose "id" names it from now on
 */
async function uploadFile(audioPath, apiKey, expiresAfterS) {
    const form = new FormData();
    // purpose says what the file is for. user_data is the one that takes
    // media, and the one transcription reads.
    form.append('purpose', 'user_data');
    if (expiresAfterS != null) {
        // Both parts are required together; the anchor has one valid value.
        form.append('expires_after[anchor]', 'created_at');
        form.append('expires_after[seconds]', String(expiresAfterS));
    }
    form.append('file', new Blob([fs.readFileSync(audioPath)]), path.basename(audioPath));

    const response = await fetch(`${API_BASE}/v1/files`, {
        method: 'POST',
        // No Content-Type here: fetch sets it from the FormData, including the
        // multipart boundary, which a hand-written header would omit.
        headers: { 'Authorization': `Basic ${apiKey}` },
        body: form
    });

    if (!response.ok) throw await toError(response);
    return response.json();
}

/**
 * Submit an asynchronous transcription job that names a stored file.
 *
 * Nothing is uploaded here: the request is small whatever the recording's size,
 * so submitting is fast even for an hours-long file.
 *
 * @param {string} fileId - Id of a file in your workspace, as POST /v1/files answered it
 * @param {Object} options - Optional transcribeConfig overrides
 * @param {string} apiKey - API key for authentication
 * @returns {Promise<Object>} The operation, whose "name" identifies the job
 */
async function submit(fileId, options, apiKey) {
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
        body: JSON.stringify({ transcribeConfig, fileId })
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

    const response = operation.response || {};
    if (response.resultUri) {
        // The link carries its own authorization, so anyone holding it can read
        // the transcript until it expires. Treat it as you would the transcript.
        console.log(`\nTranscript link: ${response.resultUri}`);
    }
    if (response.expireTime) {
        console.log(`It expires at ${response.expireTime}. Keep your own copy to read it later.`);
    }
}

/**
 * Main.
 */
async function main() {
    console.log('Inworld STT Async Transcription - audio stored in the Files API');
    console.log('='.repeat(60));

    const apiKey = checkApiKey();
    if (!apiKey) return 1;

    const defaultAudioPath = path.join(__dirname, '..', 'tests-data', 'audio', 'test-audio.wav');
    const audioPath = process.argv[2] || defaultAudioPath;
    if (!fs.existsSync(audioPath)) {
        console.log(`Error: Audio file not found: ${audioPath}`);
        console.log('Usage: node example_stt_async_files_api.js [path/to/audio.wav]');
        console.log('Default: tests-data/audio/test-audio.wav');
        return 1;
    }

    try {
        const sizeMb = (fs.statSync(audioPath).size / (1024 * 1024)).toFixed(1);
        console.log(`Audio file: ${audioPath} (${sizeMb} MB)`);
        console.log('Uploading to the Files API...');
        const start = Date.now();

        const stored = await uploadFile(audioPath, apiKey);
        console.log(`Stored as ${stored.id} (${stored.mime_type}, expires at ${stored.expires_at})`);

        // From here the recording is named rather than sent. Submitting it
        // again — another language, another model — repeats only this step.
        console.log('Submitting...');
        let operation = await submit(stored.id, {}, apiKey);
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
        console.log(`The recording stays as ${stored.id} until it expires; ` +
            `delete it with DELETE /v1/files/${stored.id}.`);
    } catch (err) {
        console.log(`Transcription failed: ${err.message}`);
        return 1;
    }
    return 0;
}

if (require.main === module) {
    main().then(process.exit);
}
