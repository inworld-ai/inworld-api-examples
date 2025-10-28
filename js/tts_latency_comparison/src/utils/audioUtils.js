import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';

/**
 * Audio Utilities
 * Provides accurate audio duration detection and other audio-related utilities
 */

/**
 * Get accurate audio duration from an audio file using FFmpeg
 * @param {string} audioFilePath - Path to the audio file
 * @returns {Promise<number>} Duration in milliseconds, or null if failed
 */
export async function getAudioDuration(audioFilePath) {
    return new Promise((resolve, reject) => {
        // Check if file exists
        if (!fs.existsSync(audioFilePath)) {
            console.warn(`Audio file does not exist: ${audioFilePath}`);
            resolve(null);
            return;
        }

        ffmpeg.ffprobe(audioFilePath, (err, metadata) => {
            if (err) {
                console.error('FFprobe error:', err.message);
                resolve(null);
                return;
            }

            try {
                // Get duration from metadata
                const duration = metadata.format?.duration;
                if (duration && typeof duration === 'number') {
                    const durationMs = Math.round(duration * 1000);
                    console.log(`🎵 Audio duration detected: ${durationMs}ms for ${audioFilePath.split('/').pop()}`);
                    resolve(durationMs);
                } else {
                    console.warn(`Could not extract duration from metadata for ${audioFilePath}`);
                    resolve(null);
                }
            } catch (parseError) {
                console.error('Error parsing audio metadata:', parseError.message);
                resolve(null);
            }
        });
    });
}

/**
 * Get audio duration with retry mechanism
 * @param {string} audioFilePath - Path to the audio file
 * @param {number} maxRetries - Maximum number of retry attempts
 * @param {number} retryDelay - Delay between retries in milliseconds
 * @returns {Promise<number>} Duration in milliseconds, or null if failed
 */
export async function getAudioDurationWithRetry(audioFilePath, maxRetries = 3, retryDelay = 500) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        const duration = await getAudioDuration(audioFilePath);
        
        if (duration !== null) {
            return duration;
        }
        
        if (attempt < maxRetries) {
            console.log(`Retry ${attempt}/${maxRetries} for audio duration detection: ${audioFilePath.split('/').pop()}`);
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
    }
    
    console.warn(`Failed to get audio duration after ${maxRetries} attempts: ${audioFilePath}`);
    return null;
}

/**
 * Get basic audio file information using FFmpeg
 * @param {string} audioFilePath - Path to the audio file
 * @returns {Promise<Object>} Audio info object with duration, format, etc.
 */
export async function getAudioInfo(audioFilePath) {
    return new Promise((resolve, reject) => {
        if (!fs.existsSync(audioFilePath)) {
            resolve(null);
            return;
        }

        ffmpeg.ffprobe(audioFilePath, (err, metadata) => {
            if (err) {
                console.error('FFprobe error:', err.message);
                resolve(null);
                return;
            }

            try {
                const format = metadata.format || {};
                const audioStream = metadata.streams?.find(s => s.codec_type === 'audio') || {};

                const info = {
                    duration: format.duration ? Math.round(format.duration * 1000) : null,
                    bitRate: format.bit_rate || null,
                    size: format.size || null,
                    formatName: format.format_name || null,
                    codec: audioStream.codec_name || null,
                    sampleRate: audioStream.sample_rate || null,
                    channels: audioStream.channels || null
                };

                resolve(info);
            } catch (parseError) {
                console.error('Error parsing audio info:', parseError.message);
                resolve(null);
            }
        });
    });
}

/**
 * Get MP3 duration using FFmpeg (as requested by user)
 * @param {string} filePath - Path to the MP3 file
 * @returns {Promise<number>} Duration in seconds
 */
export async function getMp3Duration(filePath) {
    return new Promise((resolve, reject) => {
        ffmpeg.ffprobe(filePath, (err, metadata) => {
            if (err) {
                return reject(err);
            }
            if (metadata && metadata.format && typeof metadata.format.duration === 'number') {
                resolve(metadata.format.duration); // Duration in seconds
            } else {
                reject(new Error('Could not retrieve duration from metadata.'));
            }
        });
    });
}

export default {
    getAudioDuration,
    getAudioDurationWithRetry,
    getAudioInfo,
    getMp3Duration
};
