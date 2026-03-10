// SPDX-FileCopyrightText: 2025 LiveKit, Inc.
//
// SPDX-License-Identifier: Apache-2.0

/**
 * Quick test agent for Inworld TTS plugin development
 */

// Load .env file with override to take precedence over shell env vars
import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
config({ path: join(__dirname, '.env'), override: true });

import {
  type JobContext,
  type JobProcess,
  WorkerOptions,
  cli,
  defineAgent,
  voice,
} from '@livekit/agents';
// Import directly from source for live development (no rebuild needed)
import { TTS } from '../agents-js/plugins/inworld/src/tts.js';
import * as livekit from '@livekit/agents-plugin-livekit';
import * as silero from '@livekit/agents-plugin-silero';

const baseURL = process.env.INWORLD_BASE_URL || 'https://api.inworld.ai/';
const wsURL = process.env.INWORLD_WS_URL || 'wss://api.inworld.ai/';

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
    try {
      const agent = new voice.Agent({
        instructions: `You are a helpful voice AI assistant for testing Inworld TTS.
Keep your responses concise and to the point.
Do not use emojis, asterisks, or markdown.
You are friendly and have a sense of humor.`,
        // Use TTS word-level timestamps for transcript sync & interruption trimming
        useTtsAlignedTranscript: true,
      });

      const tts = new TTS({
        voice: process.env.INWORLD_VOICE || 'Alex',
        model: 'inworld-tts-1.5-max',
        encoding: 'LINEAR16',
        timestampType: 'CHARACTER',
        textNormalization: 'ON',
        bitRate: 64000,
        sampleRate: 24000,
        speakingRate: 1.0,
        temperature: 1.1,
        bufferCharThreshold: 100,
        maxBufferDelayMs: 3000,
        baseURL,
        wsURL,
      });

      const session = new voice.AgentSession({
        // AssemblyAI for speech-to-text
        stt: 'assemblyai/universal-streaming:en',
        // OpenAI for LLM
        llm: 'openai/gpt-4.1-mini',
        // Inworld for text-to-speech
        tts,
        // Silero VAD
        vad: ctx.proc.userData.vad! as silero.VAD,
        turnDetection: new livekit.turnDetector.MultilingualModel(),
      });

      await session.start({
        agent,
        room: ctx.room,
      });

      session.say('Hello, how can I help you today?');
    } catch (err) {
      console.error('Agent entry error:', err);
      throw err;
    }
  },
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
