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
import { TTS, type Voice } from '../agents-js/plugins/inworld/src/tts.js';
import * as livekit from '@livekit/agents-plugin-livekit';
import * as silero from '@livekit/agents-plugin-silero';

// Log configuration at startup
const baseURL = process.env.INWORLD_BASE_URL || 'https://api.inworld.ai/';
const wsURL = process.env.INWORLD_WS_URL || 'wss://api.inworld.ai/';
const apiKey = process.env.INWORLD_API_KEY;
console.log('[Inworld TTS] Configuration:');
console.log(`  - Base URL: ${baseURL}`);
console.log(`  - WebSocket URL: ${wsURL}`);
console.log(`  - API Key: ${apiKey ? apiKey.substring(0, 8) + '...' : 'NOT SET'}`);
console.log(`  - Voice: ${process.env.INWORLD_VOICE || 'Alex'}`);

export default defineAgent({
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },
  entry: async (ctx: JobContext) => {
    try {
      console.log('[test_agent] entry: creating voice agent...');
      const agent = new voice.Agent({
        instructions: `You are a helpful voice AI assistant for testing Inworld TTS.
Keep your responses concise and to the point.
Do not use emojis, asterisks, or markdown.
You are friendly and have a sense of humor.`,
      });

      // Create TTS instance
      console.log('[test_agent] entry: creating TTS instance...');
      const tts = new TTS({
        voice: process.env.INWORLD_VOICE || 'Alex',
        model: 'inworld-tts-1.5-max',
        encoding: 'LINEAR16',
        timestampType: 'WORD',
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

      // List available voices
      tts
        .listVoices()
        .then((voices: Voice[]) => {
          console.log(`[Inworld TTS] ${voices.length} voices available in this workspace`);
          if (voices.length > 0) {
            console.log('[Inworld TTS] Available voices:');
            voices.forEach((v) => console.log(`  - ${v.voiceId}: ${v.displayName}`));
          }
        })
        .catch((err: Error) => {
          console.error('[Inworld TTS] Failed to list voices:', err);
        });

      console.log('[test_agent] entry: creating AgentSession...');
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

      // Timestamp handling - log word alignments
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session.tts!.on('alignment' as any, (data: any) => {
        if (data.wordAlignment) {
          const { words, starts, ends } = data.wordAlignment;
          for (let i = 0; i < words.length; i++) {
            console.log(
              `[Inworld TTS] Word: "${words[i]}", Start: ${starts[i].toFixed(3)}s, End: ${ends[i].toFixed(3)}s`,
            );
          }
        }
      });

      console.log('[test_agent] entry: starting session...');
      await session.start({
        agent,
        room: ctx.room,
      });

      console.log('[test_agent] entry: session started, saying greeting...');
      session.say('Hello, how can I help you today?');
    } catch (err) {
      console.error('[test_agent] entry ERROR:', err);
      console.error('[test_agent] entry ERROR stack:', err instanceof Error ? err.stack : String(err));
      throw err;
    }
  },
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
