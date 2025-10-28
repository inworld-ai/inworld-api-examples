import { EventEmitter } from 'events';
import { VADFactory } from '@inworld/runtime/primitives/vad';
import { DeviceRegistry, DeviceType } from '@inworld/runtime/core';
import fs from 'fs';
import ffmpeg from 'fluent-ffmpeg';
import path from 'path';

class VadService extends EventEmitter {
    constructor() {
        super();
        this.vad = null;
        this.isInitialized = false;
        this.isInitializing = false;
        this.initializationPromise = null;
        this.config = {
            modelPath: path.resolve('models/silero_vad.onnx'),
            sampleRate: 16000,      
            minVolume: 0.005,       // Minimum RMS volume threshold for speech detection
            skipInitialMs: 25,      // Skip first 25ms to avoid potential TTS artifacts
            frameSize: 1024         // Process in larger chunks for better performance (23ms at 44.1kHz)
        };
    }

    async initialize() {
        if (this.isInitialized) {
            console.log('VAD Service: Already initialized');
            return;
        }

        // If already initializing, wait for the existing initialization to complete
        if (this.isInitializing) {
            console.log('VAD Service: Initialization already in progress, waiting...');
            await this.initializationPromise;
            return;
        }

        // Mark as initializing and create the initialization promise
        this.isInitializing = true;
        this.initializationPromise = this._performInitialization();

        try {
            await this.initializationPromise;
        } finally {
            this.isInitializing = false;
            this.initializationPromise = null;
        }
    }

    async _performInitialization() {
        try {
            console.log('VAD Service: Starting initialization with model path:', this.config.modelPath);
            
            // Try to find CUDA device, fallback to CPU
            const availableDevices = DeviceRegistry.getAvailableDevices();
            console.log('VAD Service: Available devices:', availableDevices.map(d => d.getType()));
            
            const cudaDevice = availableDevices.find(
                (device) => device.getType() === DeviceType.CUDA
            );
            console.log('VAD Service: Using CUDA device:', !!cudaDevice);

            // Create local VAD instance
            console.log('VAD Service: Creating VAD instance...');
            this.vad = await VADFactory.createLocal({
                modelPath: this.config.modelPath,
                device: cudaDevice || availableDevices[0] // fallback to first available device
            });

            this.isInitialized = true;
            console.log('VAD Service: Initialization complete');
            
        } catch (error) {
            console.error('VAD Service: Failed to initialize:', error);
            this.isInitialized = false;
            throw error;
        }
    }

    // Convert MP3 to WAV with specific format for VAD processing
    async preprocessAudio(inputPath, sessionId = null, model = null) {
        return new Promise((resolve, reject) => {
            // Create unique temporary file name using session and model info
            let tempFileName;
            if (sessionId && model) {
                tempFileName = `temp_vad_${sessionId}_${model}.wav`;
            } else {
                // Fallback for cases where session info isn't available
                const timestamp = Date.now();
                const random = Math.random().toString(36).substring(2, 8);
                tempFileName = `temp_vad_audio_${timestamp}_${random}.wav`;
            }
            const tempWavPath = path.join(path.dirname(inputPath), tempFileName);
            
            ffmpeg(inputPath)
                .outputOptions([
                    `-ar ${this.config.sampleRate}`, // Keep native 44.1kHz sample rate
                    '-ac 1',     // Set audio channels to mono
                    '-f wav'     // Output format WAV
                ])
                .on('end', () => resolve(tempWavPath))
                .on('error', (err) => reject(err))
                .save(tempWavPath);
        });
    }

    // Read WAV file and convert to Float32Array
    readWavFile(filePath) {
        const buffer = fs.readFileSync(filePath);
        
        // Skip WAV header (44 bytes) and read PCM data
        const headerSize = 44;
        const pcmData = buffer.slice(headerSize);
        
        // Convert to Int16Array
        const int16Array = new Int16Array(pcmData.buffer, pcmData.byteOffset, pcmData.length / 2);
        
        // Convert to normalized Float32Array [-1, 1]
        const float32Array = new Float32Array(int16Array.length);
        for (let i = 0; i < int16Array.length; i++) {
            float32Array[i] = int16Array[i] / 32768.0;
        }
        
        return float32Array;
    }

    // Calculate RMS volume for noise filtering
    calculateRMSVolume(audioData) {
        let sumSquares = 0;
        for (let i = 0; i < audioData.length; i++) {
            sumSquares += audioData[i] * audioData[i];
        }
        return Math.sqrt(sumSquares / audioData.length);
    }

    // Simple volume-based noise filtering - much more reliable than complex artifact detection
    isLikelyNoise(audioData, rmsVolume) {
        // Very simple heuristic: if RMS is very low, it's likely silence or noise
        // This is much more reliable than complex frequency analysis
        return rmsVolume < this.config.minVolume;
    }

    // Simplified VAD processing - focus on finding first voice activity quickly and reliably
    async processAudioForVAD(audioData) {
        if (!this.isInitialized || !this.vad) {
            throw new Error('VAD Service not initialized');
        }

        if (this.isInitializing) {
            throw new Error('VAD Service is currently initializing, please wait and try again');
        }

        const skipSamples = Math.floor((this.config.skipInitialMs / 1000) * this.config.sampleRate);
        console.log(`VAD Service: Processing audio with ${audioData.length} samples, skipping first ${skipSamples} samples (${this.config.skipInitialMs}ms)`);
        
        // Process in larger chunks for better performance and accuracy
        for (let i = skipSamples; i < audioData.length; i += this.config.frameSize) {
            const chunk = audioData.slice(i, i + this.config.frameSize);
            
            // Skip if chunk is too small (need at least half frame size)
            if (chunk.length < this.config.frameSize / 2) continue;
            
            const timestampMs = (i / this.config.sampleRate) * 1000;
            
            // Calculate RMS volume for simple noise filtering
            const rmsVolume = this.calculateRMSVolume(chunk);
            
            // Skip if volume is too low (likely silence/noise)
            if (this.isLikelyNoise(chunk, rmsVolume)) {
                continue;
            }
            
            // Pass Float32Array directly (normalized -1 to 1 range)
            // Previously converted to int16 range, but VAD accepts fp32 directly
            // const integerArray = Array.from(chunk, sample => Math.round(sample * 32768));
            
            try {
                // Process with Silero VAD - this is the main detection
                const vadResult = await this.vad.detectVoiceActivity({
                    data: chunk,  // Pass Float32Array directly
                    sampleRate: this.config.sampleRate
                });
                
                // Voice activity detected if Silero VAD returns non-negative result
                // (Silero returns -1 for no voice, >= 0 for voice activity confidence)
                if (vadResult >= 0) {
                    console.log(`VAD Service: First voice activity detected at ${timestampMs.toFixed(2)}ms (confidence: ${vadResult}, volume: ${rmsVolume.toFixed(4)})`);
                    return [{
                        timestampMs,
                        hasVoiceActivity: true,
                        confidence: vadResult,
                        volume: rmsVolume
                    }];
                }
                
            } catch (error) {
                console.error('VAD processing error at timestamp', timestampMs, 'ms:', error);
                // Continue processing even if one chunk fails
                continue;
            }
        }
        
        // No voice activity detected
        console.log('VAD Service: No voice activity detected in audio');
        return [];
    }

    /**
     * Analyze complete audio file (not just first chunk)
     * @param {string} sessionId - Session ID
     * @param {string} model - Model name
     * @param {Object} audioManager - AudioManager instance for cleanup
     * @returns {Promise<Object>} VAD analysis result
     */
    async analyzeCompleteAudioFile(sessionId, model, audioManager = null) {
        const audioDir = path.dirname(this.config.modelPath).replace('/models', '/audio');
        const audioFilePath = path.join(audioDir, `${sessionId}_${model}_complete.mp3`);
        
        console.log(`VAD Service: Analyzing complete audio file: ${audioFilePath}`);
        return this.analyzeAudioFile(audioFilePath, sessionId, model, audioManager);
    }

    // Main function: analyze audio file and return ms before voice detection
    async analyzeAudioFile(audioFilePath, sessionId = null, model = null, audioManager = null) {
        try {
            console.log('VAD Service: Analyzing audio file:', audioFilePath);
            
            // Initialize VAD if not already done
            if (!this.isInitialized) {
                await this.initialize();
            }
            
            // Preprocess audio file
            console.log('VAD Service: Preprocessing audio...');
            const wavFilePath = await this.preprocessAudio(audioFilePath, sessionId, model);
            
            // Read and convert audio data
            console.log('VAD Service: Reading audio data...');
            const audioData = this.readWavFile(wavFilePath);
            
            // Process audio for VAD
            console.log('VAD Service: Processing audio for voice activity detection...');
            const vadResults = await this.processAudioForVAD(audioData);
            
            // Clean up temporary file safely
            try {
                if (fs.existsSync(wavFilePath)) {
                    fs.unlinkSync(wavFilePath);
                    console.log(`VAD Service: Cleaned up temporary file: ${path.basename(wavFilePath)}`);
                }
            } catch (cleanupError) {
                console.warn(`VAD Service: Could not clean up temporary file: ${cleanupError.message}`);
            }
            
            // Clean up audio files after VAD analysis if audioManager is provided
            if (audioManager && sessionId && model) {
                const saveAudio = process.env.SAVE_AUDIO === 'true';
                if (saveAudio) {
                    console.log(`VAD Service: Keeping audio files for analysis (SAVE_AUDIO=true)`);
                } else {
                    console.log(`VAD Service: Cleaning up audio files for ${model}...`);
                    audioManager.deleteAudioFiles(sessionId, model);
                }
            }
            
            // Check if voice activity was detected (simplified results)
            if (vadResults.length > 0 && vadResults[0].hasVoiceActivity) {
                const firstVoiceActivity = vadResults[0];
                const msBeforeVoice = firstVoiceActivity.timestampMs;
                console.log(`VAD Service: Voice activity detected at ${msBeforeVoice.toFixed(2)}ms`);
                console.log(`VAD Service: Confidence: ${firstVoiceActivity.confidence}, Volume: ${firstVoiceActivity.volume.toFixed(4)}`);
                
                return {
                    success: true,
                    msBeforeVoice: msBeforeVoice,
                    confidence: firstVoiceActivity.confidence,
                    volume: firstVoiceActivity.volume
                };
            } else {
                console.log('VAD Service: No voice activity detected in the audio file');
                return {
                    success: false,
                    msBeforeVoice: null,
                    message: 'No voice activity detected'
                };
            }
            
        } catch (error) {
            console.error('VAD Service: Error analyzing audio file:', error);
            throw error;
        }
    }

    // Clean up resources
    async destroy() {
        // Wait for any ongoing initialization to complete
        if (this.isInitializing && this.initializationPromise) {
            try {
                await this.initializationPromise;
            } catch (error) {
                console.warn('VAD Service: Error during initialization while destroying:', error.message);
            }
        }

        if (this.vad) {
            try {
                this.vad.destroy();
            } catch (error) {
                console.warn('VAD Service: Error destroying VAD instance:', error.message);
            }
            this.vad = null;
        }
        
        this.isInitialized = false;
        this.isInitializing = false;
        this.initializationPromise = null;
    }
}

// Export singleton instance
const vadService = new VadService();

export default vadService;