import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { getAudioDurationWithRetry } from '../utils/audioUtils.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Audio Manager
 * Handles audio file storage and retrieval
 */

class AudioManager {
    constructor() {
        this.audioFiles = new Map();
        this.audioDir = path.join(__dirname, '../../audio');
        this.ensureAudioDirectory();
    }

    /**
     * Ensure audio directory exists
     */
    ensureAudioDirectory() {
        if (!fs.existsSync(this.audioDir)) {
            fs.mkdirSync(this.audioDir, { recursive: true });
        }
    }

    /**
     * Store audio data in memory
     * @param {string} sessionId - The session ID
     * @param {string} model - The model name (elevenlabs, inworld, hume)
     * @param {Buffer} audioBuffer - The audio data
     */
    storeAudio(sessionId, model, audioBuffer) {
        const audioKey = `${sessionId}_${model}`;
        
        // If we're overwriting existing audio, log it
        if (this.audioFiles.has(audioKey)) {
            console.log(`🔄 ${model} audio replaced for session ${sessionId}`);
        }
        
        this.audioFiles.set(audioKey, audioBuffer);
        console.log(`✅ ${model} audio stored: ${audioBuffer.length} bytes`);
    }

    /**
     * Get audio data from memory
     * @param {string} sessionId - The session ID
     * @param {string} model - The model name (elevenlabs, inworld)
     * @returns {Buffer|null} Audio buffer or null if not found
     */
    getAudio(sessionId, model) {
        const audioKey = `${sessionId}_${model}`;
        return this.audioFiles.get(audioKey) || null;
    }

    /**
     * Check if audio exists
     * @param {string} sessionId - The session ID
     * @param {string} model - The model name (elevenlabs, inworld)
     * @returns {boolean} True if audio exists
     */
    hasAudio(sessionId, model) {
        const audioKey = `${sessionId}_${model}`;
        return this.audioFiles.has(audioKey);
    }

    /**
     * Save audio chunk to disk for analysis
     * @param {string} sessionId - The session ID
     * @param {string} model - The model name
     * @param {Buffer} chunk - The audio chunk
     * @param {number} chunkNumber - The chunk number
     * @param {string} suffix - Optional suffix for filename
     */
    saveChunkToDisk(sessionId, model, chunk, chunkNumber, suffix = '') {
        const filename = suffix 
            ? `${sessionId}_${model}_${suffix}.mp3`
            : `${sessionId}_${model}_chunk_${chunkNumber}.mp3`;
        const filePath = path.join(this.audioDir, filename);
        
        try {
            fs.writeFileSync(filePath, chunk);
            console.log(`💾 ${model}: ${suffix || `Chunk ${chunkNumber}`} saved - Size: ${chunk.length} bytes`);
            return filePath;
        } catch (error) {
            console.error(`Error saving audio chunk: ${error.message}`);
            return null;
        }
    }

    /**
     * Clean up audio files for a specific session
     * @param {string} sessionId - Session ID to clean up
     */
    cleanupSession(sessionId) {
        const keysToDelete = [];
        
        // Find all keys that match this session
        for (const key of this.audioFiles.keys()) {
            if (key.startsWith(`${sessionId}_`)) {
                keysToDelete.push(key);
            }
        }
        
        // Delete matching keys
        keysToDelete.forEach(key => {
            this.audioFiles.delete(key);
        });
        
        if (keysToDelete.length > 0) {
            console.log(`🧹 Cleaned up ${keysToDelete.length} audio files for session ${sessionId}`);
        }
    }

    /**
     * Clean up old audio files from memory
     * @param {number} maxAge - Maximum age in milliseconds (optional)
     */
    cleanup(maxAge = 3600000) { // Default 1 hour
        // This is a simple implementation - in production you might want
        // to track timestamps and clean up based on age
        const keysToDelete = [];
        
        // For now, just log the cleanup attempt
        console.log(`Audio cleanup requested. Current stored files: ${this.audioFiles.size}`);
        
        // In a real implementation, you'd track timestamps and remove old entries
        // For this demo, we'll keep all files in memory during the session
    }

    /**
     * Get the audio directory path
     * @returns {string} The audio directory path
     */
    getAudioDirectory() {
        return this.audioDir;
    }

    /**
     * Save complete concatenated audio to disk
     * @param {string} sessionId - Session ID
     * @param {string} model - Model name  
     * @param {Buffer} audioBuffer - Complete audio buffer
     * @returns {string|null} File path of saved audio or null if failed
     */
    saveCompleteAudio(sessionId, model, audioBuffer) {
        const filename = `${sessionId}_${model}_complete.mp3`;
        const filePath = path.join(this.audioDir, filename);
        
        try {
            fs.writeFileSync(filePath, audioBuffer);
            console.log(`💾 ${model}: Complete audio saved - Size: ${audioBuffer.length} bytes`);
            return filePath;
        } catch (error) {
            console.error(`Error saving complete audio: ${error.message}`);
            return null;
        }
    }

    /**
     * Get accurate audio duration using FFmpeg
     * @param {string} sessionId - The session ID
     * @param {string} model - The model name
     * @param {string} suffix - Optional suffix for filename (default: 'first_chunk')
     * @returns {Promise<number|null>} Duration in milliseconds or null if failed
     */
    async getAudioDuration(sessionId, model, suffix = 'first_chunk') {
        const filename = `${sessionId}_${model}_${suffix}.mp3`;
        const filePath = path.join(this.audioDir, filename);
        
        try {
            const duration = await getAudioDurationWithRetry(filePath);
            if (duration !== null) {
                console.log(`📏 ${model}: Accurate duration: ${duration}ms`);
            }
            return duration;
        } catch (error) {
            console.error(`Error getting audio duration for ${model}:`, error.message);
            return null;
        }
    }

    /**
     * Delete audio files from disk after VAD analysis
     * @param {string} sessionId - Session ID
     * @param {string} model - Model name  
     * @returns {boolean} True if files were deleted successfully
     */
    deleteAudioFiles(sessionId, model) {
        // Check if audio files should be saved based on environment variable
        const saveAudio = process.env.SAVE_AUDIO === 'true';
        
        if (saveAudio) {
            console.log(`💾 ${model}: Keeping audio files for analysis (SAVE_AUDIO=true)`);
            return true; // Return true to indicate "success" without actually deleting
        }
        
        const filesToDelete = [
            `${sessionId}_${model}_complete.mp3`,
            `${sessionId}_${model}_first_chunk.mp3`
        ];
        
        let deletedCount = 0;
        
        for (const filename of filesToDelete) {
            const filePath = path.join(this.audioDir, filename);
            
            try {
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                    console.log(`🗑️  ${model}: Deleted ${filename}`);
                    deletedCount++;
                } else {
                    console.log(`⚠️  ${model}: File not found for deletion: ${filename}`);
                }
            } catch (error) {
                console.error(`❌ ${model}: Error deleting ${filename}:`, error.message);
            }
        }
        
        console.log(`✅ ${model}: Cleanup complete - ${deletedCount}/${filesToDelete.length} files deleted`);
        return deletedCount === filesToDelete.length;
    }
}

export default AudioManager;
