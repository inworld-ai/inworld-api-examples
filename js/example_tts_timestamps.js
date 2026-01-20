#!/usr/bin/env node
/**
 * Example script for Inworld TTS synthesis with timestamp, phoneme, and viseme data.
 *
 * This script demonstrates how to retrieve detailed timing information from the
 * Inworld TTS API, including word timestamps, phoneme data, and viseme data.
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
        console.log('No timestamp data in response');
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
 * Synthesize speech from text and retrieve timestamp/phoneme/viseme data.
 *
 * @param {string} text - Text to synthesize
 * @param {string} voiceId - Voice ID to use
 * @param {string} modelId - Model ID to use
 * @param {string} apiKey - API key for authentication
 * @returns {Promise<{audioData: Buffer, response: Object}>} Audio data and full response
 */
async function synthesizeWithTimestamps(text, voiceId, modelId, apiKey) {
    // API endpoint
    const url = 'https://api.inworld.ai/tts/v1/voice';

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
        console.log('Synthesizing speech with timestamps...');
        console.log(`   Text: ${text}`);
        console.log(`   Voice ID: ${voiceId}`);
        console.log(`   Model ID: ${modelId}`);
        console.log();

        // Use native fetch API (Node.js 18+)
        const response = await fetch(url, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestData)
        });

        // Check for HTTP errors (fetch doesn't throw on 4xx/5xx)
        if (!response.ok) {
            let errorDetails = '';
            try {
                const errorData = await response.json();
                errorDetails = JSON.stringify(errorData);
            } catch {
                errorDetails = await response.text();
            }
            throw new Error(`HTTP ${response.status}: ${errorDetails}`);
        }

        const result = await response.json();

        // Log full response with truncated audio
        console.log('=== Full API Response (audio truncated) ===');
        const truncatedResult = truncateAudioForLogging(result);
        console.log(JSON.stringify(truncatedResult, null, 2));
        console.log();

        // Extract and display word/phoneme/viseme data
        console.log('=== Word Breakdown with Phonemes & Visemes ===');
        const timestampInfo = result.timestampInfo || {};
        const wordAlignment = timestampInfo.wordAlignment || {};
        printWordBreakdown(wordAlignment);
        console.log();

        // Decode audio
        const audioData = Buffer.from(result.audioContent, 'base64');
        console.log(`Synthesis successful! Audio size: ${audioData.length} bytes`);

        return { audioData, response: result };

    } catch (error) {
        console.log(`HTTP Error: ${error.message}`);
        throw error;
    }
}

/**
 * Save audio data to a WAV file.
 * @param {Buffer} audioData - Audio data
 * @param {string} outputFile - Output file path
 */
function saveAudioToFile(audioData, outputFile) {
    try {
        // Skip WAV header if present (first 44 bytes)
        const rawAudio = (audioData.length > 44 && audioData.subarray(0, 4).equals(Buffer.from('RIFF')))
            ? audioData.subarray(44)
            : audioData;

        // Create WAV header
        const wavHeader = createWavHeader(rawAudio.length, 1, 48000, 16);
        const wavFile = Buffer.concat([wavHeader, rawAudio]);

        fs.writeFileSync(outputFile, wavFile);
        console.log(`Audio saved to: ${outputFile}`);

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
 * Main function to demonstrate TTS synthesis with timestamps.
 */
async function main() {
    console.log('Inworld TTS Timestamps Example');
    console.log('=' + '='.repeat(39));

    // Check API key
    const apiKey = checkApiKey();
    if (!apiKey) {
        return 1;
    }

    // Configuration
    const text = "Hello, adventurer! What a beautiful day, isn't it?";
    const voiceId = 'Dennis';
    const modelId = 'inworld-tts-1.5-max';
    const outputFile = 'synthesis_timestamps_output.wav';

    try {
        const startTime = Date.now();
        const { audioData } = await synthesizeWithTimestamps(text, voiceId, modelId, apiKey);
        const synthesisTime = (Date.now() - startTime) / 1000;

        saveAudioToFile(audioData, outputFile);

        console.log(`Synthesis time: ${synthesisTime.toFixed(2)} seconds`);
        console.log(`Synthesis completed successfully! You can play the audio file: ${outputFile}`);

    } catch (error) {
        console.log(`\nSynthesis failed: ${error.message}`);
        return 1;
    }

    return 0;
}

if (require.main === module) {
    main().then(process.exit);
}
