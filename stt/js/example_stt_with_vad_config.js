#!/usr/bin/env node
/**
 * Example script for Inworld STT WebSocket transcription with VAD configuration.
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
// Client-side safety timeout, not an API latency guarantee.
const CLOSE_GRACE_MS = 10000;
const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_CHANNELS = 1;

// Example turn-detection settings, not server defaults.
// Raise the silence duration or end-of-turn confidence threshold to reduce
// premature turn boundaries. Raise vadThreshold to reject more background
// noise; lower it if quiet speech is being missed.
const DEFAULT_VAD_THRESHOLD = 0.3;
const DEFAULT_MIN_END_OF_TURN_SILENCE_WHEN_CONFIDENT = 300;
const DEFAULT_END_OF_TURN_CONFIDENCE_THRESHOLD = 0.4;

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
 * Stream transcribe raw PCM over WebSocket with VAD configuration.
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

    const modelId = options.modelId || 'inworld/inworld-stt-1';
    const vadThreshold = options.vadThreshold ?? DEFAULT_VAD_THRESHOLD;
    const minEndOfTurnSilenceWhenConfident = options.minEndOfTurnSilenceWhenConfident ?? DEFAULT_MIN_END_OF_TURN_SILENCE_WHEN_CONFIDENT;
    const endOfTurnConfidenceThreshold = options.endOfTurnConfidenceThreshold ?? DEFAULT_END_OF_TURN_CONFIDENCE_THRESHOLD;

    const finalTexts = [];
    let lastPartial = '';
    let closeTimeout = null;

    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, { headers });

        ws.on('error', (err) => {
            console.log(`WebSocket error: ${err.message}`);
            clearTimeout(closeTimeout);
            reject(err);
        });

        ws.on('open', () => {
            ws.send(JSON.stringify({
                transcribeConfig: {
                    modelId,
                    audioEncoding: 'LINEAR16',
                    sampleRateHertz: sampleRate,
                    numberOfChannels: channels,
                    language: 'en-US',
                    endOfTurnConfidenceThreshold,
                    inworldSttV1Config: {
                        vadThreshold,
                        minEndOfTurnSilenceWhenConfident,
                    },
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
                // closeStream finalizes pending audio; do not also send endTurn.
                ws.send(JSON.stringify({ closeStream: {} }));
                closeTimeout = setTimeout(() => {
                    reject(new Error('Timed out waiting for STT stream completion'));
                    ws.terminate();
                }, CLOSE_GRACE_MS);
            })().catch((err) => { reject(err); ws.terminate(); });
        });

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.error) {
                    reject(new Error(msg.error.message || 'STT request failed'));
                    ws.close();
                    return;
                }
                if (msg.result?.usage) console.log('Usage:', msg.result.usage);
                const transcription = msg.result && msg.result.transcription;
                if (!transcription) return;
                const text = transcription.transcript || '';
                const isFinal = transcription.isFinal === true;
                const label = isFinal ? '[FINAL]' : '[interim]';
                if (isFinal) lastPartial = '';
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

        ws.on('close', (code) => {
            clearTimeout(closeTimeout);
            if (code !== 1000) {
                reject(new Error(`STT socket closed with code ${code}`));
                return;
            }
            if (lastPartial.trim()) {
                reject(new Error('Stream ended with an unfinalized transcript'));
                return;
            }
            const fullParts = finalTexts;
            resolve({ finalTexts: fullParts });
        });
    });
}

async function main() {
    console.log('Inworld STT WebSocket Transcription with VAD Config Example');
    console.log('='.repeat(50));

    const apiKey = checkApiKey();
    if (!apiKey) return 1;

    const DEFAULT_PCM_PATH = path.join(__dirname, '..', 'tests-data', 'audio', 'test-pcm-audio.pcm');
    const pcmPath = process.argv[2] || DEFAULT_PCM_PATH;
    const sampleRate = DEFAULT_SAMPLE_RATE;
    const channels = DEFAULT_CHANNELS;

    if (!fs.existsSync(pcmPath)) {
        console.log(`Error: PCM file not found: ${pcmPath}`);
        console.log('Usage: node example_stt_with_vad_config.js [pcm_file]');
        console.log('  Default: ../tests-data/audio/test-pcm-audio.pcm (16 kHz, 1 channel)');
        return 1;
    }

    const vadThreshold = DEFAULT_VAD_THRESHOLD;
    const minEndOfTurnSilenceWhenConfident = DEFAULT_MIN_END_OF_TURN_SILENCE_WHEN_CONFIDENT;
    const endOfTurnConfidenceThreshold = DEFAULT_END_OF_TURN_CONFIDENCE_THRESHOLD;

    try {
        console.log(`PCM file: ${pcmPath}`);
        console.log(`Sample rate: ${sampleRate} Hz, Channels: ${channels}`);
        console.log(`VAD config: vadThreshold=${vadThreshold}, minEndOfTurnSilenceWhenConfident=${minEndOfTurnSilenceWhenConfident}ms, endOfTurnConfidenceThreshold=${endOfTurnConfidenceThreshold}\n`);
        const { finalTexts } = await streamTranscribe(pcmPath, sampleRate, channels, apiKey, {
            vadThreshold,
            minEndOfTurnSilenceWhenConfident,
            endOfTurnConfidenceThreshold,
        });
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
