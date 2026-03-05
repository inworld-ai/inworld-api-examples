#!/usr/bin/env node
/**
 * Example script for Inworld Voice Design using HTTP requests.
 *
 * Demonstrates how to design a voice from a text description
 * using the Inworld Voice API. Returns up to three voice previews.
 * After design, preview audio is saved to files and opened for playback;
 * you can then choose whether to publish a preview to your library.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

// ============================================================================
// CONFIGURATION - Default voice description (must be 30-250 characters)
// ============================================================================
const DEFAULT_DESIGN_PROMPT =
    'A middle-aged male voice with a clear British accent speaking at a steady pace and with a neutral tone.';

const DEFAULT_SCRIPT =
    'Hello, this is a sample of my voice. I hope it sounds clear and natural to you.';

// Supported language codes (same as voice clone)
const SUPPORTED_LANGUAGES = [
    'EN_US', 'ZH_CN', 'KO_KR', 'JA_JP', 'RU_RU', 'AUTO',
    'IT_IT', 'ES_ES', 'PT_BR', 'DE_DE', 'FR_FR', 'AR_SA',
    'PL_PL', 'NL_NL'
];

const DESIGN_PROMPT_MIN = 30;
const DESIGN_PROMPT_MAX = 250;
const SCRIPT_MIN = 1;
const SCRIPT_RECOMMENDED_MAX = 200;

const PREVIEW_OUTPUT_DIR = __dirname;
const PREVIEW_FILE_PREFIX = 'design_preview_';

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
 * Design a voice using the Inworld Voice API (no audio required).
 *
 * @param {Object} options - Design options
 * @param {string} options.designPrompt - Voice description (30-250 characters)
 * @param {string} options.previewText - Text the voice will speak (preview script; 50-200 chars recommended)
 * @param {string} options.langCode - Language code (e.g., EN_US, ZH_CN)
 * @param {number} [options.numberOfSamples=1] - Number of voice previews to generate (1-3)
 * @param {string} options.apiKey - API key for authentication
 * @returns {Promise<Object>} Response containing voice preview(s)
 */
async function designVoice({ designPrompt, previewText, langCode, numberOfSamples = 1, apiKey }) {
    const url = 'https://api.inworld.ai/voices/v1/voices:design';

    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${apiKey}`
    };

    const requestData = {
        voiceDesignConfig: { numberOfSamples },
        designPrompt,
        langCode,
        previewText
    };

    console.log('\nDesigning voice...');
    console.log(`  Description: ${designPrompt.substring(0, 60)}${designPrompt.length > 60 ? '...' : ''}`);
    console.log(`  Preview text: ${previewText.substring(0, 50)}${previewText.length > 50 ? '...' : ''}`);
    console.log(`  Language: ${langCode}`);
    console.log(`  Number of samples: ${numberOfSamples}`);

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestData)
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

    const result = await response.json();

    console.log('\nVoice design completed successfully!');

    const previews = result.previewVoices || result.voice_previews || result.voicePreviews || [];
    if (previews.length > 0) {
        console.log(`\nVoice previews (${previews.length}):`);
        for (let i = 0; i < previews.length; i++) {
            const p = previews[i];
            const voiceId = p.voiceId ?? p.voice_id ?? p.preview_id ?? p.previewId ?? 'N/A';
            console.log(`  Preview ${i + 1}:`);
            console.log(`    voiceId: ${voiceId}`);
            if (p.previewAudio ?? p.preview_audio ?? p.audio_data ?? p.audioData) {
                const audio = p.previewAudio || p.preview_audio || p.audio_data || p.audioData;
                console.log(`    previewAudio: ${audio.length} chars (base64)`);
            }
        }
    }
    if (result.langCode) {
        console.log(`\nlangCode: ${result.langCode}`);
    }

    return result;
}

/**
 * Publish a designed voice preview to your library.
 * API: POST /voices/v1/voices/{voiceId}:publish
 * @param {Object} options - Publish options
 * @param {string} options.voiceId - Voice ID from design preview (e.g. workspace__design-voice-xxx)
 * @param {string} [options.displayName] - Display name for the published voice
 * @param {string} [options.description] - Description of the voice
 * @param {string[]} [options.tags] - Tags for the voice
 * @param {string} options.apiKey - API key for authentication
 * @returns {Promise<Object>} Publish response (voice with name, langCode, displayName, description, tags, voiceId, source)
 */
async function publishVoice({ voiceId, displayName, description, tags, apiKey }) {
    const url = `https://api.inworld.ai/voices/v1/voices/${encodeURIComponent(voiceId)}:publish`;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${apiKey}`
    };
    const body = { voiceId };
    if (displayName) body.displayName = displayName;
    if (description) body.description = description;
    if (tags && tags.length) body.tags = tags;
    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        let err = '';
        try {
            err = JSON.stringify(await response.json());
        } catch {
            err = await response.text();
        }
        throw new Error(`HTTP ${response.status}: ${err}`);
    }
    return response.json();
}

/**
 * Save preview audio (base64) to WAV files. Returns paths saved.
 * @param {Array} previews - previewVoices from design response
 * @returns {string[]} Paths to saved files
 */
function savePreviewAudioFiles(previews) {
    const saved = [];
    for (let i = 0; i < previews.length; i++) {
        const p = previews[i];
        const b64 = p.previewAudio ?? p.preview_audio ?? p.audio_data ?? p.audioData;
        if (!b64) continue;
        const name = `${PREVIEW_FILE_PREFIX}${i + 1}.wav`;
        const filePath = path.join(PREVIEW_OUTPUT_DIR, name);
        fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));
        saved.push(filePath);
    }
    return saved;
}

/**
 * Open an audio file with the system default player.
 * @param {string} filePath - Path to WAV file
 */
function openAudioFile(filePath) {
    try {
        const plat = process.platform;
        if (plat === 'darwin') {
            execSync(`open "${filePath}"`, { stdio: 'ignore' });
        } else if (plat === 'win32') {
            execSync(`start "" "${filePath}"`, { stdio: 'ignore' });
        } else {
            execSync(`xdg-open "${filePath}"`, { stdio: 'ignore' });
        }
    } catch (e) {
        console.log(`  (Could not open player: ${e.message}. Play ${filePath} manually.)`);
    }
}

/**
 * Ask user whether to publish (Y or n to skip). If Y and multiple previews, ask which one. Requires interactive stdin.
 * @param {number} count - Number of previews
 * @param {string} [defaultDisplayName] - Suggested display name for published voice
 * @returns {Promise<{ choice: number, displayName: string }>} choice 1..count or 0; displayName if publishing
 */
function askPublishChoice(count, defaultDisplayName) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question('\nPublish a voice? (Y or n to skip): ', (answer) => {
            const trimmed = answer.trim().toLowerCase();
            if (trimmed !== 'y' && trimmed !== 'yes') {
                rl.close();
                return resolve({ choice: 0, displayName: '' });
            }
            let choice = 1;
            if (count > 1) {
                rl.question(`Which preview (1-${count})? `, (numAnswer) => {
                    const num = parseInt(numAnswer.trim(), 10);
                    if (num >= 1 && num <= count) {
                        choice = num;
                    }
                    rl.question(`Display name for published voice (optional, default: "${defaultDisplayName || 'Designed Voice'}")? `, (nameAnswer) => {
                        const displayName = (nameAnswer && nameAnswer.trim()) ? nameAnswer.trim() : (defaultDisplayName || 'Designed Voice');
                        rl.close();
                        resolve({ choice, displayName });
                    });
                });
            } else {
                rl.question(`Display name for published voice (optional, default: "${defaultDisplayName || 'Designed Voice'}")? `, (nameAnswer) => {
                    const displayName = (nameAnswer && nameAnswer.trim()) ? nameAnswer.trim() : (defaultDisplayName || 'Designed Voice');
                    rl.close();
                    resolve({ choice: 1, displayName });
                });
            }
        });
    });
}

/**
 * Parse command line arguments.
 * @returns {Object} Parsed arguments
 */
function parseArgs() {
    const args = {
        description: DEFAULT_DESIGN_PROMPT,
        previewText: DEFAULT_SCRIPT,
        lang: 'EN_US',
        samples: 1,
        interactive: true,
        displayName: '',
        publishDescription: '',
        publishTags: [],
        help: false
    };

    const argv = process.argv.slice(2);
    let i = 0;

    while (i < argv.length) {
        const arg = argv[i];

        switch (arg) {
            case '--description':
            case '-d':
                args.description = argv[++i] ?? '';
                break;
            case '--script':
            case '-s':
            case '--preview-text':
                args.previewText = argv[++i] ?? '';
                break;
            case '--lang':
            case '-l':
                args.lang = argv[++i];
                break;
            case '--samples':
            case '-n':
                args.samples = parseInt(argv[++i], 10) || 1;
                break;
            case '--no-interactive':
                args.interactive = false;
                break;
            case '--display-name':
                args.displayName = argv[++i] ?? '';
                break;
            case '--publish-description':
                args.publishDescription = argv[++i] ?? '';
                break;
            case '--publish-tags':
                i++;
                args.publishTags = [];
                while (i < argv.length && !argv[i].startsWith('-')) {
                    args.publishTags.push(argv[i++]);
                }
                i--;
                break;
            case '--help':
            case '-h':
                args.help = true;
                break;
            default:
                break;
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
Usage: node example_voice_design_publish.js [options]

Design a voice from a text description using Inworld Voice API (no audio required).
Returns up to three voice previews. See: https://docs.inworld.ai/api-reference/voiceAPI/voiceservice/design-voice

Options:
  -d, --description <text>  Voice description (30-250 characters). Include timbre, tone, pitch, accent, gender, age.
  -s, --script <text>      Preview text (script the voice will speak; 50-200 chars recommended). Alias: --preview-text.
  -l, --lang <code>        Language code (default: EN_US).
  -n, --samples <1|2|3>    Number of voice previews to generate (default: 1).
      --no-interactive    Skip saving/playing preview audio and publish prompt (design only).
      --display-name     Default display name when publishing (optional).
      --publish-description  Description for the published voice (optional).
      --publish-tags     Tags for the published voice, space-separated (optional).
  -h, --help               Show this help message.

After design, preview audio is saved to design_preview_1.wav (etc.) and opened for playback.
You will be prompted to publish a preview to your library (or skip).

Supported Languages:
  ${SUPPORTED_LANGUAGES.join(', ')}

Environment Variables:
  INWORLD_API_KEY          API key for authentication (required)

Examples:
  node example_voice_design_publish.js

  node example_voice_design_publish.js --description "A warm female voice in her thirties with a slight Southern American accent." --script "Welcome to our show. Today we have a special guest."
`);
}

/**
 * Main function to demonstrate voice design.
 */
async function main() {
    const args = parseArgs();

    if (args.help) {
        printHelp();
        return 0;
    }

    console.log('Inworld Voice Design Example');
    console.log('='.repeat(40));

    const apiKey = checkApiKey();
    if (!apiKey) {
        return 1;
    }

    if (!SUPPORTED_LANGUAGES.includes(args.lang)) {
        console.log(`Error: Invalid language code '${args.lang}'.`);
        console.log(`Supported languages: ${SUPPORTED_LANGUAGES.join(', ')}`);
        return 1;
    }

    const len = args.description.length;
    if (len < DESIGN_PROMPT_MIN || len > DESIGN_PROMPT_MAX) {
        console.log(`Error: design_prompt must be between ${DESIGN_PROMPT_MIN} and ${DESIGN_PROMPT_MAX} characters (got ${len}).`);
        return 1;
    }

    if (!args.previewText || args.previewText.length < SCRIPT_MIN) {
        console.log('Error: preview text (--script) is required and must be at least 1 character.');
        return 1;
    }

    if (args.previewText.length > SCRIPT_RECOMMENDED_MAX) {
        console.log(`Note: Preview text is ${args.previewText.length} characters. 50-200 characters is recommended for best results.`);
    }

    const numSamples = Math.min(3, Math.max(1, args.samples || 1));

    const startTime = Date.now();

    try {
        const result = await designVoice({
            designPrompt: args.description,
            previewText: args.previewText,
            langCode: args.lang,
            numberOfSamples: numSamples,
            apiKey
        });

        const elapsed = (Date.now() - startTime) / 1000;
        console.log(`\nDesign time: ${elapsed.toFixed(2)}s`);

        const previews = result.previewVoices || result.voice_previews || result.voicePreviews || [];
        if (previews.length === 0) {
            return 0;
        }

        const interactive = args.interactive && process.stdin.isTTY;
        if (!interactive) {
            console.log('\nPreview(s) received. Run without piping to choose whether to publish (and to save/play preview audio).');
            return 0;
        }

        const savedPaths = savePreviewAudioFiles(previews);
        if (savedPaths.length > 0) {
            console.log(`\nPreview audio saved: ${savedPaths.map(p => path.basename(p)).join(', ')}`);
            console.log('Opening first preview for playback...');
            openAudioFile(savedPaths[0]);
        }

        const { choice, displayName: publishDisplayName } = await askPublishChoice(previews.length, args.displayName || 'Designed Voice');
        if (choice === 0) {
            console.log('Skipped publishing.');
            return 0;
        }

        const selected = previews[choice - 1];
        const voiceId = selected.voiceId ?? selected.voice_id ?? selected.preview_id ?? selected.previewId;
        if (!voiceId) {
            console.log('Selected preview has no voiceId.');
            return 1;
        }

        console.log(`\nPublishing voice: ${voiceId} (display name: ${publishDisplayName})...`);
        const publishResult = await publishVoice({
            voiceId,
            displayName: publishDisplayName,
            description: args.publishDescription || undefined,
            tags: args.publishTags && args.publishTags.length ? args.publishTags : undefined,
            apiKey
        });
        console.log('Published successfully.');
        const v = publishResult.voice || publishResult;
        if (v.voiceId ?? v.voice_id) console.log(`  voiceId: ${v.voiceId ?? v.voice_id}`);
        if (v.displayName) console.log(`  displayName: ${v.displayName}`);
        if (v.description) console.log(`  description: ${v.description}`);
        if (v.tags && v.tags.length) console.log(`  tags: ${v.tags.join(', ')}`);
        if (v.langCode) console.log(`  langCode: ${v.langCode}`);
        if (v.source) console.log(`  source: ${v.source}`);
        if (v.name) console.log(`  name: ${v.name}`);

        return 0;
    } catch (error) {
        console.log(`\nHTTP Error: ${error.message}`);
        return 1;
    }
}

if (require.main === module) {
    main().then(process.exit);
}

module.exports = { designVoice };
