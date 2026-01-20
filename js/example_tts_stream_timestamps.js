#!/usr/bin/env node
/**
 * Example script for Inworld TTS streaming synthesis with timestamp data.
 *
 * This script demonstrates how to synthesize speech using the Inworld TTS streaming API
 * while retrieving word timestamps, phoneme data, and viseme data.
 */

const fs = require('fs');

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
 * Create a copy of the response object with truncated audio content for readable logging.
 * @param {Object} responseObj - The API response object
 * @param {number} maxLength - Maximum length for the audio content string
 * @returns {Object} Copy of response with truncated audioContent
 */
function truncateAudioForLogging(responseObj, maxLength = 100) {
    const result = JSON.parse(JSON.stringify(responseObj)); // Deep copy
    if (result.audioContent) {
        const audioStr = result.audioContent;
        if (audioStr.length > maxLength) {
            result.audioContent = `${audioStr.substring(0, maxLength)}... [truncated, ${audioStr.length} chars total]`;
        }
    }
    return result;
}

/**
 * Print word breakdown with phonemes and visemes.
 * @param {Object} wordAlignment - Word alignment data from API response
 */
function printWordBreakdown(wordAlignment) {
    const words = wordAlignment.words || [];
    const startTimes = wordAlignment.wordStartTimeSeconds || [];
    const endTimes = wordAlignment.wordEndTimeSeconds || [];
    const phoneticDetails = wordAlignment.phoneticDetails || [];

    if (words.length === 0) {
        return;
    }

    // Build a lookup from wordIndex to phonetic details
    const phoneticsByWord = {};
    for (const p of phoneticDetails) {
        phoneticsByWord[p.wordIndex] = p;
    }

    for (let i = 0; i < words.length; i++) {
        const word = words[i];
        const start = i < startTimes.length ? startTimes[i] : 0;
        const end = i < endTimes.length ? endTimes[i] : 0;
        console.log(`\n"${word}" (${start.toFixed(2)}s - ${end.toFixed(2)}s)`);

        // Get phonetic details for this word
        const phonetic = phoneticsByWord[i] || {};
        const phones = phonetic.phones || [];

        if (phones.length > 0) {
            console.log('  Phonemes:');
            for (const phone of phones) {
                const symbol = phone.phoneSymbol || '';
                const phoneStart = phone.startTimeSeconds || 0;
                const duration = phone.durationSeconds || 0;
                const viseme = phone.visemeSymbol || '';
                console.log(`    /${symbol}/ at ${phoneStart.toFixed(2)}s (${duration.toFixed(3)}s) -> viseme: ${viseme}`);
            }
        }
    }
}

/**
 * Synthesize speech with streaming and retrieve timestamp/phoneme/viseme data.
 *
 * @param {string} text - Text to synthesize
 * @param {string} voiceId - Voice ID to use
 * @param {string} modelId - Model ID to use
 * @param {string} apiKey - API key for authentication
 * @returns {AsyncGenerator<Buffer>} Audio chunks
 */
async function* synthesizeSpeechStreamWithTimestamps(text, voiceId, modelId, apiKey) {
    // API streaming endpoint
    const url = 'https://api.inworld.ai/tts/v1/voice:stream';

    // Set up headers
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${apiKey}`
    };

    // Request data with timestamp_type
    const requestData = {
        text: text,
        voice_id: voiceId,
        model_id: modelId,
        audio_config: {
            audio_encoding: 'LINEAR16',
            sample_rate_hertz: 48000
        },
        timestamp_type: 'WORD'
    };

    try {
        console.log('Starting streaming synthesis with timestamps...');
        console.log(`   Text: ${text}`);
        console.log(`   Voice ID: ${voiceId}`);
        console.log(`   Model ID: ${modelId}`);
        console.log();

        // Use native fetch API with streaming
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestData)
        });

        // Check for HTTP errors
        if (!response.ok) {
            let errorDetails = '';
            try {
                errorDetails = await response.text();
            } catch {}
            throw new Error(`HTTP ${response.status}: ${errorDetails}`);
        }

        let chunkCount = 0;
        let totalAudioSize = 0;
        let firstChunkTime = null;
        const startTime = Date.now();
        const allTimestampInfo = [];

        console.log('Receiving audio chunks:');

        // Process streaming response using ReadableStream
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();

            if (done) break;

            // Decode the chunk and add to buffer
            buffer += decoder.decode(value, { stream: true });

            // Process complete lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer

            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const chunkData = JSON.parse(line);
                        const result = chunkData.result;

                        if (result) {
                            // Log first chunk's full structure (with truncated audio)
                            if (chunkCount === 0) {
                                console.log('\n=== First Chunk Response Structure (audio truncated) ===');
                                const truncated = truncateAudioForLogging(result);
                                console.log(JSON.stringify(truncated, null, 2));
                                console.log();
                            }

                            // Collect timestamp info if present
                            const timestampInfo = result.timestampInfo;
                            if (timestampInfo) {
                                allTimestampInfo.push(timestampInfo);
                            }

                            // Process audio
                            if (result.audioContent) {
                                const audioChunk = Buffer.from(result.audioContent, 'base64');
                                chunkCount++;
                                totalAudioSize += audioChunk.length;

                                // Record time for first chunk
                                if (chunkCount === 1) {
                                    firstChunkTime = (Date.now() - startTime) / 1000;
                                    console.log(`   Time to first chunk: ${firstChunkTime.toFixed(2)} seconds`);
                                }

                                console.log(`   Chunk ${chunkCount}: ${audioChunk.length} bytes`);
                                yield audioChunk;
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
            }
        }

        console.log(`\nStreaming completed!`);
        console.log(`   Total chunks: ${chunkCount}`);
        console.log(`   Total audio size: ${totalAudioSize} bytes`);

        // Print accumulated timestamp information
        if (allTimestampInfo.length > 0) {
            console.log('\n=== Word Breakdown with Phonemes & Visemes ===');
            for (const timestampInfo of allTimestampInfo) {
                const wordAlignment = timestampInfo.wordAlignment || {};
                if (Object.keys(wordAlignment).length > 0) {
                    printWordBreakdown(wordAlignment);
                }
            }
            console.log();
        } else {
            console.log('\nNo timestamp data received in stream');
        }

    } catch (error) {
        console.log(`HTTP Error: ${error.message}`);
        throw error;
    }
}

/**
 * Save streaming audio chunks to a WAV file.
 * @param {AsyncGenerator<Buffer>} audioChunks - Audio chunks generator
 * @param {string} outputFile - Output file path
 */
async function saveStreamingAudioToFile(audioChunks, outputFile) {
    try {
        console.log(`Saving audio chunks to: ${outputFile}`);

        // Collect all raw audio data (skip WAV headers from chunks)
        const rawAudioData = [];

        for await (const chunk of audioChunks) {
            // Skip WAV header if present (first 44 bytes)
            if (chunk.length > 44 && chunk.subarray(0, 4).equals(Buffer.from('RIFF'))) {
                rawAudioData.push(chunk.subarray(44));
            } else {
                rawAudioData.push(chunk);
            }
        }

        const combinedAudio = Buffer.concat(rawAudioData);

        // Create WAV header and save file
        const wavHeader = createWavHeader(combinedAudio.length, 1, 48000, 16);
        const wavFile = Buffer.concat([wavHeader, combinedAudio]);

        fs.writeFileSync(outputFile, wavFile);

    } catch (error) {
        console.log(`Error saving audio file: ${error.message}`);
        throw error;
    }
}

/**
 * Create WAV file header.
 * @param {number} dataSize - Size of audio data
 * @param {number} channels - Number of channels
 * @param {number} sampleRate - Sample rate
 * @param {number} bitsPerSample - Bits per sample
 * @returns {Buffer} WAV header
 */
function createWavHeader(dataSize, channels, sampleRate, bitsPerSample) {
    const header = Buffer.alloc(44);
    const bytesPerSample = bitsPerSample / 8;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;

    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);

    // fmt chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16); // chunk size
    header.writeUInt16LE(1, 20);  // audio format (PCM)
    header.writeUInt16LE(channels, 22);
    header.writeUInt32LE(sampleRate, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(bitsPerSample, 34);

    // data chunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);

    return header;
}

/**
 * Main function to demonstrate streaming TTS synthesis with timestamps.
 */
async function main() {
    console.log('Inworld TTS Streaming Timestamps Example');
    console.log('=' + '='.repeat(44));

    // Check API key
    const apiKey = checkApiKey();
    if (!apiKey) {
        return 1;
    }

    // Configuration
    const text = "Hello, adventurer! What a beautiful day, isn't it?";
    const voiceId = 'Dennis';
    const modelId = 'inworld-tts-1.5-max';
    const outputFile = 'synthesis_stream_timestamps_output.wav';

    try {
        const startTime = Date.now();
        const audioChunks = synthesizeSpeechStreamWithTimestamps(text, voiceId, modelId, apiKey);
        await saveStreamingAudioToFile(audioChunks, outputFile);
        const synthesisTime = (Date.now() - startTime) / 1000;

        console.log(`Audio saved to: ${outputFile}`);
        console.log(`Total synthesis time: ${synthesisTime.toFixed(2)} seconds`);
        console.log(`Streaming synthesis completed successfully! You can play the audio file: ${outputFile}`);

    } catch (error) {
        console.log(`\nStreaming synthesis failed: ${error.message}`);
        return 1;
    }

    return 0;
}

if (require.main === module) {
    main().then(process.exit);
}
