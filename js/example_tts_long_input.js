#!/usr/bin/env node
/**
 * Example script for Inworld TTS synthesis with long text input.
 *
 * This script demonstrates how to synthesize speech from long text by:
 * 1. Chunking text at sentence boundaries (after ~1000 characters)
 * 2. Processing each chunk through the TTS API
 * 3. Stitching all audio outputs together
 * 4. Reporting splice points with timestamps for quality checking
 */

const fs = require('fs');
const axios = require('axios');
const path = require('path');

// Configuration
const MIN_CHUNK_SIZE = 1000;  // Minimum characters before looking for sentence end
const MAX_CHUNK_SIZE = 1900;  // Maximum chunk size (API limit is 2000)
const SAMPLE_RATE = 48000;
const BITS_PER_SAMPLE = 16;
const CHANNELS = 1;

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
 * Chunk text into segments at sentence boundaries.
 * After MIN_CHUNK_SIZE characters, looks for sentence-ending punctuation.
 * 
 * @param {string} text - The full text to chunk
 * @returns {Array<{text: string, startChar: number, endChar: number}>} Array of text chunks with positions
 */
function chunkText(text) {
    const chunks = [];
    let currentPosition = 0;
    
    // Regex for sentence-ending punctuation (period, question mark, exclamation, 
    // closing quotes after punctuation, etc.)
    const sentenceEndRegex = /[.!?]["'"']?\s+|[.!?]["'"']?$/g;
    
    while (currentPosition < text.length) {
        const remainingText = text.slice(currentPosition);
        
        // If remaining text is short enough, take it all
        if (remainingText.length <= MAX_CHUNK_SIZE) {
            chunks.push({
                text: remainingText.trim(),
                startChar: currentPosition,
                endChar: text.length
            });
            break;
        }
        
        // Look for sentence end after MIN_CHUNK_SIZE
        let chunkEnd = -1;
        const searchStart = MIN_CHUNK_SIZE;
        const searchText = remainingText.slice(0, MAX_CHUNK_SIZE);
        
        // Find all sentence endings in the search range
        let match;
        sentenceEndRegex.lastIndex = searchStart;
        
        // Reset and search from beginning of search text
        const matches = [];
        let tempRegex = /[.!?]["'"']?\s+|[.!?]["'"']?$/g;
        while ((match = tempRegex.exec(searchText)) !== null) {
            if (match.index >= searchStart) {
                matches.push(match.index + match[0].length);
            }
        }
        
        if (matches.length > 0) {
            // Use the first sentence end after MIN_CHUNK_SIZE
            chunkEnd = matches[0];
        } else {
            // No sentence end found, try to find any sentence end before MAX_CHUNK_SIZE
            tempRegex = /[.!?]["'"']?\s+|[.!?]["'"']?$/g;
            while ((match = tempRegex.exec(searchText)) !== null) {
                chunkEnd = match.index + match[0].length;
            }
            
            // If still no match, force break at MAX_CHUNK_SIZE at a space
            if (chunkEnd === -1) {
                const spaceIndex = searchText.lastIndexOf(' ');
                chunkEnd = spaceIndex > 0 ? spaceIndex + 1 : MAX_CHUNK_SIZE;
            }
        }
        
        const chunkText = remainingText.slice(0, chunkEnd).trim();
        if (chunkText.length > 0) {
            chunks.push({
                text: chunkText,
                startChar: currentPosition,
                endChar: currentPosition + chunkEnd
            });
        }
        
        currentPosition += chunkEnd;
    }
    
    return chunks;
}

/**
 * Synthesize speech from text using Inworld TTS API.
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
            audio_encoding: 'LINEAR16',
            sample_rate_hertz: SAMPLE_RATE
        }
    };
    
    try {
        console.log(`[${chunkIndex + 1}/${totalChunks}] Synthesizing chunk (${text.length} chars)...`);
        
        const response = await axios.post(url, requestData, { headers });
        const audioData = Buffer.from(response.data.audioContent, 'base64');
        
        console.log(`[${chunkIndex + 1}/${totalChunks}] Done - Audio size: ${audioData.length} bytes`);
        return audioData;
        
    } catch (error) {
        console.log(`❌ HTTP Error for chunk ${chunkIndex + 1}: ${error.message}`);
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
 * Extract raw audio data from buffer (skip WAV header if present).
 * @param {Buffer} audioData - Audio data (may include WAV header)
 * @returns {Buffer} Raw PCM audio data
 */
function extractRawAudio(audioData) {
    if (audioData.length > 44 && audioData.subarray(0, 4).equals(Buffer.from('RIFF'))) {
        return audioData.subarray(44);
    }
    return audioData;
}

/**
 * Calculate audio duration from raw PCM data.
 * @param {Buffer} rawAudio - Raw PCM audio data
 * @returns {number} Duration in seconds
 */
function calculateDuration(rawAudio) {
    const bytesPerSecond = SAMPLE_RATE * (BITS_PER_SAMPLE / 8) * CHANNELS;
    return rawAudio.length / bytesPerSecond;
}

/**
 * Format seconds as MM:SS.mmm
 * @param {number} seconds - Duration in seconds
 * @returns {string} Formatted time string
 */
function formatTime(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toFixed(3).padStart(6, '0')}`;
}

/**
 * Combine multiple audio buffers and create splice report.
 * @param {Array<Buffer>} audioBuffers - Array of raw audio buffers
 * @param {Array<Object>} chunks - Original text chunks with positions
 * @returns {{combinedAudio: Buffer, splicePoints: Array}} Combined audio and splice info
 */
function combineAudioBuffers(audioBuffers, chunks) {
    const splicePoints = [];
    let currentTime = 0;
    
    const rawBuffers = audioBuffers.map((buffer, index) => {
        const rawAudio = extractRawAudio(buffer);
        const duration = calculateDuration(rawAudio);
        
        if (index > 0) {
            splicePoints.push({
                spliceIndex: index,
                timestamp: currentTime,
                formattedTime: formatTime(currentTime),
                chunkStartChar: chunks[index].startChar,
                chunkEndChar: chunks[index].endChar,
                textPreview: chunks[index].text.substring(0, 50) + '...'
            });
        }
        
        currentTime += duration;
        return rawAudio;
    });
    
    return {
        combinedAudio: Buffer.concat(rawBuffers),
        splicePoints,
        totalDuration: currentTime
    };
}

/**
 * Create WAV file header.
 * @param {number} dataSize - Size of audio data
 * @returns {Buffer} WAV header
 */
function createWavHeader(dataSize) {
    const header = Buffer.alloc(44);
    const bytesPerSample = BITS_PER_SAMPLE / 8;
    const blockAlign = CHANNELS * bytesPerSample;
    const byteRate = SAMPLE_RATE * blockAlign;
    
    // RIFF header
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + dataSize, 4);
    header.write('WAVE', 8);
    
    // fmt chunk
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(CHANNELS, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(byteRate, 28);
    header.writeUInt16LE(blockAlign, 32);
    header.writeUInt16LE(BITS_PER_SAMPLE, 34);
    
    // data chunk
    header.write('data', 36);
    header.writeUInt32LE(dataSize, 40);
    
    return header;
}

/**
 * Save combined audio to WAV file.
 * @param {Buffer} audioData - Combined raw audio data
 * @param {string} outputFile - Output file path
 */
function saveAudioToFile(audioData, outputFile) {
    const wavHeader = createWavHeader(audioData.length);
    const wavFile = Buffer.concat([wavHeader, audioData]);
    fs.writeFileSync(outputFile, wavFile);
    console.log(`Audio saved to: ${outputFile}`);
}

/**
 * Print splice report for quality checking.
 * @param {Array<Object>} splicePoints - Array of splice point info
 * @param {number} totalDuration - Total audio duration
 */
function printSpliceReport(splicePoints, totalDuration) {
    
    if (splicePoints.length === 0) {
        console.log('   No splices - text was short enough for single request');
        return;
    }
    
    console.log(`   Total splices: ${splicePoints.length}`);
    console.log(`   Total duration: ${formatTime(totalDuration)}\n`);
    
    splicePoints.forEach((point, idx) => {
        console.log(`   Splice #${idx + 1}:`);
        console.log(`      Timestamp: ${point.formattedTime}`);
        console.log(`      Character position: ${point.chunkStartChar}`);
        console.log(`      Text: "${point.textPreview}"`);
        console.log('');
    });
}

/**
 * Main function to demonstrate long text TTS synthesis.
 */
async function main() {
    console.log('🎵 Inworld TTS Long Text Synthesis Example');
    
    // Check API key
    const apiKey = checkApiKey();
    if (!apiKey) {
        return 1;
    }
    
    // Configuration
    const voiceId = 'Edward';
    const modelId = 'inworld-tts-1-max';
    const outputFile = 'synthesis_long_output.wav';
    
    // Read input text file
    const inputFile = path.join(__dirname, '..', 'tests-data', 'text', 'chapter1.txt');
    
    let text;
    try {
        text = fs.readFileSync(inputFile, 'utf-8');
        console.log(`Loaded text file: ${inputFile}`);
        console.log(`Total characters: ${text.length}`);
    } catch (error) {
        console.log(`❌ Error reading input file: ${error.message}`);
        return 1;
    }
    
    // Chunk the text
    console.log(`\nChunking text (min ${MIN_CHUNK_SIZE} chars, max ${MAX_CHUNK_SIZE} chars per chunk)...`);
    const chunks = chunkText(text);
    console.log(`Created ${chunks.length} chunks\n`);
    
    // Display chunk info
    chunks.forEach((chunk, i) => {
        console.log(`Chunk ${i + 1}: ${chunk.text.length} chars (positions ${chunk.startChar}-${chunk.endChar})`);
    });
    console.log('');
    
    try {
        const startTime = Date.now();
        
        // Synthesize all chunks in parallel
        console.log('Starting parallel TTS synthesis for all chunks...\n');
        
        const synthesisPromises = chunks.map((chunk, i) => 
            synthesizeSpeech(
                chunk.text, 
                voiceId, 
                modelId, 
                apiKey, 
                i, 
                chunks.length
            )
        );
        
        // Wait for all synthesis requests to complete
        const audioBuffers = await Promise.all(synthesisPromises);
        
        // Combine audio (buffers are already in correct order)
        console.log('\nCombining audio chunks...');
        const { combinedAudio, splicePoints, totalDuration } = combineAudioBuffers(audioBuffers, chunks);
        
        // Save to file
        saveAudioToFile(combinedAudio, outputFile);
        
        const synthesisTime = (Date.now() - startTime) / 1000;
        
        // Print splice report
        printSpliceReport(splicePoints, totalDuration);
        
        console.log(`\nTotal synthesis time: ${synthesisTime.toFixed(2)} seconds`);
        console.log(`Synthesis completed! Output file: ${outputFile}`);
        console.log(`Audio duration: ${formatTime(totalDuration)}`);
        
    } catch (error) {
        console.log(`\nSynthesis failed: ${error.message}`);
        return 1;
    }
    
    return 0;
}

if (require.main === module) {
    main().then(process.exit);
}

module.exports = { chunkText, synthesizeSpeech, combineAudioBuffers };
