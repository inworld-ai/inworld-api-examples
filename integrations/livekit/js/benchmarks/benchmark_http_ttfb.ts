/**
 * Benchmark HTTP TTS TTFB across providers using LiveKit JS synthesize() API.
 *
 * For each sentence in the input text, calls synthesize() and measures
 * the time to first audio frame (TTFB) via the built-in metrics system.
 */

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { tts, initializeLogger } from '@livekit/agents';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: join(__dirname, '.env'), override: true });
config({ override: true });

const DEFAULT_SENTENCES = [
  'Hello! Welcome to the TTS benchmark.',
  'This is a test of the text-to-speech system.',
  'Each sentence should trigger a separate TTS request.',
  "Let's see how fast the first audio byte arrives!",
  'The quick brown fox jumps over the lazy dog.',
];

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function saveWav(audioData: Buffer, filename: string, sampleRate: number, outputDir = 'benchmark_audio'): string {
  mkdirSync(outputDir, { recursive: true });
  const numChannels = 1, bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + audioData.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(audioData.length, 40);
  const filepath = `${outputDir}/${filename}`;
  writeFileSync(filepath, Buffer.concat([header, audioData]));
  return filepath;
}

function percentile(sortedVals: number[], p: number): number {
  const idx = (p / 100) * (sortedVals.length - 1);
  const low = Math.floor(idx);
  const high = Math.min(low + 1, sortedVals.length - 1);
  return sortedVals[low]! * (1 - (idx - low)) + sortedVals[high]! * (idx - low);
}

interface Stats {
  count: number;
  avg: number | null;
  std: number | null;
  min: number | null;
  max: number | null;
  p50: number | null;
  p95: number | null;
  values: number[];
}

function computeStats(values: number[]): Stats {
  if (values.length === 0) {
    return { count: 0, avg: null, std: null, min: null, max: null, p50: null, p95: null, values: [] };
  }
  const n = values.length;
  const avg = values.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(values.reduce((sum, x) => sum + (x - avg) ** 2, 0) / n);
  const sorted = [...values].sort((a, b) => a - b);
  return {
    count: n, avg, std, min: sorted[0]!, max: sorted[n - 1]!,
    p50: percentile(sorted, 50), p95: percentile(sorted, 95), values,
  };
}

interface BenchmarkResult {
  service: string;
  ttfb: Stats;
  audio_bytes: number;
}

type TTSMetrics = { ttfbMs: number; [key: string]: unknown };

async function createInworldTTS(apiKey: string): Promise<tts.TTS> {
  const inworld = await import('@livekit/agents-plugin-inworld');
  return new inworld.TTS({
    apiKey, voice: 'Ashley', model: 'inworld-tts-1.5-mini',
    baseURL: 'https://api.inworld.ai/',
  });
}

async function createElevenLabsTTS(apiKey: string): Promise<tts.TTS> {
  const elevenlabs = await import('@livekit/agents-plugin-elevenlabs');
  return new elevenlabs.TTS({
    apiKey, voiceId: '21m00Tcm4TlvDq8ikWAM', model: 'eleven_turbo_v2_5',
  });
}

async function createCartesiaTTS(apiKey: string): Promise<tts.TTS> {
  const cartesia = await import('@livekit/agents-plugin-cartesia');
  return new cartesia.TTS({
    apiKey, voice: '79a125e8-cd45-4c13-8a67-188112f4dd22', model: 'sonic-3',
  });
}

async function benchmarkOneSentence(
  ttsInstance: tts.TTS, sentence: string, serviceName: string,
  doSaveAudio = false, outputDir = 'benchmark_audio',
): Promise<{ ttfb: number | null; audio_bytes: number }> {
  let ttfbValue: number | null = null;
  const allAudio: Buffer[] = [];
  const sampleRate = ttsInstance.sampleRate;

  const onMetrics = (metrics: TTSMetrics) => {
    if (metrics.ttfbMs > 10) {
      ttfbValue = metrics.ttfbMs / 1000;
    }
  };
  ttsInstance.on('metrics_collected', onMetrics);

  try {
    const stream = ttsInstance.synthesize(sentence);
    for await (const audio of stream) {
      const frameData = Buffer.from(audio.frame.data.buffer, audio.frame.data.byteOffset, audio.frame.data.byteLength);
      allAudio.push(frameData);
    }
    await delay(100);

    if (doSaveAudio && allAudio.length > 0) {
      const safeName = serviceName.toLowerCase().replace(/ /g, '_');
      saveWav(Buffer.concat(allAudio), `${safeName}_http.wav`, sampleRate, outputDir);
    }
  } finally {
    ttsInstance.off('metrics_collected', onMetrics);
  }

  return { ttfb: ttfbValue, audio_bytes: allAudio.reduce((sum, buf) => sum + buf.length, 0) };
}

function fmt(val: number | null, suffix = 's'): string {
  return val !== null ? `${val.toFixed(3)}${suffix}` : 'N/A';
}

function printResults(results: BenchmarkResult[], title: string): void {
  const w = 90;
  console.log('\n' + '='.repeat(w));
  console.log(title);
  console.log('='.repeat(w));

  console.log('\n📊 TTFB');
  console.log(
    `${'Service'.padEnd(20)} ${'Avg'.padStart(8)} ${'StdDev'.padStart(8)} ` +
    `${'Min'.padStart(8)} ${'Max'.padStart(8)} ${'P50'.padStart(8)} ${'P95'.padStart(8)} ${'N'.padStart(5)}`
  );
  console.log('-'.repeat(w));

  const sorted = [...results].sort((a, b) => (a.ttfb.avg ?? Infinity) - (b.ttfb.avg ?? Infinity));
  for (const r of sorted) {
    const s = r.ttfb;
    if (s.count > 0) {
      console.log(
        `${r.service.padEnd(20)} ${fmt(s.avg).padStart(8)} ${fmt(s.std).padStart(8)} ` +
        `${fmt(s.min).padStart(8)} ${fmt(s.max).padStart(8)} ` +
        `${fmt(s.p50).padStart(8)} ${fmt(s.p95).padStart(8)} ${String(s.count).padStart(5)}`
      );
    } else {
      console.log(
        `${r.service.padEnd(20)} ${'N/A'.padStart(8)} ${'N/A'.padStart(8)} ${'N/A'.padStart(8)} ` +
        `${'N/A'.padStart(8)} ${'N/A'.padStart(8)} ${'N/A'.padStart(8)} ${'0'.padStart(5)}`
      );
    }
  }


  console.log('\n' + '='.repeat(w));
}

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
      iterations: { type: 'string', short: 'n', default: '5' },
      services: { type: 'string', default: 'all' },
      'no-save-audio': { type: 'boolean', default: false },
      debug: { type: 'boolean', default: false },
      warmup: { type: 'string', default: '1' },
    },
  });

  if (values.debug) {
    initializeLogger({ pretty: true, level: 'debug' });
  }

  const iterations = parseInt(values['iterations']!, 10);
  const warmup = parseInt(values['warmup']!, 10);
  const noSaveAudio = values['no-save-audio'] ?? false;
  const sentences = values.text ? [values.text] : DEFAULT_SENTENCES;

  const servicesToRun =
    values.services!.toLowerCase() === 'all'
      ? ['inworld', 'elevenlabs', 'cartesia']
      : values.services!.split(',').map((s) => s.trim().toLowerCase());

  const serviceConfigs: Record<string, ServiceConfig> = {
    inworld: { name: 'Inworld HTTP', create_fn: createInworldTTS, api_key_env: 'INWORLD_API_KEY' },
    elevenlabs: { name: 'ElevenLabs HTTP', create_fn: createElevenLabsTTS, api_key_env: 'ELEVEN_API_KEY' },
    cartesia: { name: 'Cartesia HTTP', create_fn: createCartesiaTTS, api_key_env: 'CARTESIA_API_KEY' },
  };

  const availableServices: { id: string; config: ServiceConfig; apiKey: string }[] = [];
  for (const serviceId of servicesToRun) {
    const cfg = serviceConfigs[serviceId];
    if (!cfg) { console.log(`⚠️  Unknown service: ${serviceId}`); continue; }
    const apiKey = process.env[cfg.api_key_env];
    if (!apiKey) { console.log(`⚠️  ${cfg.name}: ${cfg.api_key_env} not set, skipping`); continue; }
    availableServices.push({ id: serviceId, config: cfg, apiKey });
  }

  if (availableServices.length === 0) {
    console.log('No services available. Set INWORLD_API_KEY, ELEVEN_API_KEY, or CARTESIA_API_KEY.');
    return;
  }

  console.log(`\n🚀 Benchmarking ${availableServices.length} service(s): ${availableServices.map((s) => s.config.name).join(', ')}`);
  console.log(`📝 Sentences: ${sentences.length} (cycling per iteration)`);
  console.log(`🔄 Iterations: ${iterations} (+ ${warmup} warmup)\n`);

  const ttsInstances: Record<string, tts.TTS> = {};
  for (const { id, config: cfg, apiKey } of availableServices) {
    ttsInstances[id] = await cfg.create_fn(apiKey);
  }

  const totalIters = warmup + iterations;

  async function benchService(svc: { id: string; config: ServiceConfig }): Promise<BenchmarkResult> {
    const ttfbVals: number[] = [];
    for (let iteration = 0; iteration < totalIters; iteration++) {
      const isWarmup = iteration < warmup;
      const label = isWarmup
        ? `warmup ${iteration + 1}/${warmup}`
        : `${iteration - warmup + 1}/${iterations}`;
      console.log(`[${svc.config.name}] ${isWarmup ? '⏳' : '📊'} ${label}`);

      const sentence = sentences[iteration % sentences.length]!;

      try {
        const result = await benchmarkOneSentence(
          ttsInstances[svc.id]!, sentence, svc.config.name,
          !noSaveAudio && iteration === warmup,
        );
        if (!isWarmup && result.ttfb !== null) {
          ttfbVals.push(result.ttfb);
        }
        if (result.audio_bytes === 0) {
          console.log(`[${svc.config.name}] ⚠️ No audio received!`);
        }
      } catch (err) {
        console.log(`[${svc.config.name}] ❌ ${err}`);
      }

      await delay(1000);
    }
    return { service: svc.config.name, ttfb: computeStats(ttfbVals), audio_bytes: 0 };
  }

  let aggregatedResults: BenchmarkResult[];
  try {
    aggregatedResults = await Promise.all(availableServices.map((svc) => benchService(svc)));
  } finally {
    for (const inst of Object.values(ttsInstances)) {
      await inst.close();
    }
  }

  console.log();

  printResults(aggregatedResults, 'HTTP TTS BENCHMARK RESULTS (LiveKit JS)');
  process.exit(0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
