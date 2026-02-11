#!/usr/bin/env node
/**
 * Example script for low-latency TTS synthesis using HTTP streaming.
 *
 * This script demonstrates how to achieve the lowest possible time-to-first-byte (TTFB)
 * with HTTP streaming by warming up the connection before timing synthesis.
 *
 * Key technique: Use a warmup request to pre-establish the TCP+TLS connection,
 * then measure only the synthesis latency on the reused connection.
 */

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
 * Measure low-latency TTS using HTTP streaming with connection warmup.
 *
 * Uses a warmup request to pre-establish the TCP+TLS connection,
 * then measures TTFB from the actual synthesis request only.
 *
 * @param {string} apiKey - API key for authentication
 * @param {string} text - Text to synthesize
 * @param {string} voiceId - Voice ID to use
 * @param {string} modelId - Model ID to use
 * @returns {Object|null} Latency metrics {ttfb, totalTime, audioBytes} or null on error
 */
async function httpStreamingTts(apiKey, text, voiceId, modelId) {
    const url = 'https://api.inworld.ai/tts/v1/voice:stream';

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${apiKey}`,
        'Connection': 'keep-alive'
    };

    const requestData = {
        text: text,
        voice_id: voiceId,
        model_id: modelId,
        audio_config: {
            audio_encoding: 'OGG_OPUS',
            sample_rate_hertz: 24000,
            bit_rate: 32000
        }
    };

    try {
        // Warmup: establish TCP+TLS connection before timing
        const warmupData = {
            text: 'hi',
            voice_id: voiceId,
            model_id: modelId,
            audio_config: {
                audio_encoding: 'OGG_OPUS',
                sample_rate_hertz: 24000,
                bit_rate: 32000
            }
        };

        const warmupResponse = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(warmupData)
        });

        // Fully consume warmup response so the connection is returned to the pool
        await warmupResponse.arrayBuffer();

        // Start timer - connection already established
        const startTime = Date.now();
        let ttfb = null;
        let totalAudioBytes = 0;

        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestData)
        });

        if (!response.ok) {
            let errorDetails = '';
            try {
                errorDetails = await response.text();
            } catch {}
            console.log(`HTTP Error: ${response.status} - ${errorDetails}`);
            return null;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const chunkData = JSON.parse(line);
                        const result = chunkData.result;
                        if (result && result.audioContent) {
                            const audioChunk = Buffer.from(result.audioContent, 'base64');
                            if (ttfb === null) {
                                ttfb = (Date.now() - startTime) / 1000;
                            }
                            totalAudioBytes += audioChunk.length;
                        }
                    } catch {
                        continue;
                    }
                }
            }
        }

        const totalTime = (Date.now() - startTime) / 1000;
        return { ttfb, totalTime, audioBytes: totalAudioBytes };

    } catch (error) {
        console.log(`HTTP Error: ${error.message}`);
        return null;
    }
}

/**
 * Main function to demonstrate low-latency HTTP streaming TTS.
 */
async function main() {
    console.log('Inworld TTS Low-Latency HTTP Streaming');
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
    console.log('\nWarming up connection, then generating audio...\n');

    try {
        const result = await httpStreamingTts(apiKey, text, voiceId, modelId);

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
