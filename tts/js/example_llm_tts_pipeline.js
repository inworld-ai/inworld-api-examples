#!/usr/bin/env node
/**
 * Speak an LLM's reply with the lowest latency: Inworld Router chat completions streamed into one
 * TTS WebSocket context.
 *
 * What makes it fast (each is easy to get wrong):
 *   1. The WebSocket is opened before the turn (once per session), so no reply waits for a handshake.
 *   2. The reply's context is created the moment the user's turn ends, in parallel with the LLM
 *      request; it is ready before the LLM's first sentence is.
 *   3. The LLM is asked not to reason (`reasoning_effort: "none"`): reasoning models otherwise think
 *      for seconds before their first token.
 *   4. The whole reply goes into that one context: a flush per sentence (the first may end at a
 *      clause), or every token with SENTENCE_BOUNDARY. Not a request per sentence: a context's
 *      syntheses share its conversation history, so the delivery carries from sentence to sentence.
 *   5. Word timestamps use ASYNC transport, so audio is never held back for alignment.
 *
 * It prints a timeline measured from the end of the user's turn, with the same points in both modes:
 *   LLM first token, first sentence complete in the LLM stream, first text sent to TTS, first audio.
 * Compare modes on "first audio - first sentence complete": the time from the first text sent is not
 * comparable, because with SENTENCE_BOUNDARY the first text is the first token.
 *
 * Usage:
 *   node example_llm_tts_pipeline.js ["what the user said"]
 *   node example_llm_tts_pipeline.js --sentence-boundary "..."   (server finds the sentences)
 *   node example_llm_tts_pipeline.js --lipsync "..."             (audio-derived visemes, if enabled)
 * Options: --llm-model <provider/model> (default openai/gpt-4.1-mini), --voice <id> (default Sarah)
 * Output: llm_tts_pipeline_output.wav
 */

const fs = require('fs');
const WebSocket = require('ws');
try { require('dotenv').config(); } catch (_) {}

const API_BASE_URL = (process.env.INWORLD_API_BASE_URL || 'https://api.inworld.ai').replace(/\/+$/, '');
const SAMPLE_RATE = 24000;

/**
 * Check if INWORLD_API_KEY environment variable is set.
 * @returns {string|null} API key or null if not set
 */
function checkApiKey() {
    const apiKey = process.env.INWORLD_API_KEY;
    if (!apiKey) {
        console.log('Error: INWORLD_API_KEY environment variable is not set.');
        console.log('Please set it with: export INWORLD_API_KEY=your_api_key_here');
        return null;
    }
    return apiKey;
}

/**
 * Cuts streamed LLM text into speakable pieces: at sentence ends, and the first piece already at a
 * clause (a comma after ~28 characters), so the first audio starts sooner. Never cuts inside a
 * [steering] tag.
 */
class SentenceSplitter {
    constructor() {
        this.buffer = '';
        this.emitted = 0;
    }

    /** Adds a text delta and returns the pieces that are now complete. */
    push(delta) {
        this.buffer += delta;
        const pieces = [];
        for (;;) {
            const cut = this.findCut();
            if (cut < 0) break;
            const piece = this.buffer.slice(0, cut).trim();
            this.buffer = this.buffer.slice(cut);
            if (piece) {
                pieces.push(piece);
                this.emitted++;
            }
        }
        return pieces;
    }

    /** Whatever is left once the LLM stream has ended. */
    flush() {
        const rest = this.buffer.trim();
        this.buffer = '';
        return rest ? [rest] : [];
    }

    findCut() {
        let depth = 0;
        let clause = -1;
        for (let i = 0; i < this.buffer.length; i++) {
            const c = this.buffer[i];
            if (c === '[') depth++;
            else if (c === ']') depth = Math.max(0, depth - 1);
            if (depth) continue;
            const next = this.buffer[i + 1];
            if ('.!?'.includes(c) && next !== undefined && /\s/.test(next) && i >= 10) return i + 1;
            if ('。！？'.includes(c)) return i + 1;
            if (',;:'.includes(c) && next !== undefined && /\s/.test(next)) clause = i + 1;
        }
        if (this.emitted === 0 && clause >= 28) return clause;
        return -1;
    }
}

/** Opens the TTS WebSocket. Call once per session, before the first turn. */
function connectTts(apiKey) {
    const url = `${API_BASE_URL.replace(/^http/, 'ws')}/tts/v1/voice:streamBidirectional`;
    const ws = new WebSocket(url, { headers: { Authorization: `Basic ${apiKey}` } });
    return new Promise((resolve, reject) => {
        ws.once('open', () => resolve(ws));
        ws.once('error', reject);
    });
}

/**
 * Streams assistant text deltas from the Inworld Router (OpenAI-compatible SSE).
 * @returns {AsyncGenerator<string>}
 */
async function* streamLlm(apiKey, model, messages) {
    const res = await fetch(`${API_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Basic ${apiKey}`, 'Content-Type': 'application/json' },
        // Models that don't reason ignore reasoning_effort; reasoning models answer seconds sooner.
        body: JSON.stringify({ model, messages, stream: true, reasoning_effort: 'none' }),
    });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${await res.text()}`);
    const decoder = new TextDecoder();
    let pending = '';
    for await (const bytes of res.body) {
        pending += decoder.decode(bytes, { stream: true });
        let nl;
        while ((nl = pending.indexOf('\n')) >= 0) {
            const line = pending.slice(0, nl).trim();
            pending = pending.slice(nl + 1);
            if (!line.startsWith('data:') || line === 'data: [DONE]') continue;
            const delta = JSON.parse(line.slice(5)).choices?.[0]?.delta?.content;
            if (delta) yield delta;
        }
    }
}

/**
 * Speaks one reply: creates its context, streams the LLM into it, and collects the audio.
 * @returns {Promise<{pcm: Buffer, timeline: object, reply: string, visemes: number}>}
 */
async function speakReply(ws, apiKey, { userText, llmModel, voiceId, sentenceBoundary, lipsync }) {
    const contextId = `reply-${Date.now()}`;
    const turnEnd = performance.now(); // the user's turn just ended: the clock for everything below
    const since = () => Math.round(performance.now() - turnEnd);
    const timeline = { llmFirstToken: null, firstSentence: null, firstTextToTts: null, firstAudio: null };
    const audio = [];
    let visemes = 0;
    let reply = '';

    const done = new Promise((resolve, reject) => {
        const onMessage = (data) => {
            const msg = JSON.parse(data.toString());
            const result = msg.result || {};
            if (result.contextId && result.contextId !== contextId) return;
            if (msg.error || (result.status && result.status.code)) {
                ws.off('message', onMessage);
                reject(new Error(JSON.stringify(msg.error || result.status)));
                return;
            }
            const chunk = result.audioChunk;
            if (chunk && chunk.audioContent) {
                timeline.firstAudio ??= since();
                audio.push(Buffer.from(chunk.audioContent, 'base64'));
                // Audio-derived visemes travel with their audio; absent if lip-sync is unavailable.
                visemes += chunk.timestampInfo?.lipsyncAlignment?.visemes?.length || 0;
            }
            if (result.contextClosed) {
                ws.off('message', onMessage);
                resolve();
            }
        };
        ws.on('message', onMessage);
    });
    const send = (message) => ws.send(JSON.stringify({ contextId, ...message }));

    // 2. Create the context now, in parallel with the LLM request; don't wait for contextCreated.
    send({
        create: {
            voiceId,
            modelId: 'inworld-tts-2',
            audioConfig: { audioEncoding: 'PCM', sampleRateHertz: SAMPLE_RATE },
            timestampType: 'WORD',
            timestampTransportStrategy: 'ASYNC', // 5. audio is never held back for alignment
            ...(lipsync ? { lipsyncConfig: {} } : {}),
            ...(sentenceBoundary ? { autoMode: true, autoModeStrategy: 'SENTENCE_BOUNDARY' } : {}),
        },
    });

    const messages = [
        { role: 'system', content: 'You are a friendly voice assistant. Answer in two or three short spoken sentences.' },
        { role: 'user', content: userText },
    ];
    const splitter = new SentenceSplitter();
    const probe = new SentenceSplitter(); // only timestamps "first sentence complete", in both modes
    const sendPiece = (text, flush) => {
        timeline.firstTextToTts ??= since();
        send({ sendText: { text, ...(flush ? { flushContext: {} } : {}) } });
    };
    for await (const delta of streamLlm(apiKey, llmModel, messages)) {
        timeline.llmFirstToken ??= since();
        reply += delta;
        if (timeline.firstSentence === null && probe.push(delta).length) timeline.firstSentence = since();
        // 4. One context for the whole reply: every token, or a flush per sentence.
        if (sentenceBoundary) sendPiece(delta, false);
        else for (const sentence of splitter.push(delta)) sendPiece(sentence, true);
    }
    if (!sentenceBoundary) for (const sentence of splitter.flush()) sendPiece(sentence, true);
    timeline.firstSentence ??= since();
    send({ closeContext: {} }); // synthesizes what is still buffered, then closes
    await done;
    return { pcm: Buffer.concat(audio), timeline, reply, visemes };
}

function writeWav(path, pcm) {
    const header = Buffer.alloc(44);
    header.write('RIFF', 0);
    header.writeUInt32LE(36 + pcm.length, 4);
    header.write('WAVE', 8);
    header.write('fmt ', 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(SAMPLE_RATE, 24);
    header.writeUInt32LE(SAMPLE_RATE * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write('data', 36);
    header.writeUInt32LE(pcm.length, 40);
    fs.writeFileSync(path, Buffer.concat([header, pcm]));
}

async function main() {
    const apiKey = checkApiKey();
    if (!apiKey) return 1;
    const args = process.argv.slice(2);
    const option = (name, fallback) => {
        const i = args.indexOf(name);
        return i >= 0 ? args.splice(i, 2)[1] : fallback;
    };
    const flag = (name) => {
        const i = args.indexOf(name);
        return i >= 0 ? (args.splice(i, 1), true) : false;
    };
    const options = {
        llmModel: option('--llm-model', 'openai/gpt-4.1-mini'),
        voiceId: option('--voice', 'Sarah'),
        sentenceBoundary: flag('--sentence-boundary'),
        lipsync: flag('--lipsync'),
    };
    options.userText = args.join(' ') || 'What is a fun fact about the Moon?';

    // 1. Connect before the turn: in an app, at session start.
    const ws = await connectTts(apiKey);
    try {
        const { pcm, timeline, reply, visemes } = await speakReply(ws, apiKey, options);
        console.log(`Reply: ${reply.trim()}\n`);
        console.log(`Mode: ${options.sentenceBoundary ? 'SENTENCE_BOUNDARY (tokens streamed)' : 'flush per sentence'}`);
        console.log('Timeline, ms from the end of the user\'s turn:');
        console.log(`  LLM first token          ${timeline.llmFirstToken}`);
        console.log(`  first sentence complete  ${timeline.firstSentence}`);
        console.log(`  first text sent to TTS   ${timeline.firstTextToTts}`);
        console.log(`  first audio received     ${timeline.firstAudio}`);
        console.log(`  → audio ${timeline.firstAudio - timeline.firstSentence} ms after the first sentence was complete`);
        if (options.lipsync) {
            console.log(visemes ? `Lip-sync: ${visemes} viseme spans` : 'Lip-sync: no lipsyncAlignment returned (not enabled for this key/region?)');
        }
        writeWav('llm_tts_pipeline_output.wav', pcm);
        console.log(`\nWrote ${(pcm.length / 2 / SAMPLE_RATE).toFixed(1)} s of audio to llm_tts_pipeline_output.wav`);
        return 0;
    } catch (error) {
        console.log(`Failed: ${error.message}`);
        return 1;
    } finally {
        ws.close();
    }
}

if (require.main === module) {
    main().then(process.exit);
}

module.exports = { SentenceSplitter, connectTts, streamLlm, speakReply };
