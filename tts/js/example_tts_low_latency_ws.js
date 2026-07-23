#!/usr/bin/env node
/**
 * Example script for low-latency TTS synthesis using WebSocket.
 *
 * This script demonstrates how to achieve the lowest possible time-to-first-byte (TTFB)
 * with WebSocket by pre-establishing the connection and pipelining messages.
 *
 * Key technique: Send the context create message and text back-to-back without
 * waiting for the contextCreated acknowledgment. The server processes messages
 * in order, so waiting for the ack only adds a network round trip. TTFB is
 * measured from the create message to first audio chunk arrival.
 */

const WebSocket = require('ws');
try { require('dotenv').config(); } catch (_) {}

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
 * Measure low-latency TTS using WebSocket with pipelined messages.
 *
 * Sends context create and text back-to-back without waiting for the
 * contextCreated acknowledgment, sending text sentence-by-sentence with
 * flush_context on each for lowest time-to-first-byte.
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
            // Send create, text, and close back-to-back without waiting for
            // the contextCreated acknowledgment. Messages are processed in
            // order on the server, so waiting for the ack only adds a full
            // network round trip before the first audio chunk.
            startTime = Date.now();

            ws.send(JSON.stringify({
                context_id: contextId,
                create: {
                    voice_id: voiceId,
                    model_id: modelId,
                    audio_config: {
                        audio_encoding: 'PCM',
                        sample_rate_hertz: 24000,
                        bit_rate: 32000
                    }
                }
            }));

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

                if (!result) {
                    if (data.done) {
                        const totalTime = (Date.now() - startTime) / 1000;
                        finish({ ttfb, totalTime, audioBytes: totalAudioBytes });
                    }
                    return;
                }

                // Audio chunk - base64-encoded PCM
                if (result.audioChunk) {
                    const b64Content = result.audioChunk.audioContent;
                    if (b64Content) {
                        const audioChunk = Buffer.from(b64Content, 'base64');
                        if (ttfb === null) {
                            ttfb = (Date.now() - startTime) / 1000;
                        }
                        totalAudioBytes += audioChunk.length;
                    }
                }

                // Context closed - all audio received
                if (result.contextClosed !== undefined) {
                    const totalTime = (Date.now() - startTime) / 1000;
                    finish({ ttfb, totalTime, audioBytes: totalAudioBytes });
                    return;
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
    const voiceId = 'Clive';
    const modelId = 'inworld-tts-2'; // newest default; supports deliveryMode and language. Use 'inworld-tts-1.5-mini' for the fastest legacy model.

    console.log(`   Text: "${text}"`);
    console.log(`  Voice: ${voiceId}`);
    console.log(`  Model: ${modelId}`);
    console.log('\nConnecting, then generating audio...\n');

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
