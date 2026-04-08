#!/usr/bin/env node
/**
 * Example script for Inworld STT transcription from the microphone.
 *
 * This script demonstrates how to capture live microphone input and stream it
 * to the STT WebSocket API for real-time transcription.
 */

const { spawn } = require('child_process');
const WebSocket = require('ws');
try { require('dotenv').config(); } catch (_) {}

const API_BASE = 'https://api.inworld.ai';
const SAMPLE_RATE = 16000;
const CHANNELS = 1;
const CHUNK_DURATION_MS = 100;

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
 * Try to find sox or rec (SoX) on the system.
 * @returns {string} 'sox' or 'rec' or null
 */
function findSox() {
    const { execSync } = require('child_process');
    const which = process.platform === 'win32' ? 'where' : 'which';
    try {
        execSync(`${which} sox`, { stdio: 'ignore' });
        return 'sox';
    } catch (_) {}
    try {
        execSync(`${which} rec`, { stdio: 'ignore' });
        return 'rec';
    } catch (_) {}
    return null;
}

/**
 * Start streaming microphone PCM and send to STT WebSocket.
 * @param {string} apiKey
 * @param {Object} options - Optional: modelId, language
 * @returns {Promise<{ finalTexts: string[] }>}
 */
function streamMicToStt(apiKey, options = {}) {
    const soxCmd = findSox();
    if (!soxCmd) {
        return Promise.reject(new Error(
            'SoX not found. Install it and ensure it is in PATH (e.g. brew install sox on macOS).'
        ));
    }

    const wsUrl = API_BASE.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
    const url = `${wsUrl}/stt/v1/transcribe:streamBidirectional`;
    const headers = { Authorization: `Basic ${apiKey}` };

    const modelId = options.modelId || 'inworld/inworld-stt-1';
    const finalTexts = [];
    let lastPartial = '';

    const bytesPerSample = 2 * CHANNELS;
    const chunkSize = Math.floor((CHUNK_DURATION_MS / 1000) * SAMPLE_RATE * bytesPerSample);

    return new Promise((resolve, reject) => {
        const ws = new WebSocket(url, { headers });
        let micProcess = null;
        let chunkBuffer = Buffer.alloc(0);

        ws.on('error', (err) => {
            console.log(`WebSocket error: ${err.message}`);
            reject(err);
        });

        ws.on('open', () => {
            const config = {
                modelId,
                audioEncoding: 'LINEAR16',
                sampleRateHertz: SAMPLE_RATE,
                numberOfChannels: CHANNELS
            };
            if (options.language) config.language = options.language;
            ws.send(JSON.stringify({ transcribeConfig: config }));

            const isDarwin = process.platform === 'darwin';
            const isLinux = process.platform === 'linux';
            const soxInput = isDarwin ? 'coreaudio' : (isLinux ? 'alsa' : 'waveaudio');
            const soxArgs = [
                '-q',
                '-t', soxInput,
                '-d',
                '-r', String(SAMPLE_RATE),
                '-c', String(CHANNELS),
                '-e', 'signed-integer',
                '-b', '16',
                '-t', 'raw',
                '-'
            ];

            micProcess = spawn(soxCmd, soxArgs, { stdio: ['ignore', 'pipe', 'pipe'] });

            micProcess.stdout.on('data', (data) => {
                if (ws.readyState !== WebSocket.OPEN) return;
                chunkBuffer = Buffer.concat([chunkBuffer, data]);
                while (chunkBuffer.length >= chunkSize) {
                    const chunk = chunkBuffer.subarray(0, chunkSize);
                    chunkBuffer = chunkBuffer.subarray(chunkSize);
                    ws.send(JSON.stringify({
                        audioChunk: { content: chunk.toString('base64') }
                    }));
                }
            });

            micProcess.stderr.on('data', (d) => {
                const s = d.toString().trim();
                if (s && !s.includes('overrun')) console.error('SoX:', s);
            });

            micProcess.on('error', (err) => {
                console.log(`Microphone error: ${err.message}`);
            });

            micProcess.on('exit', () => {
                // Flush remaining buffered audio
                if (chunkBuffer.length > 0 && ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({
                        audioChunk: { content: chunkBuffer.toString('base64') }
                    }));
                    chunkBuffer = Buffer.alloc(0);
                }
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ closeStream: {} }));
                }
            });
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
            const fullParts = lastPartial.trim() ? [...finalTexts, lastPartial.trim()] : finalTexts;
            resolve({ finalTexts: fullParts });
        });

        function stopMic() {
            if (micProcess) {
                try { micProcess.kill('SIGTERM'); } catch (_) {}
                micProcess = null;
            }
        }

        process.on('SIGINT', () => {
            console.log('\nStopping...');
            stopMic();
        });
        process.on('SIGTERM', stopMic);
    });
}

async function main() {
    console.log('Inworld STT: real-time transcription from microphone');
    console.log('='.repeat(50));
    console.log('Speak into your microphone. Press Ctrl+C to stop.\n');

    const apiKey = checkApiKey();
    if (!apiKey) return 1;

    try {
        const { finalTexts } = await streamMicToStt(apiKey);
        console.log('\nFull transcript:', finalTexts.join(' ').trim() || '(none)');
    } catch (err) {
        console.log(`Error: ${err.message}`);
        return 1;
    }
    return 0;
}

if (require.main === module) {
    main().then(process.exit);
}

module.exports = { streamMicToStt, checkApiKey, findSox };
