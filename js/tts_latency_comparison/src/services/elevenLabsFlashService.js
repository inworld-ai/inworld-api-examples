
/**
 * ElevenLabs Flash TTS Service
 * Handles ElevenLabs eleven_flash_v2_5 text-to-speech processing
 */

class ElevenLabsFlashService {
    constructor(audioManager, vadService = null) {
        this.audioManager = audioManager;
        this.vadService = vadService;
    }

    /**
     * Check if API key is valid
     * @returns {boolean} True if API key is valid
     */
    hasValidApiKey() {
        return process.env.ELEVENLABS_API_KEY && 
               process.env.ELEVENLABS_API_KEY !== 'your_elevenlabs_api_key_here' &&
               process.env.ELEVENLABS_API_KEY.trim() !== '';
    }

    /**
     * Process ElevenLabs Flash TTS
     * @param {string} text - Text to convert to speech
     * @param {Function} sendUpdate - Function to send progress updates
     * @param {string} sessionId - Session ID
     */
    async process(text, sendUpdate, sessionId) {
        const startTime = Date.now();
        
        try {
            if (!this.hasValidApiKey()) {
                console.log(' ElevenLabs Flash: Skipping - no valid API key (0ms)');
                return { timeToFirstByte: 99999, hasAudio: false };
            }

            // Send processing start
            sendUpdate({
                type: 'model_update',
                model: 'elevenlabs-flash',
                stage: 'processing',
                progress: 0,
                timestamp: startTime
            });

            console.log(' ElevenLabs Flash: Using real API');
            const result = await this.processReal(text, sendUpdate, sessionId);

            // Send completion
            sendUpdate({
                type: 'model_update',
                model: 'elevenlabs-flash',
                stage: 'complete',
                duration: Date.now() - startTime,
                hasAudio: result?.hasAudio || false,
                timestamp: Date.now()
            });

            return result;

        } catch (error) {
            console.error('ElevenLabs Flash TTS Error:', error.message);
            sendUpdate({
                type: 'model_update',
                model: 'elevenlabs-flash',
                stage: 'error',
                error: error.message,
                timestamp: Date.now()
            });
            throw error;
        }
    }

    /**
     * Process real ElevenLabs API call
     * @param {string} text - Text to convert to speech
     * @param {Function} sendUpdate - Function to send progress updates
     * @param {string} sessionId - Session ID
     */
    async processReal(text, sendUpdate, sessionId) {
        // Send processing completion signal (start is already sent by main process method)
        sendUpdate({
            type: 'model_update',
            model: 'elevenlabs-flash',
            stage: 'processing',
            progress: 100,
            timestamp: Date.now()
        });

        // Track when we start the request for TTFB calculation
        const requestStartTime = Date.now();
        let timeToFirstByte = null;

        // Make actual API call to ElevenLabs with flash model and specific voice
        const voiceId = process.env.ELEVENLABS_FLASH_VOICE_ID || '4YYIPFl9wE5c4L2eu2Gb';

        const response = await fetch(
            `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}/stream/with-timestamps`,
            {
                text: text,
                model_id: 'eleven_flash_v2_5',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75
                }
            },
            {
                headers: {
                    'xi-api-key': process.env.ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json'
                },
                params: {
                    output_format: 'mp3_44100_128',
                    optimize_streaming_latency: 3
                },
                responseType: 'stream'
            }
        );

        // Handle streaming response with timestamps
        let bytesReceived = 0;
        const audioChunks = [];
        let firstAudioChunkReceived = false;
        let totalAudioChunks = 0;
        let buffer = '';
        let silentPrefixDuration = 0;
        let totalAudioDuration = 0;
        let firstSpeechTimestamp = null;
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
                        
                        if (data.audio_base64) {
                            // Decode base64 audio content
                            const audioData = Buffer.from(data.audio_base64, 'base64');
                            audioChunks.push(audioData);
                            totalAudioChunks++;
                            
                            if (!firstAudioChunkReceived) {
                                firstAudioChunkReceived = true;
                                timeToFirstByte = Date.now() - requestStartTime;
                                console.log(`ElevenLabs Flash: First chunk received after ${timeToFirstByte}ms - Size: ${audioData.length} bytes`);
                                
                                // Mark processing as complete when first chunk arrives
                                sendUpdate({
                                    type: 'model_update',
                                    model: 'elevenlabs-flash',
                                    stage: 'processing',
                                    progress: 100,
                                    timestamp: Date.now()
                                });
                                
                                // Save first chunk for analysis only if VAD service is available
                                if (this.vadService) {
                                    this.audioManager.saveChunkToDisk(sessionId, 'elevenlabs-flash', audioData, totalAudioChunks, 'first_chunk');
                                }
                            }
                        }
                        
                        // Process alignment data for timing
                        if (data.alignment) {
                            const characters = data.alignment.characters || [];
                            const startTimes = data.alignment.character_start_times_seconds || [];
                            const endTimes = data.alignment.character_end_times_seconds || [];
                            
                            if (startTimes.length > 0 && endTimes.length > 0) {
                                const firstCharTime = startTimes[0];
                                const lastCharTime = endTimes[endTimes.length - 1];
                                
                                // Update timing information
                                if (firstSpeechTimestamp === null) {
                                    firstSpeechTimestamp = firstCharTime;
                                    
                                    // ElevenLabs now goes straight to speech like Inworld (no silent prefix stage)
                                    // VAD analysis will handle actual silence detection
                                    console.log(` ElevenLabs Flash: Starting speech generation`);
                                    sendUpdate({
                                        type: 'model_update',
                                        model: 'elevenlabs-flash',
                                        stage: 'speech',
                                        progress: 0,
                                        timestamp: Date.now()
                                    });
                                }
                                
                                // Update total audio duration and speech progress
                                lastTimestamp = lastCharTime;
                                totalAudioDuration = Math.round(lastCharTime * 1000); // Convert to ms
                                const speechDuration = Math.round((lastCharTime - firstCharTime) * 1000);
                                
                                // Calculate speech progress based on characters processed
                                const totalCharacters = characters.join('').length;
                                const speechProgress = Math.min((totalCharacters / Math.max(text.length, 1)) * 100, 95);
                                
                                sendUpdate({
                                    type: 'model_update',
                                    model: 'elevenlabs-flash',
                                    stage: 'speech',
                                    progress: speechProgress,
                                    duration: speechDuration,
                                    totalDuration: totalAudioDuration,
                                    bytesReceived: audioChunks.reduce((sum, chunk) => sum + chunk.length, 0),
                                    totalChunks: totalAudioChunks,
                                    timestamp: Date.now()
                                });
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
                // Store audio data in memory
                const audioBuffer = Buffer.concat(audioChunks);
                this.audioManager.storeAudio(sessionId, 'elevenlabs-flash', audioBuffer);
                hasAudio = true;
                console.log(`ElevenLabs Flash: Total audio duration (estimated): ${totalAudioDuration}ms`);
                console.log(`Total chunks: ${totalAudioChunks}`);
                
                // NEW: Save complete audio file to disk for VAD and duration analysis
                completeAudioPath = this.audioManager.saveCompleteAudio(sessionId, 'elevenlabs-flash', audioBuffer);
                
                // Get accurate duration from the complete audio file (not first chunk)
                let accurateDuration = totalAudioDuration;
                if (completeAudioPath) {
                    try {
                        const ffmpegDuration = await this.audioManager.getAudioDuration(sessionId, 'elevenlabs-flash', 'complete');
                        if (ffmpegDuration !== null) {
                            accurateDuration = ffmpegDuration;
                            console.log(` ElevenLabs Flash: Corrected duration from ${totalAudioDuration}ms to ${accurateDuration}ms (complete file)`);
                        }
                    } catch (error) {
                        console.warn(`ElevenLabs Flash: Could not get accurate duration from complete file, using estimated: ${error.message}`);
                    }
                }
                    
                    // Send final speech completion with accurate duration
                    sendUpdate({
                        type: 'model_update',
                        model: 'elevenlabs-flash',
                        stage: 'speech',
                        progress: 100,
                        duration: Math.round((lastTimestamp - (firstSpeechTimestamp || 0)) * 1000),
                        totalDuration: accurateDuration,
                        timestamp: Date.now()
                    });
                } else {
                    // Send final speech completion without audio
                    sendUpdate({
                        type: 'model_update',
                        model: 'elevenlabs-flash',
                        stage: 'speech',
                        progress: 100,
                        duration: Math.round((lastTimestamp - (firstSpeechTimestamp || 0)) * 1000),
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
     * Simulate ElevenLabs TTS when no API key is provided
     * @param {string} text - Text to convert to speech
     * @param {Function} sendUpdate - Function to send progress updates
     * @param {number} startTime - Start timestamp
     * @param {string} sessionId - Session ID
     */
    async simulate(text, sendUpdate, startTime, sessionId) {
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 300));
        
        // Mark processing as complete
        sendUpdate({
            type: 'model_update',
            model: 'elevenlabs-flash',
            stage: 'processing',
            progress: 100,
            timestamp: Date.now()
        });
        
        // ElevenLabs now goes straight to speech like Inworld (no silent prefix simulation)
        // VAD analysis will handle actual silence detection
        
        // Start speech generation immediately
        sendUpdate({
            type: 'model_update',
            model: 'elevenlabs-flash',
            stage: 'speech',
            progress: 0,
            timestamp: Date.now()
        });
        
        await new Promise(resolve => setTimeout(resolve, 75));

        // Simulate streaming speech
        const streamDuration = Math.min(text.length * 30, 3000);
        const chunks = 10;
        for (let i = 0; i <= chunks; i++) {
            sendUpdate({
                type: 'model_update',
                model: 'elevenlabs-flash',
                stage: 'speech',
                progress: (i / chunks) * 100,
                timestamp: Date.now()
            });
            await new Promise(resolve => setTimeout(resolve, streamDuration / chunks));
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
            console.log(`${model}: Starting VAD analysis on complete audio...`);
            
            // Use the new method to analyze complete audio file
            const vadResult = await this.vadService.analyzeCompleteAudioFile(sessionId, model, this.audioManager);
            
            if (vadResult.success) {
                console.log(`${model}: VAD detected ${vadResult.msBeforeVoice}ms of silence before speech (complete audio)`);
                
                // Send VAD results to frontend
                sendUpdate({
                    type: 'vad_analysis',
                    model: model,
                    vadResult: vadResult,
                    timestamp: Date.now()
                });
            } else {
                console.log(`${model}: VAD analysis failed - ${vadResult.message}`);
            }
            
        } catch (error) {
            console.error(`${model}: VAD analysis error:`, error);
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
            console.log(`${model}: Starting VAD analysis...`);
            
            // Get the first chunk file path
            const audioDir = this.audioManager.getAudioDirectory();
            const audioFilePath = `${audioDir}/${sessionId}_${model}_first_chunk.mp3`;
            
            // Perform VAD analysis with session and model info
            const vadResult = await this.vadService.analyzeAudioFile(audioFilePath, sessionId, model, this.audioManager);
            
            if (vadResult.success) {
                console.log(`${model}: VAD detected ${vadResult.msBeforeVoice}ms of silence before speech`);
                
                // Send VAD results to frontend
                sendUpdate({
                    type: 'vad_analysis',
                    model: model,
                    vadResult: vadResult,
                    timestamp: Date.now()
                });
            } else {
                console.log(`${model}: VAD analysis failed - ${vadResult.message}`);
            }
            
        } catch (error) {
            console.error(`${model}: VAD analysis error:`, error);
        }
    }
}

export default ElevenLabsFlashService;
