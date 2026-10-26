#!/usr/bin/env node
/**
 * Speak an LLM's reply with the steering tags it wrote, over the TTS WebSocket.
 *
 * The LLM that already writes your agent's reply also directs how it is spoken:
 * ../steering_system_prompt.md, added to its system prompt, asks it to put a
 * steering tag such as [barely containing excitement] before the words it
 * applies to. The tags travel inside the reply text, so steering adds no
 * request and no latency. Built-in Reasoning (example_reasoning.js) instead
 * runs its own LLM call before synthesis, and is not available on the WebSocket.
 *
 * As the LLM streams, the client cuts its tokens into sentences and sends each
 * one as soon as it is complete, so the first sentence is spoken while the LLM
 * is still writing the rest. A sentence is never cut inside a [tag], so a tag
 * that arrives split across tokens reaches TTS whole.
 *
 * The LLM is the Inworld Router's OpenAI-compatible chat completions API, with
 * the same INWORLD_API_KEY. To use another OpenAI-compatible provider, set
 * LLM_BASE_URL, LLM_API_KEY and LLM_MODEL.
 *
 *     node example_llm_steering_stream.js
 *     node example_llm_steering_stream.js "I just got the job!"
 */

const fs = require('node:fs');
const path = require('node:path');
const WebSocket = require('ws');
try { require('dotenv').config(); } catch (_) {}

const PROMPT_FILE = path.join(__dirname, '..', 'steering_system_prompt.md');
const API_BASE_URL = (process.env.INWORLD_API_BASE_URL || 'https://api.inworld.ai').replace(/\/+$/, '');
const TTS_WS_URL = API_BASE_URL.replace(/^http/, 'ws') + '/tts/v1/voice:streamBidirectional';
const LLM_BASE_URL = (process.env.LLM_BASE_URL || `${API_BASE_URL}/v1`).replace(/\/+$/, '');
const LLM_MODEL = process.env.LLM_MODEL || 'openai/gpt-4.1-mini';
const VOICE_ID = 'Sarah';
const MODEL_ID = 'inworld-tts-2'; // steering instructions work on inworld-tts-2 only
const SAMPLE_RATE_HZ = 24000;
const OUTPUT_FILE = 'llm_steering_stream.wav';

// A sentence ends at ".", "!" or "?" followed by whitespace, or at Chinese and
// Japanese "。！？" once the next character arrives. Closing quotes and
// brackets go with the sentence they close.
const CLOSERS = '"\')」』）';
const SENTENCE_END = new RegExp(`[.!?]+[${CLOSERS}]*\\s+|[。！？]+[${CLOSERS}]*(?=[^${CLOSERS}])`, 'g');
const ABBREVIATIONS = new Set(['mr', 'mrs', 'ms', 'dr', 'st', 'jr', 'sr', 'vs', 'etc', 'e.g', 'i.e']);
const TAG = /\[[^\]]*\]/g;

/**
 * Collect streamed text and hand back complete sentences, never cutting
 * inside a [tag]. Everything pushed comes back out exactly once, in order.
 */
class SentenceBuffer {
    constructor() {
        this.pending = '';
    }

    /** Add text; return the sentences it completed. */
    push(text) {
        this.pending += text;
        const tags = [...this.pending.matchAll(TAG)].map((m) => [m.index, m.index + m[0].length]);
        // An unclosed "[" holds back everything from where it starts.
        const unclosed = this.pending.indexOf('[', tags.length ? tags[tags.length - 1][1] : 0);
        const limit = unclosed < 0 ? this.pending.length : unclosed;
        const sentences = [];
        let start = 0;
        for (const m of this.pending.slice(0, limit).matchAll(SENTENCE_END)) {
            if (tags.some(([a, b]) => a <= m.index && m.index < b)) continue;
            const words = this.pending.slice(start, m.index).split(/\s+/).filter(Boolean);
            const word = (words[words.length - 1] || '').replace(/^["'(]+/, '').toLowerCase();
            if (m[0].startsWith('..') || (m[0].startsWith('.')
                && (ABBREVIATIONS.has(word) || (word.length === 1 && /\p{L}/u.test(word))))) {
                continue; // an ellipsis, abbreviation or initial
            }
            sentences.push(this.pending.slice(start, m.index + m[0].length));
            start = m.index + m[0].length;
        }
        this.pending = this.pending.slice(start);
        return sentences;
    }

    /** Return whatever is left once the stream has ended. */
    flush() {
        const rest = this.pending;
        this.pending = '';
        return rest;
    }
}

/** Your agent's own system prompt, followed by the steering addendum. */
function loadSystemPrompt(persona = 'You are a helpful voice assistant. Keep replies to two or three sentences.') {
    return `${persona}\n\n${fs.readFileSync(PROMPT_FILE, 'utf8').trim()}`;
}

function llmRequest(userMessage, systemPrompt, model = LLM_MODEL) {
    return {
        model,
        stream: true,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
        ],
    };
}

/**
 * The Inworld Router takes the Inworld key as Basic auth; other
 * OpenAI-compatible providers take their own key as a Bearer token.
 */
function llmHeaders(inworldApiKey, env = process.env) {
    if (env.LLM_API_KEY) return { Authorization: `Bearer ${env.LLM_API_KEY}` };
    return { Authorization: `Basic ${inworldApiKey}` };
}

/** Return the text a chat completions stream line carries, or "". */
function parseSseLine(line) {
    if (!line.startsWith('data:') || line.slice(5).trim() === '[DONE]') return '';
    const data = JSON.parse(line.slice(5));
    return (data.choices || []).map((c) => (c.delta && c.delta.content) || '').join('');
}

/** Yield the LLM's reply as it streams. */
async function* streamLlm(userMessage, apiKey, fetchImpl = fetch) {
    const response = await fetchImpl(`${LLM_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...llmHeaders(apiKey) },
        body: JSON.stringify(llmRequest(userMessage, loadSystemPrompt())),
    });
    if (!response.ok) throw new Error(`LLM HTTP ${response.status}: ${await response.text()}`);
    const decoder = new TextDecoder();
    let buffered = '';
    for await (const bytes of response.body) {
        buffered += decoder.decode(bytes, { stream: true });
        const lines = buffered.split('\n');
        buffered = lines.pop();
        for (const line of lines) {
            const token = parseSseLine(line.trim());
            if (token) yield token;
        }
    }
    const token = parseSseLine(buffered.trim());
    if (token) yield token;
}

/**
 * Send each complete sentence of the streamed reply, tags included, then
 * close the context, which synthesizes anything left.
 */
async function forwardReply(tokens, send, contextId, { onSentence = () => {}, write = (t) => process.stdout.write(t) } = {}) {
    const buffer = new SentenceBuffer();
    const sendSentence = (text) => {
        onSentence(text);
        send({ contextId, sendText: { text, flushContext: {} } });
    };
    for await (const token of tokens) {
        write(token);
        buffer.push(token).forEach(sendSentence);
    }
    const rest = buffer.flush();
    if (rest) sendSentence(rest);
    send({ contextId, closeContext: {} });
}

/** Return the PCM samples of a chunk, dropping its RIFF/WAV header. */
function stripWavHeader(audio) {
    if (audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') return audio;
    let pos = 12;
    while (pos + 8 <= audio.length) {
        const size = audio.readUInt32LE(pos + 4);
        if (audio.toString('ascii', pos, pos + 4) === 'data') return audio.subarray(pos + 8);
        pos += 8 + size;
    }
    return Buffer.alloc(0);
}

function wavFile(pcm) {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVEfmt ', 8);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20); // PCM
    header.writeUInt16LE(1, 22); // mono
    header.writeUInt32LE(SAMPLE_RATE_HZ, 24);
    header.writeUInt32LE(SAMPLE_RATE_HZ * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    return Buffer.concat([header, pcm]);
}

async function speak(userMessage, apiKey) {
    const contextId = 'steering-turn-1';
    const ws = new WebSocket(TTS_WS_URL, { headers: { Authorization: `Basic ${apiKey}` } });
    await new Promise((resolve, reject) => {
        ws.once('open', resolve);
        ws.once('error', reject);
    });
    const start = performance.now();
    const times = {};
    const first = (name) => { if (!(name in times)) times[name] = performance.now() - start; };
    const pcm = [];

    const done = new Promise((resolve, reject) => {
        ws.on('message', (message) => {
            const response = JSON.parse(message.toString());
            const result = response.result || {};
            const error = response.error || result.status || {};
            if (response.error || error.code) {
                reject(new Error(error.message || 'TTS error'));
                return;
            }
            const content = result.audioChunk && result.audioChunk.audioContent;
            if (content) {
                first('audio');
                pcm.push(stripWavHeader(Buffer.from(content, 'base64')));
            }
            if (result.contextClosed !== undefined) resolve();
        });
        ws.on('error', reject);
        ws.on('close', () => reject(new Error('connection closed')));
    });

    // Create the context before the LLM's first token arrives, without waiting
    // for the acknowledgment. Auto mode synthesizes each sentence at once and
    // batches sentences that arrive while it is busy.
    ws.send(JSON.stringify({
        contextId,
        create: {
            voiceId: VOICE_ID,
            modelId: MODEL_ID,
            autoMode: true,
            audioConfig: { audioEncoding: 'PCM', sampleRateHertz: SAMPLE_RATE_HZ },
        },
    }));

    async function* tokens() {
        for await (const token of streamLlm(userMessage, apiKey)) {
            first('token');
            yield token;
        }
    }

    process.stdout.write('Reply: ');
    try {
        await Promise.all([
            forwardReply(tokens(), (m) => ws.send(JSON.stringify(m)), contextId, { onSentence: () => first('sentence') }),
            done,
        ]);
    } finally {
        ws.removeAllListeners('close');
        ws.close();
    }
    console.log('\n');

    for (const [name, label] of [['token', 'First LLM token'], ['sentence', 'First sentence sent'], ['audio', 'First audio']]) {
        if (name in times) console.log(`${(label + ':').padEnd(21)}${times[name].toFixed(0).padStart(7)} ms`);
    }
    const audio = Buffer.concat(pcm);
    fs.writeFileSync(OUTPUT_FILE, wavFile(audio));
    console.log(`Wrote ${(audio.length / 2 / SAMPLE_RATE_HZ).toFixed(1)}s of audio to ${OUTPUT_FILE}`);
}

async function main() {
    const apiKey = process.env.INWORLD_API_KEY;
    if (!apiKey) {
        console.log('Error: INWORLD_API_KEY environment variable is not set.');
        console.log('Please set it with: export INWORLD_API_KEY=your_api_key_here');
        return 1;
    }
    const userMessage = process.argv.slice(2).join(' ') || 'I finally passed my driving test on the third try!';
    console.log(`User: ${userMessage}`);
    console.log(`LLM: ${LLM_MODEL} at ${LLM_BASE_URL}`);
    console.log(`TTS: ${MODEL_ID}, voice ${VOICE_ID}\n`);
    try {
        await speak(userMessage, apiKey);
        return 0;
    } catch (error) {
        console.log(`\nError: ${error.message}`);
        return 1;
    }
}

if (require.main === module) {
    main().then((code) => process.exit(code));
}

module.exports = {
    SentenceBuffer, loadSystemPrompt, llmRequest, llmHeaders, parseSseLine, streamLlm, forwardReply,
    stripWavHeader, PROMPT_FILE,
};
