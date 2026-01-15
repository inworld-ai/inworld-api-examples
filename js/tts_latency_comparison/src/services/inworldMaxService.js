
/**
 * Inworld TTS Max Service
 * Handles Inworld text-to-speech processing using inworld-tts-1.5-max model with Hades voice
 */

class InworldMaxService {
    constructor(audioManager, vadService = null) {
        this.audioManager = audioManager;
        this.vadService = vadService;
    }

    /**
     * Check if API key is valid
     * @returns {boolean} True if API key is valid
     */
    hasValidApiKey() {
        return process.env.INWORLD_API_KEY && 
               process.env.INWORLD_API_KEY !== 'your_inworld_api_key_here' &&
               process.env.INWORLD_API_KEY.trim() !== '';
    }

    /**
     * Process Inworld TTS Max
     * @param {string} text - Text to convert to speech
     * @param {Function} sendUpdate - Function to send progress updates
     * @param {string} sessionId - Session ID
     */
    async process(text, sendUpdate, sessionId) {
        const startTime = Date.now();
        
        try {
            if (!this.hasValidApiKey()) {
                console.log(' Inworld Max: Skipping - no valid API key (0ms)');
                return { timeToFirstByte: 99999, hasAudio: false };
            }

            // Send processing start
            sendUpdate({
                type: 'model_update',
                model: 'inworldmax',
                stage: 'processing',
                progress: 0,
                timestamp: startTime
            });

            console.log(' Inworld Max: Using real API');
            const result = await this.processReal(text, sendUpdate, sessionId);

            // Send completion
            sendUpdate({
                type: 'model_update',
                model: 'inworldmax',
                stage: 'complete',
                duration: Date.now() - startTime,
                hasAudio: result?.hasAudio || false,
                timestamp: Date.now()
            });

            return result;

        } catch (error) {
            console.error('Inworld TTS Max Error:', error.message);
            sendUpdate({
                type: 'model_update',
                model: 'inworldmax',
                stage: 'error',
                error: error.message,
                timestamp: Date.now()
            });
            throw error;
        }
    }

    /**
     * Process real Inworld API call
     * @param {string} text - Text to convert to speech
     * @param {Function} sendUpdate - Function to send progress updates
     * @param {string} sessionId - Session ID
     */
    async processReal(text, sendUpdate, sessionId) {
        // Make actual API call to Inworld
        // Inworld never has silent prefix (hard-coded)

        // Processing start is already sent by main process method

        // Track when we start the request for TTFB calculation
        const requestStartTime = Date.now();
        let timeToFirstByte = null;

        // Prepare request body
        const requestBody = {
            text: text,
            voiceId: process.env.INWORLD_MAX_VOICE_ID || 'Hades',
            modelId: 'inworld-tts-1.5-max',
            audioConfig: {
                audioEncoding: 'MP3',
                sampleRateHertz: 44100  // Standardized to 44.1kHz for better browser compatibility
            },
            temperature: 1.1
        };

        // Create Basic auth header - Inworld expects the API key directly, not base64 encoded
        const authHeader = `Basic ${process.env.INWORLD_API_KEY}`;

        const response = await fetch(
            'https://api.inworld.ai/tts/v1/voice:stream',
            requestBody,
            {
                headers: {
                    'Authorization': authHeader,
                    'Content-Type': 'application/json'
                },
                responseType: 'stream'
            }
        );

        // Handle streaming response
        let bytesReceived = 0;
        let firstAudioChunkReceived = false;
        let audioChunks = [];
        let totalAudioChunks = 0;
        let buffer = '';
        let totalAudioDuration = 0;
        let firstWordTimestamp = null;
        let lastWordTimestamp = 0;
        
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
                        
                        // Debug: Log the full response structure to understand the format
                        // if (data.result) {
                        //     console.log(' Inworld Max response structure:', JSON.stringify(data.result, null, 2));
                        // }
                        
                        if (data.result && data.result.audioContent) {
                            // Decode base64 audio content
                            const audioData = Buffer.from(data.result.audioContent, 'base64');
                            audioChunks.push(audioData);
                            totalAudioChunks++;
                            
                            if (!firstAudioChunkReceived) {
                                firstAudioChunkReceived = true;
                                timeToFirstByte = Date.now() - requestStartTime;
                                console.log(`Inworld Max: First chunk received after ${timeToFirstByte}ms - Size: ${audioData.length} bytes`);
                                
                                // Mark processing as complete when first chunk arrives
                                sendUpdate({
                                    type: 'model_update',
                                    model: 'inworldmax',
                                    stage: 'processing',
                                    progress: 100,
                                    timestamp: Date.now()
                                });
                                
                                // Save first chunk for analysis only if VAD service is available
                                if (this.vadService) {
                                    this.audioManager.saveChunkToDisk(sessionId, 'inworldmax', audioData, totalAudioChunks, 'first_chunk');
                                }
                                
                                // Inworld goes straight to speech (no silent prefix)
                                console.log(` Inworld Max: Starting speech generation`);
                                sendUpdate({
                                    type: 'model_update',
                                    model: 'inworldmax',
                                    stage: 'speech',
                                    progress: 0,
                                    timestamp: Date.now()
                                });
                            }
                        }
                        
                        // Process word timing data if available
                        if (data.result && data.result.words) {
                            const words = data.result.words;
                            
                            if (words.length > 0) {
                                const firstWord = words[0];
                                const lastWord = words[words.length - 1];
                                
                                // Update timing information
                                if (firstWordTimestamp === null && firstWord.startTime) {
                                    firstWordTimestamp = parseFloat(firstWord.startTime);
                                }
                                
                                if (lastWord.endTime) {
                                    lastWordTimestamp = parseFloat(lastWord.endTime);
                                    totalAudioDuration = Math.round(lastWordTimestamp * 1000); // Convert to ms
                                    
                                    // Calculate speech progress based on words processed
                                    const totalWords = text.split(/\s+/).length;
                                    const processedWords = words.length;
                                    const speechProgress = Math.min((processedWords / Math.max(totalWords, 1)) * 100, 95);
                                    
                                    console.log(` Inworld Max: Processed ${processedWords}/${totalWords} words, duration: ${totalAudioDuration}ms`);
                                    
                                    sendUpdate({
                                        type: 'model_update',
                                        model: 'inworldmax',
                                        stage: 'speech',
                                        progress: speechProgress,
                                        duration: Math.round((lastWordTimestamp - (firstWordTimestamp || 0)) * 1000),
                                        totalDuration: totalAudioDuration,
                                        bytesReceived: audioChunks.reduce((sum, chunk) => sum + chunk.length, 0),
                                        totalChunks: totalAudioChunks,
                                        timestamp: Date.now()
                                    });
                                }
                            }
                        }
                        
                        // Fallback: if no word timing, estimate duration and use chunk-based progress
                        if (!data.result?.words && data.result?.audioContent) {
                            // Estimate audio duration based on text length (rough approximation)
                            // Average speaking rate is about 150-160 words per minute
                            const estimatedDurationMs = Math.round((text.split(/\s+/).length / 150) * 60 * 1000);
                            const speechProgress = Math.min((totalAudioChunks / Math.max(2, 1)) * 100, 95);
                            
                            // Update our duration estimate
                            if (totalAudioDuration === 0) {
                                totalAudioDuration = estimatedDurationMs;
                                console.log(` Inworld Max: Using estimated duration: ${estimatedDurationMs}ms for ${text.split(/\s+/).length} words`);
                            }
                            
                            sendUpdate({
                                type: 'model_update',
                                model: 'inworldmax',
                                stage: 'speech',
                                progress: speechProgress,
                                duration: Math.round(totalAudioDuration * (speechProgress / 100)), // Progressive duration
                                totalDuration: totalAudioDuration,
                                bytesReceived: audioChunks.reduce((sum, chunk) => sum + chunk.length, 0),
                                totalChunks: totalAudioChunks,
                                timestamp: Date.now()
                            });
                        }
                    } catch (parseError) {
                        console.log('Parse error for line:', line, parseError.message);
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
                this.audioManager.storeAudio(sessionId, 'inworldmax', audioBuffer);
                hasAudio = true;
                    console.log(`Inworld Max: Total audio duration (estimated): ${totalAudioDuration}ms`);
                    console.log(`Total chunks: ${totalAudioChunks}`);
                    
                    // NEW: Save complete audio file to disk for VAD and duration analysis
                    completeAudioPath = this.audioManager.saveCompleteAudio(sessionId, 'inworldmax', audioBuffer);
                    
                    // Get accurate duration from the complete audio file (not first chunk)
                    let accurateDuration = totalAudioDuration;
                    if (completeAudioPath) {
                        try {
                            const ffmpegDuration = await this.audioManager.getAudioDuration(sessionId, 'inworldmax', 'complete');
                            if (ffmpegDuration !== null) {
                                accurateDuration = ffmpegDuration;
                                console.log(` Inworld Max: Corrected duration from ${totalAudioDuration}ms to ${accurateDuration}ms (complete file)`);
                            }
                        } catch (error) {
                            console.warn(`Inworld Max: Could not get accurate duration from complete file, using estimated: ${error.message}`);
                        }
                    }
                    
                    // Send final speech completion with accurate duration
                    const finalSpeechDuration = firstWordTimestamp !== null && lastWordTimestamp > 0 
                        ? Math.round((lastWordTimestamp - firstWordTimestamp) * 1000)
                        : accurateDuration;
                    
                    sendUpdate({
                        type: 'model_update',
                        model: 'inworldmax',
                        stage: 'speech',
                        progress: 100,
                        duration: finalSpeechDuration,
                        totalDuration: accurateDuration,
                        timestamp: Date.now()
                    });
                } else {
                    // If we still don't have duration, estimate it one final time
                    if (totalAudioDuration === 0) {
                        totalAudioDuration = Math.round((text.split(/\s+/).length / 150) * 60 * 1000);
                        console.log(` Inworld Max: Final fallback duration estimate: ${totalAudioDuration}ms`);
                    }
                    
                    // Send final speech completion without audio
                    const finalSpeechDuration = firstWordTimestamp !== null && lastWordTimestamp > 0 
                        ? Math.round((lastWordTimestamp - firstWordTimestamp) * 1000)
                        : totalAudioDuration;
                    
                    sendUpdate({
                        type: 'model_update',
                        model: 'inworldmax',
                        stage: 'speech',
                        progress: 100,
                        duration: finalSpeechDuration,
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
     * Simulate Inworld TTS Max when no API key is provided
     * @param {string} text - Text to convert to speech
     * @param {Function} sendUpdate - Function to send progress updates
     * @param {number} startTime - Start timestamp
     * @param {string} sessionId - Session ID
     */
    async simulate(text, sendUpdate, startTime, sessionId) {
        // Simulate processing time
        await new Promise(resolve => setTimeout(resolve, 250));
        
        // Mark processing as complete
        sendUpdate({
            type: 'model_update',
            model: 'inworldmax',
            stage: 'processing',
            progress: 100,
            timestamp: Date.now()
        });

        // Start speech generation immediately (no silent prefix)
        sendUpdate({
            type: 'model_update',
            model: 'inworldmax',
            stage: 'speech',
            progress: 0,
            timestamp: Date.now()
        });
        
        await new Promise(resolve => setTimeout(resolve, 75));

        // Simulate streaming speech
        const streamDuration = Math.min(text.length * 28, 2800);
        const chunks = 12;
        for (let i = 0; i <= chunks; i++) {
            sendUpdate({
                type: 'model_update',
                model: 'inworldmax',
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

export default InworldMaxService;
