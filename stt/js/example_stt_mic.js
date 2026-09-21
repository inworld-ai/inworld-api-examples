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
// Client-side safety timeout, not an API latency guarantee.
const CLOSE_GRACE_MS = 10000;

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
        let closed = false;
        let stopping = false;
        let closeTimeout = null;

        function finish(result) {
            if (closed) return;
            closed = true;
            clearTimeout(closeTimeout);
            process.off('SIGINT', stopStream);
            process.off('SIGTERM', stopStream);
            if (micProcess) {
                try { micProcess.kill('SIGTERM'); } catch (_) {}
                micProcess = null;
            }
            if (lastPartial.trim()) {
                reject(new Error('Stream ended with an unfinalized transcript'));
                return;
            }
            const fullParts = finalTexts;
            resolve(Object.assign(result || {}, { finalTexts: fullParts }));
        }

        ws.on('error', (err) => {
            console.log(`WebSocket error: ${err.message}`);
            reject(err);
            finish();
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
                reject(err);
                ws.terminate();
                finish();
            });

            // Register immediately: SoX can exit before the user requests a stop.
            // 'close' follows stdout drainage, so the final PCM chunk is available.
            micProcess.once('close', (code, signal) => {
                micProcess = null;
                if (closed) return;
                const requestedStop = stopping && (code === 143 || signal === 'SIGTERM');
                if (code !== 0 && !requestedStop) {
                    reject(new Error(`SoX exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
                    ws.terminate();
                    finish();
                    return;
                }
                stopping = true;
                closeInput();
            });
        });

        ws.on('message', (raw) => {
            try {
                const msg = JSON.parse(raw.toString());
                if (msg.result?.usage) console.log('Usage:', msg.result.usage);
                if (msg.error) {
                    reject(new Error(msg.error.message || 'STT request failed'));
                    ws.close();
                    return;
                }
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
            if (code !== 1000) reject(new Error(`STT socket closed with code ${code}`));
            finish();
        });

        function closeInput() {
            if (ws.readyState !== WebSocket.OPEN) return;
            if (chunkBuffer.length > 0) {
                ws.send(JSON.stringify({
                    audioChunk: { content: chunkBuffer.toString('base64') }
                }));
                chunkBuffer = Buffer.alloc(0);
            }
            // closeStream also finalizes the pending turn.
            ws.send(JSON.stringify({ closeStream: {} }));
            closeTimeout = setTimeout(() => {
                reject(new Error('Timed out waiting for STT stream completion'));
                ws.terminate();
                finish();
            }, CLOSE_GRACE_MS);
        }

        function stopStream() {
            if (closed || stopping) return;
            stopping = true;
            if (micProcess) {
                // Wait for stdout to drain, including the last partial PCM chunk.
                micProcess.kill('SIGTERM');
            } else if (ws.readyState === WebSocket.OPEN) {
                closeInput();
            } else {
                ws.close();
            }
        }

        process.on('SIGINT', stopStream);
        process.on('SIGTERM', stopStream);
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
