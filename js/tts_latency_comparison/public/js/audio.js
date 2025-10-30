// Audio Management
// COMMENTED OUT: ElevenLabs Turbo and Flash
// import { elevenLabsPlayBtn, elevenLabsMultilingualPlayBtn, elevenLabsFlashPlayBtn, inworldPlayBtn, inworldMaxPlayBtn, humePlayBtn, cartesiaPlayBtn } from './dom.js';
import { elevenLabsMultilingualPlayBtn, inworldPlayBtn, inworldMaxPlayBtn, humePlayBtn, cartesiaPlayBtn } from './dom.js';
import { updateStatus } from './utils.js';

// Audio management state
let currentAudio = null;
const audioCache = new Map();

// Clear audio cache (called when starting new generation)
export function clearAudioCache() {
    // Stop current audio if playing
    if (currentAudio && !currentAudio.paused) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }
    
    // Revoke all cached audio URLs to free memory
    audioCache.forEach((audio, key) => {
        if (audio.src && audio.src.startsWith('blob:')) {
            URL.revokeObjectURL(audio.src);
        }
    });
    
    // Clear the cache
    audioCache.clear();
}

// Audio playback functions
export async function playAudio(model, currentSessionId) {
    if (!currentSessionId) {
        updateStatus('No audio available', 'error');
        return;
    }
    
    // COMMENTED OUT: ElevenLabs Turbo and Flash
    const playBtn = // model === 'elevenlabs' ? elevenLabsPlayBtn : 
                    model === 'elevenlabs-multilingual' ? elevenLabsMultilingualPlayBtn :
                    // model === 'elevenlabs-flash' ? elevenLabsFlashPlayBtn :
                    model === 'inworld' ? inworldPlayBtn : 
                    model === 'inworldmax' ? inworldMaxPlayBtn :
                    model === 'hume' ? humePlayBtn : cartesiaPlayBtn;
    const audioKey = `${currentSessionId}_${model}`;
    
    // Stop current audio if playing
    if (currentAudio && !currentAudio.paused) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        resetPlayButtons();
    }
    
    try {
        let audio;
        
        // Check cache first
        if (audioCache.has(audioKey)) {
            audio = audioCache.get(audioKey);
        } else {
            // Fetch audio from server
            const response = await fetch(`/api/audio/${currentSessionId}/${model}`);
            if (!response.ok) {
                throw new Error(`Audio not available for ${model}`);
            }
            
            const audioBlob = await response.blob();
            // Ensure proper MIME type for better browser compatibility
            const properBlob = new Blob([audioBlob], { type: 'audio/mpeg' });
            const audioUrl = URL.createObjectURL(properBlob);
            audio = new Audio(audioUrl);
            
            // For better cross-browser compatibility, preload the audio
            audio.preload = 'auto';
            
            audioCache.set(audioKey, audio);
        }
        
        currentAudio = audio;
        
        // Update button state
        playBtn.classList.add('playing');
        playBtn.textContent = 'Stop Audio';
        
        // Wait for audio to be ready before playing
        if (audio.readyState < 2) { // HAVE_CURRENT_DATA
            await new Promise((resolve) => {
                const onCanPlay = () => {
                    audio.removeEventListener('canplay', onCanPlay);
                    resolve();
                };
                audio.addEventListener('canplay', onCanPlay);
            });
        }
        
        // Play audio
        await audio.play();
        
        // Handle audio events
        audio.onended = () => {
            resetPlayButtons();
            updateStatus('Audio playback completed', 'success');
        };
        
        audio.onerror = (e) => {
            resetPlayButtons();
            updateStatus(`Audio playback error for ${model}`, 'error');
        };
        
        // Handle audio loading issues
        audio.onstalled = () => {
            // Audio stalled - no action needed
        };
        
        audio.onwaiting = () => {
            // Audio waiting for data - no action needed
        };
        
        updateStatus(`Playing ${model} audio...`, 'info');
        
    } catch (error) {
        updateStatus(`Error playing ${model} audio: ${error.message}`, 'error');
        resetPlayButtons();
    }
}

export function resetPlayButtons() {
    // COMMENTED OUT: ElevenLabs Turbo and Flash
    [/* elevenLabsPlayBtn, */ elevenLabsMultilingualPlayBtn, /* elevenLabsFlashPlayBtn, */ inworldPlayBtn, inworldMaxPlayBtn, humePlayBtn, cartesiaPlayBtn].forEach((btn, index) => {
        btn.classList.remove('playing');
        btn.textContent = 'Play Audio';
    });
    
    if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
    }
}
