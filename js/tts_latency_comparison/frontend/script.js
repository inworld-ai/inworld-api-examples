// Main TTS Application Script
// COMMENTED OUT: ElevenLabs Turbo and Flash
import { 
    textInput, 
    generateBtn, 
    // elevenLabsPlayBtn, 
    elevenLabsMultilingualPlayBtn,
    // elevenLabsFlashPlayBtn,
    inworldPlayBtn,
    inworldMaxPlayBtn,
    humePlayBtn,
    cartesiaPlayBtn,
    models
} from './js/dom.js';

import { generateSessionId, updateStatus } from './js/utils.js';
import { playAudio, resetPlayButtons } from './js/audio.js';
import { resetTimelines } from './js/timeline.js';
import { connectSSE, closeSSE } from './js/sse.js';
import { generateTTS } from './js/tts.js';
import { initializeTooltips } from './js/tooltip.js';

// Session management
let currentSessionId = null;


// Event listeners
generateBtn.addEventListener('click', async () => {
    // Generate a new session ID for each TTS generation to ensure fresh audio
    currentSessionId = generateSessionId();
    connectSSE(currentSessionId);
    await generateTTS(textInput.value, currentSessionId);
});


// Play button event listeners
// COMMENTED OUT: ElevenLabs Turbo
// elevenLabsPlayBtn.addEventListener('click', () => {
//     if (elevenLabsPlayBtn.classList.contains('playing')) {
//         resetPlayButtons();
//     } else {
//         playAudio('elevenlabs', currentSessionId);
//     }
// });

elevenLabsMultilingualPlayBtn.addEventListener('click', () => {
    if (elevenLabsMultilingualPlayBtn.classList.contains('playing')) {
        resetPlayButtons();
    } else {
        playAudio('elevenlabs-multilingual', currentSessionId);
    }
});

// COMMENTED OUT: ElevenLabs Flash
// elevenLabsFlashPlayBtn.addEventListener('click', () => {
//     if (elevenLabsFlashPlayBtn.classList.contains('playing')) {
//         resetPlayButtons();
//     } else {
//         playAudio('elevenlabs-flash', currentSessionId);
//     }
// });

inworldPlayBtn.addEventListener('click', () => {
    if (inworldPlayBtn.classList.contains('playing')) {
        resetPlayButtons();
    } else {
        playAudio('inworld', currentSessionId);
    }
});

inworldMaxPlayBtn.addEventListener('click', () => {
    if (inworldMaxPlayBtn.classList.contains('playing')) {
        resetPlayButtons();
    } else {
        playAudio('inworldmax', currentSessionId);
    }
});

humePlayBtn.addEventListener('click', () => {
    if (humePlayBtn.classList.contains('playing')) {
        resetPlayButtons();
    } else {
        playAudio('hume', currentSessionId);
    }
});

cartesiaPlayBtn.addEventListener('click', () => {
    if (cartesiaPlayBtn.classList.contains('playing')) {
        resetPlayButtons();
    } else {
        playAudio('cartesia', currentSessionId);
    }
});

// Character counter
const charCount = document.getElementById('charCount');
const updateCharCount = () => {
    const length = textInput.value.length;
    charCount.textContent = length;
    // Add warning class if approaching limit
    if (length >= 380) {
        charCount.style.color = '#ff4444';
    } else if (length >= 350) {
        charCount.style.color = '#ff9800';
    } else {
        charCount.style.color = '';
    }
};

textInput.addEventListener('input', updateCharCount);

// Keyboard shortcuts
textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.ctrlKey) {
        // Generate a new session ID for each TTS generation to ensure fresh audio
        currentSessionId = generateSessionId();
        connectSSE(currentSessionId);
        generateTTS(textInput.value, currentSessionId);
    }
});

// Initialize on load
window.addEventListener('load', () => {
    currentSessionId = generateSessionId();
    connectSSE(currentSessionId);
    updateStatus('Ready to generate speech', 'info');
    initializeTooltips();
});

// Cleanup on unload
window.addEventListener('beforeunload', () => {
    closeSSE();
});