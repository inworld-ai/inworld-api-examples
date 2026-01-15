#!/usr/bin/env node
/**
 * Example script for Inworld TTS synthesis using HTTP requests.
 *
 * This script demonstrates how to synthesize speech from text using the Inworld TTS API
 * with synchronous (non-streaming) requests.
 */

const fs = require('fs');
const axios = require('axios');

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
 * Synthesize speech from text using Inworld TTS API.
 * 
 * @param {string} text - Text to synthesize
 * @param {string} voiceId - Voice ID to use
 * @param {string} modelId - Model ID to use
 * @param {string} apiKey - API key for authentication
 * @returns {Promise<Buffer>} Audio data
 */
async function synthesizeSpeech(text, voiceId, modelId, apiKey) {
    // API endpoint
    const url = 'https://api.inworld.ai/tts/v1/voice';
    
    // Set up headers
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${apiKey}`
    };
    
    // Request data
    const requestData = {
        text: text,
        voice_id: voiceId,
        model_id: modelId,
        audio_config: {
            audio_encoding: 'LINEAR16',
            sample_rate_hertz: 48000
        }
    };
    
    try {
        console.log('Synthesizing speech...');
        console.log(`   Text: ${text}`);
        console.log(`   Voice ID: ${voiceId}`);
        console.log(`   Model ID: ${modelId}`);
        
        const response = await axios.post(url, requestData, { headers });
        
        const audioData = Buffer.from(response.data.audioContent, 'base64');
        
        console.log(`Synthesis successful! Audio size: ${audioData.length} bytes`);
        return audioData;
        
    } catch (error) {
        console.log(`HTTP Error: ${error.message}`);
        if (error.response) {
            try {
                console.log(`   Error details: ${JSON.stringify(error.response.data)}`);
            } catch {
                console.log(`   Response text: ${error.response.data}`);
            }
        }
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
 * Main function to demonstrate TTS synthesis.
 */
async function main() {
    console.log('Inworld TTS Synthesis Example');
    console.log('=' + '='.repeat(39));
    
    // Check API key
    const apiKey = checkApiKey();
    if (!apiKey) {
        return 1;
    }
    
    // Configuration
    const text = "Hello, adventurer! What a beautiful day, isn't it?";
    const voiceId = 'Dennis';
    const modelId = 'inworld-tts-1';
    const outputFile = 'synthesis_output.wav';
    
    try {
        const startTime = Date.now();
        const audioData = await synthesizeSpeech(text, voiceId, modelId, apiKey);
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
