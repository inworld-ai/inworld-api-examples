#!/usr/bin/env node
/**
 * Let built-in Reasoning write the steering instruction.
 *
 * With `synthesisContext.reasoning` set to REASONING_ON, a language model reads
 * the text before synthesis and writes a short delivery instruction for it, or
 * none when the text needs no direction. `reasoningContext` tells it what the
 * text alone can't: the scene, or the character. The response returns the
 * instruction it applied in `reasoningInstruction`.
 *
 * This is the easiest way to steer, but it adds a step before the first audio.
 * It runs on HTTP requests, unary and streaming; the WebSocket doesn't run it.
 * For a realtime agent, have your own LLM write the tags instead:
 * example_llm_steering_stream.js.
 *
 *     node example_reasoning.js
 */

const fs = require('node:fs');
try { require('dotenv').config(); } catch (_) {}

const API_BASE_URL = (process.env.INWORLD_API_BASE_URL || 'https://api.inworld.ai').replace(/\/+$/, '');
const TEXT = "Don't open that door.";
const REASONING_CONTEXT = 'Protagonist in a psychological thriller, alone in the house at night.';
const PREVIOUS_TEXTS = ['Did you hear that?'];

function buildRequest(text, { reasoningContext = '', previousTexts = [], voiceId = 'Dennis', modelId = 'inworld-tts-2' } = {}) {
    const synthesisContext = { reasoning: 'REASONING_ON' };
    if (reasoningContext) synthesisContext.reasoningContext = reasoningContext; // at most 600 characters
    if (previousTexts.length) synthesisContext.previousRequests = previousTexts.map((t) => ({ text: t }));
    return {
        text,
        voiceId,
        modelId, // Reasoning runs on inworld-tts-2 only
        audioConfig: { audioEncoding: 'MP3' },
        synthesisContext,
    };
}

function post(fetchImpl, apiKey, endpoint, body) {
    return fetchImpl(`${API_BASE_URL}${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Basic ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
}

async function throwForError(response) {
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${await response.text()}`);
}

/** Unary request: return the applied instruction ("" if none) and the audio. */
async function synthesize(apiKey, body, fetchImpl = fetch) {
    const response = await post(fetchImpl, apiKey, '/tts/v1/voice', body);
    await throwForError(response);
    const data = await response.json();
    return { instruction: data.reasoningInstruction || '', audio: Buffer.from(data.audioContent, 'base64') };
}

/**
 * Streaming request: return the instruction, the audio, and the milliseconds
 * to the first audio. The instruction is on the first message only.
 */
async function synthesizeStream(apiKey, body, fetchImpl = fetch) {
    const start = performance.now();
    const response = await post(fetchImpl, apiKey, '/tts/v1/voice:stream', body);
    await throwForError(response);
    let instruction = '';
    let firstAudioMs = null;
    const audio = [];
    const decoder = new TextDecoder();
    let buffered = '';
    const handle = (line) => {
        if (!line.trim()) return;
        const message = JSON.parse(line);
        if (message.error) throw new Error(JSON.stringify(message.error));
        const result = message.result || {};
        instruction = instruction || result.reasoningInstruction || '';
        if (result.audioContent) {
            if (firstAudioMs === null) firstAudioMs = performance.now() - start;
            audio.push(Buffer.from(result.audioContent, 'base64')); // MP3 chunks concatenate
        }
    };
    for await (const bytes of response.body) {
        buffered += decoder.decode(bytes, { stream: true });
        const lines = buffered.split('\n');
        buffered = lines.pop();
        lines.forEach(handle);
    }
    handle(buffered);
    return { instruction, audio: Buffer.concat(audio), firstAudioMs: firstAudioMs ?? 0 };
}

function describe(instruction, text) {
    if (!instruction) return 'Reasoning wrote no instruction; the text was read as written.';
    return `Reasoning instruction: [${instruction}]\n`
        + `To keep this delivery, send it inline and leave reasoning unset: [${instruction}] ${text}`;
}

async function main() {
    const apiKey = process.env.INWORLD_API_KEY;
    if (!apiKey) {
        console.log('Error: INWORLD_API_KEY environment variable is not set.');
        console.log('Please set it with: export INWORLD_API_KEY=your_api_key_here');
        return 1;
    }
    const body = buildRequest(TEXT, { reasoningContext: REASONING_CONTEXT, previousTexts: PREVIOUS_TEXTS });
    console.log(`Text:    ${TEXT}`);
    console.log(`Context: ${REASONING_CONTEXT}\n`);
    try {
        console.log('1. Unary: POST /tts/v1/voice');
        const unary = await synthesize(apiKey, body);
        fs.writeFileSync('reasoning.mp3', unary.audio);
        console.log(describe(unary.instruction, TEXT));
        console.log('Saved reasoning.mp3\n');

        console.log('2. Streaming: POST /tts/v1/voice:stream');
        const streamed = await synthesizeStream(apiKey, body);
        fs.writeFileSync('reasoning_stream.mp3', streamed.audio);
        console.log(describe(streamed.instruction, TEXT));
        console.log(`First audio after ${streamed.firstAudioMs.toFixed(0)} ms, Reasoning included`);
        console.log('Saved reasoning_stream.mp3');
        return 0;
    } catch (error) {
        console.log(`Error: ${error.message}`);
        return 1;
    }
}

if (require.main === module) {
    main().then((code) => process.exit(code));
}

module.exports = { buildRequest, synthesize, synthesizeStream, describe, REASONING_CONTEXT };
