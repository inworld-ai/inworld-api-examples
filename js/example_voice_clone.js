#!/usr/bin/env node
/**
 * Example script for Inworld Voice Cloning using HTTP requests.
 *
 * Demonstrates how to clone a voice by sending audio samples to the Inworld Voice API.
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ============================================================================
// CONFIGURATION - Modify this path to use your own audio file
// ============================================================================
const DEFAULT_AUDIO_PATH = path.join(__dirname, '..', 'tests-data', 'audio', 'english_british_1.wav');

// Supported language codes
const SUPPORTED_LANGUAGES = [
    'EN_US', 'ZH_CN', 'KO_KR', 'JA_JP', 'RU_RU', 'AUTO',
    'IT_IT', 'ES_ES', 'PT_BR', 'DE_DE', 'FR_FR', 'AR_SA',
    'PL_PL', 'NL_NL'
];

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
 * Check if INWORLD_WORKSPACE environment variable is set.
 * @returns {string|null} Workspace or null if not set
 */
function checkWorkspace() {
    const workspace = process.env.INWORLD_WORKSPACE;
    if (!workspace) {
        console.log('Error: INWORLD_WORKSPACE environment variable is not set.');
        console.log('Please set it with: export INWORLD_WORKSPACE=your_workspace_id');
        return null;
    }
    return workspace;
}

/**
 * Load audio data from a file.
 * @param {string} audioPath - Path to audio file (WAV or MP3)
 * @returns {Buffer} Audio data
 */
function loadAudioFile(audioPath) {
    return fs.readFileSync(audioPath);
}

/**
 * Clone a voice using the Inworld Voice API.
 * 
 * @param {Object} options - Clone options
 * @param {string} options.workspace - Workspace ID (without 'workspaces/' prefix)
 * @param {string} options.displayName - Human-readable name for the voice
 * @param {string[]} options.audioPaths - List of paths to audio files (WAV or MP3)
 * @param {string} options.langCode - Language code (e.g., EN_US, ZH_CN, JA_JP)
 * @param {string} options.apiKey - API key for authentication
 * @param {string} [options.description] - Optional description of the voice
 * @param {string[]} [options.tags] - Optional list of tags for filtering/discovery
 * @param {string[]} [options.transcriptions] - Optional list of transcriptions aligned with audio files
 * @param {boolean} [options.removeBackgroundNoise] - Whether to apply noise removal
 * @returns {Promise<Object>} Response containing the cloned voice details
 */
async function cloneVoice({
    workspace,
    displayName,
    audioPaths,
    langCode,
    apiKey,
    description,
    tags,
    transcriptions,
    removeBackgroundNoise
}) {
    const url = `https://api.inworld.ai/voices/v1/workspaces/${workspace}/voices:clone`;
    
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${apiKey}`
    };
    
    // Build voice samples array
    const voiceSamples = [];
    for (let i = 0; i < audioPaths.length; i++) {
        const audioPath = audioPaths[i];
        console.log(`  Loading: ${audioPath}`);
        
        const audioData = loadAudioFile(audioPath);
        const audioB64 = audioData.toString('base64');
        
        const sample = { audioData: audioB64 };
        if (transcriptions && i < transcriptions.length) {
            sample.transcription = transcriptions[i];
        }
        
        voiceSamples.push(sample);
        console.log(`    Size: ${audioData.length.toLocaleString()} bytes`);
    }
    
    // Build request data
    const requestData = {
        displayName,
        langCode,
        voiceSamples
    };
    
    if (description) {
        requestData.description = description;
    }
    if (tags && tags.length > 0) {
        requestData.tags = tags;
    }
    if (removeBackgroundNoise) {
        requestData.audioProcessingConfig = { removeBackgroundNoise: true };
    }
    
    console.log('\nCloning voice...');
    console.log(`  Display Name: ${displayName}`);
    console.log(`  Language: ${langCode}`);
    console.log(`  Samples: ${voiceSamples.length}`);
    if (description) {
        console.log(`  Description: ${description}`);
    }
    if (tags && tags.length > 0) {
        console.log(`  Tags: ${tags.join(', ')}`);
    }
    if (removeBackgroundNoise) {
        console.log('  Noise removal: enabled');
    }
    
    const response = await axios.post(url, requestData, { headers });
    const result = response.data;
    
    console.log('\nVoice cloned successfully!');
    
    // Display voice details
    const voice = result.voice || {};
    if (Object.keys(voice).length > 0) {
        console.log('\nVoice Details:');
        console.log(`  Name: ${voice.name || 'N/A'}`);
        console.log(`  Voice ID: ${voice.voiceId || 'N/A'}`);
        console.log(`  Display Name: ${voice.displayName || 'N/A'}`);
        console.log(`  Language: ${voice.langCode || 'N/A'}`);
        if (voice.description) {
            console.log(`  Description: ${voice.description}`);
        }
        if (voice.tags && voice.tags.length > 0) {
            console.log(`  Tags: ${voice.tags.join(', ')}`);
        }
    }
    
    // Display sample validation results
    const validatedSamples = result.audioSamplesValidated || [];
    if (validatedSamples.length > 0) {
        console.log('\nSample Validation:');
        for (let i = 0; i < validatedSamples.length; i++) {
            const sample = validatedSamples[i];
            console.log(`\n  Sample ${i + 1}:`);
            
            if (sample.transcription) {
                console.log(`    Transcription: ${sample.transcription}`);
            }
            if (sample.langCode) {
                console.log(`    Detected Language: ${sample.langCode}`);
            }
            
            const warnings = sample.warnings || [];
            for (const warning of warnings) {
                console.log(`    Warning: ${warning.text || 'Unknown warning'}`);
            }
            
            const errors = sample.errors || [];
            for (const error of errors) {
                console.log(`    Error: ${error.text || 'Unknown error'}`);
            }
            
            if (warnings.length === 0 && errors.length === 0) {
                console.log('    Status:  OK');
            }
        }
    }
    
    return result;
}

/**
 * Parse command line arguments.
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
    const args = {
        name: 'Cloned Voice Demo',
        audio: [],
        lang: 'EN_US',
        description: null,
        tags: [],
        transcriptions: [],
        removeNoise: false,
        help: false
    };
    
    const argv = process.argv.slice(2);
    let i = 0;
    
    while (i < argv.length) {
        const arg = argv[i];
        
        switch (arg) {
            case '--name':
            case '-n':
                args.name = argv[++i];
                break;
            case '--audio':
            case '-a':
                // Collect all audio files until next flag
                i++;
                while (i < argv.length && !argv[i].startsWith('-')) {
                    args.audio.push(argv[i++]);
                }
                i--; // Back up one since the while loop went one too far
                break;
            case '--lang':
            case '-l':
                args.lang = argv[++i];
                break;
            case '--description':
            case '-d':
                args.description = argv[++i];
                break;
            case '--tags':
            case '-t':
                // Collect all tags until next flag
                i++;
                while (i < argv.length && !argv[i].startsWith('-')) {
                    args.tags.push(argv[i++]);
                }
                i--;
                break;
            case '--transcription':
                // Collect all transcriptions until next flag
                i++;
                while (i < argv.length && !argv[i].startsWith('-')) {
                    args.transcriptions.push(argv[i++]);
                }
                i--;
                break;
            case '--remove-noise':
                args.removeNoise = true;
                break;
            case '--help':
            case '-h':
                args.help = true;
                break;
            default:
                // If it looks like a file path without a flag, treat as audio
                if (!arg.startsWith('-') && (arg.endsWith('.wav') || arg.endsWith('.mp3'))) {
                    args.audio.push(arg);
                }
        }
        i++;
    }
    
    return args;
}

/**
 * Print help message.
 */
function printHelp() {
    console.log(`
Usage: node example_voice_clone.js [options]

Clone a voice using Inworld Voice API

Options:
  -n, --name <name>           Display name for the cloned voice (default: "Cloned Voice Demo")
  -a, --audio <files...>      Path(s) to audio file(s) for cloning (WAV or MP3)
  -l, --lang <code>           Language code (default: EN_US)
  -d, --description <text>    Description of the voice
  -t, --tags <tags...>        Tags for the voice (space-separated)
      --transcription <text>  Transcription(s) for audio file(s)
      --remove-noise          Enable background noise removal
  -h, --help                  Show this help message

Supported Languages:
  ${SUPPORTED_LANGUAGES.join(', ')}

Environment Variables:
  INWORLD_API_KEY      API key for authentication (required)
  INWORLD_WORKSPACE    Workspace ID (required)

Examples:
  node example_voice_clone.js --name "My Voice" --audio sample.wav

  node example_voice_clone.js \\
    --name "British Voice" \\
    --audio sample1.wav sample2.wav \\
    --lang EN_US \\
    --description "A warm British accent" \\
    --tags british warm \\
    --remove-noise
`);
}

/**
 * Main function to demonstrate voice cloning.
 */
async function main() {
    const args = parseArgs();
    
    if (args.help) {
        printHelp();
        return 0;
    }
    
    console.log('Inworld Voice Cloning Example');
    console.log('=' + '='.repeat(39));
    
    // Check environment variables
    const apiKey = checkApiKey();
    if (!apiKey) {
        return 1;
    }
    
    const workspace = checkWorkspace();
    if (!workspace) {
        return 1;
    }
    
    // Validate language code
    if (!SUPPORTED_LANGUAGES.includes(args.lang)) {
        console.log(`Error: Invalid language code '${args.lang}'.`);
        console.log(`Supported languages: ${SUPPORTED_LANGUAGES.join(', ')}`);
        return 1;
    }
    
    // Get audio paths
    let audioPaths = args.audio;
    if (audioPaths.length === 0) {
        // Try default audio file
        if (fs.existsSync(DEFAULT_AUDIO_PATH)) {
            audioPaths = [DEFAULT_AUDIO_PATH];
            console.log(`Using default audio: ${DEFAULT_AUDIO_PATH}`);
        } else {
            console.log('Error: No audio file specified and default not found.');
            console.log('Use --audio to specify audio file(s).');
            return 1;
        }
    }
    
    // Validate audio files exist
    for (const audioPath of audioPaths) {
        if (!fs.existsSync(audioPath)) {
            console.log(`Error: Audio file not found: ${audioPath}`);
            return 1;
        }
    }
    
    const startTime = Date.now();
    
    try {
        const result = await cloneVoice({
            workspace,
            displayName: args.name,
            audioPaths,
            langCode: args.lang,
            apiKey,
            description: args.description,
            tags: args.tags.length > 0 ? args.tags : null,
            transcriptions: args.transcriptions.length > 0 ? args.transcriptions : null,
            removeBackgroundNoise: args.removeNoise
        });
        
        const cloneTime = (Date.now() - startTime) / 1000;
        console.log(`\nClone time: ${cloneTime.toFixed(2)}s`);
        
        const voice = result.voice || {};
        if (voice.voiceId) {
            console.log(`\nUse this voice_id in TTS calls: ${voice.voiceId}`);
        }
        
        return 0;
        
    } catch (error) {
        console.log(`\nHTTP Error: ${error.message}`);
        if (error.response) {
            try {
                console.log(`Details: ${JSON.stringify(error.response.data, null, 2)}`);
            } catch {
                console.log(`Response: ${error.response.data}`);
            }
        }
        return 1;
    }
}

if (require.main === module) {
    main().then(process.exit);
}

module.exports = { cloneVoice };

