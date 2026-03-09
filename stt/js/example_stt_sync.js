#!/usr/bin/env node
/**
 * Example script for Inworld STT synchronous transcription using HTTP.
 *
 * This script demonstrates how to transcribe a complete audio file in a single
 * POST request. Supports WAV and other formats via AUTO_DETECT or explicit encoding.
 */

const fs = require('fs');
const path = require('path');
try { require('dotenv').config(); } catch (_) {}

const API_BASE = 'https://api.inworld.ai';

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
 * Transcribe audio using Inworld STT API (synchronous).
 *
 * @param {string} audioPath - Path to audio file (WAV, MP3, etc.)
 * @param {Object} options - Optional transcribeConfig overrides
 * @param {string} apiKey - API key for authentication
 * @returns {Promise<Object>} Response with transcription and usage
 */
async function transcribe(audioPath, options, apiKey) {
    const url = `${API_BASE}/stt/v1/transcribe`;
    const audioBytes = fs.readFileSync(audioPath);
    const contentB64 = audioBytes.toString('base64');

    const transcribeConfig = {
        modelId: 'groq/whisper-large-v3-turbo',
        audioEncoding: 'AUTO_DETECT',
        language: 'en-US',
        sampleRateHertz: 16000,
        numberOfChannels: 1,
        includeWordTimestamps: true,
        ...options
    };

    const body = {
        transcribeConfig,
        audioData: { content: contentB64 }
    };

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${apiKey}`
    };

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        let errorDetails = '';
        try {
            const errorData = await response.json();
            errorDetails = JSON.stringify(errorData);
        } catch {
            errorDetails = await response.text();
        }
        throw new Error(`HTTP ${response.status}: ${errorDetails}`);
    }

    return response.json();
}

/**
 * Main.
 */
async function main() {
    console.log('Inworld STT Synchronous Transcription Example');
    console.log('='.repeat(50));

    const apiKey = checkApiKey();
    if (!apiKey) return 1;

    const DEFAULT_AUDIO_PATH = path.join(__dirname, '..', 'tests-data', 'audio', 'test-audio.wav');
    const audioPath = process.argv[2] || DEFAULT_AUDIO_PATH;
    if (!fs.existsSync(audioPath)) {
        console.log(`Error: Audio file not found: ${audioPath}`);
        console.log('Usage: node example_stt_sync.js [path/to/audio.wav]');
        console.log('Default: ../tests-data/audio/test-audio.wav');
        return 1;
    }

    try {
        console.log(`Audio file: ${audioPath}`);
        console.log('Transcribing...\n');
        const start = Date.now();
        const result = await transcribe(audioPath, {}, apiKey);
        const elapsed = ((Date.now() - start) / 1000).toFixed(2);

        const transcription = result.transcription || {};
        const transcript = transcription.transcript || '';
        const wordTimestamps = transcription.wordTimestamps || [];
        const usage = result.usage || {};

        console.log('Transcript:');
        console.log(transcript || '(empty)');
        if (wordTimestamps.length > 0) {
            console.log('\nWord timestamps:');
            wordTimestamps.forEach(w => {
                console.log(`  ${w.startTimeMs}-${w.endTimeMs} ms: "${w.word}" (confidence: ${w.confidence})`);
            });
        }
        if (usage.transcribedAudioMs != null) {
            console.log(`\nTranscribed audio: ${usage.transcribedAudioMs} ms`);
        }
        if (usage.modelId) {
            console.log(`Model: ${usage.modelId}`);
        }
        console.log(`\nDone in ${elapsed} s.`);
    } catch (err) {
        console.log(`Transcription failed: ${err.message}`);
        return 1;
    }
    return 0;
}

if (require.main === module) {
    main().then(process.exit);
}
