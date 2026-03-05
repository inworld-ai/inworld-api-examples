// Timeline Management
// COMMENTED OUT: ElevenLabs Turbo
import { models, loadingSection, /* elevenLabsPlayBtn, */ inworldPlayBtn, inworldMaxPlayBtn, humePlayBtn } from './dom.js';
import { resetPlayButtons } from './audio.js';
import { setSegmentDuration } from './tooltip.js';

// Track the longest duration for normalization
let maxDuration = 0;

// Track revealed models and their latencies for ordering
let revealedModels = [];
let completedModelsWithVAD = [];

// Show loading animation
export function showLoading() {
    loadingSection.classList.add('active');
    // Hide all model sections
    Object.values(models).forEach(model => {
        model.section.classList.add('hidden');
        model.section.classList.remove('revealed');
    });
    // Reset reveal tracking
    revealedModels = [];
    completedModelsWithVAD = [];
}

// Hide loading animation
export function hideLoading() {
    loadingSection.classList.remove('active');
}

// Reveal a model with animation
export function revealModel(modelName) {
    const model = models[modelName];
    if (!model || revealedModels.includes(modelName)) return;
    
    model.section.classList.remove('hidden');
    // Small delay to trigger CSS transition
    setTimeout(() => {
        model.section.classList.add('revealed');
    }, 50);
    
    revealedModels.push(modelName);
}

// Mark model as completed with VAD analysis
export function markModelCompletedWithVAD(modelName) {
    if (!completedModelsWithVAD.includes(modelName)) {
        completedModelsWithVAD.push(modelName);
        
        // Check if all models are done
        const totalModels = Object.keys(models).length;
        if (completedModelsWithVAD.length === totalModels) {
            hideLoading();
            setTimeout(() => {
                revealModelsInOrder();
            }, 500); // Small delay after hiding loading
        }
    }
}

// Reveal models in order of true latency (best first)
export function revealModelsInOrder() {
    // Sort completed models by true latency (including VAD correction)
    // Filter out skipped services (99999ms) from being displayed
    const sortedModels = completedModelsWithVAD
        .map(modelName => {
            const model = models[modelName];
            // Use the same calculation as in sse.js for consistency
            const processingDuration = model.currentProgress?.processingDuration || 0;
            const vadSilenceDuration = model.currentProgress?.vadSilenceDuration || 0;
            const trueLatency = processingDuration + vadSilenceDuration;
            return { name: modelName, latency: trueLatency };
        })
        .filter(modelData => modelData.latency < 99999)
        .sort((a, b) => a.latency - b.latency);
    
    // Reorder DOM elements to match the latency order
    const comparisonSection = document.querySelector('.comparison-section');
    const loadingSection = document.getElementById('loadingSection');
    
    // Remove all model sections from DOM (but keep loading section)
    sortedModels.forEach(modelData => {
        const model = models[modelData.name];
        if (model.section.parentNode) {
            model.section.parentNode.removeChild(model.section);
        }
    });
    
    // Re-insert model sections in the correct order after loading section
    sortedModels.forEach(modelData => {
        const model = models[modelData.name];
        comparisonSection.appendChild(model.section);
    });
    
    // Reveal models with delays (best latency first)
    sortedModels.forEach((modelData, index) => {
        setTimeout(() => {
            revealModel(modelData.name);
        }, index * 800); // 800ms delay between reveals
    });
}

// Reset timelines
export function resetTimelines() {
    // Reset max duration for normalization
    maxDuration = 0;
    
    Object.keys(models).forEach(modelName => {
        const model = models[modelName];
        
        // Reset segments
        Object.values(model.segments).forEach(segment => {
            segment.style.width = '0%';
        });
        
        // Reset VAD silence segment position
        if (model.segments.vadSilence) {
            model.segments.vadSilence.style.left = '0';
        }
        
        
        // Reset stats
        model.stats.querySelectorAll('.stat-value').forEach(value => {
            value.textContent = '--';
        });
        
        // Reset tracking
        model.startTime = null;
        model.speechStartTime = null;
        model.completionTime = null;
        model.totalDuration = 0;
        model.currentProgress = {};
    });
    
    
    // Reset and disable play buttons
    resetPlayButtons();
    // COMMENTED OUT: ElevenLabs Turbo
    // elevenLabsPlayBtn.disabled = true;
    inworldPlayBtn.disabled = true;
    inworldMaxPlayBtn.disabled = true;
    humePlayBtn.disabled = true;
    
    // Hide models but don't show loading on initial reset
    Object.values(models).forEach(model => {
        model.section.classList.add('hidden');
        model.section.classList.remove('revealed');
    });
}

// Calculate timeline percentages with consistent x-axis (time from t=0)
export function calculateTimelinePercentages(model) {
    const progress = model.currentProgress;
    
    // Calculate durations - use backend timing data if available, fallback to frontend estimates
    const processingDuration = progress.apiLatency || progress.processingDuration || 0;
    const speechAudioDuration = progress.totalAudioDuration || progress.speechDuration || 0;
    const vadSilenceDuration = progress.vadSilenceDuration || 0;
    
    // Time to First Real Audio = processing + VAD silence (what user actually experiences)
    const timeToFirstRealAudio = processingDuration + vadSilenceDuration;
    
    if (!timeToFirstRealAudio || timeToFirstRealAudio === 0) return;
    
    // Update max duration for consistent x-axis across all models
    // Now based on time to first real audio instead of total duration with audio
    // Exclude skipped services (99999ms) from max duration calculation for proper bar scaling
    if (timeToFirstRealAudio < 99999) {
        maxDuration = Math.max(maxDuration, timeToFirstRealAudio);
    }
    
    // IMPORTANT: All timelines use the same maxDuration for x-axis consistency
    // This ensures t=0 is always at the left edge and the slowest time to first real audio fills the bar
    const normalizationDuration = maxDuration;
    
    // Get model name for tooltip data storage
    const modelName = Object.keys(models).find(name => models[name] === model);
    
    // Processing segment (gray) - starts at t=0
    if (progress.processing) {
        const processingWidth = (processingDuration / normalizationDuration) * 100;
        model.segments.processing.style.width = `${processingWidth}%`;
        setSegmentDuration(modelName, 'processing', processingDuration);
    }
    
    // Silent prefix segment (orange) - no longer used by any TTS models
    // Reset to 0 width in case it was previously set
    model.segments.silentPrefix.style.width = '0%';
    setSegmentDuration(modelName, 'silentPrefix', 0);
    
    // Speech segment (green) - REMOVED: No longer displaying audio length in visualization
    // The calculations remain the same but we don't show this segment anymore
    // if (progress.speech) {
    //     const speechWidth = (speechAudioDuration / normalizationDuration) * 100;
    //     model.segments.speech.style.width = `${speechWidth}%`;
    //     setSegmentDuration(modelName, 'speech', speechAudioDuration);
    // }
    model.segments.speech.style.width = '0%';
    setSegmentDuration(modelName, 'speech', 0);
    
    // VAD silence segment (yellow overlay) - overlays the beginning of the speech segment
    if (progress.vadSilence && vadSilenceDuration > 0) {
        const vadSilenceWidth = (vadSilenceDuration / normalizationDuration) * 100;
        const speechStartPosition = (processingDuration / normalizationDuration) * 100;
        
        model.segments.vadSilence.style.width = `${vadSilenceWidth}%`;
        model.segments.vadSilence.style.left = `${speechStartPosition}%`;
        setSegmentDuration(modelName, 'vadSilence', vadSilenceDuration);
    }
    
    // Store timing info for this model
    model.totalDuration = timeToFirstRealAudio;
    model.speechStartTime_calculated = processingDuration; // When speech data starts
    
    // Recalculate all models when max duration changes to maintain consistent x-axis
    if (timeToFirstRealAudio === maxDuration) {
        Object.values(models).forEach(otherModel => {
            if (otherModel !== model && otherModel.totalDuration > 0) {
                calculateTimelinePercentages(otherModel);
            }
        });
    }
}

