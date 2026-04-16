#!/usr/bin/env node
/**
 * Example script for Inworld STT WebSocket transcription with voice profile detection.
 *
 * Streams raw LINEAR16 PCM over the STT WebSocket and receives transcription results
 * along with speaker voice characteristics (age, gender, emotion, vocal style, accent).
 * Audio must be 16 kHz, 1 channel. Default input: tests-data/audio/test-pcm-audio.pcm.
 */

const fs = require('fs');
const path = require('path');
const WebSocket = require('ws');
try { require('dotenv').config(); } catch (_) {}

const API_BASE = 'https://api.inworld.ai';
const CHUNK_DURATION_MS = 100;
const DEFAULT_SAMPLE_RATE = 16000;
const DEFAULT_CHANNELS = 1;

// Default voice profile configuration.
const DEFAULT_VOICE_PROFILE_TOP_N = 5;

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
 * Format voice profile data for display.
 * @param {Object} voiceProfile
 * @returns {string}
 */
function formatVoiceProfile(voiceProfile) {
    const categories = [
        ['Age', 'age'],
        ['Gender', 'gender'],
        ['Emotion', 'emotion'],
        ['Vocal Style', 'vocalStyle'],
        ['Accent', 'accent'],
    ];
    const lines = [];
    for (const [displayName, key] of categories) {
        const labels = voiceProfile[key];
        if (labels && labels.length > 0) {
            const items = labels.map(l => `${l.label} (${l.confidence.toFixed(2)})`).join(', ');
            lines.push(`  ${displayName}: ${items}`);
        }
    }
    return lines.length > 0 ? lines.join('\n') : '  (no data)';
}

/**
 * Stream transcribe raw PCM over WebSocket with voice profile detection.
 * @param {string} pcmPath - Path to raw LINEAR16 PCM file
 * @param {number} sampleRate - Sample rate in Hz
 * @param {number} channels - Number of channels
 * @param {string} apiKey - API key
 * @param {Object} options - Optional: modelId, voiceProfileTopN
 * @returns {Promise<{ finalTexts: string[] }>}
 */
function streamTranscribe(pcmPath, sampleRate, channels, apiKey, options = {}) {
    const pcmBuffer = fs.readFileSync(pcmPath);
    const wsUrl = API_BASE.replace(/^https:\/\//, 'wss://').replace(/^http:\/\//, 'ws://');
    const url = `${wsUrl}/stt/v1/transcribe:streamBidirectional`;
    const headers = { Authorization: `Basic ${apiKey}` };

    const modelId = options.modelId || 'inworld/inworld-stt-1';
    const voiceProfileTopN = options.voiceProfileTopN ?? DEFAULT_VOICE_PROFILE_TOP_N;

    const finalTexts = [];
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
                    numberOfChannels: channels,
                    language: 'en-US',
                    voiceProfileConfig: {
                        enableVoiceProfile: true,
                        topN: voiceProfileTopN,
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
                ws.send(JSON.stringify({ closeStream: {} }));
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

                const voiceProfile = transcription.voiceProfile;
                if (voiceProfile && isFinal) {
                    console.log(`Voice profile:\n${formatVoiceProfile(voiceProfile)}`);
                }
            } catch (_) {}
        });

        ws.on('close', () => {
            const fullParts = lastPartial.trim() ? [...finalTexts, lastPartial.trim()] : finalTexts;
            resolve({ finalTexts: fullParts });
        });
    });
}

async function main() {
    console.log('Inworld STT WebSocket Transcription with Voice Profile Example');
    console.log('='.repeat(60));

    const apiKey = checkApiKey();
    if (!apiKey) return 1;

    const DEFAULT_PCM_PATH = path.join(__dirname, '..', 'tests-data', 'audio', 'test-pcm-audio.pcm');
    const pcmPath = process.argv[2] || DEFAULT_PCM_PATH;
    const sampleRate = DEFAULT_SAMPLE_RATE;
    const channels = DEFAULT_CHANNELS;

    const voiceProfileTopN = DEFAULT_VOICE_PROFILE_TOP_N;

    if (!fs.existsSync(pcmPath)) {
        console.log(`Error: PCM file not found: ${pcmPath}`);
        console.log('Usage: node example_stt_with_voice_profile.js [pcm_file]');
        console.log('  Default: ../tests-data/audio/test-pcm-audio.pcm (16 kHz, 1 channel)');
        return 1;
    }

    try {
        console.log(`PCM file: ${pcmPath}`);
        console.log(`Sample rate: ${sampleRate} Hz, Channels: ${channels}`);
        console.log(`Voice profile: enabled, topN=${voiceProfileTopN}\n`);
        const { finalTexts } = await streamTranscribe(pcmPath, sampleRate, channels, apiKey, {
            voiceProfileTopN,
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
