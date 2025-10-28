import axios from 'axios';

/**
 * Hume TTS Service
 * Handles Hume text-to-speech processing
 */

class HumeService {
    constructor(audioManager, vadService = null) {
        this.audioManager = audioManager;
        this.vadService = vadService;
    }

    /**
     * Check if API key is valid
     * @returns {boolean} True if API key is valid
     */
    hasValidApiKey() {
        return process.env.HUME_API_KEY && 
               process.env.HUME_API_KEY !== 'your_hume_api_key_here' &&
               process.env.HUME_API_KEY.trim() !== '';
    }

    /**
     * Process Hume TTS
     * @param {string} text - Text to convert to speech
     * @param {Function} sendUpdate - Function to send progress updates
     * @param {string} sessionId - Session ID
     */
    async process(text, sendUpdate, sessionId) {
        const startTime = Date.now();
        
        try {
            if (!this.hasValidApiKey()) {
                console.log('⏭️ Hume: Skipping - no valid API key (0ms)');
                return { timeToFirstByte: 99999, hasAudio: false };
            }

            // Send processing start
            sendUpdate({
                type: 'model_update',
                model: 'hume',
                stage: 'processing',
                progress: 0,
                timestamp: startTime
            });

            console.log('🎙️ Hume: Using real API');
            const result = await this.processReal(text, sendUpdate, sessionId);

            // Send completion
            sendUpdate({
                type: 'model_update',
                model: 'hume',
                stage: 'complete',
                duration: Date.now() - startTime,
                hasAudio: result?.hasAudio || false,
                timestamp: Date.now()
            });

            return result;

        } catch (error) {
            console.error('Hume TTS Error:', error.message);
            sendUpdate({
                type: 'model_update',
                model: 'hume',
                stage: 'error',
                error: error.message,
                timestamp: Date.now()
            });
            throw error;
        }
    }

    /**
     * Process real Hume API call
     * @param {string} text - Text to convert to speech
     * @param {Function} sendUpdate - Function to send progress updates
     * @param {string} sessionId - Session ID
     */
    async processReal(text, sendUpdate, sessionId) {
        // Processing start is already sent by main process method

        sendUpdate({
            type: 'model_update',
            model: 'hume',
            stage: 'processing',
            progress: 100,
            timestamp: Date.now()
        });

        // Track when we start the request for TTFB calculation
        const requestStartTime = Date.now();
        let timeToFirstByte = null;

        // Make actual API call to Hume
        const response = await axios.post(
            'https://api.hume.ai/v0/tts/stream/json',
            {
                utterances: [
                    {
                        text: text,
                        voice: {
                            name: process.env.HUME_VOICE_ID || "Male English Actor",
                            provider: "HUME_AI"
                        }
                    }
                ]
            },
            {
                headers: {
                    'X-Hume-Api-Key': process.env.HUME_API_KEY,
                    'Content-Type': 'application/json'
                },
                responseType: 'stream'
            }
        );

        // Handle streaming response
        let bytesReceived = 0;
        const audioChunks = [];
        let firstAudioChunkReceived = false;
        let totalAudioChunks = 0;
        let buffer = '';
        let totalAudioDuration = 0;
        let firstSpeechTimestamp = null;
        let lastProgressSent = -1; // Track last progress to avoid duplicates
        let lastTimestamp = 0;

        response.data.on('data', (chunk) => {
            bytesReceived += chunk.length;
            buffer += chunk.toString();
            
            // Parse streaming JSON responses line by line
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer
            
            for (const line of lines) {
                if (line.trim()) {
                    try {
                        const data = JSON.parse(line);
                        
                        if (data.audio) {
                            // Decode base64 audio content
                            const audioData = Buffer.from(data.audio, 'base64');
                            audioChunks.push(audioData);
                            totalAudioChunks++;
                            
                            if (!firstAudioChunkReceived) {
                                firstAudioChunkReceived = true;
                                timeToFirstByte = Date.now() - requestStartTime;
                                console.log(`🎵 Hume: First chunk received after ${timeToFirstByte}ms - Size: ${audioData.length} bytes`);
                                
                                // Mark processing as complete when first chunk arrives
                                sendUpdate({
                                    type: 'model_update',
                                    model: 'hume',
                                    stage: 'processing',
                                    progress: 100,
                                    timestamp: Date.now()
                                });
                                
                                // Save first chunk for analysis only if VAD service is available
                                if (this.vadService) {
                                    this.audioManager.saveChunkToDisk(sessionId, 'hume', audioData, totalAudioChunks, 'first_chunk');
                                }
                                
                                // Hume goes straight to speech (no silent prefix)
                                console.log(`🗣️ Hume: Starting speech generation`);
                                sendUpdate({
                                    type: 'model_update',
                                    model: 'hume',
                                    stage: 'speech',
                                    progress: 0,
                                    timestamp: Date.now()
                                });
                            }
                        }
                        
                        // Process chunk index for progress tracking
                        if (data.chunk_index !== undefined) {
                            // Calculate progress based on chunk index
                            // Hume typically sends chunks sequentially
                            const speechProgress = Math.min((data.chunk_index + 1) * 10, 95);
                            
                            // Only send update if progress changed significantly (avoid duplicates)
                            if (speechProgress !== lastProgressSent) {
                                // Estimate duration based on text length and chunk progress
                                const estimatedTotalDuration = Math.round((text.split(/\s+/).length / 150) * 60 * 1000);
                                const currentDuration = Math.round(estimatedTotalDuration * (speechProgress / 100));
                                
                                totalAudioDuration = estimatedTotalDuration;
                                
                                sendUpdate({
                                    type: 'model_update',
                                    model: 'hume',
                                    stage: 'speech',
                                    progress: speechProgress,
                                    duration: currentDuration,
                                    totalDuration: totalAudioDuration,
                                    bytesReceived: audioChunks.reduce((sum, chunk) => sum + chunk.length, 0),
                                    totalChunks: totalAudioChunks,
                                    timestamp: Date.now()
                                });
                                
                                lastProgressSent = speechProgress;
                            }
                        }
                        
                        // Handle final chunk
                        if (data.is_last_chunk === true) {
                            console.log(`🎵 Hume: Received final chunk (${data.chunk_index})`);
                            
                            // Final duration estimation if not set
                            if (totalAudioDuration === 0) {
                                totalAudioDuration = Math.round((text.split(/\s+/).length / 150) * 60 * 1000);
                            }
                        }
                        
                    } catch (parseError) {
                        console.log('Parse error for line:', line.substring(0, 100) + '...', parseError.message);
                        // Continue processing other lines
                    }
                }
            }
        });

        await new Promise((resolve, reject) => {
            response.data.on('end', async () => {
                let completeAudioPath = null; // Declare at proper scope
                let hasAudio = false;
                
                if (audioChunks.length > 0) {
                    // Store audio data - use proper concatenation and conversion for better quality
                    let finalAudioBuffer;
                    
                    if (audioChunks.length === 1) {
                        // Single chunk - just convert sample rate
                        const convertedAudio = await this.convertAudioSampleRate(audioChunks[0], sessionId);
                        finalAudioBuffer = convertedAudio || audioChunks[0];
                    } else {
                        // Multiple chunks - use proper concatenation method
                        finalAudioBuffer = await this.concatenateAndConvertAudioChunks(audioChunks, sessionId);
                    }
                    
                    this.audioManager.storeAudio(sessionId, 'hume', finalAudioBuffer);
                    hasAudio = true;
                    console.log(`✅ Hume: Total audio duration (estimated): ${totalAudioDuration}ms`);
                    console.log(`Total chunks: ${totalAudioChunks}`);
                    
                    // NEW: Save complete audio file to disk for VAD and duration analysis
                    completeAudioPath = this.audioManager.saveCompleteAudio(sessionId, 'hume', finalAudioBuffer);
                    
                    // Get accurate duration from the complete audio file (not first chunk)
                    let accurateDuration = totalAudioDuration;
                    if (completeAudioPath) {
                        try {
                            const ffmpegDuration = await this.audioManager.getAudioDuration(sessionId, 'hume', 'complete');
                            if (ffmpegDuration !== null) {
                                accurateDuration = ffmpegDuration;
                                console.log(`📏 Hume: Corrected duration from ${totalAudioDuration}ms to ${accurateDuration}ms (complete file)`);
                            }
                        } catch (error) {
                            console.warn(`Hume: Could not get accurate duration from complete file, using estimated: ${error.message}`);
                        }
                    }
                    
                    // Send final speech completion with accurate duration
                    sendUpdate({
                        type: 'model_update',
                        model: 'hume',
                        stage: 'speech',
                        progress: 100,
                        duration: accurateDuration,
                        totalDuration: accurateDuration,
                        timestamp: Date.now()
                    });
                } else {
                    // If we still don't have duration, estimate it one final time
                    if (totalAudioDuration === 0) {
                        totalAudioDuration = Math.round((text.split(/\s+/).length / 150) * 60 * 1000);
                        console.log(`📝 Hume: Final fallback duration estimate: ${totalAudioDuration}ms`);
                    }
                    
                    // Send final speech completion without audio
                    sendUpdate({
                        type: 'model_update',
                        model: 'hume',
                        stage: 'speech',
                        progress: 100,
                        duration: totalAudioDuration,
                        totalDuration: totalAudioDuration,
                        timestamp: Date.now()
                    });
                }
                
                // VAD analysis will be handled by the graph node
                
                resolve();
            });
            response.data.on('error', reject);
        });

        // Return the time to first byte and whether audio was generated
        return { timeToFirstByte, hasAudio: audioChunks.length > 0 };
    }

    /**
     * Simulate Hume TTS when no API key is provided
     * @param {string} text - Text to convert to speech
     * @param {Function} sendUpdate - Function to send progress updates
     * @param {number} startTime - Start timestamp
     * @param {string} sessionId - Session ID
     */
    async simulate(text, sendUpdate, startTime, sessionId) {
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 350));
        
        // Mark processing as complete
        sendUpdate({
            type: 'model_update',
            model: 'hume',
            stage: 'processing',
            progress: 100,
            timestamp: Date.now()
        });
        
        // Start speech generation immediately (no silent prefix)
        sendUpdate({
            type: 'model_update',
            model: 'hume',
            stage: 'speech',
            progress: 0,
            timestamp: Date.now()
        });
        
        await new Promise(resolve => setTimeout(resolve, 100));

        // Simulate streaming speech
        const streamDuration = Math.min(text.length * 32, 3200);
        const chunks = 8;
        for (let i = 0; i <= chunks; i++) {
            sendUpdate({
                type: 'model_update',
                model: 'hume',
                stage: 'speech',
                progress: (i / chunks) * 100,
                timestamp: Date.now()
            });
            await new Promise(resolve => setTimeout(resolve, streamDuration / chunks));
        }
    }

    /**
     * Properly concatenate and convert multiple audio chunks to prevent clipping
     * @param {Buffer[]} audioChunks - Array of audio chunk buffers
     * @param {string} sessionId - Session ID for temporary files
     * @returns {Promise<Buffer>} Final concatenated and converted audio buffer
     */
    async concatenateAndConvertAudioChunks(audioChunks, sessionId) {
        try {
            const { spawn } = await import('child_process');
            const fs = await import('fs');
            const path = await import('path');
            
            const audioDir = this.audioManager.getAudioDirectory();
            const tempDir = path.join(audioDir, `${sessionId}_hume_temp`);
            
            // Create temporary directory
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            // Save each chunk as a separate file
            const chunkFiles = [];
            for (let i = 0; i < audioChunks.length; i++) {
                const chunkPath = path.join(tempDir, `chunk_${i}.mp3`);
                fs.writeFileSync(chunkPath, audioChunks[i]);
                chunkFiles.push(chunkPath);
            }
            
            // Create ffmpeg concat file
            const concatFilePath = path.join(tempDir, 'concat.txt');
            const concatContent = chunkFiles.map(file => `file '${file}'`).join('\n');
            fs.writeFileSync(concatFilePath, concatContent);
            
            const outputPath = path.join(tempDir, 'final.mp3');
            
            // Use ffmpeg to properly concatenate and convert
            const ffmpeg = spawn('ffmpeg', [
                '-f', 'concat',
                '-safe', '0',
                '-i', concatFilePath,
                '-ar', '44100',  // Convert to 44.1kHz
                '-ac', '1',      // Mono
                '-acodec', 'libmp3lame',  // Use LAME encoder
                '-ab', '128k',   // 128kbps bitrate
                '-af', 'volume=1.0,aresample=44100',  // Normalize and resample
                '-avoid_negative_ts', 'make_zero',
                '-y',
                outputPath
            ]);
            
            await new Promise((resolve, reject) => {
                let ffmpegError = '';
                
                ffmpeg.stderr?.on('data', (data) => {
                    ffmpegError += data.toString();
                });
                
                ffmpeg.on('close', (code) => {
                    if (code === 0) {
                        console.log(`🔄 Hume: Audio chunks concatenated and converted successfully`);
                        resolve();
                    } else {
                        console.error(`🔄 Hume: Concatenation failed with code ${code}`);
                        console.error(`FFmpeg stderr: ${ffmpegError}`);
                        reject(new Error(`Concatenation failed: ${ffmpegError}`));
                    }
                });
                
                ffmpeg.on('error', reject);
            });
            
            // Read final file
            const finalBuffer = fs.readFileSync(outputPath);
            
            // Clean up temporary directory
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (cleanupError) {
                console.warn('Failed to clean up temp directory:', cleanupError.message);
            }
            
            console.log(`🔄 Hume: ${audioChunks.length} chunks concatenated and converted (${finalBuffer.length} bytes)`);
            return finalBuffer;
            
        } catch (error) {
            console.error('Audio concatenation failed:', error.message);
            console.log('🔄 Hume: Falling back to simple concatenation');
            
            // Fallback to simple concatenation and conversion
            const simpleBuffer = Buffer.concat(audioChunks);
            const convertedAudio = await this.convertAudioSampleRate(simpleBuffer, sessionId);
            return convertedAudio || simpleBuffer;
        }
    }

    /**
     * Convert audio sample rate from 48kHz to 44.1kHz for better browser compatibility
     * @param {Buffer} audioBuffer - Original audio buffer
     * @param {string} sessionId - Session ID for temporary files
     * @returns {Promise<Buffer|null>} Converted audio buffer or null if conversion failed
     */
    async convertAudioSampleRate(audioBuffer, sessionId) {
        try {
            const { spawn } = await import('child_process');
            const fs = await import('fs');
            const path = await import('path');
            
            const audioDir = this.audioManager.getAudioDirectory();
            const inputPath = path.join(audioDir, `${sessionId}_hume_temp_input.mp3`);
            const outputPath = path.join(audioDir, `${sessionId}_hume_temp_output.mp3`);
            
            // Write input file
            fs.writeFileSync(inputPath, audioBuffer);
            
            // Use ffmpeg to convert sample rate with better quality settings
            const ffmpeg = spawn('ffmpeg', [
                '-i', inputPath,
                '-ar', '44100',  // Convert to 44.1kHz
                '-ac', '1',      // Mono
                '-acodec', 'libmp3lame',  // Use LAME encoder for better quality
                '-ab', '128k',   // 128kbps bitrate
                '-af', 'volume=1.0',  // Normalize volume to prevent clipping
                '-avoid_negative_ts', 'make_zero',  // Fix timing issues
                '-y',            // Overwrite output file
                outputPath
            ]);
            
            await new Promise((resolve, reject) => {
                let ffmpegOutput = '';
                let ffmpegError = '';
                
                // Capture stdout and stderr for debugging
                ffmpeg.stdout?.on('data', (data) => {
                    ffmpegOutput += data.toString();
                });
                
                ffmpeg.stderr?.on('data', (data) => {
                    ffmpegError += data.toString();
                });
                
                ffmpeg.on('close', (code) => {
                    if (code === 0) {
                        console.log(`🔄 Hume: FFmpeg conversion successful`);
                        resolve();
                    } else {
                        console.error(`🔄 Hume: FFmpeg failed with code ${code}`);
                        console.error(`FFmpeg stderr: ${ffmpegError}`);
                        reject(new Error(`FFmpeg process exited with code ${code}: ${ffmpegError}`));
                    }
                });
                
                ffmpeg.on('error', (err) => {
                    console.error(`🔄 Hume: FFmpeg spawn error:`, err);
                    reject(err);
                });
            });
            
            // Read converted file
            const convertedBuffer = fs.readFileSync(outputPath);
            
            // Clean up temporary files
            try {
                fs.unlinkSync(inputPath);
                fs.unlinkSync(outputPath);
            } catch (cleanupError) {
                console.warn('Failed to clean up temp files:', cleanupError.message);
            }
            
            console.log(`🔄 Hume: Audio converted from 48kHz to 44.1kHz (${audioBuffer.length} -> ${convertedBuffer.length} bytes)`);
            return convertedBuffer;
            
        } catch (error) {
            console.error('Audio conversion failed:', error.message);
            console.log('🔄 Hume: Using original audio without conversion');
            return null;
        }
    }

    /**
     * Perform VAD analysis on complete audio file (NEW METHOD)
     * @param {string} sessionId - Session ID
     * @param {string} model - Model name
     * @param {Function} sendUpdate - Function to send progress updates
     */
    async performVADAnalysisOnComplete(sessionId, model, sendUpdate) {
        try {
            console.log(`🔍 ${model}: Starting VAD analysis on complete audio...`);
            
            // Use the new method to analyze complete audio file
            const vadResult = await this.vadService.analyzeCompleteAudioFile(sessionId, model, this.audioManager);
            
            if (vadResult.success) {
                console.log(`🔍 ${model}: VAD detected ${vadResult.msBeforeVoice}ms of silence before speech (complete audio)`);
                
                // Send VAD results to frontend
                sendUpdate({
                    type: 'vad_analysis',
                    model: model,
                    vadResult: vadResult,
                    timestamp: Date.now()
                });
            } else {
                console.log(`🔍 ${model}: VAD analysis failed - ${vadResult.message}`);
            }
            
        } catch (error) {
            console.error(`🔍 ${model}: VAD analysis error:`, error);
        }
    }

    /**
     * Perform VAD analysis on generated audio (LEGACY - for first chunk)
     * @param {string} sessionId - Session ID
     * @param {string} model - Model name
     * @param {Function} sendUpdate - Function to send progress updates
     */
    async performVADAnalysis(sessionId, model, sendUpdate) {
        try {
            console.log(`🔍 ${model}: Starting VAD analysis...`);
            
            // Get the first chunk file path
            const audioDir = this.audioManager.getAudioDirectory();
            const audioFilePath = `${audioDir}/${sessionId}_${model}_first_chunk.mp3`;
            
            // Perform VAD analysis with session and model info
            const vadResult = await this.vadService.analyzeAudioFile(audioFilePath, sessionId, model, this.audioManager);
            
            if (vadResult.success) {
                console.log(`🔍 ${model}: VAD detected ${vadResult.msBeforeVoice}ms of silence before speech`);
                
                // Send VAD results to frontend
                sendUpdate({
                    type: 'vad_analysis',
                    model: model,
                    vadResult: vadResult,
                    timestamp: Date.now()
                });
            } else {
                console.log(`🔍 ${model}: VAD analysis failed - ${vadResult.message}`);
            }
            
        } catch (error) {
            console.error(`🔍 ${model}: VAD analysis error:`, error);
        }
    }
}

export default HumeService;
