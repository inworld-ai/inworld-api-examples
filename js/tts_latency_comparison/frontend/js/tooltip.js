// Timeline Segment Tooltip Management
import { models } from './dom.js';

let tooltip = null;
let currentSegment = null; // Track the segment we're showing tooltip for

// Create tooltip element
function createTooltip() {
    if (tooltip) return tooltip;
    
    tooltip = document.createElement('div');
    tooltip.className = 'timeline-tooltip';
    document.body.appendChild(tooltip);
    return tooltip;
}

// Show tooltip with segment duration
function showTooltip(event, duration, segmentType, segmentElement) {
    if (!tooltip) createTooltip();
    
    const segmentNames = {
        processing: 'Server Processing',
        'silent-prefix': 'Silent Prefix',
        speech: 'Speech Audio',
        'vad-silence': 'Silence'
    };
    
    const segmentName = segmentNames[segmentType] || segmentType;
    tooltip.textContent = `${segmentName}: ${duration}ms`;
    
    // Store reference to the segment we're showing tooltip for
    currentSegment = segmentElement;
    
    // Position tooltip relative to the segment
    const rect = segmentElement.getBoundingClientRect();
    const tooltipX = rect.left + (rect.width / 2);
    const tooltipY = rect.top;
    
    tooltip.style.left = `${tooltipX}px`;
    tooltip.style.top = `${tooltipY}px`;
    tooltip.classList.add('show');
}

// Hide tooltip
function hideTooltip() {
    if (tooltip) {
        tooltip.classList.remove('show');
    }
    currentSegment = null; // Clear the current segment reference
}

// Get segment type from element classes
function getSegmentType(element) {
    const classList = Array.from(element.classList);
    const segmentTypes = ['processing', 'silent-prefix', 'speech', 'vad-silence'];
    
    for (const type of segmentTypes) {
        if (classList.includes(type)) {
            return type;
        }
    }
    return null;
}

// Initialize tooltip event listeners for all timeline segments
export function initializeTooltips() {
    Object.keys(models).forEach(modelName => {
        const model = models[modelName];
        
        // Add event listeners to each segment
        Object.entries(model.segments).forEach(([segmentKey, segment]) => {
            if (!segment) return;
            
            segment.addEventListener('mouseenter', (event) => {
                const duration = parseFloat(segment.dataset.duration) || 0;
                const segmentType = getSegmentType(segment);
                
                if (duration > 0 && segmentType) {
                    showTooltip(event, Math.round(duration), segmentType, segment);
                }
            });
            
            segment.addEventListener('mouseleave', hideTooltip);
            
            // Update tooltip position on mouse move within segment
            segment.addEventListener('mousemove', (event) => {
                if (tooltip && tooltip.classList.contains('show') && currentSegment) {
                    // Use the stored currentSegment reference, not event.target
                    // This prevents the tooltip from jumping when segments overlap
                    const rect = currentSegment.getBoundingClientRect();
                    const tooltipX = rect.left + (rect.width / 2);
                    const tooltipY = rect.top;
                    
                    tooltip.style.left = `${tooltipX}px`;
                    tooltip.style.top = `${tooltipY}px`;
                }
            });
        });
    });
}

// Update segment duration data attribute
export function setSegmentDuration(modelName, segmentType, duration) {
    const model = models[modelName];
    if (!model || !model.segments) return;
    
    const segmentMap = {
        processing: model.segments.processing,
        silentPrefix: model.segments.silentPrefix,
        speech: model.segments.speech,
        vadSilence: model.segments.vadSilence
    };
    
    const segment = segmentMap[segmentType];
    if (segment) {
        segment.dataset.duration = duration.toString();
    }
}
