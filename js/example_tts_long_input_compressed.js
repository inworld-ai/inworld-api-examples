#!/usr/bin/env node
/**
 * Example script for Inworld TTS synthesis with long text input (MP3 compressed).
 *
 * This script demonstrates how to synthesize speech from long text by:
 * 1. Chunking text at natural boundaries (paragraphs → newlines → sentences)
 * 2. Processing chunks through the TTS API with controlled concurrency
 * 3. Stitching all MP3 audio outputs together
 */

const fs = require('fs');
const axios = require('axios');
const path = require('path');

// Configuration
const INPUT_FILE_PATH = '../tests-data/text/chapter1.txt';  // Path to input text file (relative to this script)
const MIN_CHUNK_SIZE = 500;   // Minimum characters before looking for break point
const MAX_CHUNK_SIZE = 1900;  // Maximum chunk size (API limit is 2000)
const MAX_CONCURRENT_REQUESTS = 2;  // Limit parallel requests to avoid RPS limits
const MAX_RETRIES = 3;        // Maximum retries for rate limit errors
const RETRY_BASE_DELAY = 1000; // Base delay for exponential backoff (ms)

// Audio configuration for MP3
const SAMPLE_RATE = 48000;

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
 * Find the best break point in text, prioritizing:
 * 1. Paragraph breaks (\n\n)
 * 2. Line breaks (\n)
 * 3. Sentence endings (.!?)
 * 4. Last space (fallback)
 * 
 * @param {string} text - Text to search for break point
 * @param {number} minPos - Minimum position to start looking
 * @param {number} maxPos - Maximum position to look
 * @param {number} chunkIndex - Current chunk index for logging
 * @returns {number} Position of best break point
 */
function findBreakPoint(text, minPos, maxPos, chunkIndex) {
    const searchText = text.slice(0, maxPos);
    
    // 1. Try paragraph breaks (\n\n) after minPos
    let breakIndex = -1;
    let searchStart = minPos;
    
    while (true) {
        const idx = searchText.indexOf('\n\n', searchStart);
        if (idx === -1 || idx >= maxPos) break;
        if (idx >= minPos) {
            breakIndex = idx + 2; // Include the paragraph break
            break; // Use first paragraph break after minPos
        }
        searchStart = idx + 1;
    }
    
    if (breakIndex > 0) {
        console.log(`  Chunk ${chunkIndex + 1}: Found paragraph break at position ${breakIndex}`);
        return breakIndex;
    }
    
    // 2. Try single line breaks (\n) after minPos
    searchStart = minPos;
    while (true) {
        const idx = searchText.indexOf('\n', searchStart);
        if (idx === -1 || idx >= maxPos) break;
        if (idx >= minPos) {
            breakIndex = idx + 1;
            break;
        }
        searchStart = idx + 1;
    }
    
    if (breakIndex > 0) {
        console.log(`  Chunk ${chunkIndex + 1}: Found line break at position ${breakIndex}`);
        return breakIndex;
    }
    
    // 3. Try sentence endings after minPos
    const sentenceEndRegex = /[.!?]["'"']?\s+|[.!?]["'"']?$/g;
    let match;
    while ((match = sentenceEndRegex.exec(searchText)) !== null) {
        if (match.index >= minPos) {
            console.log(`  Chunk ${chunkIndex + 1}: Found sentence break at position ${match.index + match[0].length}`);
            return match.index + match[0].length;
        }
    }
    
    // 4. Fall back to any sentence end before maxPos
    sentenceEndRegex.lastIndex = 0;
    let lastSentenceEnd = -1;
    while ((match = sentenceEndRegex.exec(searchText)) !== null) {
        lastSentenceEnd = match.index + match[0].length;
    }
    if (lastSentenceEnd > 0) {
        console.log(`  Chunk ${chunkIndex + 1}: Found sentence break (fallback) at position ${lastSentenceEnd}`);
        return lastSentenceEnd;
    }
    
    // 5. Last resort: break at last space
    const spaceIndex = searchText.lastIndexOf(' ');
    const breakPos = spaceIndex > 0 ? spaceIndex + 1 : maxPos;
    console.log(`  Chunk ${chunkIndex + 1}: Found space break (fallback) at position ${breakPos}`);
    return breakPos;
}

/**
 * Chunk text into segments at natural boundaries.
 * Prioritizes paragraph breaks, then line breaks, then sentence endings.
 * 
 * @param {string} text - The full text to chunk
 * @returns {Array<{text: string, startChar: number, endChar: number}>} Array of text chunks
 */
function chunkText(text) {
    const chunks = [];
    let currentPosition = 0;
    
    while (currentPosition < text.length) {
        const remainingText = text.slice(currentPosition);
        
        // If remaining text is short enough, take it all
        if (remainingText.length <= MAX_CHUNK_SIZE) {
            const chunkContent = remainingText.trim();
            if (chunkContent.length > 0) {
                chunks.push({
                    text: chunkContent,
                    startChar: currentPosition,
                    endChar: text.length
                });
            }
            break;
        }
        
        // Find the best break point
        const chunkEnd = findBreakPoint(remainingText, MIN_CHUNK_SIZE, MAX_CHUNK_SIZE, chunks.length);
        
        const chunkContent = remainingText.slice(0, chunkEnd).trim();
        if (chunkContent.length > 0) {
            chunks.push({
                text: chunkContent,
                startChar: currentPosition,
                endChar: currentPosition + chunkEnd
            });
        }
        
        currentPosition += chunkEnd;
    }
    
    return chunks;
}

/**
 * Sleep for a specified duration.
 * @param {number} ms - Milliseconds to sleep
 * @returns {Promise<void>}
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Synthesize speech from text using Inworld TTS API with retry logic.
 * 
 * @param {string} text - Text to synthesize
 * @param {string} voiceId - Voice ID to use
 * @param {string} modelId - Model ID to use
 * @param {string} apiKey - API key for authentication
 * @param {number} chunkIndex - Chunk index for logging
 * @param {number} totalChunks - Total number of chunks
 * @returns {Promise<Buffer>} Audio data
 */
async function synthesizeSpeech(text, voiceId, modelId, apiKey, chunkIndex, totalChunks) {
    const url = 'https://api.inworld.ai/tts/v1/voice';
    
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${apiKey}`
    };
    
    const requestData = {
        text: text,
        voice_id: voiceId,
        model_id: modelId,
        audio_config: {
            audio_encoding: 'MP3',
            sample_rate_hertz: SAMPLE_RATE
        }
    };
    
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            console.log(`[${chunkIndex + 1}/${totalChunks}] Synthesizing chunk (${text.length} chars)...`);
            
            const response = await axios.post(url, requestData, { headers });
            const audioData = Buffer.from(response.data.audioContent, 'base64');
            
            console.log(`[${chunkIndex + 1}/${totalChunks}] Done - ${audioData.length} bytes`);
            
            return audioData;
            
        } catch (error) {
            const isRateLimit = error.response?.status === 429;
            const isLastAttempt = attempt === MAX_RETRIES - 1;
            
            if (isRateLimit && !isLastAttempt) {
                const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
                console.log(`[${chunkIndex + 1}/${totalChunks}] Rate limited, retrying in ${delay}ms...`);
                await sleep(delay);
                continue;
            }
            
            console.log(`Error for chunk ${chunkIndex + 1}: ${error.message}`);
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
}

/**
 * Process chunks with controlled concurrency.
 * @param {Array} chunks - Text chunks to process
 * @param {string} voiceId - Voice ID
 * @param {string} modelId - Model ID
 * @param {string} apiKey - API key
 * @returns {Promise<Array<Buffer>>} Audio buffers in order
 */
async function synthesizeAllChunks(chunks, voiceId, modelId, apiKey) {
    const results = new Array(chunks.length);
    const queue = chunks.map((chunk, index) => ({ chunk, index }));
    
    async function processNext() {
        while (queue.length > 0) {
            const { chunk, index } = queue.shift();
            results[index] = await synthesizeSpeech(
                chunk.text,
                voiceId,
                modelId,
                apiKey,
                index,
                chunks.length
            );
        }
    }
    
    // Start concurrent workers
    const workers = [];
    for (let i = 0; i < Math.min(MAX_CONCURRENT_REQUESTS, chunks.length); i++) {
        workers.push(processNext());
    }
    
    await Promise.all(workers);
    return results;
}

/**
 * Combine multiple audio buffers into one.
 * @param {Array<Buffer>} audioBuffers - Audio buffers to combine
 * @returns {Buffer} Combined audio
 */
function combineAudioBuffers(audioBuffers) {
    return Buffer.concat(audioBuffers);
}

/**
 * Save audio to file.
 * @param {Buffer} audioData - Audio data (MP3)
 * @param {string} outputFile - Output file path
 */
function saveAudioToFile(audioData, outputFile) {
    fs.writeFileSync(outputFile, audioData);
    console.log(`Audio saved to: ${outputFile}`);
}

/**
 * Read input text from file.
 * @param {string} inputFile - Path to input file
 * @returns {string|null} Text content or null on error
 */
function readInputText(inputFile) {
    try {
        const text = fs.readFileSync(inputFile, 'utf-8');
        console.log(`Loaded: ${inputFile} (${text.length} chars)`);
        return text;
    } catch (error) {
        console.log(`Error reading input file: ${error.message}`);
        return null;
    }
}

/**
 * Main function - high-level orchestration only.
 */
async function main() {
    console.log('Inworld TTS Long Text Synthesis (MP3 Compressed)\n');
    
    // Setup
    const apiKey = checkApiKey();
    if (!apiKey) return 1;
    
    // Configuration - modify these for your use case
    const voiceId = 'Edward';
    const modelId = 'inworld-tts-1-max';
    const outputFile = 'synthesis_long_output.mp3';
    const inputFile = path.join(__dirname, INPUT_FILE_PATH);
    
    // Read input text
    const text = readInputText(inputFile);
    if (!text) return 1;
    
    // Split into chunks
    const chunks = chunkText(text);
    console.log(`Split into ${chunks.length} chunks (min: ${MIN_CHUNK_SIZE}, max: ${MAX_CHUNK_SIZE} chars)\n`);
    
    try {
        const startTime = Date.now();
        
        // Synthesize all chunks
        console.log(`Synthesizing with ${MAX_CONCURRENT_REQUESTS} concurrent requests...\n`);
        const audioBuffers = await synthesizeAllChunks(chunks, voiceId, modelId, apiKey);
        
        // Combine audio
        console.log('\nCombining audio...');
        const combinedAudio = combineAudioBuffers(audioBuffers);
        
        // Save output
        saveAudioToFile(combinedAudio, outputFile);
        
        // Report
        const fileSizeKB = (combinedAudio.length / 1024).toFixed(1);
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`Output size: ${fileSizeKB} KB`);
        console.log(`Completed in ${elapsed.toFixed(2)}s`);
        
    } catch (error) {
        console.log(`\nSynthesis failed: ${error.message}`);
        return 1;
    }
    
    return 0;
}

if (require.main === module) {
    main().then(process.exit);
}

module.exports = { chunkText, synthesizeSpeech, combineAudioBuffers, synthesizeAllChunks };
