import { createTTSComparisonGraph } from '../graphs/ttsComparison.js';

class GraphManager {
  constructor() {
    this.ttsGraph = null;
    this.sessionManager = null;
  }

  async initialize(sessionManager) {
    try {
      console.log('[GraphManager] Initializing TTS comparison graph...');
      this.sessionManager = sessionManager;
      this.ttsGraph = createTTSComparisonGraph(sessionManager);
      console.log('[GraphManager] TTS comparison graph initialized successfully');
      return true;
    } catch (error) {
      console.error('[GraphManager] Failed to initialize graph:', error);
      throw error;
    }
  }

  async runTTSComparison(text, sessionId, voice = null) {
    if (!this.ttsGraph) {
      throw new Error('TTS graph not initialized. Call initialize() first.');
    }

    try {
      console.log(`[GraphManager] Starting TTS comparison for session ${sessionId}`);
      
      const input = {
        text,
        sessionId,
        voice
      };

      console.log(`[GraphManager] Starting graph with input:`, input);
      const { outputStream } = this.ttsGraph.start(input);
      console.log(`[GraphManager] Graph started, processing output stream...`);
      
      // Store session manager reference on the graph for nodes to access
      this.ttsGraph.sessionManager = this.sessionManager;
      
      // Process the results
      const results = [];
      for await (const result of outputStream) {
        result.processResponse({
          default: (data) => {
            results.push(data);
          }
        });
      }

      console.log(`[GraphManager] TTS comparison completed for session ${sessionId}`);
      return results;
      
    } catch (error) {
      console.error(`[GraphManager] Error running TTS comparison:`, error);
      
      // Send error to frontend
      if (this.sessionManager) {
        this.sessionManager.sendUpdate(sessionId, {
          type: 'tts_comparison_error',
          data: {
            error: error.message,
            timestamp: new Date().toISOString()
          }
        });
      }
      
      throw error;
    }
  }

  async shutdown() {
    try {
      console.log('[GraphManager] Shutting down graphs...');
      
      if (this.ttsGraph) {
        // If the graph has a shutdown method, call it
        if (typeof this.ttsGraph.shutdown === 'function') {
          await this.ttsGraph.shutdown();
        }
        this.ttsGraph = null;
      }
      
      this.sessionManager = null;
      console.log('[GraphManager] Graph manager shutdown complete');
    } catch (error) {
      console.error('[GraphManager] Error during shutdown:', error);
      throw error;
    }
  }

  isInitialized() {
    return this.ttsGraph !== null;
  }

  // Health check method
  getStatus() {
    return {
      initialized: this.isInitialized(),
      graphId: this.ttsGraph?.id || null,
      sessionManagerConnected: this.sessionManager !== null
    };
  }
}

// Export singleton instance
export const graphManager = new GraphManager();
