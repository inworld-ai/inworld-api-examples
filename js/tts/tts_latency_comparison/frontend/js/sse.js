// Server-Sent Events (SSE) Management
// COMMENTED OUT: ElevenLabs Turbo and Flash
import { models, /* elevenLabsPlayBtn, */ elevenLabsMultilingualPlayBtn, /* elevenLabsFlashPlayBtn, */ inworldPlayBtn, inworldMaxPlayBtn, humePlayBtn, cartesiaPlayBtn } from './dom.js';
import { updateStatus } from './utils.js';
import { resetTimelines, calculateTimelinePercentages, markModelCompletedWithVAD, hideLoading } from './timeline.js';

// SSE state
let eventSource = null;
let isGenerating = false;

// Handle SSE updates
export function handleSSEUpdate(data) {
    if (data.type === 'connected') {
        updateStatus('Connected to server', 'success');
        return;
    }
    
    if (data.type === 'tts_comparison_started') {
        updateStatus('Starting TTS comparison...', 'info');
        resetTimelines();
        
        // Initialize start times for all providers
        const timestamp = Date.now();
        data.data.providers.forEach(providerName => {
            // Map provider names to model keys
            const modelKey = getModelKeyFromProvider(providerName);
            if (models[modelKey]) {
                models[modelKey].startTime = timestamp;
            }
        });
        return;
    }
    
    if (data.type === 'start') {
        updateStatus('Starting TTS generation...', 'info');
        resetTimelines();
        
        // Initialize start times
        data.models.forEach(modelName => {
            if (models[modelName]) {
                models[modelName].startTime = data.timestamp;
            }
        });
        return;
    }
    
    if (data.type === 'model_update') {
        const model = models[data.model];
        if (!model) return;
        
        const now = data.timestamp;
        const elapsed = now - model.startTime;
        
        // Initialize progress tracking
        if (!model.currentProgress) {
            model.currentProgress = {};
        }
        
        // Update based on stage
        switch (data.stage) {
            case 'processing':
                if (data.progress === 0) {
                    model.currentProgress.processingStart = elapsed;
                } else if (data.progress === 100) {
                    model.currentProgress.processing = true;
                    model.currentProgress.processingDuration = elapsed - (model.currentProgress.processingStart || 0);
                }
                break;
                
            case 'silent_prefix':
                // Silent prefix is no longer used by any TTS models
                // Received unexpected silent_prefix stage - this should not happen
                break;
                
            case 'speech':
                if (!model.currentProgress.speechStart) {
                    model.currentProgress.speechStart = elapsed;
                    model.speechStartTime = now;
                }
                model.currentProgress.speech = true;
                
                // Use actual audio duration from API if provided, otherwise calculate from elapsed time
                if (data.duration !== undefined) {
                    model.currentProgress.speechDuration = data.duration;
                    model.currentProgress.totalAudioDuration = data.totalDuration || data.duration;
                } else {
                    model.currentProgress.speechDuration = elapsed - (model.currentProgress.speechStart || 0);
                }
                break;
                
            case 'complete':
                model.completionTime = now;
                model.totalDuration = data.duration;
                
                // Duration stat removed - users only care about latency to first speech
                
                // Enable play button if audio is available
                if (data.hasAudio) {
                    // COMMENTED OUT: ElevenLabs Turbo and Flash
                    const playBtn = // data.model === 'elevenlabs' ? elevenLabsPlayBtn : 
                                    data.model === 'elevenlabs-multilingual' ? elevenLabsMultilingualPlayBtn :
                                    // data.model === 'elevenlabs-flash' ? elevenLabsFlashPlayBtn :
                                    data.model === 'inworld' ? inworldPlayBtn : 
                                    data.model === 'inworldmax' ? inworldMaxPlayBtn : 
                                    data.model === 'hume' ? humePlayBtn : cartesiaPlayBtn;
                    playBtn.disabled = false;
                }
                
                // Final timeline update
                calculateTimelinePercentages(model);
                
                // Don't auto-reveal models - wait for final reordering
                // setTimeout(() => {
                //     if (!model.currentProgress.vadSilence) {
                //         // No VAD analysis after 2s, marking as completed without VAD
                //         markModelCompletedWithVAD(data.model);
                //     }
                // }, 2000);
                break;
                
            case 'error':
                break;
        }
        
        // Update timeline visualization
        if (data.stage !== 'complete' && data.stage !== 'error') {
            // Estimate total duration for progressive rendering
            model.totalDuration = Math.max(elapsed * 1.5, 3000);
            calculateTimelinePercentages(model);
        }
    }
    
    if (data.type === 'timing_update') {
        const model = models[data.model];
        if (!model) return;
        
        // Update stats with accurate timing data from backend graph
        // timeToAudio = true latency (time to first byte + VAD-detected silence)
        // timeToData = time to first byte (TTFB)
        model.stats.querySelector('.stat-item:first-child .stat-value').textContent = `${data.timeToAudio}ms`;
        model.stats.querySelector('.stat-item:nth-child(2) .stat-value').textContent = `${data.timeToData}ms`;
        
        // Store timing data for timeline calculations
        if (data.vadSilence !== undefined) {
            model.currentProgress.vadSilence = true;
            model.currentProgress.vadSilenceDuration = data.vadSilence;
            model.currentProgress.apiLatency = data.timeToData;
            model.currentProgress.trueLatency = data.timeToAudio;
            
            // Update timeline with VAD overlay
            calculateTimelinePercentages(model);
            
            // Mark this model as completed with VAD (but don't reveal yet - wait for final reordering)
            // markModelCompletedWithVAD(data.model);
        } else {
            // Initial timing without VAD
            model.currentProgress.apiLatency = data.timeToData;
            model.currentProgress.trueLatency = data.timeToAudio;
        }
        
        return;
    }
    
    if (data.type === 'vad_analysis') {
        // This is now handled by timing_update messages
        // Keep for backward compatibility but timing_update should be the source of truth
        return;
    }
    
    if (data.type === 'tts_provider_complete') {
        // Handle individual provider completion from graph
        const providerData = data.data;
        const modelKey = getModelKeyFromProvider(providerData.provider);
        
        if (models[modelKey]) {
            // Update stats with timing data
            const timeToAudio = providerData.timeToAudio;
            const timeToData = providerData.timeToData;
            
            models[modelKey].stats.querySelector('.stat-item:first-child .stat-value').textContent = `${timeToAudio}ms`;
            models[modelKey].stats.querySelector('.stat-item:nth-child(2) .stat-value').textContent = `${timeToData}ms`;
            
            // Enable play button if audio is available
            if (providerData.audioBuffer) {
                const playBtn = getPlayButtonForModel(modelKey);
                if (playBtn) playBtn.disabled = false;
            }
            
            // Mark as completed (but don't reveal yet - wait for final reordering)
            // markModelCompletedWithVAD(modelKey);
        }
        return;
    }
    
    if (data.type === 'tts_comparison_complete') {
        updateStatus('TTS comparison complete!', 'success');
        setGenerating(false);
        
        // Hide loading animation
        hideLoading();
        
        return;
    }
    
    if (data.type === 'tts_comparison_error') {
        updateStatus(`Error: ${data.data.error}`, 'error');
        setGenerating(false);
        
        // Hide loading animation on error
        hideLoading();
        return;
    }
    
    if (data.type === 'complete') {
        updateStatus('TTS generation complete!', 'success');
        setGenerating(false);
        
        // Hide loading animation
        hideLoading();
        
        // Hide all models first to prevent any early reveals from interfering
        Object.values(models).forEach(model => {
            if (model.section) {
                model.section.classList.add('hidden');
                model.section.classList.remove('revealed');
            }
        });
        
        // Reorder models based on backend ranking
        if (data.results && data.results.length > 0) {
            reorderModelsByRanking(data.results);
        }
    }
    
    if (data.type === 'error') {
        updateStatus(`Error: ${data.error}`, 'error');
        setGenerating(false);
        
        // Hide loading animation on error
        hideLoading();
    }
}

// Connect to SSE endpoint
export function connectSSE(sessionId) {
    if (eventSource) {
        eventSource.close();
    }
    
    eventSource = new EventSource(`/api/tts/stream?sessionId=${sessionId}`);
    
    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleSSEUpdate(data);
        } catch (error) {
            // Parse error occurred
        }
    };
    
    eventSource.onerror = (error) => {
        updateStatus('Connection lost. Reconnecting...', 'error');
        setTimeout(() => connectSSE(sessionId), 2000);
    };
    
    return eventSource;
}

// Close SSE connection
export function closeSSE() {
    if (eventSource) {
        eventSource.close();
        eventSource = null;
    }
}

// Generation state management
export function isCurrentlyGenerating() {
    return isGenerating;
}

export function setGenerating(generating) {
    isGenerating = generating;
    const generateBtn = document.getElementById('generateBtn');
    generateBtn.disabled = generating;
}

// Get current event source state
export function getEventSourceState() {
    return eventSource ? eventSource.readyState : null;
}

// Helper function to map provider names to model keys
function getModelKeyFromProvider(providerName) {
    const providerMap = {
        'Cartesia': 'cartesia',
        'ElevenLabs': 'elevenlabs',
        'ElevenLabs Flash': 'elevenlabs-flash',
        'ElevenLabs Multilingual': 'elevenlabs-multilingual',
        'Hume': 'hume',
        'Inworld': 'inworld',
        'Inworld Max': 'inworldmax'
    };
    return providerMap[providerName] || providerName.toLowerCase();
}

// Helper function to get play button for model
function getPlayButtonForModel(modelKey) {
    switch(modelKey) {
        // COMMENTED OUT: ElevenLabs Turbo and Flash
        // case 'elevenlabs': return elevenLabsPlayBtn;
        case 'elevenlabs-multilingual': return elevenLabsMultilingualPlayBtn;
        // case 'elevenlabs-flash': return elevenLabsFlashPlayBtn;
        case 'inworld': return inworldPlayBtn;
        case 'inworldmax': return inworldMaxPlayBtn;
        case 'hume': return humePlayBtn;
        case 'cartesia': return cartesiaPlayBtn;
        default: return null;
    }
}

// Reorder models in DOM based on backend ranking results
function reorderModelsByRanking(rankedResults) {
    
    const comparisonSection = document.querySelector('.comparison-section');
    const loadingSection = document.getElementById('loadingSection');
    
    if (!comparisonSection) {
        return;
    }
    
    // Hide loading section
    hideLoading();
    
    // Get all model sections and remove them from DOM
    const modelSections = [];
    rankedResults.forEach((result, index) => {
        const model = models[result.model];
        if (model && model.section) {
            if (model.section.parentNode) {
                model.section.parentNode.removeChild(model.section);
            }
            modelSections.push({ result, model });
        }
    });
    
    // Clear the comparison section completely (except loading)
    const children = Array.from(comparisonSection.children);
    children.forEach(child => {
        if (child.id !== 'loadingSection') {
            child.remove();
        }
    });
    
    // Re-insert model sections in the correct ranking order
    modelSections.forEach(({ result, model }, index) => {
        
        // Set initial state for animation
        model.section.style.opacity = '0.7';
        model.section.style.transform = 'translateY(10px)';
        
        // Append to comparison section but keep hidden initially
        comparisonSection.appendChild(model.section);
        
        // Add a reveal animation with staggered timing
        setTimeout(() => {
            model.section.classList.remove('hidden');
            model.section.classList.add('revealed');
            model.section.style.opacity = '1';
            model.section.style.transform = 'translateY(0)';
        }, index * 200); // 200ms delay between reveals for better effect
    });
}
