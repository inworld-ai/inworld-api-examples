#!/usr/bin/env node
/**
 * Example script for Inworld STT streaming transcription using WebSocket.
 *
 * This script demonstrates how to stream audio from a WAV file to the STT
 * WebSocket API for real-time transcription. For raw PCM input use example_stt_websocket_pcm.js.
 */

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
try { require('dotenv').config(); } catch (_) {}

const API_BASE = 'https://api.inworld.ai';
const CHUNK_DURATION_MS = 100;
/** Wait this long after the last audio chunk before endTurn/closeStream so the server can process trailing samples (fixes missing last word). */
const END_OF_AUDIO_DELAY_MS = 350;
/** Wait this long after closeStream for final server messages before we close the socket. */
const CLOSE_GRACE_MS = 2500;

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
 * Read WAV file and return { sampleRate, channels, pcmBuffer }.
 * Assumes standard 44-byte header for 16-bit PCM.
 * @param {string} wavPath - Path to WAV file
 * @returns {{ sampleRate: number, channels: number, pcmBuffer: Buffer }}
 */
function readWavPcm(wavPath) {
    const buf = fs.readFileSync(wavPath);
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') {
        throw new Error('Not a valid WAV file (expected RIFF header)');
    }
    const sampleRate = buf.readUInt32LE(24);
    const channels = buf.readUInt16LE(22);
    const pcmBuffer = buf.subarray(44);
    return { sampleRate, channels, pcmBuffer };
}

/**
 * Stream transcribe a WAV file over WebSocket.
 * @param {string} wavPath - Path to WAV file
 * @param {string} apiKey - API key
 * @param {Object} options - Optional: modelId (default english), language
 * @returns {Promise<{ finalTexts: string[] }>}
 */
function streamTranscribe(wavPath, apiKey, options = {}) {
    const { sampleRate, channels, pcmBuffer } = readWavPcm(wavPath);
    const wsUrl = API_BASE.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
    const url = `${wsUrl}/stt/v1/transcribe:streamBidirectional`;
    const headers = { Authorization: `Basic ${apiKey}` };

    const modelId = options.modelId || 'assemblyai/universal-streaming-english';
    const finalTexts = [];
    /** Last partial transcript; if connection closes before [FINAL], we append this to the full transcript. */
    let lastPartial = '';

    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, { headers });

        ws.on('error', (err) => {
            console.log(`WebSocket error: ${err.message}`);
            reject(err);
        });

        ws.on('open', () => {
            ws.send(JSON.stringify({
                transcribeConfig: {
                    modelId,
                    audioEncoding: 'LINEAR16',
                    sampleRateHertz: sampleRate,
                    numberOfChannels: channels
                }
            }));

            const bytesPerSample = 2 * channels;
            const chunkSize = Math.floor((CHUNK_DURATION_MS / 1000) * sampleRate * bytesPerSample);

            (async () => {
                for (let offset = 0; offset < pcmBuffer.length; offset += chunkSize) {
                    const chunk = pcmBuffer.subarray(offset, offset + chunkSize);
                    if (chunk.length === 0) break;
                    ws.send(JSON.stringify({
                        audioChunk: { content: chunk.toString('base64') }
                    }));
                    await new Promise(r => setTimeout(r, CHUNK_DURATION_MS));
                }
                await new Promise(r => setTimeout(r, END_OF_AUDIO_DELAY_MS));
                ws.send(JSON.stringify({ endTurn: {} }));
                ws.send(JSON.stringify({ closeStream: {} }));
                // Server may not close the connection; close ourselves after a short grace period.
                setTimeout(() => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.close();
                    }
                }, CLOSE_GRACE_MS);
            })().catch(reject);
        });

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                const transcription = msg.result && msg.result.transcription;
                if (!transcription) return;
                const text = transcription.transcript || '';
                const isFinal = transcription.isFinal === true;
                const label = isFinal ? '[FINAL]' : '[interim]';
                if (text) {
                    console.log(`${label} ${text}`);
                    if (isFinal) {
                        finalTexts.push(text);
                        lastPartial = '';
                    } else {
                        lastPartial = text;
                    }
                }
            } catch (_) {}
        });

        ws.on('close', () => {
            // Include any trailing partial so the last sentence isn't lost if server never sent [FINAL]
            const fullParts = lastPartial.trim() ? [...finalTexts, lastPartial.trim()] : finalTexts;
            resolve({ finalTexts: fullParts });
        });
    });
}

/**
 * Main.
 */
async function main() {
    console.log('Inworld STT WebSocket Transcription Example (from WAV)');
    console.log('='.repeat(50));

    const apiKey = checkApiKey();
    if (!apiKey) return 1;

    const DEFAULT_AUDIO_PATH = path.join(__dirname, '..', 'tests-data', 'audio', 'test-audio.wav');
    const audioPath = process.argv[2] || DEFAULT_AUDIO_PATH;
    if (!fs.existsSync(audioPath)) {
        console.log(`Error: WAV file not found: ${audioPath}`);
        console.log('Usage: node example_stt_websocket.js [path/to/audio.wav]');
        console.log('Default: ../tests-data/audio/test-audio.wav');
        return 1;
    }

    try {
        console.log(`Audio file: ${audioPath}\n`);
        const { finalTexts } = await streamTranscribe(audioPath, apiKey);
        console.log('\nFull transcript:', finalTexts.join(' ').trim() || '(none)');
    } catch (err) {
        console.log(`WebSocket transcription failed: ${err.message}`);
        return 1;
    }
    return 0;
}

if (require.main === module) {
    main().then(process.exit);
}
