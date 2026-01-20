#!/usr/bin/env node
/**
 * Example script for Inworld TTS streaming synthesis using HTTP requests.
 *
 * This script demonstrates how to synthesize speech from text using the Inworld TTS API
 * with streaming requests, receiving audio chunks in real-time.
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
        console.log('❌ Error: INWORLD_API_KEY environment variable is not set.');
        console.log('Please set it with: export INWORLD_API_KEY=your_api_key_here');
        return null;
    }
    return apiKey;
}

/**
 * Synthesize speech from text using Inworld TTS API with streaming.
 * 
 * @param {string} text - Text to synthesize
 * @param {string} voiceId - Voice ID to use
 * @param {string} modelId - Model ID to use
 * @param {string} apiKey - API key for authentication
 * @returns {AsyncGenerator<Buffer>} Audio chunks
 */
async function* synthesizeSpeechStream(text, voiceId, modelId, apiKey) {
    // API endpoint
    const url = 'https://api.inworld.ai/tts/v1/voice:stream';
    
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
        console.log('🎤 Starting streaming synthesis...');
        console.log(`   Text: ${text}`);
        console.log(`   Voice ID: ${voiceId}`);
        console.log(`   Model ID: ${modelId}`);
        console.log();
        
        const response = await axios.post(url, requestData, {
            headers,
            responseType: 'stream'
        });
        
        let chunkCount = 0;
        let totalAudioSize = 0;
        let firstChunkTime = null;
        const startTime = Date.now();
        
        console.log('📡 Receiving audio chunks:');
        
        let buffer = '';
        
        for await (const chunk of response.data) {
            buffer += chunk.toString();
            
            // Process complete lines
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer
            
            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const chunkData = JSON.parse(line);
                        const result = chunkData.result;
                        if (result && result.audioContent) {
                            const audioChunk = Buffer.from(result.audioContent, 'base64');
                            chunkCount++;
                            totalAudioSize += audioChunk.length;
                            
                            // Record time for first chunk
                            if (chunkCount === 1) {
                                firstChunkTime = (Date.now() - startTime) / 1000;
                                console.log(`   ⏱️  Time to first chunk: ${firstChunkTime.toFixed(2)} seconds`);
                            }
                            
                            console.log(`   📦 Chunk ${chunkCount}: ${audioChunk.length} bytes`);
                            yield audioChunk;
                        }
                    } catch (error) {
                        if (error instanceof SyntaxError) {
                            console.log(`   ⚠️  JSON decode error: ${error.message}`);
                            continue;
                        } else {
                            console.log(`   ⚠️  Missing key in response: ${error.message}`);
                            continue;
                        }
                    }
                }
            }
        }
        
        console.log(`\n✅ Streaming completed!`);
        console.log(`   Total chunks: ${chunkCount}`);
        console.log(`   Total audio size: ${totalAudioSize} bytes`);
        
    } catch (error) {
        console.log(`❌ HTTP Error: ${error.message}`);
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
 * Save streaming audio chunks to a WAV file.
 * @param {AsyncGenerator<Buffer>} audioChunks - Audio chunks generator
 * @param {string} outputFile - Output file path
 */
async function saveStreamingAudioToFile(audioChunks, outputFile) {
    try {
        console.log(`💾 Saving audio chunks to: ${outputFile}`);
        
        // Collect all raw audio data (skip WAV headers from chunks)
        const rawAudioData = [];
        
        let i = 0;
        for await (const chunk of audioChunks) {
            // Skip WAV header if present (first 44 bytes)
            if (chunk.length > 44 && chunk.subarray(0, 4).equals(Buffer.from('RIFF'))) {
                rawAudioData.push(chunk.subarray(44));
            } else {
                rawAudioData.push(chunk);
            }
            i++;
        }
        
        const combinedAudio = Buffer.concat(rawAudioData);
        
        // Create WAV header and save file
        const wavHeader = createWavHeader(combinedAudio.length, 1, 48000, 16);
        const wavFile = Buffer.concat([wavHeader, combinedAudio]);
        
        fs.writeFileSync(outputFile, wavFile);
        
    } catch (error) {
        console.log(`❌ Error saving audio file: ${error.message}`);
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
 * Main function to demonstrate streaming TTS synthesis.
 */
async function main() {
    console.log('🎵 Inworld TTS Streaming Synthesis Example');
    console.log('=' + '='.repeat(44));
    
    // Check API key
    const apiKey = checkApiKey();
    if (!apiKey) {
        return 1;
    }
    
    // Configuration
    const text = "Hello, adventurer! What a beautiful day, isn't it?";
    const voiceId = 'Dennis';
    const modelId = 'inworld-tts-1';
    const outputFile = 'synthesis_stream_output.wav';
    
    try {
        const audioChunks = synthesizeSpeechStream(text, voiceId, modelId, apiKey);
        await saveStreamingAudioToFile(audioChunks, outputFile);
        console.log(`🎉 Streaming synthesis completed successfully! You can play the audio file: ${outputFile}`);
        
    } catch (error) {
        console.log(`\n❌ Streaming synthesis failed: ${error.message}`);
        return 1;
    }
    
    return 0;
}

if (require.main === module) {
    main().then(process.exit);
}
