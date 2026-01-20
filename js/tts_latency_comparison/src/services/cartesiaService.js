import axios from 'axios';

/**
 * Cartesia TTS Service
 * Handles Cartesia text-to-speech processing
 */

class CartesiaService {
    constructor(audioManager, vadService = null) {
        this.audioManager = audioManager;
        this.vadService = vadService;
    }

    /**
     * Check if API key is valid
     * @returns {boolean} True if API key is valid
     */
    hasValidApiKey() {
        return process.env.CARTESIA_API_KEY && 
               process.env.CARTESIA_API_KEY !== 'your_cartesia_api_key_here' &&
               process.env.CARTESIA_API_KEY.trim() !== '';
    }

    /**
     * Process Cartesia TTS
     * @param {string} text - Text to convert to speech
     * @param {Function} sendUpdate - Function to send progress updates
     * @param {string} sessionId - Session ID
     */
    async process(text, sendUpdate, sessionId) {
        const startTime = Date.now();
        
        try {
            if (!this.hasValidApiKey()) {
                console.log('⏭️ Cartesia: Skipping - no valid API key (0ms)');
                return { timeToFirstByte: 99999, hasAudio: false };
            }

            // Send processing start
            sendUpdate({
                type: 'model_update',
                model: 'cartesia',
                stage: 'processing',
                progress: 0,
                timestamp: startTime
            });

            console.log('🎙️ Cartesia: Using real API');
            const result = await this.processReal(text, sendUpdate, sessionId);

            // Send completion
            sendUpdate({
                type: 'model_update',
                model: 'cartesia',
                stage: 'complete',
                duration: Date.now() - startTime,
                hasAudio: result?.hasAudio || false,
                timestamp: Date.now()
            });

            return result;

        } catch (error) {
            console.error('Cartesia TTS Error:', error.message);
            sendUpdate({
                type: 'model_update',
                model: 'cartesia',
                stage: 'error',
                error: error.message,
                timestamp: Date.now()
            });
            throw error;
        }
    }

    /**
     * Process real Cartesia API call
     * @param {string} text - Text to convert to speech
     * @param {Function} sendUpdate - Function to send progress updates
     * @param {string} sessionId - Session ID
     */
    async processReal(text, sendUpdate, sessionId) {
        // Processing start is already sent by main process method

        // Track when we start the request for TTFB calculation
        const requestStartTime = Date.now();
        let timeToFirstByte = null;

        // Make actual API call to Cartesia using streaming SSE endpoint
        const voiceId = process.env.CARTESIA_VOICE_ID || '694f9389-aac1-45b6-b726-9d9369183238';

        const response = await axios.post(
            'https://api.cartesia.ai/tts/sse',
            {
                model_id: 'sonic-2',
                transcript: text,
                voice: {
                    mode: 'id',
                    id: voiceId
                },
                output_format: {
                    container: 'raw',
                    encoding: 'pcm_f32le',
                    sample_rate: 44100
                },
                language: 'en'
            },
            {
                headers: {
                    'Cartesia-Version': '2024-06-10',
                    'X-API-Key': process.env.CARTESIA_API_KEY,
                    'Content-Type': 'application/json'
                },
                responseType: 'stream'
            }
        );

        // Handle streaming SSE response
        let bytesReceived = 0;
        const audioChunks = [];
        let firstAudioChunkReceived = false;
        let totalAudioChunks = 0;
        let buffer = '';
        let totalAudioDuration = 0;
        let isComplete = false;
        let lastProgressSent = -1; // Track last progress to avoid duplicates

        response.data.on('data', (chunk) => {
            bytesReceived += chunk.length;
            buffer += chunk.toString();
            
            // Parse SSE events line by line
            const lines = buffer.split('\n');
            buffer = lines.pop() || ''; // Keep incomplete line in buffer
            
            for (const line of lines) {
                if (line.trim()) {
                    try {
                        // Parse SSE format: "event: chunk" and "data: {...}"
                        if (line.startsWith('event:')) {
                            // Event type line - we care about 'chunk' and 'done' events
                            const eventType = line.substring(6).trim(); // Remove "event:" prefix
                            // Store event type for next data line processing
                            continue;
                        } else if (line.startsWith('data:')) {
                            // Extract JSON data from SSE data line
                            const jsonData = line.substring(5).trim(); // Remove "data:" prefix
                            const data = JSON.parse(jsonData);
                            
                            if (data.type === 'chunk' && data.data && !data.done) {
                                // Decode base64 audio content from streaming chunk
                                const audioData = Buffer.from(data.data, 'base64');
                                audioChunks.push(audioData);
                                totalAudioChunks++;
                                
                                if (!firstAudioChunkReceived) {
                                    firstAudioChunkReceived = true;
                                    timeToFirstByte = Date.now() - requestStartTime;
                                    console.log(`🎵 Cartesia: First chunk received after ${timeToFirstByte}ms - Size: ${audioData.length} bytes`);
                                    
                                    // Mark processing as complete when first chunk arrives
                                    sendUpdate({
                                        type: 'model_update',
                                        model: 'cartesia',
                                        stage: 'processing',
                                        progress: 100,
                                        timestamp: Date.now()
                                    });
                                    
                                    // Save first chunk for analysis only if VAD service is available
                                    // Convert PCM chunk to MP3 for VAD analysis
                                    if (this.vadService) {
                                        // Save raw PCM first chunk for now - conversion will happen at the end
                                        this.audioManager.saveChunkToDisk(sessionId, 'cartesia', audioData, totalAudioChunks, 'first_chunk');
                                    }
                                    
                                    // Cartesia goes straight to speech (no silent prefix)
                                    console.log(`🗣️ Cartesia: Starting speech generation`);
                                    sendUpdate({
                                        type: 'model_update',
                                        model: 'cartesia',
                                        stage: 'speech',
                                        progress: 0,
                                        timestamp: Date.now()
                                    });
                                }
                                
                                // Estimate progress based on chunks received
                                // Since we don't have timing data, estimate based on text length and chunks
                                const estimatedTotalDuration = Math.round((text.split(/\s+/).length / 150) * 60 * 1000);
                                const speechProgress = Math.min((totalAudioChunks * 10), 95);
                                const currentDuration = Math.round(estimatedTotalDuration * (speechProgress / 100));
                                
                                totalAudioDuration = estimatedTotalDuration;
                                
                                // Only send update if progress changed significantly (avoid duplicates)
                                if (speechProgress !== lastProgressSent) {
                                    sendUpdate({
                                        type: 'model_update',
                                        model: 'cartesia',
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
                                
                                console.log(`🎵 Cartesia: Chunk ${totalAudioChunks} received - Size: ${audioData.length} bytes, Progress: ${speechProgress}%`);
                            } else if (data.type === 'chunk' && data.done === true) {
                                // Final chunk received - stream is complete
                                isComplete = true;
                                console.log(`🎵 Cartesia: Stream complete after ${totalAudioChunks} chunks`);
                            } else if (data.type === 'done' && data.done === true && data.status_code === 200) {
                                // Stream completion signal with successful status
                                isComplete = true;
                                console.log(`🎵 Cartesia: Stream done signal received after ${totalAudioChunks} chunks (status: ${data.status_code})`);
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
            let resolved = false;
            
            // Function to handle completion
            const handleCompletion = async () => {
                if (resolved) return;
                resolved = true;
                
                console.log(`🎵 Cartesia: Processing completion with ${audioChunks.length} chunks`);
                let completeAudioPath = null; // Declare at proper scope
                
                let hasAudio = false;
                if (audioChunks.length > 0) {
                    // Store audio data in memory - convert PCM to a usable format
                    const audioBuffer = await this.convertPCMToMP3(audioChunks, sessionId);
                    this.audioManager.storeAudio(sessionId, 'cartesia', audioBuffer);
                    hasAudio = true;
                    console.log(`✅ Cartesia: Total audio duration (estimated): ${totalAudioDuration}ms`);
                    console.log(`Total chunks: ${totalAudioChunks}`);
                    
                    // Save complete audio file to disk for VAD and duration analysis
                    completeAudioPath = this.audioManager.saveCompleteAudio(sessionId, 'cartesia', audioBuffer);
                    
                    // Get accurate duration from the complete audio file
                    let accurateDuration = totalAudioDuration;
                    if (completeAudioPath) {
                        try {
                            const ffmpegDuration = await this.audioManager.getAudioDuration(sessionId, 'cartesia', 'complete');
                            if (ffmpegDuration !== null) {
                                accurateDuration = ffmpegDuration;
                                console.log(`📏 Cartesia: Corrected duration from ${totalAudioDuration}ms to ${accurateDuration}ms (complete file)`);
                            }
                        } catch (error) {
                            console.warn(`Cartesia: Could not get accurate duration from complete file, using estimated: ${error.message}`);
                        }
                    }
                    
                    // Send final speech completion with accurate duration
                    sendUpdate({
                        type: 'model_update',
                        model: 'cartesia',
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
                        console.log(`📝 Cartesia: Final fallback duration estimate: ${totalAudioDuration}ms`);
                    }
                    
                    // Send final speech completion without audio
                    sendUpdate({
                        type: 'model_update',
                        model: 'cartesia',
                        stage: 'speech',
                        progress: 100,
                        duration: totalAudioDuration,
                        totalDuration: totalAudioDuration,
                        timestamp: Date.now()
                    });
                }
                
                // VAD analysis will be handled by the graph node
                
                resolve();
            };
            
            // Handle completion when done event is detected
            const checkCompletion = () => {
                if (isComplete && !resolved) {
                    console.log(`🎵 Cartesia: Triggering completion handler`);
                    handleCompletion();
                }
            };
            
            // Check for completion periodically
            const completionChecker = setInterval(() => {
                checkCompletion();
                if (resolved) {
                    clearInterval(completionChecker);
                }
            }, 100);
            
            // Also handle natural stream end
            response.data.on('end', async () => {
                console.log(`🎵 Cartesia: Stream ended naturally`);
                clearInterval(completionChecker);
                await handleCompletion();
            });
            
            response.data.on('error', (error) => {
                clearInterval(completionChecker);
                reject(error);
            });
            
            // Timeout after 30 seconds to prevent hanging
            setTimeout(() => {
                if (!resolved) {
                    console.log(`🎵 Cartesia: Stream timeout after 30s, forcing completion`);
                    clearInterval(completionChecker);
                    handleCompletion();
                }
            }, 30000);
        });

        // Return the time to first byte and whether audio was generated
        return { timeToFirstByte, hasAudio: audioChunks.length > 0 };
    }

    /**
     * Simulate Cartesia TTS when no API key is provided
     * @param {string} text - Text to convert to speech
     * @param {Function} sendUpdate - Function to send progress updates
     * @param {number} startTime - Start timestamp
     * @param {string} sessionId - Session ID
     */
    async simulate(text, sendUpdate, startTime, sessionId) {
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 200));
        
        // Mark processing as complete
        sendUpdate({
            type: 'model_update',
            model: 'cartesia',
            stage: 'processing',
            progress: 100,
            timestamp: Date.now()
        });
        
        // Start speech generation immediately (no silent prefix)
        sendUpdate({
            type: 'model_update',
            model: 'cartesia',
            stage: 'speech',
            progress: 0,
            timestamp: Date.now()
        });
        
        await new Promise(resolve => setTimeout(resolve, 50));

        // Simulate streaming speech
        const streamDuration = Math.min(text.length * 25, 2500);
        const chunks = 10;
        for (let i = 0; i <= chunks; i++) {
            sendUpdate({
                type: 'model_update',
                model: 'cartesia',
                stage: 'speech',
                progress: (i / chunks) * 100,
                timestamp: Date.now()
            });
            await new Promise(resolve => setTimeout(resolve, streamDuration / chunks));
        }
    }

    /**
     * Convert PCM audio chunks to MP3 format
     * @param {Buffer[]} audioChunks - Array of PCM audio chunk buffers
     * @param {string} sessionId - Session ID for temporary files
     * @returns {Promise<Buffer>} Converted MP3 audio buffer
     */
    async convertPCMToMP3(audioChunks, sessionId) {
        try {
            const { spawn } = await import('child_process');
            const fs = await import('fs');
            const path = await import('path');
            
            const audioDir = this.audioManager.getAudioDirectory();
            const inputPath = path.join(audioDir, `${sessionId}_cartesia_temp_input.raw`);
            const outputPath = path.join(audioDir, `${sessionId}_cartesia_temp_output.mp3`);
            
            // Concatenate all PCM chunks
            const pcmBuffer = Buffer.concat(audioChunks);
            
            // Write PCM data to temporary file
            fs.writeFileSync(inputPath, pcmBuffer);
            
            // Use ffmpeg to convert PCM to MP3
            const ffmpeg = spawn('ffmpeg', [
                '-f', 'f32le',        // Input format: 32-bit float little-endian PCM
                '-ar', '44100',       // Sample rate: 44.1kHz
                '-ac', '1',           // Channels: mono
                '-i', inputPath,      // Input file
                '-acodec', 'libmp3lame',  // Output codec: MP3
                '-ab', '128k',        // Bitrate: 128kbps
                '-ar', '44100',       // Output sample rate: 44.1kHz
                '-ac', '1',           // Output channels: mono
                '-af', 'volume=1.0',  // Normalize volume
                '-y',                 // Overwrite output file
                outputPath
            ]);
            
            await new Promise((resolve, reject) => {
                let ffmpegError = '';
                
                ffmpeg.stderr?.on('data', (data) => {
                    ffmpegError += data.toString();
                });
                
                ffmpeg.on('close', (code) => {
                    if (code === 0) {
                        console.log(`🔄 Cartesia: PCM to MP3 conversion successful`);
                        resolve();
                    } else {
                        console.error(`🔄 Cartesia: FFmpeg failed with code ${code}`);
                        console.error(`FFmpeg stderr: ${ffmpegError}`);
                        reject(new Error(`PCM conversion failed: ${ffmpegError}`));
                    }
                });
                
                ffmpeg.on('error', reject);
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
            
            console.log(`🔄 Cartesia: ${audioChunks.length} PCM chunks converted to MP3 (${pcmBuffer.length} -> ${convertedBuffer.length} bytes)`);
            return convertedBuffer;
            
        } catch (error) {
            console.error('PCM to MP3 conversion failed:', error.message);
            console.log('🔄 Cartesia: Falling back to raw PCM data');
            
            // Fallback to concatenated raw PCM data
            return Buffer.concat(audioChunks);
        }
    }

    /**
     * Perform VAD analysis on complete audio file
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
}

export default CartesiaService;
