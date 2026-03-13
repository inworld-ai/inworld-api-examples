#!/usr/bin/env node
/**
 * Example script for Inworld STT WebSocket transcription from a PCM file.
 *
 * Sends raw LINEAR16 PCM over the STT WebSocket. Audio must be 16 kHz, 1 channel.
 * Default input: tests-data/audio/test-pcm-audio.pcm.
 */

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
try { require('dotenv').config(); } catch (_) {}

const API_BASE = 'https://api.inworld.ai';
const CHUNK_DURATION_MS = 100;
/** Delay after last audio chunk before endTurn so the server can process trailing samples. */
const END_OF_AUDIO_DELAY_MS = 350;
/** After endTurn, wait this long with no new message before sending closeStream (so server can send all finals including last word). */
const SILENCE_BEFORE_CLOSE_MS = 1500;
const CLOSE_GRACE_MS = 2500;
const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_CHANNELS = 1;

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
 * Stream transcribe raw PCM over WebSocket.
 * @param {string} pcmPath - Path to raw LINEAR16 PCM file
 * @param {number} sampleRate - Sample rate in Hz
 * @param {number} channels - Number of channels
 * @param {string} apiKey - API key
 * @param {Object} options - Optional: modelId
 * @returns {Promise<{ finalTexts: string[] }>}
 */
function streamTranscribe(pcmPath, sampleRate, channels, apiKey, options = {}) {
    const pcmBuffer = fs.readFileSync(pcmPath);
    const wsUrl = API_BASE.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
    const url = `${wsUrl}/stt/v1/transcribe:streamBidirectional`;
    const headers = { Authorization: `Basic ${apiKey}` };

    const modelId = options.modelId || 'assemblyai/universal-streaming-english';
    const finalTexts = [];
    let lastPartial = '';
    let audioComplete = false;
    let silenceTimeout = null;

    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, { headers });

        function checkClose() {
            if (!audioComplete) return;
            if (silenceTimeout) clearTimeout(silenceTimeout);
            silenceTimeout = setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ closeStream: {} }));
                    setTimeout(() => {
                        if (ws.readyState === WebSocket.OPEN) ws.close();
                    }, CLOSE_GRACE_MS);
                }
            }, SILENCE_BEFORE_CLOSE_MS);
        }

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
                    numberOfChannels: channels,
                    language: 'en-US'
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
                audioComplete = true;
                ws.send(JSON.stringify({ endTurn: {} }));
                checkClose(); // start timer; send closeStream only after no message for SILENCE_BEFORE_CLOSE_MS
            })().catch(reject);
        });

        ws.on('message', (raw) => {
            if (silenceTimeout) clearTimeout(silenceTimeout);
            silenceTimeout = null;

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

            if (audioComplete) checkClose();
        });

        ws.on('close', () => {
            const fullParts = lastPartial.trim() ? [...finalTexts, lastPartial.trim()] : finalTexts;
            resolve({ finalTexts: fullParts });
        });
    });
}

async function main() {
    console.log('Inworld STT WebSocket Transcription Example');
    console.log('='.repeat(50));

    const apiKey = checkApiKey();
    if (!apiKey) return 1;

    const DEFAULT_PCM_PATH = path.join(__dirname, '..', 'tests-data', 'audio', 'test-pcm-audio.pcm');
    const pcmPath = process.argv[2] || DEFAULT_PCM_PATH;
    const sampleRate = DEFAULT_SAMPLE_RATE;
    const channels = DEFAULT_CHANNELS;

    if (!fs.existsSync(pcmPath)) {
        console.log(`Error: PCM file not found: ${pcmPath}`);
        console.log('Usage: node example_stt_websocket.js [pcm_file]');
        console.log('  Default: ../tests-data/audio/test-pcm-audio.pcm (16 kHz, 1 channel)');
        return 1;
    }

    try {
        console.log(`PCM file: ${pcmPath}`);
        console.log(`Sample rate: ${sampleRate} Hz, Channels: ${channels}\n`);
        const { finalTexts } = await streamTranscribe(pcmPath, sampleRate, channels, apiKey);
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
