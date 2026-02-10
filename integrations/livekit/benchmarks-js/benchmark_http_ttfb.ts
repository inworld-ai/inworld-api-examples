/**
 * Benchmark script for measuring TTFB with HTTP-based TTS (synthesize API).
 *
 * Compares TTFB across TTS providers using LiveKit JS Agents' synthesize() API:
 * - Inworld (HTTP)
 * - ElevenLabs (HTTP)
 * - Cartesia (HTTP)
 *
 * For each sentence in the input text, calls synthesize() and measures
 * the time to first audio frame (TTFB).
 *
 * Usage:
 *   cd integrations/livekit/benchmarks-js
 *   npx tsx benchmark_http_ttfb.ts --services inworld -n 5
 *   npx tsx benchmark_http_ttfb.ts --services all -n 20
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { tts, initializeLogger } from '@livekit/agents';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from benchmarks-js dir, then fall back to parent
config({ path: join(__dirname, '.env'), override: true });
config({ override: true });

// ---------------------------------------------------------------------------
// WAV helper
// ---------------------------------------------------------------------------

function saveWav(
  audioData: Buffer,
  filename: string,
  sampleRate: number,
  outputDir = 'benchmark_audio',
): string {
  mkdirSync(outputDir, { recursive: true });

  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const dataSize = audioData.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  const filepath = `${outputDir}/${filename}`;
  writeFileSync(filepath, Buffer.concat([header, audioData]));
  return filepath;
}

// ---------------------------------------------------------------------------
// Sentence splitter
// ---------------------------------------------------------------------------

function splitSentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?])\s+/)
    .filter((s) => s.trim().length > 0);
}

// ---------------------------------------------------------------------------
// TTS service factory functions
// ---------------------------------------------------------------------------

type TTSMetrics = {
  type: 'tts_metrics';
  ttfbMs: number;
  [key: string]: unknown;
};

async function createInworldTTS(apiKey: string): Promise<tts.TTS> {
  const inworld = await import('@livekit/agents-plugin-inworld');
  return new inworld.TTS({
    apiKey,
    voice: 'Ashley',
    model: 'inworld-tts-1.5-max',
    encoding: 'LINEAR16',
    sampleRate: 24000,
  });
}

async function createElevenLabsTTS(apiKey: string): Promise<tts.TTS> {
  const elevenlabs = await import('@livekit/agents-plugin-elevenlabs');
  return new elevenlabs.TTS({
    apiKey,
    voiceId: '21m00Tcm4TlvDq8ikWAM', // Rachel voice
    model: 'eleven_turbo_v2_5',
  });
}

async function createCartesiaTTS(apiKey: string): Promise<tts.TTS> {
  const cartesia = await import('@livekit/agents-plugin-cartesia');
  return new cartesia.TTS({
    apiKey,
    voice: '79a125e8-cd45-4c13-8a67-188112f4dd22', // British Lady voice
    model: 'sonic-3',
  });
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

interface BenchmarkResult {
  service: string;
  ttfb_count: number;
  ttfb_avg: number | null;
  ttfb_min: number | null;
  ttfb_max: number | null;
  ttfb_values: number[];
  audio_bytes: number;
  error?: string;
}

async function benchmarkSynthesize(
  ttsInstance: tts.TTS,
  text: string,
  serviceName: string,
  doSaveAudio = false,
  outputDir = 'benchmark_audio',
): Promise<BenchmarkResult> {
  const sentences = splitSentences(text);
  const ttfbValues: number[] = [];
  const allAudio: Buffer[] = [];
  let firstChunkBytes: Buffer | null = null;
  const sampleRate = ttsInstance.sampleRate;

  // Collect TTFB from the built-in metrics system
  const onMetrics = (metrics: TTSMetrics) => {
    if (metrics.ttfbMs > 10) {
      // Filter spurious near-zero values (< 10ms)
      ttfbValues.push(metrics.ttfbMs / 1000); // Convert to seconds for display
    }
  };
  ttsInstance.on('metrics_collected', onMetrics);

  try {
    for (const sentence of sentences) {
      const stream = ttsInstance.synthesize(sentence);

      for await (const audio of stream) {
        const frameData = Buffer.from(
          audio.frame.data.buffer,
          audio.frame.data.byteOffset,
          audio.frame.data.byteLength,
        );
        allAudio.push(frameData);

        if (firstChunkBytes === null) {
          firstChunkBytes = frameData;
        }
      }

      // Allow a moment for metrics events to fire
      await delay(100);
    }

    // Save audio files on request
    if (doSaveAudio && allAudio.length > 0) {
      const safeName = serviceName.toLowerCase().replace(/ /g, '_');
      const fullAudio = Buffer.concat(allAudio);
      saveWav(fullAudio, `${safeName}_http_full.wav`, sampleRate, outputDir);
      if (firstChunkBytes) {
        saveWav(firstChunkBytes, `${safeName}_http_first_chunk.wav`, sampleRate, outputDir);
      }
    }
  } finally {
    ttsInstance.off('metrics_collected', onMetrics);
  }

  if (ttfbValues.length > 0) {
    return {
      service: serviceName,
      ttfb_count: ttfbValues.length,
      ttfb_avg: ttfbValues.reduce((a, b) => a + b, 0) / ttfbValues.length,
      ttfb_min: Math.min(...ttfbValues),
      ttfb_max: Math.max(...ttfbValues),
      ttfb_values: ttfbValues,
      audio_bytes: allAudio.reduce((sum, buf) => sum + buf.length, 0),
    };
  }

  return {
    service: serviceName,
    ttfb_count: 0,
    ttfb_avg: null,
    ttfb_min: null,
    ttfb_max: null,
    ttfb_values: [],
    audio_bytes: allAudio.reduce((sum, buf) => sum + buf.length, 0),
  };
}

async function runServiceBenchmark(
  serviceName: string,
  createTtsFn: (apiKey: string) => Promise<tts.TTS>,
  apiKey: string,
  text: string,
  doSaveAudio = true,
  outputDir = 'benchmark_audio',
): Promise<BenchmarkResult> {
  const ttsInstance = await createTtsFn(apiKey);
  try {
    return await benchmarkSynthesize(ttsInstance, text, serviceName, doSaveAudio, outputDir);
  } finally {
    await ttsInstance.close();
  }
}

// ---------------------------------------------------------------------------
// Results display
// ---------------------------------------------------------------------------

function printComparisonTable(results: BenchmarkResult[]): void {
  console.log('\n' + '='.repeat(70));
  console.log('HTTP TTS BENCHMARK RESULTS (synthesize API) — JS');
  console.log('='.repeat(70));

  console.log(
    `${'Service'.padEnd(20)} ${'Avg TTFB'.padEnd(12)} ${'Min TTFB'.padEnd(12)} ${'Max TTFB'.padEnd(12)} ${'Samples'.padEnd(10)}`,
  );
  console.log('-'.repeat(70));

  const sorted = [...results].sort(
    (a, b) => (a.ttfb_avg ?? Infinity) - (b.ttfb_avg ?? Infinity),
  );

  for (const r of sorted) {
    if (r.ttfb_avg !== null) {
      console.log(
        `${r.service.padEnd(20)} ${(r.ttfb_avg.toFixed(3) + 's').padEnd(12)} ` +
        `${(r.ttfb_min!.toFixed(3) + 's').padEnd(12)} ` +
        `${(r.ttfb_max!.toFixed(3) + 's').padEnd(12)} ${String(r.ttfb_count).padEnd(10)}`,
      );
    } else {
      console.log(
        `${r.service.padEnd(20)} ${'N/A'.padEnd(12)} ${'N/A'.padEnd(12)} ${'N/A'.padEnd(12)} ${'0'.padEnd(10)}`,
      );
    }
  }

  console.log('='.repeat(70));

  if (sorted.length > 0 && sorted[0]!.ttfb_avg !== null) {
    console.log(
      `\n🏆 Fastest average TTFB: ${sorted[0]!.service} (${sorted[0]!.ttfb_avg!.toFixed(3)}s)`,
    );
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

interface ServiceConfig {
  name: string;
  create_fn: (apiKey: string) => Promise<tts.TTS>;
  api_key_env: string;
}

async function main() {
  initializeLogger({ pretty: false, level: 'warn' });

  const { values } = parseArgs({
    options: {
      text: { type: 'string' },
      iterations: { type: 'string', short: 'n', default: '20' },
      services: { type: 'string', default: 'all' },
      'no-save-audio': { type: 'boolean', default: false },
    },
  });

  const iterations = parseInt(values['iterations']!, 10);
  const noSaveAudio = values['no-save-audio'] ?? false;

  // Default text with multiple sentences
  const text =
    values.text ??
    'Hello! Welcome to the TTS benchmark. ' +
      'This is a test of the text-to-speech system. ' +
      'Each sentence should trigger a separate TTS request. ' +
      "Let's see how fast the first audio byte arrives!";

  // Parse services to benchmark
  const servicesToRun =
    values.services!.toLowerCase() === 'all'
      ? ['inworld', 'elevenlabs', 'cartesia']
      : values.services!.split(',').map((s) => s.trim().toLowerCase());

  // Service configurations
  const serviceConfigs: Record<string, ServiceConfig> = {
    inworld: {
      name: 'Inworld HTTP',
      create_fn: createInworldTTS,
      api_key_env: 'INWORLD_API_KEY',
    },
    elevenlabs: {
      name: 'ElevenLabs HTTP',
      create_fn: createElevenLabsTTS,
      api_key_env: 'ELEVEN_API_KEY',
    },
    cartesia: {
      name: 'Cartesia HTTP',
      create_fn: createCartesiaTTS,
      api_key_env: 'CARTESIA_API_KEY',
    },
  };

  // Check API keys and filter available services
  const availableServices: { id: string; config: ServiceConfig; apiKey: string }[] = [];
  for (const serviceId of servicesToRun) {
    const cfg = serviceConfigs[serviceId];
    if (!cfg) {
      console.log(`⚠️  Unknown service: ${serviceId}`);
      continue;
    }

    const apiKey = process.env[cfg.api_key_env];
    if (!apiKey) {
      console.log(`⚠️  ${cfg.name}: ${cfg.api_key_env} not set, skipping`);
      continue;
    }

    availableServices.push({ id: serviceId, config: cfg, apiKey });
  }

  if (availableServices.length === 0) {
    console.log('No services available to benchmark. Please set the required API keys:');
    console.log('  - INWORLD_API_KEY for Inworld');
    console.log('  - ELEVEN_API_KEY for ElevenLabs');
    console.log('  - CARTESIA_API_KEY for Cartesia');
    return;
  }

  console.log(
    `\n🚀 Benchmarking ${availableServices.length} HTTP TTS service(s): ` +
      availableServices.map((s) => s.config.name).join(', '),
  );
  console.log(text.length > 50 ? `📝 Text: ${text.slice(0, 50)}...` : `📝 Text: ${text}`);
  console.log(`🔄 Iterations: ${iterations}`);
  console.log();

  const allResults: Record<string, BenchmarkResult[]> = {};
  for (const s of availableServices) {
    allResults[s.id] = [];
  }

  for (let iteration = 0; iteration < iterations; iteration++) {
    // Print progress
    process.stdout.write(`\rProgress: ${iteration + 1}/${iterations}`);

    for (const { id, config: cfg, apiKey } of availableServices) {
      try {
        const result = await runServiceBenchmark(
          cfg.name,
          cfg.create_fn,
          apiKey,
          text,
          !noSaveAudio && iteration === 0, // Only save audio on first run
        );
        allResults[id]!.push(result);
      } catch (err) {
        allResults[id]!.push({
          service: cfg.name,
          ttfb_count: 0,
          ttfb_avg: null,
          ttfb_min: null,
          ttfb_max: null,
          ttfb_values: [],
          audio_bytes: 0,
          error: String(err),
        });
      }

      // Small delay between services
      await delay(500);
    }
  }

  console.log(); // New line after progress

  // Aggregate results across iterations
  const aggregatedResults: BenchmarkResult[] = [];
  for (const { id, config: cfg } of availableServices) {
    const resultsList = allResults[id]!;
    const allTtfb: number[] = [];

    for (const r of resultsList) {
      allTtfb.push(...r.ttfb_values);
    }

    if (allTtfb.length > 0) {
      aggregatedResults.push({
        service: resultsList[0]!.service,
        ttfb_count: allTtfb.length,
        ttfb_avg: allTtfb.reduce((a, b) => a + b, 0) / allTtfb.length,
        ttfb_min: Math.min(...allTtfb),
        ttfb_max: Math.max(...allTtfb),
        ttfb_values: allTtfb,
        audio_bytes: 0,
      });
    } else {
      aggregatedResults.push({
        service: cfg.name,
        ttfb_count: 0,
        ttfb_avg: null,
        ttfb_min: null,
        ttfb_max: null,
        ttfb_values: [],
        audio_bytes: 0,
      });
    }
  }

  printComparisonTable(aggregatedResults);

  // Print aggregate stats if multiple iterations
  if (iterations > 1) {
    console.log('\n' + '='.repeat(70));
    console.log(`AGGREGATE STATISTICS (${iterations} iterations)`);
    console.log('='.repeat(70));

    const sorted = [...aggregatedResults].sort(
      (a, b) => (a.ttfb_avg ?? Infinity) - (b.ttfb_avg ?? Infinity),
    );

    for (const r of sorted) {
      if (r.ttfb_avg !== null) {
        const mean = r.ttfb_avg;
        const variance =
          r.ttfb_values.reduce((sum, x) => sum + (x - mean) ** 2, 0) / r.ttfb_values.length;
        const stdDev = Math.sqrt(variance);
        console.log(`\n${r.service}:`);
        console.log(`  Total samples: ${r.ttfb_count}`);
        console.log(`  Average TTFB:  ${r.ttfb_avg.toFixed(3)}s`);
        console.log(`  Min TTFB:      ${r.ttfb_min!.toFixed(3)}s`);
        console.log(`  Max TTFB:      ${r.ttfb_max!.toFixed(3)}s`);
        console.log(`  Std Dev:       ${stdDev.toFixed(3)}s`);
      }
    }
  }

  // Force exit since connections may keep the event loop alive
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
