#!/usr/bin/env node
/**
 * Example script for Inworld TTS synthesis using WebSocket connections.
 *
 * This script demonstrates how to synthesize speech from text using the Inworld TTS API
 * with WebSocket connections for real-time streaming audio synthesis.
 */

const fs = require('fs');
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
 * Stream TTS audio using multi-request context flow over WebSocket.
 * Sends a sequence of messages (create/send_text/close_context) and yields
 * Raw PCM16 little-endian audio bytes at 24 kHz as they arrive.
 * 
 * @param {string} apiKey - API key for authentication
 * @param {Array} requests - Array of request objects
 * @param {string} websocketUrl - WebSocket URL
 * @returns {AsyncGenerator<Buffer>} Audio chunks
 */
async function* streamTtsWithContext(
    apiKey,
    requests,
    websocketUrl = 'wss://api.inworld.ai/tts/v1/voice:streamBidirectional'
) {
    const headers = {
        'Authorization': `Basic ${apiKey}`
    };

    try {
        console.log(` Connecting to WebSocket: ${websocketUrl}`);
        const startTime = Date.now();
        
        const ws = new WebSocket(websocketUrl, { headers });
        
        // Wait for connection to open
        await new Promise((resolve, reject) => {
            ws.on('open', resolve);
            ws.on('error', reject);
        });

        console.log('WebSocket connection established');
        console.log(`Connection established in ${((Date.now() - startTime) / 1000).toFixed(2)} seconds`);

        // Send the sequence of context-aware requests
        for (const req of requests) {
            ws.send(JSON.stringify(req));
        }

        console.log('Receiving audio chunks:');
        let chunkCount = 0;
        let totalAudioSize = 0;
        let firstChunkTime = null;
        const recvStart = Date.now();

        // Process messages
        for await (const message of asyncIterateWebSocket(ws)) {
            try {
                const response = JSON.parse(message.toString());

                // Handle server errors
                if (response.error) {
                    const errorMsg = response.error.message || 'Unknown error';
                    console.log(`Server error: ${errorMsg}`);
                    break;
                }

                const result = response.result;
                if (!result) {
                    // Non-result informational message
                    if (response.done) {
                        console.log('Synthesis completed (done=true)');
                        break;
                    }
                    continue;
                }

                // Check for context close confirmation
                if (result.contextClosed) {
                    console.log('Context closed confirmation received');
                    break;
                }

                // Status updates
                if (result.status) {
                    console.log(`Status: ${result.status}`);
                }

                // Audio chunk (new protocol)
                if (result.audioChunk) {
                    const audioChunkObj = result.audioChunk;
                    // Some servers may return either nested audioContent or top-level
                    const b64Content = audioChunkObj.audioContent || result.audioContent;
                    if (b64Content) {
                        const audioBytes = Buffer.from(b64Content, 'base64');
                        chunkCount++;
                        totalAudioSize += audioBytes.length;
                        if (chunkCount === 1) {
                            firstChunkTime = (Date.now() - recvStart) / 1000;
                            console.log(`   Time to first chunk: ${firstChunkTime.toFixed(2)} seconds`);
                        }
                        console.log(`   Chunk ${chunkCount}: ${audioBytes.length} bytes`);
                        yield audioBytes;
                    }

                    // Optional timestamp info
                    const tsInfo = audioChunkObj.timestampInfo;
                    if (tsInfo !== undefined) {
                        // Print a compact summary (count if array, else object keys)
                        if (Array.isArray(tsInfo)) {
                            console.log(`    Timestamps: ${tsInfo.length} entries`);
                        } else if (typeof tsInfo === 'object' && tsInfo !== null) {
                            console.log(`    Timestamp fields: ${Object.keys(tsInfo).join(', ')}`);
                        }
                    }
                }

            } catch (error) {
                if (error instanceof SyntaxError) {
                    console.log(`   JSON decode error: ${error.message}`);
                    continue;
                } else {
                    console.log(`   Missing key in response: ${error.message}`);
                    continue;
                }
            }
        }

        console.log(`\nStream finished. Total chunks: ${chunkCount}, total bytes: ${totalAudioSize}`);
        
        ws.close();

    } catch (error) {
        if (error.code === 'ECONNRESET' || error.code === 'ECONNREFUSED') {
            console.log(`WebSocket connection closed unexpectedly: ${error.message}`);
        } else {
            console.log(`WebSocket error: ${error.message}`);
        }
        throw error;
    }
}

/**
 * Convert WebSocket to async iterator.
 * @param {WebSocket} ws - WebSocket instance
 * @returns {AsyncGenerator} Message generator
 */
async function* asyncIterateWebSocket(ws) {
    const messageQueue = [];
    let resolveNext = null;
    let finished = false;

    ws.on('message', (data) => {
        if (resolveNext) {
            resolveNext({ value: data, done: false });
            resolveNext = null;
        } else {
            messageQueue.push(data);
        }
    });

    ws.on('close', () => {
        finished = true;
        if (resolveNext) {
            resolveNext({ value: undefined, done: true });
            resolveNext = null;
        }
    });

    ws.on('error', (error) => {
        finished = true;
        if (resolveNext) {
            resolveNext(Promise.reject(error));
            resolveNext = null;
        }
    });

    while (!finished) {
        if (messageQueue.length > 0) {
            yield messageQueue.shift();
        } else {
            const next = await new Promise((resolve) => {
                resolveNext = resolve;
            });
            if (next.done) {
                break;
            }
            yield next.value;
        }
    }
}

/**
 * Wrap the PCM16 WebSocket audio in a WAV file (24 kHz, mono).
 * @param {AsyncGenerator<Buffer>} audioChunksGenerator - Audio chunks generator
 * @param {string} outputFile - Output file path
 */
async function saveWebsocketAudioToFile(audioChunksGenerator, outputFile) {
    try {
        console.log(`Saving audio chunks to: ${outputFile}`);

        const audioData = [];
        let chunkCount = 0;

        for await (const chunk of audioChunksGenerator) {
            chunkCount++;
            audioData.push(chunk);
        }

        const pcmData = Buffer.concat(audioData);
        // A single WAV header describes all PCM chunks in the saved file.
        const header = Buffer.alloc(44);
        header.write('RIFF', 0);
        header.writeUInt32LE(36 + pcmData.length, 4);
        header.write('WAVE', 8);
        header.write('fmt ', 12);
        header.writeUInt32LE(16, 16); // PCM format chunk size
        header.writeUInt16LE(1, 20); // PCM format
        header.writeUInt16LE(1, 22); // Mono
        header.writeUInt32LE(24000, 24); // Sample rate
        header.writeUInt32LE(24000 * 2, 28); // Bytes per second
        header.writeUInt16LE(2, 32); // Bytes per sample frame
        header.writeUInt16LE(16, 34); // Bits per sample
        header.write('data', 36);
        header.writeUInt32LE(pcmData.length, 40);
        fs.writeFileSync(outputFile, Buffer.concat([header, pcmData]));

        console.log(`Audio saved successfully! Processed ${chunkCount} chunks`);

    } catch (error) {
        console.log(`Error saving audio file: ${error.message}`);
        throw error;
    }
}

/**
 * Synthesize speech via WebSocket multi-request flow and save to a WAV file.
 * @param {string} apiKey - API key
 * @param {Array} requests - Request array
 * @param {string} outputFile - Output file path
 */
async function synthesizeAndSaveWithContext(apiKey, requests, outputFile) {
    const audioGenerator = streamTtsWithContext(apiKey, requests);
    await saveWebsocketAudioToFile(audioGenerator, outputFile);
}

/**
 * Main function to demonstrate WebSocket TTS synthesis.
 */
async function main() {
    console.log('Inworld TTS WebSocket Synthesis (Context Flow) Example');
    console.log('=' + '='.repeat(49));
    
    // Check API key
    const apiKey = checkApiKey();
    if (!apiKey) {
        return 1;
    }
    
    // Example multi-request flow sharing a single context
    const outputFile = 'synthesis_websocket_output.wav';
    const text = "Hello, adventurer! What a beautiful day, isn't it? Let's explore together";
    // Simulate incremental LLM output; the server detects sentence boundaries.
    const fragments = text.match(/\s*\S+\s*/g) || [];
    const requests = [
        {
            context_id: 'ctx-1',
            create: {
                voice_id: 'Hana',
                model_id: 'inworld-tts-2', // SENTENCE_BOUNDARY supports inworld-tts-2 and inworld-tts-2-flash.
                autoMode: true,
                autoModeStrategy: 'SENTENCE_BOUNDARY',
                audio_config: {
                    audio_encoding: 'PCM',
                    sample_rate_hertz: 24000
                }
            }
        },
        ...fragments.map(fragment => ({
            context_id: 'ctx-1',
            send_text: {
                text: fragment
            }
        })),
        // Closing releases any remaining text, including an unfinished sentence.
        {
            context_id: 'ctx-1',
            close_context: {}
        }
    ];
    
    try {
        const startTime = Date.now();
        
        await synthesizeAndSaveWithContext(apiKey, requests, outputFile);
        
        const totalTime = (Date.now() - startTime) / 1000;
        console.log(`Total synthesis time: ${totalTime.toFixed(2)} seconds`);
        console.log(`WebSocket synthesis completed successfully! Audio file saved: ${outputFile}`);
        
    } catch (error) {
        console.log(`\nWebSocket synthesis failed: ${error.message}`);
        return 1;
    }
    
    return 0;
}

if (require.main === module) {
    main().then(process.exit);
}
