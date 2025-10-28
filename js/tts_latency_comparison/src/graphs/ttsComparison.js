import 'dotenv/config';
import {
  GraphBuilder,
  CustomNode
} from "@inworld/runtime/graph";
import { v4 as uuidv4 } from 'uuid';

// Import TTS services
import CartesiaService from '../services/cartesiaService.js';
import ElevenLabsService from '../services/elevenLabsService.js';
import ElevenLabsFlashService from '../services/elevenLabsFlashService.js';
import ElevenLabsMultilingualService from '../services/elevenLabsMultilingualService.js';
import HumeService from '../services/humeService.js';
import InworldService from '../services/inworldService.js';
import InworldMaxService from '../services/inworldMaxService.js';
import AudioManager from '../managers/audioManager.js';
import vadService from '../services/vadService.js';

const apiKey = process.env.INWORLD_API_KEY;
if (!apiKey) {
  throw new Error(
    "INWORLD_API_KEY environment variable is not set. Please add it to your .env file."
  );
}

// Input proxy node that prepares the text for all TTS providers
class TextInputProxyNode extends CustomNode {
  async process(_context, input) {
    console.log(`[TextInputProxy] Processing text: "${input.text.substring(0, 50)}${input.text.length > 50 ? '...' : ''}"`);
    return {
      text: input.text,
      sessionId: input.sessionId,
      voice: input.voice
    };
  }
}

// Base TTS Provider Node that reuses existing services
class BaseTTSProviderNode extends CustomNode {
  constructor(config, providerName, ServiceClass, modelName, sharedAudioManager, sessionManager) {
    super(config);
    this.providerName = providerName;
    this.modelName = modelName;
    this.audioManager = sharedAudioManager; // Use shared instance
    this.sessionManager = sessionManager; // Store session manager reference
    this.vadService = vadService; // Store VAD service reference for graph node
    this.service = new ServiceClass(this.audioManager, vadService);
  }

  async process(context, input) {
    const startTime = Date.now();
    let timeToData = null;
    let vadSilence = 0;
    let hasAudio = false;
    let error = null;

    try {
      console.log(`[${this.providerName}] Starting TTS for text: "${input.text.substring(0, 30)}..."`);
      
      // Simple sendUpdate function that just forwards messages
      const sendUpdate = (data) => {
        console.log(`[${this.providerName}] Forwarding message:`, data.type, data.stage || '', data.progress || '');
        
        if (this.sessionManager) {
          this.sessionManager.sendUpdate(input.sessionId, data);
        } else {
          console.warn(`[${this.providerName}] No session manager available!`);
        }
      };

      // Call the TTS service - it will handle VAD internally and await completion
      const serviceResult = await this.service.process(input.text, sendUpdate, input.sessionId);
      
      // Use time to first byte from service if available, otherwise use total time
      timeToData = serviceResult?.timeToFirstByte || (Date.now() - startTime);
      
      // Check if audio was generated from service result first, fallback to checking audio manager
      hasAudio = serviceResult?.hasAudio || !!this.audioManager.getAudio(input.sessionId, this.getModelKey());
      console.log(`[${this.providerName}] Audio check - from service: ${serviceResult?.hasAudio}, from manager: ${!!this.audioManager.getAudio(input.sessionId, this.getModelKey())}, final: ${hasAudio}`);
      
      // Get VAD silence from the audio file if it exists
      console.log(`[${this.providerName}] Checking VAD: hasAudio=${hasAudio}, vadService=${!!this.vadService}`);
      if (hasAudio && this.vadService) {
        try {
          console.log(`[${this.providerName}] Running VAD analysis...`);
          const vadResult = await this.vadService.analyzeCompleteAudioFile(input.sessionId, this.getModelKey(), this.audioManager);
          if (vadResult.success) {
            vadSilence = vadResult.msBeforeVoice;
            console.log(`[${this.providerName}] VAD detected ${vadSilence}ms silence`);
          } else {
            console.log(`[${this.providerName}] VAD analysis failed: ${vadResult.message}`);
          }
        } catch (vadError) {
          console.log(`[${this.providerName}] VAD analysis error: ${vadError.message}`);
        }
      } else {
        console.log(`[${this.providerName}] Skipping VAD - hasAudio: ${hasAudio}, vadService: ${!!this.vadService}`);
      }
      
      const timeToAudio = timeToData + vadSilence;
      
      // Send final timing to frontend (skip if service was not run due to missing API key)
      if (this.sessionManager && timeToData < 99999) {
        this.sessionManager.sendUpdate(input.sessionId, {
          type: 'timing_update',
          model: this.getModelKey(),
          timeToData: timeToData,
          timeToAudio: timeToAudio,
          vadSilence: vadSilence,
          timestamp: Date.now()
        });
      }
      
      console.log(`[${this.providerName}] Final - TTFB: ${timeToData}ms, Silence: ${vadSilence}ms, Audio: ${timeToAudio}ms`);

    } catch (err) {
      timeToData = Date.now() - startTime;
      error = err.message;
      console.error(`[${this.providerName}] Error after ${timeToData}ms:`, error);
    }

    // Get the voice used by this service
    const voice = this.getVoiceUsed();

    return {
      provider: this.providerName,
      model: this.modelName,
      voice: voice,
      responseLatency: timeToData || 0,  // Time to first byte (TTFB)
      silenceTime: vadSilence || 0,      // VAD-detected silence at beginning of audio
      timeToAudio: (timeToData || 0) + (vadSilence || 0), // True latency: responseLatency + silenceTime
      hasAudio: hasAudio,
      error,
      sessionId: input.sessionId
    };
  }

  getModelKey() {
    // Map provider names to model keys used by audio manager
    const keyMap = {
      'Cartesia': 'cartesia',
      'ElevenLabs': 'elevenlabs',
      'ElevenLabs Flash': 'elevenlabs-flash',
      'ElevenLabs Multilingual': 'elevenlabs-multilingual',
      'Hume': 'hume',
      'Inworld': 'inworld',
      'Inworld Max': 'inworldmax'
    };
    return keyMap[this.providerName] || this.providerName.toLowerCase();
  }

  getVoiceUsed() {
    // This method should be overridden by each specific TTS node
    // to return the actual voice used by the service
    return null;
  }
}

// Specific TTS Provider Nodes that reuse existing services
class CartesiaTTSNode extends BaseTTSProviderNode {
  constructor(config, sharedAudioManager, sessionManager) {
    super(config, 'Cartesia', CartesiaService, 'sonic-english', sharedAudioManager, sessionManager);
  }

  getVoiceUsed() {
    return process.env.CARTESIA_VOICE_ID || '694f9389-aac1-45b6-b726-9d9369183238';
  }
}

class ElevenLabsTTSNode extends BaseTTSProviderNode {
  constructor(config, sharedAudioManager, sessionManager) {
    super(config, 'ElevenLabs', ElevenLabsService, 'eleven_turbo_v2_5', sharedAudioManager, sessionManager);
  }

  getVoiceUsed() {
    return process.env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
  }
}

class ElevenLabsFlashTTSNode extends BaseTTSProviderNode {
  constructor(config, sharedAudioManager, sessionManager) {
    super(config, 'ElevenLabs Flash', ElevenLabsFlashService, 'eleven_flash_v2_5', sharedAudioManager, sessionManager);
  }

  getVoiceUsed() {
    return process.env.ELEVENLABS_FLASH_VOICE_ID || '4YYIPFl9wE5c4L2eu2Gb';
  }
}

class ElevenLabsMultilingualTTSNode extends BaseTTSProviderNode {
  constructor(config, sharedAudioManager, sessionManager) {
    super(config, 'ElevenLabs Multilingual', ElevenLabsMultilingualService, 'eleven_multilingual_v2', sharedAudioManager, sessionManager);
  }

  getVoiceUsed() {
    return process.env.ELEVENLABS_MULTILINGUAL_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb';
  }
}

class HumeTTSNode extends BaseTTSProviderNode {
  constructor(config, sharedAudioManager, sessionManager) {
    super(config, 'Hume', HumeService, 'hume-ai', sharedAudioManager, sessionManager);
  }

  getVoiceUsed() {
    return process.env.HUME_VOICE_ID || "Male English Actor";
  }
}

class InworldTTSNode extends BaseTTSProviderNode {
  constructor(config, sharedAudioManager, sessionManager) {
    super(config, 'Inworld', InworldService, 'inworld-tts', sharedAudioManager, sessionManager);
  }

  getVoiceUsed() {
    return process.env.INWORLD_VOICE_ID || 'Alex';
  }
}

class InworldMaxTTSNode extends BaseTTSProviderNode {
  constructor(config, sharedAudioManager, sessionManager) {
    super(config, 'Inworld Max', InworldMaxService, 'inworld-max', sharedAudioManager, sessionManager);
  }

  getVoiceUsed() {
    return process.env.INWORLD_MAX_VOICE_ID || 'Hades';
  }
}

// Ranking and results aggregation node
class TTSRankingNode extends CustomNode {
  constructor(config, sessionManager) {
    super(config);
    this.sessionManager = sessionManager;
  }

  async process(context, cartesiaResult, elevenLabsMultilingualResult, humeResult, inworldResult, inworldMaxResult) {
    console.log('[TTSRanking] Aggregating results from all providers');
    console.log('[TTSRanking] Received results:', {
      cartesia: cartesiaResult?.provider,
      elevenLabsMultilingual: elevenLabsMultilingualResult?.provider,
      hume: humeResult?.provider,
      inworld: inworldResult?.provider,
      inworldMax: inworldMaxResult?.provider
    });
    
    // Collect all results into an array
    const allResults = [
      cartesiaResult,
      elevenLabsMultilingualResult,
      humeResult,
      inworldResult,
      inworldMaxResult
    ];
    
    // Filter out null/undefined results, errors, and results with 99999ms latency (skipped due to missing API keys)
    const results = allResults.filter(result => result && !result.error && result.timeToAudio < 99999);
    const failedResults = allResults.filter(result => result && result.error);
    const skippedResults = allResults.filter(result => result && result.timeToAudio >= 99999);
    const sessionId = results[0]?.sessionId || failedResults[0]?.sessionId || skippedResults[0]?.sessionId;
    
    console.log(`[TTSRanking] Processing ${results.length} successful, ${failedResults.length} failed, and ${skippedResults.length} skipped results`);
    if (failedResults.length > 0) {
      failedResults.forEach(result => {
        console.log(`[TTSRanking] Failed: ${result.provider} - ${result.error}`);
      });
    }
    if (skippedResults.length > 0) {
      skippedResults.forEach(result => {
        console.log(`[TTSRanking] Skipped: ${result.provider} - no API key configured`);
      });
    }

    // Debug: Log all results before sorting
    console.log('[TTSRanking] Results before sorting:');
    results.forEach((result, index) => {
      console.log(`  ${index + 1}. ${result.provider}: timeToAudio=${result.timeToAudio}ms, responseLatency=${result.responseLatency}ms, silenceTime=${result.silenceTime}ms`);
    });
    
    // Sort by timeToAudio (fastest first) - this should include VAD timing
    const rankedResults = results.sort((a, b) => a.timeToAudio - b.timeToAudio);
    
    console.log('[TTSRanking] Final rankings (with VAD-adjusted latency):');
    rankedResults.forEach((result, index) => {
      console.log(`  ${index + 1}. ${result.provider} (${result.model}): ${result.timeToAudio}ms (response: ${result.responseLatency}ms + silence: ${result.silenceTime}ms)`);
    });

    // Don't send individual completion messages here - the services already sent them
    // Just log the final rankings
    console.log('[TTSRanking] Rankings completed - all progressive updates were sent by individual services');

    // Send final comparison results with clean ranking data
    if (this.sessionManager) {
      this.sessionManager.sendUpdate(sessionId, {
        type: 'complete',
        results: rankedResults.map((result, index) => ({
          model: this.getModelKeyFromProvider(result.provider),
          provider: result.provider,
          modelName: result.model,
          voice: result.voice,
          status: 'fulfilled',
          error: null,
          responseLatency: result.responseLatency,
          silenceTime: result.silenceTime,
          timeToAudio: result.timeToAudio,
          hasAudio: result.hasAudio,
          rank: index + 1
        })),
        timestamp: Date.now()
      });
    }

    return {
      rankedResults,
      sessionId
    };
  }

  // Helper method to map provider names to model keys for frontend
  getModelKeyFromProvider(providerName) {
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
}

// Create the graph
export function createTTSComparisonGraph(sessionManager) {
  // Initialize VAD service if not already initialized
  if (!vadService.isInitialized) {
    vadService.initialize().catch(console.error);
  }

  // Create shared audio manager instance for all nodes
  const sharedAudioManager = new AudioManager();

  const textInputProxy = new TextInputProxyNode({ id: "text-input-proxy" });
  
  const cartesiaTTS = new CartesiaTTSNode({ id: "cartesia-tts" }, sharedAudioManager, sessionManager);
  // COMMENTED OUT: ElevenLabs Turbo
  // const elevenLabsTTS = new ElevenLabsTTSNode({ id: "elevenlabs-tts" }, sharedAudioManager, sessionManager);
  // COMMENTED OUT: ElevenLabs Flash
  // const elevenLabsFlashTTS = new ElevenLabsFlashTTSNode({ id: "elevenlabs-flash-tts" }, sharedAudioManager, sessionManager);
  const elevenLabsMultilingualTTS = new ElevenLabsMultilingualTTSNode({ id: "elevenlabs-multilingual-tts" }, sharedAudioManager, sessionManager);
  const humeTTS = new HumeTTSNode({ id: "hume-tts" }, sharedAudioManager, sessionManager);
  const inworldTTS = new InworldTTSNode({ id: "inworld-tts" }, sharedAudioManager, sessionManager);
  const inworldMaxTTS = new InworldMaxTTSNode({ id: "inworld-max-tts" }, sharedAudioManager, sessionManager);
  
  const ttsRanking = new TTSRankingNode({ id: "tts-ranking" }, sessionManager);

  const graph = new GraphBuilder({ id: 'tts-comparison', apiKey })
    .addNode(textInputProxy)
    .addNode(cartesiaTTS)
    // COMMENTED OUT: ElevenLabs Turbo
    // .addNode(elevenLabsTTS)
    // COMMENTED OUT: ElevenLabs Flash
    // .addNode(elevenLabsFlashTTS)
    .addNode(elevenLabsMultilingualTTS)
    .addNode(humeTTS)
    .addNode(inworldTTS)
    .addNode(inworldMaxTTS)
    .addNode(ttsRanking)
    .setStartNode(textInputProxy)
    // Connect proxy to all TTS providers
    .addEdge(textInputProxy, cartesiaTTS)
    // COMMENTED OUT: ElevenLabs Turbo
    // .addEdge(textInputProxy, elevenLabsTTS)
    // COMMENTED OUT: ElevenLabs Flash
    // .addEdge(textInputProxy, elevenLabsFlashTTS)
    .addEdge(textInputProxy, elevenLabsMultilingualTTS)
    .addEdge(textInputProxy, humeTTS)
    .addEdge(textInputProxy, inworldTTS)
    .addEdge(textInputProxy, inworldMaxTTS)
    // Connect all TTS providers to ranking node
    .addEdge(cartesiaTTS, ttsRanking)
    // COMMENTED OUT: ElevenLabs Turbo
    // .addEdge(elevenLabsTTS, ttsRanking)
    // COMMENTED OUT: ElevenLabs Flash
    // .addEdge(elevenLabsFlashTTS, ttsRanking)
    .addEdge(elevenLabsMultilingualTTS, ttsRanking)
    .addEdge(humeTTS, ttsRanking)
    .addEdge(inworldTTS, ttsRanking)
    .addEdge(inworldMaxTTS, ttsRanking)
    .setEndNode(ttsRanking)
    .build();

  // Store session manager and audio manager references
  graph.sessionManager = sessionManager;
  graph.audioManager = sharedAudioManager;
  
  return graph;
}
