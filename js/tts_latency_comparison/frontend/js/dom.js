// DOM Elements and Model Configuration
export const textInput = document.getElementById('textInput');
export const generateBtn = document.getElementById('generateBtn');
// export const statusBar = document.getElementById('statusBar'); // Removed - no longer used
// COMMENTED OUT: ElevenLabs Turbo
// export const elevenLabsPlayBtn = document.getElementById('elevenlabs-play-btn');
export const elevenLabsMultilingualPlayBtn = document.getElementById('elevenlabs-multilingual-play-btn');
// COMMENTED OUT: ElevenLabs Flash
// export const elevenLabsFlashPlayBtn = document.getElementById('elevenlabs-flash-play-btn');
export const inworldPlayBtn = document.getElementById('inworld-play-btn');
export const inworldMaxPlayBtn = document.getElementById('inworldmax-play-btn');
export const humePlayBtn = document.getElementById('hume-play-btn');
export const cartesiaPlayBtn = document.getElementById('cartesia-play-btn');
export const loadingSection = document.getElementById('loadingSection');

// Model timeline tracking configuration
export const models = {
    // COMMENTED OUT: ElevenLabs Turbo
    // elevenlabs: {
    //     section: document.getElementById('elevenlabs-section'),
    //     timeline: document.getElementById('elevenlabs-timeline'),
    //     stats: document.getElementById('elevenlabs-stats'),
    //     segments: {},
    //     markers: {},
    //     startTime: null,
    //     speechStartTime: null,
    //     completionTime: null
    // },
    'elevenlabs-multilingual': {
        section: document.getElementById('elevenlabs-multilingual-section'),
        timeline: document.getElementById('elevenlabs-multilingual-timeline'),
        stats: document.getElementById('elevenlabs-multilingual-stats'),
        segments: {},
        markers: {},
        startTime: null,
        speechStartTime: null,
        completionTime: null
    },
    // COMMENTED OUT: ElevenLabs Flash
    // 'elevenlabs-flash': {
    //     section: document.getElementById('elevenlabs-flash-section'),
    //     timeline: document.getElementById('elevenlabs-flash-timeline'),
    //     stats: document.getElementById('elevenlabs-flash-stats'),
    //     segments: {},
    //     markers: {},
    //     startTime: null,
    //     speechStartTime: null,
    //     completionTime: null
    // },
    inworld: {
        section: document.getElementById('inworld-section'),
        timeline: document.getElementById('inworld-timeline'),
        stats: document.getElementById('inworld-stats'),
        segments: {},
        markers: {},
        startTime: null,
        speechStartTime: null,
        completionTime: null
    },
    inworldmax: {
        section: document.getElementById('inworldmax-section'),
        timeline: document.getElementById('inworldmax-timeline'),
        stats: document.getElementById('inworldmax-stats'),
        segments: {},
        markers: {},
        startTime: null,
        speechStartTime: null,
        completionTime: null
    },
    hume: {
        section: document.getElementById('hume-section'),
        timeline: document.getElementById('hume-timeline'),
        stats: document.getElementById('hume-stats'),
        segments: {},
        markers: {},
        startTime: null,
        speechStartTime: null,
        completionTime: null
    },
    cartesia: {
        section: document.getElementById('cartesia-section'),
        timeline: document.getElementById('cartesia-timeline'),
        stats: document.getElementById('cartesia-stats'),
        segments: {},
        markers: {},
        startTime: null,
        speechStartTime: null,
        completionTime: null
    }
};

// Initialize timeline segments
Object.keys(models).forEach(modelName => {
    const model = models[modelName];
    model.segments = {
        processing: model.timeline.querySelector('.timeline-segment.processing'),
        silentPrefix: model.timeline.querySelector('.timeline-segment.silent-prefix'),
        speech: model.timeline.querySelector('.timeline-segment.speech'),
        vadSilence: model.timeline.querySelector('.timeline-segment.vad-silence')
    };
});
