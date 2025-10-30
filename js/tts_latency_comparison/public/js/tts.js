// TTS Generation Logic
import { updateStatus } from './utils.js';
import { resetTimelines, showLoading, hideLoading } from './timeline.js';
import { connectSSE, isCurrentlyGenerating, setGenerating, getEventSourceState } from './sse.js';
import { clearAudioCache, resetPlayButtons } from './audio.js';

// Generate TTS
export async function generateTTS(text, sessionId) {
    if (!text.trim()) {
        updateStatus('Please enter some text', 'error');
        return;
    }
    
    if (isCurrentlyGenerating()) {
        return;
    }
    
    setGenerating(true);
    resetTimelines();
    showLoading();
    
    // Clear audio cache and reset play buttons to ensure fresh audio playback
    clearAudioCache();
    resetPlayButtons();
    
    // Ensure SSE connection is established before making request
    if (getEventSourceState() !== EventSource.OPEN) {
        connectSSE(sessionId);
        
        // Wait for SSE connection to be established
        let retries = 0;
        while (getEventSourceState() !== EventSource.OPEN && retries < 10) {
            await new Promise(resolve => setTimeout(resolve, 200));
            retries++;
        }
        
        if (getEventSourceState() !== EventSource.OPEN) {
            // Failed to establish SSE connection
        }
    }
    
    try {
        const response = await fetch('/compare', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-session-id': sessionId
            },
            body: JSON.stringify({
                text,
                voice: null // Optional voice parameter
            })
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'TTS comparison failed');
        }
        
        const result = await response.json();
        
    } catch (error) {
        updateStatus(`Error: ${error.message}`, 'error');
        setGenerating(false);
        
        // Hide loading animation on error
        hideLoading();
    }
}
