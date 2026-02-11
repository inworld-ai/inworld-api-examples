#!/usr/bin/env node
/**
 * Example script for Inworld TTS streaming synthesis using HTTP requests.
 *
 * This script demonstrates how to synthesize speech from text using the Inworld TTS API
 * with streaming requests, receiving audio chunks in real-time.
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
            audio_encoding: 'OGG_OPUS',
            sample_rate_hertz: 24000,
            bit_rate: 32000
        }
    };
    
    try {
        console.log('Starting streaming synthesis...');
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
                        if (result && result.audioContent) {
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
        
    } catch (error) {
        console.log(`HTTP Error: ${error.message}`);
        throw error;
    }
}

/**
 * Save streaming audio chunks to an OGG file.
 * @param {AsyncGenerator<Buffer>} audioChunks - Audio chunks generator
 * @param {string} outputFile - Output file path
 */
async function saveStreamingAudioToFile(audioChunks, outputFile) {
    try {
        console.log(`Saving audio chunks to: ${outputFile}`);

        const audioData = [];
        for await (const chunk of audioChunks) {
            audioData.push(chunk);
        }

        fs.writeFileSync(outputFile, Buffer.concat(audioData));

    } catch (error) {
        console.log(`Error saving audio file: ${error.message}`);
        throw error;
    }
}

/**
 * Main function to demonstrate streaming TTS synthesis.
 */
async function main() {
    console.log('Inworld TTS Streaming Synthesis Example');
    console.log('=' + '='.repeat(44));
    
    // Check API key
    const apiKey = checkApiKey();
    if (!apiKey) {
        return 1;
    }
    
    // Configuration
    const text = "Hello, adventurer! What a beautiful day, isn't it?";
    const voiceId = 'Dennis';
    const modelId = 'inworld-tts-1.5-mini';
    const outputFile = 'synthesis_stream_output.ogg';
    
    try {
        const audioChunks = synthesizeSpeechStream(text, voiceId, modelId, apiKey);
        await saveStreamingAudioToFile(audioChunks, outputFile);
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
