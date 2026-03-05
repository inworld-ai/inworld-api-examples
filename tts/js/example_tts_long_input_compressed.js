#!/usr/bin/env node
/**
 * Example script for Inworld TTS synthesis with long text input (MP3 compressed).
 *
 * This script demonstrates how to synthesize speech from long text by:
 * 1. Chunking text at natural boundaries (paragraphs → newlines → sentences)
 * 2. Processing chunks through the TTS API with controlled concurrency
 * 3. Merging segment outputs with ffmpeg so duration/playback are correct
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

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
            
            const response = await fetch(url, {
                method: 'POST',
                headers: headers,
                body: JSON.stringify(requestData)
            });
            
            // Check for rate limit or other HTTP errors
            if (!response.ok) {
                const isRateLimit = response.status === 429;
                const isLastAttempt = attempt === MAX_RETRIES - 1;
                
                if (isRateLimit && !isLastAttempt) {
                    const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
                    console.log(`[${chunkIndex + 1}/${totalChunks}] Rate limited, retrying in ${delay}ms...`);
                    await sleep(delay);
                    continue;
                }
                
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
            const audioData = Buffer.from(result.audioContent, 'base64');
            
            console.log(`[${chunkIndex + 1}/${totalChunks}] Done - ${audioData.length} bytes`);
            
            return audioData;
            
        } catch (error) {
            const isRateLimit = error.message.includes('429');
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
 * Combine multiple audio buffers into one by raw concatenation.
 * Note: Each API response is a complete MP3 file (with its own header/duration). Raw concat
 * produces a file that players and duration tools interpret as only the first segment (e.g. 1:00),
 * so the reported duration/playback metadata may be incorrect.
 *
 * Prefer mergeMp3SegmentsWithFfmpeg() when ffmpeg is available, as it produces a single MP3 with
 * correct duration and playback. This function is intended as a fallback when ffmpeg is not
 * available or cannot be used.
 * @param {Array<Buffer>} audioBuffers - Audio buffers to combine
 * @returns {Buffer} Combined audio
 */
function combineAudioBuffers(audioBuffers) {
    return Buffer.concat(audioBuffers);
}

/**
 * Merge multiple MP3 buffers into one file with correct duration using ffmpeg.
 * Each non-streaming API response is a full MP3; raw concat makes duration/show length wrong.
 * @param {Array<Buffer>} audioBuffers - One MP3 buffer per segment
 * @param {string} outputFile - Output path for merged MP3
 * @returns {boolean} true if merged with ffmpeg, false if ffmpeg unavailable (caller should fall back)
 */
function mergeMp3SegmentsWithFfmpeg(audioBuffers, outputFile) {
    const tmpDir = path.join(os.tmpdir(), `inworld-tts-long-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
        const listPath = path.join(tmpDir, 'list.txt');
        const segPaths = [];
        for (let i = 0; i < audioBuffers.length; i++) {
            const segPath = path.join(tmpDir, `seg_${i}.mp3`);
            fs.writeFileSync(segPath, audioBuffers[i]);
            segPaths.push(segPath);
        }
        // ffmpeg concat demuxer: paths must be escaped for ' in file names
        const listContent = segPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
        fs.writeFileSync(listPath, listContent);
        execFileSync('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outputFile], {
            stdio: ['ignore', 'pipe', 'pipe']
        });
        return true;
    } catch (e) {
        const ffmpegNotFound = e && (e.code === 'ENOENT' || (e.message && e.message.includes('ffmpeg')));
        if (ffmpegNotFound) {
            console.log('   (ffmpeg not found; saving raw concatenation — duration may show as first segment only)');
        } else {
            console.error('   (ffmpeg failed while merging MP3 segments; falling back to raw concatenation)');
            console.error('   Error:', e && e.message ? e.message : e);
            if (e && e.stderr) {
                try {
                    const stderrStr = typeof e.stderr === 'string' ? e.stderr : e.stderr.toString();
                    if (stderrStr) {
                        console.error('   ffmpeg stderr:\n' + stderrStr);
                    }
                } catch (_) {}
            }
        }
        return false;
    } finally {
        try {
            const files = fs.readdirSync(tmpDir);
            for (const f of files) fs.unlinkSync(path.join(tmpDir, f));
            fs.rmdirSync(tmpDir);
        } catch (_) {}
    }
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
    const modelId = 'inworld-tts-1.5-max';
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
        
        // Merge audio (ffmpeg gives correct duration; raw concat would show first segment only)
        console.log('\nMerging audio...');
        const mergedWithFfmpeg = mergeMp3SegmentsWithFfmpeg(audioBuffers, outputFile);
        if (!mergedWithFfmpeg) {
            const combinedAudio = combineAudioBuffers(audioBuffers);
            saveAudioToFile(combinedAudio, outputFile);
        } else {
            console.log(`Audio saved to: ${outputFile}`);
        }

        const fileSizeKB = (fs.statSync(outputFile).size / 1024).toFixed(1);
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

module.exports = { chunkText, synthesizeSpeech, combineAudioBuffers, mergeMp3SegmentsWithFfmpeg, synthesizeAllChunks };
