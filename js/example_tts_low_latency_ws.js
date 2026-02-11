#!/usr/bin/env node
/**
 * Example script for low-latency TTS synthesis using WebSocket.
 *
 * This script demonstrates how to achieve the lowest possible time-to-first-byte (TTFB)
 * with WebSocket by pre-establishing the connection and audio context before timing.
 *
 * Key technique: Connect and create the audio context ahead of time, then measure
 * only from text submission to first audio chunk arrival.
 */

const WebSocket = require('ws');

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
 * Split text into sentences using common end-of-sentence markers across languages.
 * Handles: . ! ? 。 ！ ？ । ؟ ۔
 *
 * @param {string} text - Text to split
 * @returns {string[]} Array of sentences
 */
function splitSentences(text) {
    const regex = /[^.!?。！？।؟۔]*[.!?。！？।؟۔]+[\s]*/g;
    const sentences = [];
    let match;
    let lastIndex = 0;
    while ((match = regex.exec(text)) !== null) {
        const s = match[0].trim();
        if (s) sentences.push(s);
        lastIndex = regex.lastIndex;
    }
    const remaining = text.slice(lastIndex).trim();
    if (remaining) sentences.push(remaining);
    return sentences;
}

/**
 * Measure low-latency TTS using WebSocket with pre-established context.
 *
 * Connects and creates the audio context before starting the timer,
 * then sends text sentence-by-sentence with flush_context on each
 * for lowest time-to-first-byte.
 *
 * @param {string} apiKey - API key for authentication
 * @param {string} text - Text to synthesize
 * @param {string} voiceId - Voice ID to use
 * @param {string} modelId - Model ID to use
 * @returns {Object|null} Latency metrics {ttfb, totalTime, audioBytes} or null on error
 */
async function websocketTts(apiKey, text, voiceId, modelId) {
    const url = 'wss://api.inworld.ai/tts/v1/voice:streamBidirectional';
    const headers = { 'Authorization': `Basic ${apiKey}` };
    const contextId = 'ctx-latency-test';

    return new Promise((resolve) => {
        const ws = new WebSocket(url, { headers });
        let contextReady = false;
        let startTime = null;
        let ttfb = null;
        let totalAudioBytes = 0;
        let resolved = false;

        function finish(result) {
            if (!resolved) {
                resolved = true;
                ws.close();
                resolve(result);
            }
        }

        ws.on('error', (error) => {
            console.log(`WebSocket error: ${error.message}`);
            finish(null);
        });

        ws.on('open', () => {
            // Create context (not timed - this is setup)
            ws.send(JSON.stringify({
                context_id: contextId,
                create: {
                    voice_id: voiceId,
                    model_id: modelId,
                    audio_config: {
                        audio_encoding: 'OGG_OPUS',
                        sample_rate_hertz: 24000,
                        bit_rate: 32000
                    }
                }
            }));
        });

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message.toString());

                if (data.error) {
                    console.log(`WebSocket error: ${JSON.stringify(data.error)}`);
                    finish(null);
                    return;
                }

                const result = data.result;

                // Wait for context creation confirmation
                if (!contextReady) {
                    if (result && result.contextCreated !== undefined) {
                        contextReady = true;

                        // Start timer - context ready, measure synthesis only
                        startTime = Date.now();

                        // Send text sentence-by-sentence, flushing each for lowest TTFB
                        const sentences = splitSentences(text);
                        for (const sentence of sentences) {
                            ws.send(JSON.stringify({
                                context_id: contextId,
                                send_text: {
                                    text: sentence,
                                    flush_context: {}
                                }
                            }));
                        }
                        ws.send(JSON.stringify({
                            context_id: contextId,
                            close_context: {}
                        }));
                    }
                    return;
                }

                if (!result) {
                    if (data.done) {
                        const totalTime = (Date.now() - startTime) / 1000;
                        finish({ ttfb, totalTime, audioBytes: totalAudioBytes });
                    }
                    return;
                }

                // Context closed - all audio received
                if (result.contextClosed !== undefined) {
                    const totalTime = (Date.now() - startTime) / 1000;
                    finish({ ttfb, totalTime, audioBytes: totalAudioBytes });
                    return;
                }

                // Audio chunk
                if (result.audioChunk) {
                    const b64Content = result.audioChunk.audioContent;
                    if (b64Content) {
                        if (ttfb === null) {
                            ttfb = (Date.now() - startTime) / 1000;
                        }
                        const audioBytes = Buffer.from(b64Content, 'base64');
                        totalAudioBytes += audioBytes.length;
                    }
                }

            } catch {
                // JSON parse error, continue
            }
        });

        ws.on('close', () => {
            finish(null);
        });
    });
}

/**
 * Main function to demonstrate low-latency WebSocket TTS.
 */
async function main() {
    console.log('Inworld TTS Low-Latency WebSocket');
    console.log('=' + '='.repeat(44));

    // Check API key
    const apiKey = checkApiKey();
    if (!apiKey) {
        return 1;
    }

    // Configuration
    const text = "Life moves pretty fast. Look around once in a while, or you might miss it.";
    const voiceId = 'Dennis';
    const modelId = 'inworld-tts-1.5-mini';

    console.log(`   Text: "${text}"`);
    console.log(`  Voice: ${voiceId}`);
    console.log(`  Model: ${modelId}`);
    console.log('\nConnecting and creating context, then generating audio...\n');

    try {
        const result = await websocketTts(apiKey, text, voiceId, modelId);

        if (result) {
            console.log(`TTFB:         ${(result.ttfb * 1000).toFixed(1)} ms`);
            console.log(`Total time:   ${(result.totalTime * 1000).toFixed(1)} ms`);
            console.log(`Audio bytes:  ${result.audioBytes}`);
        } else {
            console.log('Synthesis failed.');
            return 1;
        }

    } catch (error) {
        console.log(`\nLatency test failed: ${error.message}`);
        return 1;
    }

    return 0;
}

if (require.main === module) {
    main().then(process.exit);
}
